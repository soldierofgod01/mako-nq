import { buildReport } from "@/lib/bias";
import { parseOverrides } from "@/lib/params";
import LevelsMap from "./LevelsMap";
import TermChart from "./TermChart";
import StrikeChart from "./StrikeChart";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const n0 = (n: number | null | undefined) => (n == null || isNaN(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
const n2 = (n: number | null | undefined, d = 2) => (n == null || isNaN(n) ? "—" : n.toFixed(d));
const pc = (n: number | null | undefined, d = 0) => (n == null || isNaN(n) ? "—" : `${(n * 100).toFixed(d)}%`);
const sgn = (n: number) => (n > 0 ? `+${n0(n)}` : n0(n));

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ov = parseOverrides((k) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; });
  const r = await buildReport(Date.now(), ov);
  const d = r.direction, lv = r.levels, g = r.gex, tr = r.track, o = r.options, last = r.last;
  const long = d?.lean === "LONG";
  const chg = lv && last ? last - lv.prior.close : null;
  const calm = d?.rules.find((x) => x.id === "calm");
  const skew30 = o?.term.length ? o.term.reduce((a, b) => (Math.abs(b.days - 30) < Math.abs(a.days - 30) ? b : a)).skew25 : null;
  const vs = !lv || !last ? "—" : Math.abs(last - lv.prior.vah) <= 10 ? "at VAH" : Math.abs(last - lv.prior.val) <= 10 ? "at VAL" : last > lv.prior.vah ? "above value" : last < lv.prior.val ? "below value" : "inside value";
  const nearNaked = r.naked.filter((x) => last && Math.abs(x.poc - last) / last < 0.03);

  return (
    <div className="app">
      <header className="bar">
        <div className="logo">Mako<span>NQ</span></div>
        <div className="tick">
          <span className="sym">NQ1!</span>
          <span className="num px">{n0(last)}</span>
          {chg != null && <span className={`chip ${chg >= 0 ? "pos" : "neg"} num`}>{sgn(chg)} · {pc(chg / lv!.prior.close, 2)}</span>}
        </div>
        <div className="meta">Plan for <b>{r.session}</b></div>
        <div className="grow" />
        {r.freshness.map((f) => <div key={f.label} className={`meta ${f.stale ? "warn" : ""}`} title={f.label}><i className={`dot ${f.stale ? "stale" : ""}`} />{f.label.split(" ")[0]} <span className="num">{f.asOf === "unknown" ? "delayed" : f.asOf}</span></div>)}
      </header>

      <main className="grid">
        <section className="panel span8">
          <div className="ph">
            <h3>Levels map</h3>{lv?.overridden && <span className="chip pos">your levels</span>}
            <form method="get" className="ov">{(["vah", "poc", "val"] as const).map((k) => <input key={k} name={k} placeholder={k.toUpperCase()} defaultValue={ov[k] ?? ""} inputMode="decimal" />)}<button type="submit">Apply</button></form>
          </div>
          <div className="pb"><LevelsMap r={r} /></div>
        </section>

        <div className="col span4">
          <section className={`panel dir ${long ? "long" : ""}`}>
            <div className="ph"><h3>Direction</h3><span className="hint">tested signals only</span></div>
            <div className="pb">
              <div className={`call ${long ? "up" : "none"}`}>{d ? (long ? "Long" : "No edge") : "—"}</div>
              <p className="reason">{d?.summary ?? "Model unavailable."}</p>
              {calm && <div className={`sig ${calm.firesToday && calm.valid ? "on" : ""}`}>
                <div className="sl"><i className="ind" /><b>Calm-market drift</b><span className="tag">{calm.firesToday && calm.valid ? "active" : "off"}</span></div>
                <div className="sr num">{pc(calm.hit)} up · {calm.n} days · t {n2(calm.t, 1)}</div>
                <div className="sd">VXN in its bottom 20% → QQQ open→close +{n2(calm.avgPct, 2)}% vs +{n2(calm.basePct, 2)}% average. Today VXN {calm.todayValue}.</div>
              </div>}
              <div className="sig faded">
                <div className="sl"><i className="ind" /><b>Fear reversion</b><span className="tag">faded</span></div>
                <div className="sd">Strong 2017–19, no out-of-sample skill 2020–26 (walk-forward, 1,501 sessions). Shown for context, not used.</div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="ph"><h3>Positioning</h3><span className="hint">QQQ → NQ</span></div>
            <div className="pb">
              <div className="stats">
                <Stat k="68% move" v={r.expectedRange ? `±${n0(r.expectedRange)}` : "—"} s={r.expectedRange && lv ? `${n0(lv.prior.close - r.expectedRange)} – ${n0(lv.prior.close + r.expectedRange)}` : ""} />
                <Stat k="Net gamma" v={g ? `${n2(g.netGex)}B` : "—"} cls={g ? (g.netGex >= 0 ? "up" : "dn") : ""} s={g ? (g.netGex >= 0 ? "dealers dampen" : "dealers amplify") : ""} />
                <Stat k="Gamma flip" v={n0(g?.nq.flip)} s={g?.nq.flip && last ? `${sgn(g.nq.flip - last)} from price` : ""} />
                <Stat k="Vol curve" v={o?.curve.hump ? "Hump" : o?.curve.inverted ? "Inverted" : "Normal"} cls={o?.curve.hump || o?.curve.inverted ? "warn" : ""} s={o ? `7d ${pc(o.curve.iv7, 1)} · 30d ${pc(o.curve.iv30, 1)}` : ""} />
              </div>
              {g && g.key.length > 0 && <div className="keys">
                <div className="kh">Key gamma strikes near price</div>
                {g.key.map((s) => { const p = s.strike * g.nqRatio; return <div className="kr" key={s.strike}>
                  <span className="num">{s.strike}</span><span className="num">{n0(p)}</span>
                  <span className={`num ${s.gex >= 0 ? "up" : "dn"}`}>{s.gex > 0 ? "+" : ""}{n2(s.gex)}B</span>
                  <span className="num dim">{last ? sgn(p - last) : ""}</span>
                </div>; })}
              </div>}
              <p className="foot">25Δ skew (30d) <b className="num">{skew30 != null ? `${n2(skew30 * 100, 1)} pts` : "—"}</b> · P/C vol <b className="num">{n2(g?.pcVolume)}</b></p>
            </div>
          </section>

          <section className="panel">
            <div className="ph"><h3>Session</h3></div>
            <div className="pb">
              {r.events.length ? r.events.map((e) => (
                <div className="row" key={e.title + e.etTime}><span className={e.impact === "High" ? "dn" : "warn"}>{e.title}</span><span className="num">{e.etTime}</span></div>
              )) : <div className="row"><span className="mut">No major US data</span><span /></div>}
              {lv && <>
                <div className="row"><span className="mut">Price vs prior value</span><span>{vs}</span></div>
                <div className="row"><span className="mut">Prior profile</span><span>{lv.prior.shape}-shape{lv.prior.poorHigh ? " · poor high" : ""}{lv.prior.poorLow ? " · poor low" : ""}</span></div>
                <div className="row"><span className="mut">Overnight</span><span className="num">{lv.overnight ? `${n0(lv.overnight.low)} – ${n0(lv.overnight.high)}` : "not open yet"}</span></div>
                <div className="row"><span className="mut">Naked POCs ±3%</span><span className="num">{nearNaked.length ? nearNaked.slice(-3).map((x) => n0(x.poc)).join(" · ") : "none"}</span></div>
              </>}
            </div>
          </section>
        </div>

        <section className="panel span12">
          <div className="ph"><h3>Options activity by strike</h3><span className="hint">≤10-day expiries · volume is unsigned (where, not who)</span></div>
          <div className="pb">{o && g ? <StrikeChart rows={o.byStrike} gamma={g.profile} spot={g.spot} ratio={g.nqRatio} last={last ?? 0} /> : <p className="mut">Unavailable</p>}</div>
        </section>

        <section className="panel span7">
          <div className="ph"><h3>Vol term structure &amp; skew</h3><span className="hint">QQQ ATM IV by expiry</span></div>
          <div className="pb">{o ? <TermChart term={o.term} curve={o.curve} /> : <p className="mut">Unavailable</p>}</div>
        </section>

        <section className="panel span5">
          <div className="ph"><h3>Live record</h3></div>
          <div className="pb">
            {!r.storeConnected ? <p className="warn small">Connect a Vercel Blob store to log calls.</p>
              : tr && tr.days ? <div className="stats">
                <Stat k="Long calls" v={String(tr.longCalls)} />
                <Stat k="Hit rate" v={tr.longCalls ? pc(tr.longWins / tr.longCalls) : "—"} />
                <Stat k="Avg pts / call" v={tr.longCalls ? sgn(tr.longPts / tr.longCalls) : "—"} />
                <Stat k="No-edge days" v={tr.noEdgeDays ? sgn(tr.noEdgePts / tr.noEdgeDays) : "—"} s="avg pts" />
              </div> : <p className="mut small">Collecting — first result after the next session.</p>}
          </div>
        </section>
      </main>

      <details className="research">
        <summary>Research · rule tests</summary>
        {d && <table><thead><tr><th>Rule</th><th className="r">Days</th><th className="r">Hit</th><th className="r">Avg</th><th className="r">All days</th><th className="r">By third</th><th className="r">t</th></tr></thead>
          <tbody>{d.rules.map((x) => <tr key={x.id}><td>{x.label}<div className="mut small">{x.why}</div></td><td className="r num">{x.n}</td><td className="r num">{pc(x.hit)}</td><td className="r num">{n2(x.avgPct, 3)}%</td><td className="r num">{n2(x.basePct, 3)}%</td><td className="r num">{x.byThird.map((v) => n2(v, 2)).join(" / ")}</td><td className="r num">{n2(x.t, 1)}</td></tr>)}</tbody></table>}
        {r.errors.length > 0 && <div style={{ marginTop: 12 }}>{r.errors.map((e) => <div key={e} className="err">{e}</div>)}</div>}
      </details>
    </div>
  );
}

function Stat({ k, v, s, cls = "" }: { k: string; v: string; s?: string; cls?: string }) {
  return <div className="stat"><div className="k">{k}</div><div className={`v num ${cls}`}>{v}</div>{s ? <div className="s num">{s}</div> : null}</div>;
}
