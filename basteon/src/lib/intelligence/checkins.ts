export type CheckInStage = "due_soon" | "nudge" | "countdown" | "guardian_notified" | "help_offered" | "resolved";
export type CheckInDecision = {
  stage: CheckInStage | null;
  action: "none" | "due_soon" | "nudge" | "countdown" | "guardian_notice_unavailable" | "resolve";
  reason: string;
  countdownUntil: string | null;
};

const MINUTE = 60_000;

export function nextCheckInStage(input: {
  now: number;
  expectedArrivalAt: number;
  p95DurationSeconds?: number | null;
  startedAt: number;
  stage?: CheckInStage | null;
  sentAt?: number | null;
  countdownUntil?: number | null;
  response?: "ok" | "need_more_time" | "help" | "none" | null;
  delayMinutes: number;
  guardianNotifyEnabled: boolean;
}) : CheckInDecision {
  if (input.response === "ok" || input.response === "help" || input.stage === "resolved") {
    return { stage: "resolved", action: "resolve", reason: input.response === "help" ? "The user requested help; continue through the existing SOS flow." : "The user checked in.", countdownUntil: null };
  }
  if (input.stage === "help_offered" || input.stage === "guardian_notified") {
    return { stage: input.stage, action: "none", reason: "", countdownUntil: null };
  }

  if (input.stage === "nudge" && input.response === "need_more_time") {
    return { stage: "resolved", action: "resolve", reason: "The user asked for more time; monitoring remains active.", countdownUntil: null };
  }

  const dueAt = input.expectedArrivalAt - 5 * MINUTE;
  if (!input.stage && input.now >= dueAt && input.now < input.expectedArrivalAt) {
    return { stage: "due_soon", action: "due_soon", reason: "Your trip is nearing its estimated arrival time.", countdownUntil: null };
  }

  const p95At = input.p95DurationSeconds == null
    ? input.expectedArrivalAt
    : input.startedAt + input.p95DurationSeconds * 1_000;
  const nudgeAt = Math.max(input.expectedArrivalAt + 3 * MINUTE, p95At);
  if ((!input.stage || input.stage === "due_soon") && input.now >= nudgeAt) {
    return {
      stage: "nudge",
      action: "nudge",
      reason: `The trip is past its estimated arrival time. ${input.expectedArrivalAt > input.startedAt ? "This is a gentle check-in, not a prediction of danger." : ""}`.trim(),
      countdownUntil: null,
    };
  }

  if (input.stage === "nudge" && input.sentAt != null && input.now >= input.sentAt + input.delayMinutes * MINUTE) {
    const countdownUntil = new Date(input.now + input.delayMinutes * MINUTE).toISOString();
    return {
      stage: "countdown",
      action: input.guardianNotifyEnabled ? "countdown" : "countdown",
      reason: "No check-in has been received yet. The countdown will continue only while the app is active; no emergency services are contacted automatically.",
      countdownUntil,
    };
  }

  if (input.stage === "countdown" && input.now >= (input.countdownUntil ?? (input.sentAt ?? input.now) + input.delayMinutes * MINUTE)) {
    return {
      stage: input.guardianNotifyEnabled ? "help_offered" : "help_offered",
      action: input.guardianNotifyEnabled ? "guardian_notice_unavailable" : "none",
      reason: input.guardianNotifyEnabled
        ? "Guardian contact delivery is not configured in this app; use the existing help/SOS control if assistance is needed."
        : "Guardian notifications are off. Use the existing help/SOS control if assistance is needed.",
      countdownUntil: null,
    };
  }

  return { stage: input.stage ?? null, action: "none", reason: "", countdownUntil: null };
}

export function applyCheckInExtension(expectedArrivalAt: number, minutes: 10 | 20 | 30) {
  return expectedArrivalAt + minutes * MINUTE;
}

export function isWithinQuietHours(now: Date, quietHours: { enabled?: boolean; start?: string; end?: string } | null) {
  if (!quietHours?.enabled || !quietHours.start || !quietHours.end) return false;
  const parse = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const start = parse(quietHours.start);
  const end = parse(quietHours.end);
  const current = now.getUTCHours() * 60 + now.getUTCMinutes();
  return start <= end ? current >= start && current < end : current >= start || current < end;
}
