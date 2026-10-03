import type { AlertStatus } from "./types";

export const statusLabels: Record<AlertStatus, string> = { new: "New", acknowledged: "Acknowledged", enroute: "En route", on_scene: "On scene", resolved: "Resolved", false_alarm: "False alarm" };
export const statusColors: Record<AlertStatus, string> = { new: "red", acknowledged: "amber", enroute: "blue", on_scene: "purple", resolved: "green", false_alarm: "gray" };
export const transitions: Record<AlertStatus, AlertStatus[]> = { new: ["acknowledged", "false_alarm"], acknowledged: ["enroute", "false_alarm", "resolved"], enroute: ["on_scene", "false_alarm", "resolved"], on_scene: ["resolved", "false_alarm"], resolved: [], false_alarm: [] };
export const activeStatuses: AlertStatus[] = ["new", "acknowledged", "enroute", "on_scene"];