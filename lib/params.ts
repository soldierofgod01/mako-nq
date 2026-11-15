import type { Override } from "./levels";
// ?vah=28030&poc=27797&val=27730 — use your MotiveWave levels instead of the 5-min estimate
export function parseOverrides(get: (k: string) => string | null | undefined): Override {
  const n = (k: string) => { const v = Number(get(k)); return Number.isFinite(v) && v > 1000 ? v : undefined; };
  return { vah: n("vah"), poc: n("poc"), val: n("val") };
}
