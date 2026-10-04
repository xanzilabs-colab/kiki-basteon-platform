const MAX_CHECK_IN_INTERVAL_MS = 15 * 60_000;
const MIN_CHECK_IN_INTERVAL_MS = 2 * 60_000;

export function nextCheckInAt(now: Date, expectedArrival: Date) {
  const remainingMs = Math.max(0, expectedArrival.getTime() - now.getTime());
  const intervalMs = Math.min(
    MAX_CHECK_IN_INTERVAL_MS,
    remainingMs,
    Math.max(MIN_CHECK_IN_INTERVAL_MS, Math.floor(remainingMs / 2)),
  );
  return new Date(now.getTime() + intervalMs);
}