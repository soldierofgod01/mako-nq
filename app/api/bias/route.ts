import { buildReport } from "@/lib/bias";
import { parseOverrides } from "@/lib/params";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const r = await buildReport(Date.now(), parseOverrides((k) => sp.get(k)));
  return Response.json(r, { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } });
}
