import { runResearch } from "@/lib/research";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET() {
  return Response.json(await runResearch());
}
