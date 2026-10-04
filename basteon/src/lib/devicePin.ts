import { z } from "zod";

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

/** Returns a user-facing problem with a proposed band PIN, or null when it is acceptable. */
export function pinProblem(pin: string): string | null {
  if (!new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin)) {
    return `Use ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`;
  }
  if (/^(\d)\1+$/.test(pin)) return "Avoid repeating the same digit.";
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((digit, index) => (digit - digits[index] + 10) % 10));
  if (steps.size === 1 && (steps.has(1) || steps.has(9))) return "Avoid simple sequences like 1234.";
  return null;
}

/** Any PIN-shaped input (used when checking an existing PIN, so older PINs are never rejected by policy). */
export const pinInputSchema = z.string().regex(/^\d{4,8}$/);
/** A new PIN that also passes the strength rules. */
export const newPinSchema = pinInputSchema.refine((pin) => pinProblem(pin) === null, "weak_pin");

export type PinErrorBody =
  | { error: "bad_pin"; attempts_left: number }
  | { error: "pin_locked_out"; retry_after: number }
  | { error: "pin_required" }
  | { error: "no_pin" };

export function pinErrorMessage(body: { error?: string; attempts_left?: number; retry_after?: number }): string | null {
  switch (body.error) {
    case "bad_pin":
      return body.attempts_left
        ? `Incorrect PIN. ${body.attempts_left} attempt${body.attempts_left === 1 ? "" : "s"} left before a 15 minute lock.`
        : "Incorrect PIN. The band PIN is now locked for 15 minutes.";
    case "pin_locked_out": {
      const minutes = Math.max(1, Math.ceil((body.retry_after ?? 900) / 60));
      return `Too many incorrect PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    case "pin_required":
      return "This band is PIN-locked. Enter its PIN to continue.";
    case "active_alert":
      return "This band has an active alert. It can't be transferred or unlinked until the alert is closed.";
    case "already_owned":
      return "This band is linked to another account and isn't PIN-locked. Ask the owner to unlink it first.";
    case "weak_pin":
      return "Choose a stronger PIN (no repeated digits or simple sequences).";
    default:
      return null;
  }
}
