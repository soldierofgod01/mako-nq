import { buildReport } from "@/lib/bias";

export const revalidate = 300;
export const maxDuration = 60;

const f0 = (n: number | null | undefined) => (n == null || isNaN(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
const f2 = (n: number | null | undefined, d = 2) => (n == null || isNaN(n) ? "—" : n.toFixed(d));
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export default async function Page() {
  const r = await buildReport();
  const m = r.model;
  const leanCls = r.lean === "LONG" ? "up" : r.lean === "SHORT" ? "dn" : "mut";
  const fadeCls = r.regime.fade === "FAVORED" ? "up" : r.regime.fade === "CAUTION" ? "warn" : "dn";
  const genEt = new Date(r.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

  return (
    <main>
      <div className="head">
        <div><h1>NQ Daily Bias</h1><div className="mut">Generated {genEt} ET · NQ last {f0(r.last)}</div></div>
        <div className="mut">Data: Yahoo (delayed) · CBOE (15-min delayed options) · ForexFactory</div>
      </div>

      <div className="bl" style={{ marginBottom: 14 }}><b>Bottom line:</b> {r.bottomLine}</div>

      <div className="grid">
        <div className="card">
          <h2>Directional lean</h2>
          <div className={`big ${leanCls}`}>{r.lean}</div>
          <p className="mut">{r.leanStrength}</p>
          {m && <div className="mut">Composite {f2(m.composite, 3)} · data through {m.asOf}</div>}
        </div>
        <div className="card">
          <h2>Regime — fade VAH/VAL?</h2>
          <div className={`big ${fadeCls}`}>{r.regime.fade}</div>
          <p><b>{r.regime.label}.</b> <span className="mut">{r.regime.detail}</span></p>
          <p className="mut" style={{ fontSize: 12 }}>Hypothesis, not yet validated on your trades — log fade results by regime to confirm.</p>
        </div>
        <div className="card">
          <h2>Risk rules</h2>
          <ul>{r.rules.map((x) => <li key={x}>{x}</li>)}</ul>
          {r.expectedRange && <p className="mut">VXN-implied 1σ day: ±{f0(r.expectedRange)} pts ({f0(r.last! - r.expectedRange)} – {f0(r.last! + r.expectedRange)})</p>}
        </div>
      </div>

      <div className="grid" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Levels</h2>
          <table><thead><tr><th>Level</th><th className="r">Price</th><th className="r">Dist</th></tr></thead>
            <tbody>
              {r.zones.map((z) => (
                <tr key={z.label}>
                  <td className={z.kind === "res" ? "dn" : "up"}>{z.label}{r.floor?.label === z.label ? " ◆ critical floor" : ""}</td>
                  <td className="r">{f0(z.price)}</td><td className="r mut">{r.last ? f0(z.price - r.last) : ""}</td>
                </tr>
              ))}
            </tbody></table>
          {r.levels && <p className="mut" style={{ fontSize: 12 }}>Prior RTH {r.levels.rthDate}. Value area estimated from 5-min bars (volume spread across each bar's range) — will differ slightly from MotiveWave's tick profile.</p>}
        </div>
        <div className="card">
          <h2>Dealer gamma ({r.gex ? "QQQ" : "—"})</h2>
          {r.gex ? <>
            <table><tbody>
              <tr><td>Net GEX (≤{r.gex.maxDays}d)</td><td className={`r ${r.gex.netGex >= 0 ? "up" : "dn"}`}>{f2(r.gex.netGex)}B / 1%</td></tr>
              <tr><td>Gamma flip</td><td className="r">{f2(r.gex.flip)} → NQ {f0(r.gex.nq.flip)}</td></tr>
              <tr><td>Call wall</td><td className="r">{r.gex.callWall} → NQ {f0(r.gex.nq.callWall)}</td></tr>
              <tr><td>Put wall</td><td className="r">{r.gex.putWall} → NQ {f0(r.gex.nq.putWall)}</td></tr>
              <tr><td>P/C volume · P/C OI</td><td className="r">{f2(r.gex.pcVolume)} · {f2(r.gex.pcOi)}</td></tr>
            </tbody></table>
            <p className="mut" style={{ fontSize: 12 }}>Assumes dealers long calls / short puts. OI-based, updates once a day — a regime gauge, not tick-precise levels.</p>
          </> : <p className="mut">Unavailable</p>}
        </div>
        <div className="card">
          <h2>Today&apos;s USD events</h2>
          {r.events.length ? <table><tbody>{r.events.map((e) => (
            <tr key={e.title + e.etTime}><td>{e.etTime}</td><td className={e.impact === "High" ? "dn" : "warn"}>{e.title}</td><td className="r mut">{e.forecast || ""}</td></tr>
          ))}</tbody></table> : <p className="mut">No medium/high-impact USD events.</p>}
        </div>
      </div>

      {m && <div className="card" style={{ marginTop: 14 }}>
        <h2>Factor validation — does any of this actually predict NQ?</h2>
        <p className="mut">Each factor vs NQ next-day return. Trained {m.nIS} days, tested out-of-sample on {m.nOOS} days from {m.splitDate}. A factor gets weight only if it&apos;s significant (|t| ≥ 1.5) with the same sign in both periods.</p>
        <table><thead><tr><th>Factor</th><th className="r">Today</th><th className="r">z</th><th className="r">IC in-sample (t)</th><th className="r">IC out-of-sample (t)</th><th className="r">Vol IC</th><th>Used</th></tr></thead>
          <tbody>{m.factors.map((x) => (
            <tr key={x.id}>
              <td>{x.label}<div className="mut" style={{ fontSize: 11 }}>{x.desc}</div></td>
              <td className="r">{["vix_term", "vxn"].includes(x.id) ? f2(x.value) : x.id === "tnx_chg" ? `${f2(x.value, 1)}bp` : pct(x.value)}</td>
              <td className="r">{f2(x.z)}</td>
              <td className="r">{f2(x.icIS, 3)} ({f2(x.tIS, 1)})</td>
              <td className="r">{f2(x.icOOS, 3)} ({f2(x.tOOS, 1)})</td>
              <td className="r mut">{f2(x.volIcOOS, 2)}</td>
              <td>{x.usable ? <span className="pill up">yes</span> : <span className="mut">no</span>}</td>
            </tr>
          ))}</tbody></table>
        <p className="mut" style={{ fontSize: 12 }}>
          Combined model out-of-sample: hit rate {isNaN(m.oos.hitRate) ? "—" : pct(m.oos.hitRate)} on {m.oos.nSignals} days vs {pct(m.oos.baseUpRate)} base up-rate · IC {f2(m.oos.ic, 3)} (t {f2(m.oos.t, 1)}).
          &nbsp;Vol IC = correlation with the size of the next day&apos;s move (many macro factors predict volatility, not direction).
        </p>
      </div>}

      {r.errors.length > 0 && <div className="card" style={{ marginTop: 14 }}><h2>Data errors</h2>{r.errors.map((e) => <div key={e} className="err">{e}</div>)}</div>}
    </main>
  );
}
