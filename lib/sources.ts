// Data sources — all free, no API keys.
// Yahoo chart API (unofficial), CBOE delayed options JSON, FRED CSV, ForexFactory weekly calendar.

const UA = { "User-Agent": "Mozilla/5.0 (nq-bias)", Accept: "application/json,text/csv,*/*" };

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

export async function yahooBars(symbol: string, interval: string, range: string, revalidate = 0): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, revalidate ? { headers: UA, next: { revalidate } } : { headers: UA, cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`Yahoo ${symbol}: no data`);
  const q = r.indicators.quote[0];
  const out: Bar[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = q.close[i];
    if (c == null || q.open[i] == null) continue;
    out.push({ t: r.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c, v: q.volume[i] ?? 0 });
  }
  return out;
}

export type OptionRow = { strike: number; type: "C" | "P"; expiry: string; oi: number; gamma: number; volume: number; iv: number };

// CBOE delayed quotes: option symbol format e.g. QQQ251121C00500000
export async function cboeChain(symbol: string): Promise<{ spot: number; options: OptionRow[] }> {
  const res = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${symbol}.json`, { headers: UA, cache: "no-store" });
  if (!res.ok) throw new Error(`CBOE ${symbol} ${res.status}`);
  const j = await res.json();
  const spot: number = j.data.current_price ?? j.data.close;
  const options: OptionRow[] = [];
  for (const o of j.data.options as any[]) {
    const m = /^([A-Z_]+)(\d{6})([CP])(\d{8})$/.exec(o.option);
    if (!m) continue;
    options.push({
      expiry: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}`,
      type: m[3] as "C" | "P",
      strike: parseInt(m[4], 10) / 1000,
      oi: o.open_interest ?? 0,
      gamma: o.gamma ?? 0,
      volume: o.volume ?? 0,
      iv: o.iv ?? 0,
    });
  }
  return { spot, options };
}

export async function fredSeries(id: string): Promise<{ date: string; value: number }[]> {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, { headers: UA, cache: "no-store" });
  if (!res.ok) throw new Error(`FRED ${id} ${res.status}`);
  const lines = (await res.text()).trim().split("\n").slice(1);
  return lines
    .map((l) => l.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([d, v]) => ({ date: d, value: parseFloat(v) }));
}

export type CalEvent = { title: string; time: string; impact: string; forecast: string; previous: string };

export async function usdCalendar(): Promise<CalEvent[]> {
  const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { headers: UA, cache: "no-store" });
  if (!res.ok) throw new Error(`Calendar ${res.status}`);
  const j = (await res.json()) as any[];
  return j
    .filter((e) => e.country === "USD" && (e.impact === "High" || e.impact === "Medium"))
    .map((e) => ({ title: e.title, time: e.date, impact: e.impact, forecast: e.forecast, previous: e.previous }));
}
