export const PICK_REQUEST_GRACE_MS = 2_000;

export function isPickDeadlineExpired(deadlineAt: string | null, now = Date.now()) {
  if (!deadlineAt) return false;
  const deadline = Date.parse(deadlineAt);
  return Number.isFinite(deadline) && now > deadline + PICK_REQUEST_GRACE_MS;
}

export function isPickSubmissionOnTime(
  phaseStartedAt: string,
  deadlineAt: string | null,
  pickedAt: number,
  receivedAt = Date.now(),
) {
  if (!deadlineAt || !Number.isFinite(pickedAt)) return false;
  const phaseStarted = Date.parse(phaseStartedAt);
  const deadline = Date.parse(deadlineAt);
  return Number.isFinite(phaseStarted)
    && Number.isFinite(deadline)
    && pickedAt >= phaseStarted
    && pickedAt <= deadline
    && receivedAt <= deadline + PICK_REQUEST_GRACE_MS;
}

export function pickTimeRemainingMs(deadlineAt: string | null, now: number) {
  if (!deadlineAt) return 0;
  const deadline = Date.parse(deadlineAt);
  return Number.isFinite(deadline)
    ? Math.max(0, deadline + PICK_REQUEST_GRACE_MS - now)
    : 0;
}
