import { formatDistance } from "date-fns";

const johannesburg = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});

export function fmtDateTime(value: string) {
  return johannesburg.format(new Date(value));
}

export function fmtRelativeTime(value: string, referenceDate: Date = new Date()) {
  return formatDistance(new Date(value), referenceDate, { addSuffix: true });
}