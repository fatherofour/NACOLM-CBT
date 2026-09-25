// Largest-remainder rounding: splits `total` across weighted buckets so the
// parts always sum back to exactly `total` (plain rounding can't guarantee
// that). Used both for "count per topic" and "objective/theory split per
// topic".
export function allocateByWeight<K extends string>(total: number, weights: Record<K, number>): Record<K, number> {
  const keys = Object.keys(weights) as K[];
  const weightSum = keys.reduce((sum, k) => sum + weights[k], 0);
  if (weightSum === 0) return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

  const exact = keys.map((k) => ({ key: k, value: (weights[k] / weightSum) * total }));
  const floors = exact.map((e) => ({ key: e.key, floor: Math.floor(e.value), remainder: e.value - Math.floor(e.value) }));
  const sumFloor = floors.reduce((sum, f) => sum + f.floor, 0);
  let remaining = total - sumFloor;

  const sorted = [...floors].sort((a, b) => b.remainder - a.remainder);
  const result = Object.fromEntries(floors.map((f) => [f.key, f.floor])) as Record<K, number>;
  for (const f of sorted) {
    if (remaining <= 0) break;
    result[f.key] += 1;
    remaining -= 1;
  }
  return result;
}

export function allocateEvenly(total: number, buckets: string[]): Record<string, number> {
  return allocateByWeight(
    total,
    Object.fromEntries(buckets.map((b) => [b, 1])),
  );
}
