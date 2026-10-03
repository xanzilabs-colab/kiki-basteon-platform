import { formatDistanceToNow } from "date-fns";

const johannesburg = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});

export function fmtDateTime(value: string) {
  return johannesburg.format(new Date(value));
}

export function fmtRelativeTime(value: string) {
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}