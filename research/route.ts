import { yahooBars, et, valueArea, loadRows, type Bar } from "./core";

const COST = 1.0;

type Session = { date: string; bars: Bar[]; open: number; close: number; prevClose: number | null; prevBars: Bar[] | null; onHigh: number; onLow: number };
type Call = { date: string; dir: 1 | -1; entry: number; exit: number };
type Stat = {
  id: string; label: string; group: string; note: string;
  n: number; hit: number; avgPts: number; t: number; totalPts: number;
  firstHalfAvg: number; secondHalfAvg: number;
  longAvg: number; // always-long over the same entry→exit windows, for comparison
  verdict: "EDGE" | "WEAK" | "NONE" | "THIN";
};

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(a.length - 1, 1)); };

function stat(id: string, label: string, group: string, note: string, calls: Call[]): Stat {
  const pts = calls.map((c) => c.dir * (c.exit - c.entry) - COST);
  const longs = calls.map((c) => c.exit - c.entry - COST);
  const n = pts.length, h = Math.floor(n / 2);
  const avg = mean(pts), t = n > 2 ? avg / (sd(pts) / Math.sqrt(n)) : 0;
  const a1 = mean(pts.slice(0, h)), a2 = mean(pts.slice(h));
  const verdict: Stat["verdict"] = n < 30 ? "THIN"
    : t >= 2.9 && a1 > 0 && a2 > 0 && avg > mean(longs) ? "EDGE"   // ~Bonferroni for ~15 signals tested
    : t >= 2 && a1 > 0 && a2 > 0 ? "WEAK" : "NONE";
  return {
    id, label, group, note, n, hit: n ? pts.filter((p) => p > 0).length / n : NaN, avgPts: avg, t, totalPts: avg * n,
    firstHalfAvg: a1, secondHalfAvg: a2, longAvg: mean(longs), verdict,
  };
}

// Build RTH sessions from intraday bars. Works for :00- or :30-stamped bars.
function sessions(bars: Bar[], startMin = 9 * 60 + 30): Session[] {
  const by = new Map<string, Bar[]>();
  for (const b of bars) {
    const e = et(b.t);
    if (e.min >= startMin && e.min < 16 * 60) {
      if (!by.has(e.date)) by.set(e.date, []);
      by.get(e.date)!.push(b);
    }
  }
  const dates = [...by.keys()].sort();
  const out: Session[] = [];
  for (let i = 0; i < dates.length; i++) {
    const bs = by.get(dates[i])!;
    if (bs.length < 3) continue;
    const prev = i > 0 ? by.get(dates[i - 1])! : null;
    const prevCloseT = prev ? prev[prev.length - 1].t : -Infinity;
    const on = bars.filter((b) => b.t > prevCloseT && b.t < bs[0].t);
    out.push({
      date: dates[i], bars: bs, open: bs[0].o, close: bs[bs.length - 1].c,
      prevClose: prev ? prev[prev.length - 1].c : null, prevBars: prev,
      onHigh: on.length ? Math.max(...on.map((b) => b.h)) : NaN, onLow: on.length ? Math.min(...on.map((b) => b.l)) : NaN,
    });
  }
  return out;
}

// ---- price signals ----
function noiseArea(S: Session[], lookback = 14, firstCheck = 1, stopInside = false, only?: Set<string>): Call[] {
  const calls: Call[] = [];
  for (let i = lookback; i < S.length; i++) {
    const s = S[i]; if (s.prevClose == null) continue;
    for (let k = firstCheck; k < s.bars.length - 1; k++) {
      const hist = S.slice(i - lookback, i).map((p) => p.bars[k] ? Math.abs(p.bars[k].c / p.open - 1) : NaN).filter((x) => !isNaN(x));
      if (hist.length < lookback / 2) continue;
      const sig = mean(hist);
      const up = Math.max(s.open, s.prevClose) * (1 + sig), dn = Math.min(s.open, s.prevClose) * (1 - sig);
      const c = s.bars[k].c;
      const dir = c > up ? 1 : c < dn ? -1 : 0;
      if (!dir) continue;
      if (only && !only.has(s.date)) break;
      let exit = s.close;
      if (stopInside) {
        for (let j = k + 1; j < s.bars.length - 1; j++) { const cj = s.bars[j].c; if ((dir === 1 && cj < up) || (dir === -1 && cj > dn)) { exit = cj; break; } }
      }
      calls.push({ date: s.date, dir: dir as 1 | -1, entry: c, exit }); break;
    }
  }
  return calls;
}

const firstBarMomentum = (S: Session[], k = 0): Call[] => S.filter((s) => s.bars.length > k + 2).map((s) => {
  const c = s.bars[k].c; return { date: s.date, dir: (c >= s.open ? 1 : -1) as 1 | -1, entry: c, exit: s.close };
});

const gapGo = (S: Session[]): Call[] => S.filter((s) => s.prevClose != null && s.open !== s.prevClose)
  .map((s) => ({ date: s.date, dir: (s.open > s.prevClose! ? 1 : -1) as 1 | -1, entry: s.open, exit: s.close }));

function inventory(S: Session[]): Call[] {
  const out: Call[] = [];
  for (const s of S) {
    if (!s.prevBars) continue;
    const va = valueArea(s.prevBars, 5);
    if (s.open > va.vah) out.push({ date: s.date, dir: 1, entry: s.open, exit: s.close });
    else if (s.open < va.val) out.push({ date: s.date, dir: -1, entry: s.open, exit: s.close });
  }
  return out;
}

// order-flow PROXY from OHLCV (not true delta): close-location value × volume over the first bar(s)
const flowProxy = (S: Session[], k = 0): Call[] => S.filter((s) => s.bars.length > k + 2).map((s) => {
  const f = s.bars.slice(0, k + 1).reduce((a, b) => a + (b.h > b.l ? ((b.c - b.l) - (b.h - b.c)) / (b.h - b.l) : 0) * b.v, 0);
  return { date: s.date, dir: (f >= 0 ? 1 : -1) as 1 | -1, entry: s.bars[k].c, exit: s.close };
});

// ---- macro / cross-asset ----
function overnightCross(S: Session[], other: Bar[], invert: boolean): Call[] {
  const out: Call[] = [];
  for (const s of S) {
    if (!s.prevBars) continue;
    const t0 = s.prevBars[s.prevBars.length - 1].t, t1 = s.bars[0].t;
    // a = bar starting at the prior session's last hour (closes 16:00); b = last bar that CLOSES by the NQ open
    const a = other.filter((b) => b.t <= t0).at(-1), b = other.filter((x) => x.t < t1).at(-1);
    if (!a || !b || a === b) continue;
    const up = b.c > a.c;
    if (b.c === a.c) continue;
    out.push({ date: s.date, dir: ((up !== invert) ? 1 : -1) as 1 | -1, entry: s.open, exit: s.close });
  }
  return out;
}

const FOMC = ["2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12", "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28"];

function preFomc(S: Session[]): Call[] {
  // long from RTH open to the 14:00 ET statement
  return S.filter((s) => FOMC.includes(s.date)).map((s) => {
    const pre = s.bars.filter((b) => et(b.t).min < 14 * 60).at(-1)!;
    return { date: s.date, dir: 1 as const, entry: s.open, exit: pre.c };
  });
}

function opexWeek(S: Session[], inWeek: boolean): Call[] {
  const third = (d: string) => { const [y, m] = d.split("-").map(Number); const f = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return 1 + ((5 - f + 7) % 7) + 14; };
  return S.filter((s) => { const day = Number(s.date.slice(8)); const t = third(s.date); return (day > t - 5 && day <= t) === inWeek; })
    .map((s) => ({ date: s.date, dir: 1 as const, entry: s.open, exit: s.close }));
}

// daily factors (incl. options-implied) → next RTH session open→close, walk-forward
async function factorIntraday(S: Session[]) {
  const [rows, vix, v9, vv, sk] = await Promise.all([
    loadRows(), yahooBars("^VIX", "1d", "5y", 6 * 3600), yahooBars("^VIX9D", "1d", "5y", 6 * 3600),
    yahooBars("^VVIX", "1d", "5y", 6 * 3600), yahooBars("^SKEW", "1d", "5y", 6 * 3600),
  ]);
  const dmap = (bs: Bar[]) => new Map(bs.map((b) => [et(b.t + 12 * 3600e3).date, b.c]));
  const mvix = dmap(vix), m9 = dmap(v9), mv = dmap(vv), ms = dmap(sk);
  const rmap = new Map(rows.map((r) => [r.date, r]));
  const data: { f: Record<string, number>; y: number }[] = [];
  for (let i = 1; i < S.length; i++) {
    const pd = S[i - 1].date, r = rmap.get(pd);
    if (!r) continue;
    const f: Record<string, number> = { ...r.f };
    const v = mvix.get(pd), v9c = m9.get(pd);
    if (v && v9c) f.vix9d_vix = v9c / v;          // short-dated vs 30-day implied vol (options-implied stress)
    if (mv.get(pd) != null) f.vvix = mv.get(pd)!; // vol of vol
    if (ms.get(pd) != null) f.skew = ms.get(pd)!; // CBOE SKEW (tail-hedging demand)
    data.push({ f, y: S[i].close - S[i].open });
  }
  const keys = ["nq_ret1", "nq_trend", "vix_chg", "vix_term", "vxn", "tnx_chg", "dxy_chg", "hyg_ret5", "smh_rel5", "vix9d_vix", "vvix", "skew"];
  const corr = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); };
  return keys.map((k) => {
    const d = data.filter((p) => p.f[k] != null && isFinite(p.f[k]));
    const h = Math.floor(d.length / 2);
    const ic1 = corr(d.slice(0, h).map((p) => p.f[k]), d.slice(0, h).map((p) => p.y));
    const ic2 = corr(d.slice(h).map((p) => p.f[k]), d.slice(h).map((p) => p.y));
    const ic = corr(d.map((p) => p.f[k]), d.map((p) => p.y));
    const volIc = corr(d.map((p) => p.f[k]), d.map((p) => Math.abs(p.y)));
    return { factor: k, n: d.length, ic, t: (ic * Math.sqrt(d.length - 2)) / Math.sqrt(1 - ic * ic), icFirstHalf: ic1, icSecondHalf: ic2, volIc, stable: Math.sign(ic1) === Math.sign(ic2) };
  });
}

async function factorQQQ() {
  const [rows, qqq, vix, vv, v9, sk] = await Promise.all([loadRows(), yahooBars("QQQ", "1d", "max", 6 * 3600), yahooBars("^VIX", "1d", "max", 6 * 3600), yahooBars("^VVIX", "1d", "max", 6 * 3600), yahooBars("^VIX9D", "1d", "max", 6 * 3600), yahooBars("^SKEW", "1d", "max", 6 * 3600)]);
  const day = (b: Bar) => et(b.t + 12 * 3600e3).date;
  const dmap = (bs: Bar[]) => new Map(bs.map((b) => [day(b), b.c]));
  const mvix = dmap(vix), mv = dmap(vv), m9 = dmap(v9), ms = dmap(sk);
  const rmap = new Map(rows.map((r) => [r.date, r]));
  const q = qqq.filter((b) => b.o > 0);
  const data: { date: string; f: Record<string, number>; y: number }[] = [];
  for (let i = 1; i < q.length; i++) {
    const pd = day(q[i - 1]), r = rmap.get(pd);
    if (!r) continue;
    const f: Record<string, number> = { ...r.f };
    const v = mvix.get(pd);
    if (v && m9.get(pd)) f.vix9d_vix = m9.get(pd)! / v;
    if (mv.get(pd) != null) f.vvix = mv.get(pd)!;
    if (ms.get(pd) != null) f.skew = ms.get(pd)!;
    data.push({ date: day(q[i]), f, y: q[i].c / q[i].o - 1 });
  }
  const corr = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); };
  const keys = ["nq_ret1", "nq_trend", "vix_chg", "vix_term", "vxn", "tnx_chg", "dxy_chg", "hyg_ret5", "smh_rel5", "vix9d_vix", "vvix", "skew"];
  const factors = keys.map((k) => {
    const d = data.filter((p) => p.f[k] != null && isFinite(p.f[k]));
    const thirds = [0, 1, 2].map((j) => d.slice(Math.floor((j * d.length) / 3), Math.floor(((j + 1) * d.length) / 3)));
    const ics = thirds.map((t) => corr(t.map((p) => p.f[k]), t.map((p) => p.y)));
    const ic = corr(d.map((p) => p.f[k]), d.map((p) => p.y));
    return { factor: k, n: d.length, from: d[0]?.date, to: d.at(-1)?.date, ic, t: (ic * Math.sqrt(d.length - 2)) / Math.sqrt(1 - ic * ic), icByThird: ics, stable: ics.every((x) => Math.sign(x) === Math.sign(ic)), volIc: corr(d.map((p) => p.f[k]), d.map((p) => Math.abs(p.y))) };
  });
  // fear-bounce: long QQQ open->close the day after the factor is in its top 20% of the trailing year
  const rule = (k: string) => {
    const res: number[] = [], base: number[] = [];
    for (let i = 252; i < data.length; i++) {
      const v = data[i].f[k]; if (v == null) continue;
      const hist = data.slice(i - 252, i).map((p) => p.f[k]).filter((x) => x != null).sort((a, b) => a - b);
      base.push(data[i].y);
      if (v >= hist[Math.floor(hist.length * 0.8)]) res.push(data[i].y);
    }
    const t = mean(res) / (sd(res) / Math.sqrt(res.length));
    const h = Math.floor(res.length / 2);
    return { rule: `${k} top 20% -> long next day`, n: res.length, avgPct: mean(res) * 100, hit: res.filter((x) => x > 0).length / res.length, t, firstHalfPct: mean(res.slice(0, h)) * 100, secondHalfPct: mean(res.slice(h)) * 100, allDaysAvgPct: mean(base) * 100 };
  };
  return { factors, rules: ["vvix", "vix_term", "vix9d_vix", "vxn"].map(rule) };
}

async function runResearch() {
  const errors: string[] = [];
  const get = async (s: string, i: string, r: string) => { try { return await yahooBars(s, i, r, 3600); } catch (e: any) { errors.push(`${s} ${i}: ${e.message}`); return [] as Bar[]; } };
  const [nqH, nq5, zn, dx, es] = await Promise.all([
    get("NQ=F", "60m", "730d"), get("NQ=F", "5m", "60d"), get("ZN=F", "60m", "730d"), get("DX-Y.NYB", "60m", "730d"), get("ES=F", "60m", "730d"),
  ]);
  const hourMin = nqH.length ? et(nqH[0].t).min % 60 : 0;
  const SH = sessions(nqH, hourMin === 30 ? 9 * 60 + 30 : 9 * 60); // hourly: 09:00 or 09:30 first bar
  const S5 = sessions(nq5);

  const stats: Stat[] = [
    stat("noise_h", "Noise-area breakout (hourly checks)", "Price momentum", "Concretum-style band from 14-day average move by time of day; first close outside band, exit at RTH close. No trailing stop.", noiseArea(SH, 14, 0)),
    stat("noise_5m", "Noise-area breakout (30-min checks, 60 days)", "Price momentum", "Same rule on 5-min data, checks every 30 min from 10:00 ET. Only ~40 sessions available free.", noiseArea(S5.map((s) => ({ ...s, bars: s.bars.filter((_, j) => j % 6 === 5) })), 14, 0)),
    stat("first_hour", "First-hour direction → rest of day", "Price momentum", "Direction of the first RTH hour, held to the close.", firstBarMomentum(SH, 0)),
    stat("first_30", "First 30 min → rest of day (60 days)", "Price momentum", "5-min data.", firstBarMomentum(S5, 5)),
    stat("gap_go", "Gap direction (gap-and-go)", "Auction / inventory", "Trade the overnight gap's direction from open to close. A negative result means gaps fade.", gapGo(SH)),
    stat("inventory", "Open outside prior value area → follow", "Auction / inventory", "Open above prior VAH = long, below VAL = short, open to close. Value area from hourly bars.", inventory(SH)),
    stat("flow_proxy_1h", "Order-flow proxy, first hour", "Order flow (proxy)", "Close-location × volume of the first hour. OHLCV proxy, NOT true bid/ask delta.", flowProxy(SH, 0)),
    stat("flow_proxy_30", "Order-flow proxy, first 30 min (60 days)", "Order flow (proxy)", "Same proxy on 5-min bars.", flowProxy(S5, 5)),
    stat("rates_overnight", "Overnight bond rally → long NQ", "Macro cross-asset", "10Y note futures (ZN) up from prior RTH close to open = yields down → long; else short.", overnightCross(SH, zn, false)),
    stat("dollar_overnight", "Overnight dollar drop → long NQ", "Macro cross-asset", "DXY down overnight → long; up → short.", overnightCross(SH, dx, true)),
    stat("es_overnight", "Overnight ES direction → NQ", "Macro cross-asset", "S&P futures direction overnight → same direction NQ open to close.", overnightCross(SH, es, false)),
    stat("pre_fomc", "Pre-FOMC drift (open → 14:00)", "Macro events", "Long on FOMC days into the statement. The published drift faded after 2015.", preFomc(SH)),
    stat("opex_week", "Monthly OpEx week, long", "Options calendar", "Long open to close in the week ending on the third Friday.", opexWeek(SH, true)),
    stat("non_opex", "Non-OpEx weeks, long (baseline)", "Options calendar", "Comparison for the row above.", opexWeek(SH, false)),
  ];
  const vxnBy = new Map<string, number>();
  try { (await loadRows()).forEach((r) => vxnBy.set(r.date, r.f.vxn)); } catch {}
  const med = (() => { const v = [...vxnBy.values()].slice(-600).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; })();
  const hiVol = new Set(SH.slice(1).filter((s, i) => (vxnBy.get(SH[i].date) ?? 0) >= med).map((s) => s.date));
  const loVol = new Set(SH.slice(1).filter((s, i) => (vxnBy.get(SH[i].date) ?? 1e9) < med).map((s) => s.date));
  stats.push(
    stat("noise_h_stop", "Noise-area breakout + exit back inside band", "Price momentum", "Same entry; exits at the first later hourly close back inside the band, else at RTH close.", noiseArea(SH, 14, 0, true)),
    stat("noise_h_hivol", "Noise-area breakout, high-vol days only", "Price momentum", "Only when prior-day VXN is above its 2-year median.", noiseArea(SH, 14, 0, false, hiVol)),
    stat("noise_h_lovol", "Noise-area breakout, low-vol days only", "Price momentum", "Only when prior-day VXN is below its 2-year median.", noiseArea(SH, 14, 0, false, loVol)),
  );
  let qqq: Awaited<ReturnType<typeof factorQQQ>> | null = null;
  try { qqq = await factorQQQ(); } catch (e: any) { errors.push(`qqq factors: ${e.message}`); }
  let factors: Awaited<ReturnType<typeof factorIntraday>> = [];
  try { factors = await factorIntraday(SH); } catch (e: any) { errors.push(`factors: ${e.message}`); }

  return {
    generatedAt: Date.now(), cost: COST,
    coverage: { hourlySessions: SH.length, hourlyFrom: SH[0]?.date, hourlyTo: SH.at(-1)?.date, fiveMinSessions: S5.length, hourBarMinute: hourMin },
    stats, factors, qqq, errors,
  };
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET() { return Response.json(await runResearch()); }
