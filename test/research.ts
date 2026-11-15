import { installMock } from "./mock";
installMock();
import("../lib/research").then(async ({ runResearch }) => {
  const r = await runResearch();
  console.log(r.coverage, r.errors);
  for (const s of r.stats) console.log(s.id.padEnd(16), s.verdict.padEnd(5), "n", s.n, "hit", s.hit.toFixed(2), "avg", s.avgPts.toFixed(1), "t", s.t.toFixed(2), "h1", s.firstHalfAvg.toFixed(1), "h2", s.secondHalfAvg.toFixed(1), "long", s.longAvg.toFixed(1));
  for (const f of r.factors) console.log(f.factor.padEnd(10), "n", f.n, "ic", f.ic.toFixed(3), "t", f.t.toFixed(2), f.stable);
});
