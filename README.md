# NQ Bias

Daily pre-market bias for NQ/MNQ: macro factors, dealer gamma, levels, event risk, and your risk rules on one page.

## What it does

| Section | Source | Notes |
|---|---|---|
| **Directional lean** | Yahoo daily (10y): NQ, VIX, VIX3M, VXN, 10Y, DXY, HYG, SMH, QQQ | Walk-forward validated. A factor only gets weight if it's significant with the same sign in-sample (first 70%) and out-of-sample (last 30%). If nothing survives, it says **NEUTRAL**. |
| **Regime: fade VAH/VAL?** | CBOE delayed QQQ chain + VIX term structure + calendar | Negative gamma / below flip / inverted VIX curve → don't fade. **Hypothesis**, log your fades by regime to validate it. |
| **Levels** | Yahoo NQ=F 5m | Prior RTH H/L/VAH/POC/VAL, overnight H/L, plus QQQ gamma flip/walls mapped to NQ. |
| **Events** | ForexFactory weekly JSON | USD medium/high impact for today. |
| **Rules** | `lib/config.ts` / env vars | Max contracts, time stop, daily max loss, max stops at one level. |

`/` = dashboard (`?vah=&poc=&val=` to use your own MotiveWave levels) · `/api/bias` = JSON · `/api/cron` = daily job (save call, score finished sessions, post to Discord).

## Track record & validation

- **History:** on every load the app rebuilds ~2 years of value areas from hourly NQ and checks whether VAH/VAL touches reached POC, split by regime (VIX curve) and by trend. It also calibrates the range band so it held ~68% of sessions.
- **Live:** the weekday cron saves that day's call to Vercel Blob, then scores each finished session against it (touches → POC / back inside, range held). Needs a Blob store connected to the project (`BLOB_READ_WRITE_TOKEN`). Half-day sessions aren't scored.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npx tsx test/pipeline.ts            # offline test, synthetic data (no edge → nothing should be "used")
PLANT=1 npx tsx test/pipeline.ts    # synthetic data with a planted edge → vix_chg should be picked up
```

Deploy: import the repo in Vercel. `vercel.json` has a weekday cron at 12:00 UTC (07:00 ET / 17:30 IST) that hits the API.

Env vars (optional): `MAX_CONTRACTS`, `TIME_STOP_MIN`, `DAILY_MAX_LOSS`, `MAX_STOPS_AT_LEVEL`, `GEX_SYMBOL`, `DISCORD_WEBHOOK_URL` (morning post), `CRON_SECRET` (protects /api/cron), `BLOB_READ_WRITE_TOKEN` (set automatically when you connect a Blob store).

Cron runs at 12:xx UTC on weekdays (Hobby plan fires anywhere in that hour): 07:00–08:00 ET in winter, 17:30–18:30 IST.

## Limitations

- Yahoo's chart API is unofficial and can rate-limit or change. CBOE data is delayed 15 min and OI updates once a day.
- GEX assumes dealers are long calls and short puts. It's a regime gauge, not a precise level.
- The value area comes from 5-min bars, not ticks, so expect a few points of difference from MotiveWave.
- Daily macro factors have historically weak predictive power for next-day index direction. Most of the value is in volatility/regime context (the "Vol IC" column), not direction.
