import type { TermPoint, Curve } from "@/lib/options";

// ATM implied vol by days to expiry (line) with 25-delta put-minus-call skew (bars).
export default function TermChart({ term, curve }: { term: TermPoint[]; curve: Curve }) {
  if (term.length < 3) return <p className="mut">Not enough expiries.</p>;
  const W = 640, H = 230, x0 = 44, x1 = 620, y0 = 18, y1 = 190;
  const maxD = Math.max(...term.map((t) => t.days));
  const ivs = term.map((t) => t.atmIv * 100), lo = Math.floor(Math.min(...ivs) - 1), hi = Math.ceil(Math.max(...ivs) + 1);
  const sk = term.map((t) => (t.skew25 ?? 0) * 100), skMax = Math.max(1, ...sk.map(Math.abs));
  const X = (d: number) => x0 + (Math.sqrt(d) / Math.sqrt(maxD)) * (x1 - x0); // sqrt-time axis spreads the front end
  const Y = (v: number) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
  const path = term.map((t, i) => `${i ? "L" : "M"}${X(t.days).toFixed(1)} ${Y(t.atmIv * 100).toFixed(1)}`).join(" ");
  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  const head = curve.hump
    ? `Event hump: ${curve.hump.expiry.slice(5)} at ${pct(curve.hump.iv)} vs 30d ${pct(curve.iv30)}`
    : curve.inverted ? `Inverted front: 7d ${pct(curve.iv7)} > 30d ${pct(curve.iv30)}` : `Normal: 7d ${pct(curve.iv7)} · 30d ${pct(curve.iv30)} · 90d ${pct(curve.iv90)}`;
  const alert = !!curve.hump || curve.inverted;
  const yt: number[] = []; for (let v = lo; v <= hi; v += Math.max(1, Math.round((hi - lo) / 5))) yt.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="QQQ implied volatility term structure and skew">
      {yt.map((v) => <g key={v}><line x1={x0} x2={x1} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" /><text x={x0 - 6} y={Y(v) + 4} textAnchor="end" fontSize={10} fill="var(--dim)" className="mono">{v}%</text></g>)}
      {term.map((t) => t.skew25 != null && <rect key={`s${t.expiry}`} x={X(t.days) - 3} y={y1 - (Math.max(0, t.skew25 * 100) / skMax) * 40} width={6} height={(Math.abs(t.skew25 * 100) / skMax) * 40} fill="var(--short)" opacity={0.35}><title>{`${t.expiry}: 25Δ skew ${(t.skew25 * 100).toFixed(1)} vol pts`}</title></rect>)}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {term.map((t) => <circle key={t.expiry} cx={X(t.days)} cy={Y(t.atmIv * 100)} r={2.6} fill="var(--accent)"><title>{`${t.expiry} (${t.days.toFixed(0)}d): ATM IV ${(t.atmIv * 100).toFixed(1)}%`}</title></circle>)}
      {[1, 7, 30, 60, 90].filter((d) => d <= maxD).map((d) => <text key={d} x={X(d)} y={y1 + 16} textAnchor="middle" fontSize={10} fill="var(--dim)" className="mono">{d}d</text>)}
      {curve.hump && <g><circle cx={X(curve.hump.days)} cy={Y(curve.hump.iv * 100)} r={6} fill="none" stroke="var(--warn)" strokeWidth={1.5} /></g>}
      <text x={x1} y={y0 - 4} textAnchor="end" fontSize={11} fontWeight={500} fill={alert ? "var(--warn)" : "var(--mut)"}>{head}</text>
      <text x={x0} y={H - 4} fontSize={10} fill="var(--dim)">line = ATM IV · red bars = 25Δ put − call skew</text>
    </svg>
  );
}
