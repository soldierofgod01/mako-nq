import { installMock } from "./mock";
installMock();
import { yahooBars } from "../lib/sources";
import { et } from "../lib/levels";
import { buildRows, fearModel } from "../lib/fearmodel";
(async () => {
  const ser = async (s: string) => (await yahooBars(s, "1d", "10y")).map((b) => ({ date: et(b.t + 12 * 3600e3).date, o: b.o, c: b.c }));
  const t0 = Date.now();
  const [q, n, v, x] = await Promise.all(["QQQ", "NQ=F", "^VIX", "^VXN"].map(ser));
  const { rows, today } = buildRows(q, n, v, x);
  const m = fearModel(rows, today);
  console.log("ms", Date.now() - t0, "rows", rows.length, JSON.stringify(m, null, 0).slice(0, 900));
})();
