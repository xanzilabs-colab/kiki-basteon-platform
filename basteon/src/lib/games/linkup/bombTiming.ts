export function bombFuseRemainingMs(
  fuseLeftMs: number,
  endLetter: string | null,
  turnStartedAt: string | null,
  now: number,
) {
  if (!endLetter || !turnStartedAt) return Math.max(0, fuseLeftMs);
  const startedAt = Date.parse(turnStartedAt);
  if (!Number.isFinite(startedAt)) return Math.max(0, fuseLeftMs);
  return Math.max(0, fuseLeftMs - Math.max(0, now - startedAt));
}
