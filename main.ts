// Pump.fun Replay Sprint — paper bot (agent-fun/replay/v2)
// Fresh deterministic strategy: confirmed-flow entries, disciplined exits.
//
// Idea in one paragraph: most fresh pump.fun curves die quietly, so this bot
// never buys a launch on sight. It watches the trades in each batch, keeps a
// short rolling window per mint, and only spends paper SOL when strangers are
// demonstrably paying too: enough trades, buy-side SOL dominating sell-side
// SOL, and the curve price already rising inside the window. Every position
// then lives under fixed rules — a take-profit, a stop-loss, a trailing exit
// after a real run, and a hard time limit — so capital keeps rotating into
// new mints instead of riding one coin to zero. Rotation is also what clears
// the guardrail of round trips on at least 20 distinct coins.
//
// Determinism: no clock, no randomness, no environment reads. Every decision
// is a pure function of the hello message and the batches seen so far.

import { runBot, LAMPORTS_PER_SOL } from './vendor/makefun-bot.ts';
import type { BotState, Batch, OrderInput, TradeEventRecord } from './vendor/makefun-bot.ts';

// ---- tunables (all fixed constants: same input, same orders) ----
const BUY_LAMPORTS = LAMPORTS_PER_SOL / 50n; // 0.02 SOL per entry, above the 0.01 SOL round-trip floor
const ENTRY_SLIPPAGE_BPS = 700;
const EXIT_SLIPPAGE_BPS = 1000;
const MIN_WINDOW_TRADES = 25;
const MIN_BUY_SHARE = 0.7; // buy SOL / total SOL in the window
const MIN_WINDOW_RISE = 0.08; // price now vs price at window start
const MIN_WINDOW_SOL = 3; // total SOL traded inside the window, as a float of lamports / 1e9
const MIN_REAL_QUOTE = 15n * LAMPORTS_PER_SOL;
const MAX_REAL_QUOTE = 220n * LAMPORTS_PER_SOL;
const MAX_WINDOW_RISE = 0.35; // a window already up more than this is a top, not an entry
const TAKE_PROFIT = 0.12;
const STOP_LOSS = -0.07;
const TRAIL_ARM = 0.06; // trailing exit arms once a position is up this much
const TRAIL_DROP = 0.09; // ...and fires when price falls this far from its peak
const MAX_HOLD_SLOTS = 220;
const REENTRY_COOLDOWN_SLOTS = 800;
const WINDOW_KEEP = 48; // trades remembered per mint

interface TradeNote {
  slot: number;
  isBuy: boolean;
  sol: number; // lamports as a float; only ratios are used, so precision is ample
  price: number; // virtual quote / virtual token after the trade
}

interface MintWatch {
  notes: TradeNote[];
  lastSeenSlot: number;
}

const watch = new Map<string, MintWatch>();
const peakPrice = new Map<string, number>();
const enteredSlot = new Map<string, number>();
const cooldownUntil = new Map<string, number>();

function priceOf(vQuote: bigint, vToken: bigint): number {
  if (vToken <= 0n) return 0;
  // Scale before dividing so tiny prices keep precision in float land.
  return Number((vQuote * 1_000_000_000n) / vToken) / 1_000_000_000;
}

function noteTrades(batch: Batch): void {
  for (const e of batch.events) {
    if (e.event !== 'TradeEvent') continue;
    const t = e as TradeEventRecord;
    let w = watch.get(t.mint);
    if (w === undefined) {
      w = { notes: [], lastSeenSlot: batch.slot };
      watch.set(t.mint, w);
    }
    w.notes.push({
      slot: batch.slot,
      isBuy: t.is_buy,
      sol: Number(BigInt(t.sol_amount)),
      price: priceOf(BigInt(t.virtual_quote_reserves), BigInt(t.virtual_token_reserves)),
    });
    if (w.notes.length > WINDOW_KEEP) w.notes.splice(0, w.notes.length - WINDOW_KEEP);
    w.lastSeenSlot = batch.slot;
  }
}

function windowStats(mint: string): { trades: number; buyShare: number; rise: number; totalSol: number; lateRise: number } | null {
  const w = watch.get(mint);
  if (w === undefined || w.notes.length === 0) return null;
  let buySol = 0;
  let totalSol = 0;
  for (const n of w.notes) {
    totalSol += n.sol;
    if (n.isBuy) buySol += n.sol;
  }
  const first = w.notes[0].price;
  const last = w.notes[w.notes.length - 1].price;
  if (first <= 0 || totalSol <= 0) return null;
  // Late rise: the second half of the window must still be climbing, not
  // merely sitting above where the window started after an early spike.
  const mid = w.notes[Math.floor(w.notes.length / 2)].price;
  const lateRise = mid > 0 ? last / mid - 1 : 0;
  return { trades: w.notes.length, buyShare: buySol / totalSol, rise: last / first - 1, totalSol: totalSol / 1_000_000_000, lateRise };
}

function exits(state: BotState, orders: OrderInput[]): void {
  for (const [mint, pos] of state.positions) {
    const curve = state.curves.get(mint);
    if (curve === undefined) continue;
    if (enteredSlot.get(mint) === undefined) enteredSlot.set(mint, state.slot);
    const price = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
    if (price <= 0) continue;
    const peak = Math.max(peakPrice.get(mint) ?? price, price);
    peakPrice.set(mint, peak);
    const costPrice = Number(pos.cost_lamports) / Number(pos.token_amount);
    const pnl = price / costPrice - 1;
    const heldFor = state.slot - (enteredSlot.get(mint) ?? state.slot);
    const trailed = pnl > -1 && peak > costPrice * (1 + TRAIL_ARM) && price <= peak * (1 - TRAIL_DROP);
    if (pnl >= TAKE_PROFIT || pnl <= STOP_LOSS || trailed || heldFor >= MAX_HOLD_SLOTS) {
      orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: EXIT_SLIPPAGE_BPS });
      cooldownUntil.set(mint, state.slot + REENTRY_COOLDOWN_SLOTS);
      peakPrice.delete(mint);
      enteredSlot.delete(mint);
    }
  }
}

function entries(state: BotState, batch: Batch, orders: OrderInput[]): void {
  if (state.committedPositionCount() >= state.hello.caps.max_open_positions) return;
  const seenThisBatch = new Set<string>();
  for (const e of batch.events) {
    if (orders.length >= 16) return;
    if (e.event !== 'TradeEvent') continue;
    const mint = e.mint;
    if (seenThisBatch.has(mint)) continue;
    seenThisBatch.add(mint);
    if (state.positions.has(mint)) continue;
    if (state.committedPositionCount() + orders.filter((o) => o.side === 'buy').length >= state.hello.caps.max_open_positions) return;
    let hasPending = false;
    for (const p of state.pending.values()) if (p.order.mint === mint) hasPending = true;
    if (hasPending) continue;
    if ((cooldownUntil.get(mint) ?? -1) > batch.slot) continue;
    const curve = state.curves.get(mint);
    if (curve === undefined || curve.complete) continue;
    if (curve.real_quote_reserves < MIN_REAL_QUOTE || curve.real_quote_reserves > MAX_REAL_QUOTE) continue;
    if (state.maxBuyLamports(mint) < BUY_LAMPORTS) continue;
    if (state.freeCashLamports() < BUY_LAMPORTS + state.txFeeLamports()) continue;
    const s = windowStats(mint);
    if (s === null) continue;
    if (s.trades < MIN_WINDOW_TRADES) continue;
    if (s.buyShare < MIN_BUY_SHARE) continue;
    if (s.rise < MIN_WINDOW_RISE) continue;
    if (s.rise > MAX_WINDOW_RISE) continue;
    if (s.totalSol < MIN_WINDOW_SOL) continue;
    if (s.lateRise < 0.02) continue;
    orders.push({ side: 'buy', mint, quote_lamports: BUY_LAMPORTS, max_slippage_bps: ENTRY_SLIPPAGE_BPS });
    enteredSlot.set(mint, batch.slot);
  }
}

await runBot({
  onHello(state) {
    console.error(`hello: capital ${state.hello.capital.lamports} lamports, max positions ${state.hello.caps.max_open_positions}`);
  },
  onBatch(state, batch) {
    noteTrades(batch);
    const orders: OrderInput[] = [];
    exits(state, orders);
    entries(state, batch, orders);
    return orders;
  },
  onDone(state, done) {
    console.error(`done: ${done.reason}, cash ${state.cash} lamports after final slot`);
  },
});
