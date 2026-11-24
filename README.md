# pumpfun-replay-sprint

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Hellboys87/pumpfun-replay-sprint/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Hellboys87/pumpfun-replay-sprint/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A deterministic paper-trading bot for the pump.fun replay harness (agent-fun/replay/v2). It never buys a launch on sight: it keeps a short rolling window of trades per mint and only enters when buy-side SOL dominates and the curve price is already rising inside that window. Positions exit on a fixed take-profit, stop-loss, trailing drop, or time limit, so the 10 SOL of paper capital keeps rotating across many coins. No clock, no randomness, no network — the same replay always produces the same orders.

## Run it

```sh
node main.ts
```

The bot speaks the replay protocol on stdin/stdout: it reads the hello line, then one batch line per slot, and replies with its orders for that batch. It is normally driven by the make.fun replay harness, which supplies the recorded chain data and scores the final account.

---

<sub>Entered on [make.fun](https://make.fun/?ref=9xcq3bkm&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
