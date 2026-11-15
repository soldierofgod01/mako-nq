// Offline end-to-end test with synthetic data (sandbox can't reach Yahoo/CBOE).

let seed = Number(process.env.SEED ?? 1);
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const PLANT = process.env.PLANT === "1"; // plant a real edge: next NQ return depends on today's VIX change

const DAY = 864e5, N = 2520, now = Date.parse("2026-11-16T13:00:00Z"); // 8:00 ET Monday
// daily series
const days: number[] = []; for (let t = now - 1.5 * N * DAY; days.length < N; t += DAY) { const d = new Date(t).getUTCDay(); if (d && d < 6) days.push(t); }
days.push(Date.parse("2026-11-13T05:00:00Z")); days.sort((a, b) => a - b);
const S: Record<string, number[]> = { nq: [15000], qqq: [380], vix: [16], vix3m: [18], vxn: [20], tnx: [4], dxy: [100], hyg: [78], smh: [200] };
let vixChgPrev = 0;
for (let i = 1; i < days.length; i++) {
  const vc = gauss() * 0.06;
  const nqr = gauss() * 0.012 + (PLANT ? -0.08 * vixChgPrev : 0) + 0.0004;
  vixChgPrev = vc;
  S.nq.push(S.nq[i - 1] * (1 + nqr)); S.qqq.push(S.qqq[i - 1] * (1 + nqr + gauss() * 0.001));
  S.vix.push(Math.max(9, S.vix[i - 1] * (1 + vc))); S.vix3m.push(Math.max(11, S.vix3m[i - 1] * (1 + vc * 0.5)));
  S.vxn.push(S.vix[i] * 1.2); S.tnx.push(S.tnx[i - 1] + gauss() * 0.05); S.dxy.push(S.dxy[i - 1] * (1 + gauss() * 0.004));
  S.hyg.push(S.hyg[i - 1] * (1 + gauss() * 0.003)); S.smh.push(S.smh[i - 1] * (1 + nqr * 1.3 + gauss() * 0.008));
}
const symMap: Record<string, string> = { "NQ=F": "nq", QQQ: "qqq", "^VIX": "vix", "^VIX3M": "vix3m", "^VXN": "vxn", "^TNX": "tnx", "DX-Y.NYB": "dxy", HYG: "hyg", SMH: "smh" };
const chart = (ts: number[], c: number[], v = 1000) => ({ chart: { result: [{ timestamp: ts.map((t) => t / 1000), indicators: { quote: [{ open: c.map((x, i) => (i ? c[i - 1] * (1 + gauss() * 0.004) : x)), high: c.map((x) => x * 1.002), low: c.map((x) => x * 0.998), close: c, volume: c.map(() => v) }] } }] } });

// intraday NQ 5m for Thu-Fri + overnight into Mon: build a market with a clear volume node at 21000
function intraday() {
  const ts: number[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
  let px = 21000;
  for (let t = Date.parse("2026-11-12T23:00:00Z"); t <= now - 5 * 60e3; t += 5 * 60e3) {
    const d = new Date(t); if (d.getUTCDay() === 6 || (d.getUTCDay() === 0 && d.getUTCHours() < 23) || (d.getUTCDay() === 5 && d.getUTCHours() >= 22)) continue;
    const step = gauss() * 6 + (21000 - px) * 0.02; const op = px; px += step;
    ts.push(t / 1000); o.push(op); c.push(px); h.push(Math.max(op, px) + 3); l.push(Math.min(op, px) - 3);
    const hr = (d.getUTCHours() + 19) % 24; v.push(hr >= 9 && hr < 16 ? 2000 : 200);
  }
  return { chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } };
}
// hourly NQ for ~2 years, all Globex hours, mean-reverting around a drifting level
function hourly() {
  const ts: number[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
  let px = 15000, anchor = 15000;
  for (let t = now - 730 * DAY; t < now - 3600e3; t += 3600e3) {
    const d = new Date(t); const etH = (d.getUTCHours() + 19) % 24;
    if (d.getUTCDay() === 6 || (d.getUTCDay() === 0 && etH < 18) || (d.getUTCDay() === 5 && etH >= 17) || etH === 17) continue;
    anchor *= 1 + gauss() * 0.002; const op = px; px += gauss() * 25 + (anchor - px) * 0.05;
    ts.push(t / 1000); o.push(op); c.push(px); h.push(Math.max(op, px) + Math.abs(gauss()) * 15); l.push(Math.min(op, px) - Math.abs(gauss()) * 15);
    v.push(etH >= 9 && etH < 16 ? 30000 : 3000);
  }
  return { chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } };
}
function chain() {
  const spot = 520, options: any[] = [];
  const exps: [string, number][] = [["261116", 0.19], ["261117", 0.24], ["261118", 0.27], ["261120", 0.29], ["261127", 0.25], ["261204", 0.24], ["261218", 0.235], ["270115", 0.228], ["270220", 0.222]];
  for (const [exp, base] of exps) for (let k = 490; k <= 550; k += 1) for (const ty of ["C", "P"]) {
    const round = k % 10 === 0 ? 6 : k % 5 === 0 ? 3 : 1;
    const dist = Math.abs(k - spot);
    const side = ty === "C" ? (k >= spot ? 1.3 : 0.4) : (k <= spot ? 1.3 : 0.4);
    const oi = Math.round(round * side * 4000 * Math.exp(-dist / 18) + (ty === "P" && k === 525 ? 60000 : 0) + (ty === "C" && k === 540 ? 50000 : 0));
    const vol = Math.round(oi * (exp <= "261120" ? 0.9 : 0.15) * (0.6 + rnd()));
    const iv = base + Math.max(0, (spot - k) / spot) * 0.9 + Math.max(0, (k - spot) / spot) * 0.15;
    options.push({ option: `QQQ${exp}${ty}${String(k * 1000).padStart(8, "0")}`, open_interest: oi, gamma: 0, volume: vol, iv });
  }
  return { data: { current_price: spot, options }, timestamp: "2026-11-15 14:57:27" };
}
const cal = [
  { title: "Empire State Manufacturing Index", country: "USD", date: "2026-11-16T08:30:00-05:00", impact: "Medium", forecast: "5.2", previous: "10.7" },
  { title: "FOMC Member Speaks", country: "USD", date: "2026-11-16T10:00:00-05:00", impact: "High", forecast: "", previous: "" },
  { title: "CPI m/m", country: "USD", date: "2026-11-18T08:30:00-05:00", impact: "High", forecast: "0.3%", previous: "0.2%" },
];
export const MOCK_NOW = now;
export function installMock() {
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (url: string) => {
  const u = new URL(url); let body: any;
  if (u.host.includes("yahoo")) {
    const sym = decodeURIComponent(u.pathname.split("/").pop()!);
    if (u.searchParams.get("interval") === "1d") body = chart(days, S[symMap[sym] ?? "vix"]);
    else if (u.searchParams.get("interval") === "60m") body = hourly();
    else if (sym === "NQ=F") body = intraday();
    else body = chart([now - 6e5], [520 * 1.0]);
  } else if (u.host.includes("cboe")) body = chain();
  else if (u.host.includes("faireconomy")) body = cal;
  else return realFetch(url as any);
  return new Response(JSON.stringify(body), { status: 200 });
};
}
