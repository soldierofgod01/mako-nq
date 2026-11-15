import { yahooBars, cboeChain, usdCalendar, type CalEvent } from "./sources";
import { computeLevels, et, type Levels, type Override } from "./levels";
import { computeGex, type Gex } from "./gex";
import { loadRows, fitModel, type ModelResult } from "./model";
import { regimeCall, type Fade } from "./regime";
import { backtestRegime, type RegimeBacktest } from "./backtest";
import { readSummary, targetSession, type Snapshot, type Summary } from "./daily";
import { storeEnabled } from "./store";
import { RULES, GEX_SYMBOL } from "./config";

export type Zone = { label: string; price: number; kind: "res" | "sup" };

export type BiasReport = {
  generatedAt: number;
  session: string; // the RTH session this plan is for
  last: number | null;
  model: ModelResult | null;
  levels: Levels | null;
  gex: (Gex & { nqRatio: number; nq: { flip: number | null; callWall: number; putWall: number } }) | null;
  events: (CalEvent & { etTime: string })[];
  sigma: number | null;          // VXN-implied 1σ in points
  rangeK: number;                // calibrated multiplier so ±k·σ held 68% of sessions historically
  expectedRange: number | null;  // k·σ
  lean: "LONG" | "SHORT" | "NEUTRAL";
  leanStrength: string;
  regime: { label: string; detail: string; fade: Fade };
  zones: Zone[];
  floor: Zone | null;
  bottomLine: string;
  rules: string[];
  backtest: RegimeBacktest | null;
  track: Summary | null;
  storeConnected: boolean;
  freshness: { label: string; asOf: string; stale: boolean }[];
  errors: string[];
};

async function settle<T>(name: string, p: Promise<T>, errors: string[]): Promise<T | null> {
  try { return await p; } catch (e: any) { errors.push(`${name}: ${e?.message ?? e}`); return null; }
}

const fmtEt = (ts: number) => new Date(ts).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " ET";

export async function buildReport(now = Date.now(), overrides: Override = {}): Promise<BiasReport> {
  const errors: string[] = [];
  const [intraday, rows, chain, cal, qqqBars, hourly, track] = await Promise.all([
    settle("NQ intraday", yahooBars("NQ=F", "5m", "5d"), errors),
    settle("Macro history", loadRows(now), errors),
    settle("Options chain", cboeChain(GEX_SYMBOL), errors),
    settle("Calendar", usdCalendar(), errors),
    settle(GEX_SYMBOL, yahooBars(GEX_SYMBOL, "5m", "1d"), errors),
    settle("NQ hourly (backtest)", yahooBars("NQ=F", "60m", "730d", 6 * 3600), errors),
    settle("Track record", readSummary(), errors),
  ]);

  const levels = intraday?.length ? computeLevels(intraday, now, overrides) : null;
  const model = rows && rows.length > 300 ? fitModel(rows) : null;
  const backtest = hourly && rows ? backtestRegime(hourly, rows) : null;
  const last = levels?.last ?? null;

  let gex: BiasReport["gex"] = null;
  if (chain && last) {
    const g = computeGex(chain.spot, chain.options, 45, now);
    const etfPx = qqqBars?.length ? qqqBars[qqqBars.length - 1].c : chain.spot;
    const r = last / etfPx; // ETF → NQ by current price ratio (approximate)
    gex = { ...g, nqRatio: r, nq: { flip: g.flip ? g.flip * r : null, callWall: g.callWall * r, putWall: g.putWall * r } };
  }

  const session = targetSession(now);
  const events = (cal ?? [])
    .filter((e) => { const t = Date.parse(e.time); return !isNaN(t) && et(t).date === session; })
    .map((e) => { const p = et(Date.parse(e.time)); return { ...e, etTime: `${String(Math.floor(p.min / 60)).padStart(2, "0")}:${String(p.min % 60).padStart(2, "0")} ET` }; });

  const vxn = model?.factors.find((f) => f.id === "vxn")?.value;
  const refPx = levels?.prior.close ?? last;
  const sigma = refPx && vxn ? refPx * (vxn / 100) / Math.sqrt(252) : null;
  const k68 = backtest?.range.k68;
  const rangeK = k68 && k68 >= 0.4 && k68 <= 3 ? k68 : 1; // sanity bounds: outside them the calibration is broken, fall back to 1σ
  if (k68 && rangeK === 1 && (k68 < 0.4 || k68 > 3)) errors.push(`Range calibration out of bounds (k=${k68.toFixed(2)}), using 1σ`);
  const expectedRange = sigma ? sigma * rangeK : null;

  // ---- direction: only if the combined model beats always-long out-of-sample with t >= 2 ----
  const usable = model?.factors.filter((f) => f.usable) ?? [];
  const c = model?.composite ?? 0;
  const o = model?.oos;
  const beatsBase = !!o && o.hitRate > Math.max(o.baseUpRate, 1 - o.baseUpRate) && o.t >= 2;
  let lean: BiasReport["lean"] = "NEUTRAL";
  let leanStrength = "No validated macro edge today — trade the levels, not a direction.";
  if (o && usable.length && !beatsBase) leanStrength = `No directional edge: combined model hit ${(o.hitRate * 100).toFixed(1)}% out-of-sample vs ${(o.baseUpRate * 100).toFixed(1)}% for always-long (t ${o.t.toFixed(1)}). Use this page for range/regime, not direction.`;
  if (usable.length && beatsBase && Math.abs(c) > 0.02) {
    lean = c > 0 ? "LONG" : "SHORT";
    leanStrength = `Weak lean from ${usable.length} validated factor(s); OOS hit ${(o!.hitRate * 100).toFixed(1)}% vs ${(o!.baseUpRate * 100).toFixed(1)}% base.`;
  }

  // ---- regime ----
  const vixTerm = model?.factors.find((f) => f.id === "vix_term")?.value ?? null;
  const highImpact = events.filter((e) => e.impact === "High");
  const rc = regimeCall({ vixTerm, netGex: gex?.netGex ?? null, belowFlip: gex?.nq.flip && last ? last < gex.nq.flip : null, highImpactNews: highImpact.map((e) => e.title) });
  const regime = {
    fade: rc.fade,
    label: rc.fade === "FAVORED" ? "Balance / mean-reversion" : rc.fade === "CAUTION" ? "Mixed — fade only with confirmation" : "Expansion risk — don't fade",
    detail: rc.reasons.join("; ") || "Insufficient data",
  };

  // ---- zones ----
  const z: Zone[] = [];
  const add = (label: string, price: number | null | undefined) => { if (price && last) z.push({ label, price, kind: price > last ? "res" : "sup" }); };
  if (levels) {
    add("Prior VAH", levels.prior.vah); add("Prior POC", levels.prior.poc); add("Prior VAL", levels.prior.val);
    add(`Prior RTH high${levels.prior.poorHigh ? " (poor)" : ""}`, levels.prior.high);
    add(`Prior RTH low${levels.prior.poorLow ? " (poor)" : ""}`, levels.prior.low);
    levels.prior.singlePrints.forEach(([a, b], i) => add(`Single prints ${i + 1} (${a}–${b})`, (a + b) / 2));
    if (levels.overnight) { add("Overnight high", levels.overnight.high); add("Overnight low", levels.overnight.low); }
  }
  if (gex) { add(`Call wall (${GEX_SYMBOL}→NQ)`, gex.nq.callWall); add(`Put wall (${GEX_SYMBOL}→NQ)`, gex.nq.putWall); add("Gamma flip", gex.nq.flip); }
  const zones = z.sort((a, b) => b.price - a.price);
  const supports = zones.filter((x) => x.kind === "sup");
  const floor = supports.find((x) => x.label === "Gamma flip" && expectedRange && last! - x.price < expectedRange)
    ?? supports.find((x) => x.label === "Prior VAL") ?? supports[0] ?? null;

  const leanTxt = lean === "NEUTRAL" ? "No directional edge" : `${lean} lean (weak)`;
  const fadeTxt = rc.fade === "FAVORED" ? "Fading VAH/VAL is in-regime" : rc.fade === "CAUTION" ? "Fade only after footprint confirmation (absorption/delta divergence)" : "Do NOT fade — trade acceptance/retest or sit out";
  const shapeTxt = levels ? ` Prior session ${levels.prior.shape}-shape${levels.prior.poorHigh ? ", poor high (likely revisit)" : ""}${levels.prior.poorLow ? ", poor low (likely revisit)" : ""}.` : "";
  const bottomLine = `${leanTxt}. ${fadeTxt}.${floor ? ` Loss of ${floor.label} ${floor.price.toFixed(0)} shifts control to sellers.` : ""}${expectedRange ? ` 68% range ±${expectedRange.toFixed(0)} pts.` : ""}${shapeTxt}`;

  const rules = [
    `Max ${RULES.maxContracts} contracts.`,
    `Time stop: out if not working within ${RULES.timeStopMin} min.`,
    `Daily max loss $${RULES.dailyMaxLoss} — flat and done when hit.`,
    `Stopped ${RULES.maxStopsAtLevel}× at the same level → stop trading that level today.`,
    ...highImpact.map((e) => `Flat 5 min before/after ${e.title} (${e.etTime}).`),
  ];

  // ---- freshness ----
  const freshness: BiasReport["freshness"] = [];
  if (levels) {
    const ageH = (now - levels.lastTime) / 36e5;
    freshness.push({ label: "NQ price & levels", asOf: fmtEt(levels.lastTime), stale: ageH > 2 && et(now).dow !== "Sat" && et(now).dow !== "Sun" && et(now).min > 18 * 60 });
  }
  if (model) freshness.push({ label: "Macro factors (daily close)", asOf: model.asOf, stale: false });
  if (chain) freshness.push({ label: `${GEX_SYMBOL} options (OI updates once a day)`, asOf: chain.asOf ?? "unknown", stale: false });

  return {
    generatedAt: now, session, last, model, levels, gex, events, sigma, rangeK, expectedRange, lean, leanStrength,
    regime, zones, floor, bottomLine, rules, backtest, track, storeConnected: storeEnabled(), freshness, errors,
  };
}

export function toSnapshot(r: BiasReport): Snapshot | null {
  if (!r.levels) return null;
  return {
    date: r.session, generatedAt: r.generatedAt, fade: r.regime.fade, reasons: r.regime.detail.split("; "),
    levels: { vah: r.levels.prior.vah, poc: r.levels.prior.poc, val: r.levels.prior.val },
    prevClose: r.levels.prior.close, expectedRange: r.expectedRange, bottomLine: r.bottomLine,
  };
}
