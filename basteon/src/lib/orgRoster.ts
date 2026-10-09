export type RosterIdentifierType = "email" | "member_id" | "access_code";
export type RosterIdCaseMode = "upper" | "lower" | "as_is";

export function normalizeIdentifierInput(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRosterIdentifier(value: string, type: RosterIdentifierType, idCaseMode: RosterIdCaseMode = "upper") {
  const cleaned = normalizeIdentifierInput(value);
  if (type === "email") return cleaned.toLowerCase();
  if (idCaseMode === "lower") return cleaned.toLowerCase();
  if (idCaseMode === "as_is") return cleaned;
  return cleaned.toUpperCase();
}

export function isRosterWindowActive(validFrom?: string | null, validUntil?: string | null, now = Date.now()) {
  const fromMs = validFrom ? new Date(validFrom).getTime() : Number.NEGATIVE_INFINITY;
  const untilMs = validUntil ? new Date(validUntil).getTime() : Number.POSITIVE_INFINITY;
  return fromMs <= now && now <= untilMs;
}
