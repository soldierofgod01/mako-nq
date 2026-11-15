import { yahooBars, type Bar } from "./sources";
import { et } from "./levels";

// Daily macro factors, tested walk-forward against NQ next-day return.
// Weights are NOT hand-picked: a factor only gets weight if it held up out-of-sample.

export const SYMBOLS = {
  nq: "NQ=F", qqq: "QQQ", vix: "^VIX", vix3m: "^VIX3M", vxn: "^VXN",
  tnx: "^TNX", dxy: "DX-Y.NYB", hyg: "HYG", smh: "SMH",
} as const;
type Key = keyof typeof SYMBOLS;

export const FACTORS: { id: string; label: string; desc: string }[] = [
  { id: "nq_ret1", label: "NQ prior-day return", desc: "Momentum (+) vs mean reversion (−)" },
  { id: "nq_trend", label: "NQ vs 20d SMA", desc: "Distance from 20-day average" },
  { id: "vix_chg", label: "VIX 1d % change", desc: "Fear spike / crush" },
  { id: "vix_term", label: "VIX / VIX3M", desc: ">1 = backwardation (stress)" },
  { id: "vxn", label: "VXN level", desc: "Nasdaq implied vol" },
  { id: "tnx_chg", label: "10Y yield 1d change (bp)", desc: "Rates pressure on duration/tech" },
  { id: "dxy_chg", label: "DXY 1d % change", desc: "Dollar strength" },
  { id: "hyg_ret5", label: "HYG 5d return", desc: "Credit risk appetite" },
  { id: "smh_rel5", label: "SMH − QQQ 5d", desc: "Semis leadership" },
];

type Row = { date: string; f: Record<string, number>; next: number | null; close: number };

function dailyMap(bars: Bar[], now: number) {
  const today = et(now);
  const m = new Map<string, number>();
  for (const b of bars) {
    const d = et(b.t + 12 * 3600e3).date; // daily bars are stamped at session start; shift to trade date
    if (d === today.date && today.min < 16 * 60 + 15) continue; // drop today's incomplete bar
    m.set(d, b.c);
  }
  return m;
}

export async function loadRows(now = Date.now()): Promise<Row[]> {
  const keys = Object.keys(SYMBOLS) as Key[];
  const data = await Promise.all(keys.map((k) => yahooBars(SYMBOLS[k], "1d", "10y", 6 * 3600)));
  const maps = Object.fromEntries(keys.map((k, i) => [k, dailyMap(data[i], now)])) as Record<Key, Map<string, number>>;
  const dates = [...maps.nq.keys()].filter((d) => keys.every((k) => maps[k].has(d))).sort();
  const s = (k: Key, i: number) => maps[k].get(dates[i])!;
  const rows: Row[] = [];
  for (let i = 20; i < dates.length; i++) {
    const sma20 = dates.slice(i - 19, i + 1).reduce((a, _, j) => a + s("nq", i - 19 + j), 0) / 20;
    rows.push({
      date: dates[i],
      close: s("nq", i),
      next: i + 1 < dates.length ? s("nq", i + 1) / s("nq", i) - 1 : null,
      f: {
        nq_ret1: s("nq", i) / s("nq", i - 1) - 1,
        nq_trend: s("nq", i) / sma20 - 1,
        vix_chg: s("vix", i) / s("vix", i - 1) - 1,
        vix_term: s("vix", i) / s("vix3m", i),
        vxn: s("vxn", i),
        tnx_chg: (s("tnx", i) - s("tnx", i - 1)) * 100, // ^TNX quotes yield in % (e.g. 4.25) → bp
        dxy_chg: s("dxy", i) / s("dxy", i - 1) - 1,
        hyg_ret5: s("hyg", i) / s("hyg", i - 5) - 1,
        smh_rel5: s("smh", i) / s("smh", i - 5) - s("qqq", i) / s("qqq", i - 5),
      },
    });
  }
  return rows;
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function corr(x: number[], y: number[]) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
const tstat = (r: number, n: number) => (r * Math.sqrt(n - 2)) / Math.sqrt(1 - r * r);

export type FactorStat = {
  id: string; label: string; desc: string;
  icIS: number; tIS: number; icOOS: number; tOOS: number; volIcOOS: number;
  usable: boolean; weight: number; z: number; value: number; contribution: number;
};

export type ModelResult = {
  asOf: string; nIS: number; nOOS: number; splitDate: string;
  factors: FactorStat[];
  composite: number; // weighted z-score today
  oos: { hitRate: number; ic: number; t: number; baseUpRate: number; nSignals: number };
  dailySigma: number;
};

export function fitModel(rows: Row[]): ModelResult {
  const hist = rows.filter((r) => r.next !== null);
  const split = Math.floor(hist.length * 0.7);
  const IS = hist.slice(0, split), OOS = hist.slice(split);
  const today = rows[rows.length - 1];
  const nextIS = IS.map((r) => r.next!), nextOOS = OOS.map((r) => r.next!);

  const factors: FactorStat[] = FACTORS.map((F) => {
    const xIS = IS.map((r) => r.f[F.id]), xOOS = OOS.map((r) => r.f[F.id]);
    const icIS = corr(xIS, nextIS), icOOS = corr(xOOS, nextOOS);
    const tIS = tstat(icIS, IS.length), tOOS = tstat(icOOS, OOS.length);
    // usable only if same sign in both halves AND OOS is at least marginally significant
    const usable = Math.sign(icIS) === Math.sign(icOOS) && Math.abs(tIS) >= 1.5 && Math.abs(tOOS) >= 1.5;
    const m = mean(xIS), s = sd(xIS);
    const z = (today.f[F.id] - m) / s;
    const weight = usable ? icIS : 0;
    return {
      ...F, icIS, tIS, icOOS, tOOS, volIcOOS: corr(xOOS, nextOOS.map(Math.abs)),
      usable, weight, z, value: today.f[F.id], contribution: weight * z,
    };
  });

  // walk-forward check of the combined model: weights from IS, evaluated on OOS
  const isW = FACTORS.map((F) => {
    const xIS = IS.map((q) => q.f[F.id]);
    const ic = corr(xIS, nextIS);
    return { id: F.id, w: Math.abs(tstat(ic, IS.length)) >= 1.5 ? ic : 0, m: mean(xIS), s: sd(xIS) };
  });
  const comp = (r: Row) => isW.reduce((a, q) => a + q.w * ((r.f[q.id] - q.m) / q.s), 0);
  const compOOS = OOS.map(comp);
  const sig = compOOS.map((c, i) => ({ c, y: nextOOS[i] })).filter((p) => p.c !== 0);
  const hits = sig.filter((p) => Math.sign(p.c) === Math.sign(p.y)).length;
  const icComb = sig.length > 10 ? corr(sig.map((p) => p.c), sig.map((p) => p.y)) : 0;

  return {
    asOf: today.date, nIS: IS.length, nOOS: OOS.length, splitDate: OOS[0].date,
    factors,
    composite: factors.reduce((a, f) => a + f.contribution, 0),
    oos: {
      hitRate: sig.length ? hits / sig.length : NaN,
      ic: icComb, t: sig.length > 10 ? tstat(icComb, sig.length) : 0,
      baseUpRate: nextOOS.filter((y) => y > 0).length / nextOOS.length,
      nSignals: sig.length,
    },
    dailySigma: sd(hist.slice(-60).map((r) => r.next!)),
  };
}
