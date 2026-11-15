// Offline end-to-end test with synthetic data (sandbox can't reach Yahoo/CBOE).
import { buildReport } from "../lib/bias";

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
const chart = (ts: number[], c: number[], v = 1000) => ({ chart: { result: [{ timestamp: ts.map((t) => t / 1000), indicators: { quote: [{ open: c, high: c.map((x) => x * 1.002), low: c.map((x) => x * 0.998), close: c, volume: c.map(() => v) }] } }] } });

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
function chain() {
  const spot = 520, options: any[] = [];
  for (const exp of ["261120", "261127", "261218"]) for (let k = 470; k <= 570; k += 5) for (const ty of ["C", "P"]) {
    const oi = ty === "C" ? (k === 540 ? 90000 : 8000) : (k === 500 ? 90000 : 9000);
    options.push({ option: `QQQ${exp}${ty}${String(k * 1000).padStart(8, "0")}`, open_interest: oi, gamma: 0, volume: oi / 10, iv: 0.22 });
  }
  return { data: { current_price: spot, options } };
}
const cal = [
  { title: "Empire State Manufacturing Index", country: "USD", date: "2026-11-16T08:30:00-05:00", impact: "Medium", forecast: "5.2", previous: "10.7" },
  { title: "FOMC Member Speaks", country: "USD", date: "2026-11-16T10:00:00-05:00", impact: "High", forecast: "", previous: "" },
  { title: "CPI m/m", country: "USD", date: "2026-11-18T08:30:00-05:00", impact: "High", forecast: "0.3%", previous: "0.2%" },
];
(globalThis as any).fetch = async (url: string) => {
  const u = new URL(url); let body: any;
  if (u.host.includes("yahoo")) {
    const sym = decodeURIComponent(u.pathname.split("/").pop()!);
    if (u.searchParams.get("interval") === "1d") body = chart(days, S[symMap[sym]]);
    else if (sym === "NQ=F") body = intraday();
    else body = chart([now - 6e5], [520 * 1.0]);
  } else if (u.host.includes("cboe")) body = chain();
  else if (u.host.includes("faireconomy")) body = cal;
  else return new Response("no", { status: 404 });
  return new Response(JSON.stringify(body), { status: 200 });
};
Date.now = () => now;
buildReport(now).then((r) => {
  const m = r.model!;
  console.log("errors:", r.errors);
  console.log("last", r.last?.toFixed(1), "| levels", JSON.stringify(r.levels?.prior), "| ON", JSON.stringify(r.levels?.overnight));
  console.log("gex", r.gex && { net: r.gex.netGex.toFixed(2), flip: r.gex.flip?.toFixed(1), cw: r.gex.callWall, pw: r.gex.putWall, nqFlip: r.gex.nq.flip?.toFixed(0) });
  console.log("events", r.events.map((e) => `${e.etTime} ${e.title}`));
  console.log("factors:"); for (const f of m.factors) console.log(`  ${f.id.padEnd(9)} IS ${f.icIS.toFixed(3)} (${f.tIS.toFixed(1)})  OOS ${f.icOOS.toFixed(3)} (${f.tOOS.toFixed(1)})  used=${f.usable}`);
  console.log("oos", m.oos, "asOf", m.asOf);
  console.log("lean", r.lean, "|", r.regime, "\nfloor", r.floor, "\nBL:", r.bottomLine);
});
