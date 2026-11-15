import { buildReport, toSnapshot } from "../lib/bias";
import { scoreDay, summarize, targetSession } from "../lib/daily";
import { installMock, MOCK_NOW as now } from "./mock";
installMock();
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
  console.log("session", r.session, "| sigma", r.sigma?.toFixed(0), "k", r.rangeK.toFixed(2), "| shape", r.levels?.prior.shape, r.levels?.prior.poorHigh, r.levels?.prior.poorLow, JSON.stringify(r.levels?.prior.singlePrints));
  console.log("backtest", JSON.stringify(r.backtest));
  console.log("freshness", r.freshness, "store", r.storeConnected, "track", r.track);
  // scoring unit check
  const snap = toSnapshot(r)!;
  const fake = [{ t: 0, o: snap.levels.poc, h: snap.levels.vah + 2, l: snap.levels.poc - 1, c: snap.levels.poc, v: 1 }, { t: 1, o: snap.levels.poc, h: snap.levels.poc + 1, l: snap.levels.val - 3, c: snap.levels.poc + 2, v: 1 }];
  const sc = scoreDay(snap, fake); console.log("score", JSON.stringify(sc.touches), "contained", sc.contained);
  console.log("summary", JSON.stringify(summarize([sc, { ...sc, fade: "AVOID" }]).byFade));
  console.log("target", targetSession(Date.parse("2026-11-14T15:00:00Z")), targetSession(Date.parse("2026-11-16T22:00:00Z")), targetSession(Date.parse("2026-11-20T22:00:00Z")));
});
