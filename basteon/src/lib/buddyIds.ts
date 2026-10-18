export function normalizeKikiId(value: unknown) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase().replace(/^KIKI[-_ ]?/, "");
  return /^[0-9A-F]{16}$/.test(code) ? `KIKI-${code}` : null;
}
