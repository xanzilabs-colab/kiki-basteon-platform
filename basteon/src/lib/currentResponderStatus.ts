export type ResponderAssignmentStatus = {
  responder_user_id: string | null;
  status: string | null;
  assigned_at: string | null;
  status_updated_at?: string | null;
};

const ACTIVE_STATUSES = new Set(["assigned", "acknowledged", "en_route", "on_scene"]);

export function currentResponderStatusByUser(
  assignments: readonly ResponderAssignmentStatus[],
): Map<string, string> {
  const statuses = new Map<string, { status: string; statusUpdatedAt: number; assignedAt: number }>();

  for (const assignment of assignments) {
    const userId = assignment.responder_user_id;
    const status = assignment.status;
    if (!userId || !status || !ACTIVE_STATUSES.has(status)) continue;

    const assignedAt = Date.parse(assignment.assigned_at ?? "") || 0;
    const statusUpdatedAt = Date.parse(assignment.status_updated_at ?? "") || assignedAt;
    const current = statuses.get(userId);
    if (!current || statusUpdatedAt > current.statusUpdatedAt ||
      (statusUpdatedAt === current.statusUpdatedAt && assignedAt > current.assignedAt)) {
      statuses.set(userId, { status, statusUpdatedAt, assignedAt });
    }
  }

  return new Map([...statuses].map(([userId, value]) => [userId, value.status]));
}

export function formatCurrentResponderStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  const labels: Record<string, string> = {
    available: "Available",
    assigned: "Assigned",
    acknowledged: "Acknowledged",
    en_route: "En route",
    on_scene: "On scene",
    busy: "Busy",
    off_duty: "Off duty",
    unavailable: "Unavailable",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}
