// Personal risk rules printed on every playbook. Edit to taste (or set env vars on Vercel).
export const RULES = {
  maxContracts: Number(process.env.MAX_CONTRACTS ?? 2),
  timeStopMin: Number(process.env.TIME_STOP_MIN ?? 20), // exit if the trade hasn't worked in N minutes
  dailyMaxLoss: Number(process.env.DAILY_MAX_LOSS ?? 400), // $ — flat for the day when hit
  maxStopsAtLevel: Number(process.env.MAX_STOPS_AT_LEVEL ?? 2), // stop fading a level after N losses
};
export const GEX_SYMBOL = process.env.GEX_SYMBOL ?? "QQQ";
