import { buildReport } from "@/lib/bias";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET() {
  const r = await buildReport();
  return Response.json(r, { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } });
}
