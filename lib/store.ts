import { put, get, list } from "@vercel/blob";

// Daily snapshots + scores in Vercel Blob (private). No-ops when the store isn't connected,
// so the app still runs without it — it just can't build a track record.
export const storeEnabled = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

export async function saveJson(path: string, data: unknown) {
  if (!storeEnabled()) return false;
  await put(path, JSON.stringify(data), { access: "private", contentType: "application/json", allowOverwrite: true, addRandomSuffix: false });
  return true;
}

export async function readJson<T>(path: string): Promise<T | null> {
  if (!storeEnabled()) return null;
  try {
    const r = await get(path, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text()) as T;
  } catch { return null; }
}

export async function listPaths(prefix: string): Promise<string[]> {
  if (!storeEnabled()) return [];
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs.map((b) => b.pathname));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out.sort();
}
