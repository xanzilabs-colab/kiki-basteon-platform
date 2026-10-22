export type ResponderAssignmentStatus = {
  responder_user_id: string | null;
  status: string | null;
  assigned_at: string | null;
};

const ACTIVE_STATUS_PRIORITY: Record<string, number> = {
  assigned: 1,
  acknowledged: 2,
  en_route: 3,
  on_scene: 4,
};

export function currentResponderStatusByUser(
  assignments: readonly ResponderAssignmentStatus[],
): Map<string, string> {
  const statuses = new Map<string, { status: string; priority: number; assignedAt: number }>();

  for (const assignment of assignments) {
    const userId = assignment.responder_user_id;
    const status = assignment.status;
    const priority = status ? ACTIVE_STATUS_PRIORITY[status] : undefined;
    if (!userId || !status || priority === undefined) continue;

    const assignedAt = assignment.assigned_at ? Date.parse(assignment.assigned_at) : 0;
    const current = statuses.get(userId);
    if (!current || priority > current.priority || (priority === current.priority && assignedAt > current.assignedAt)) {
      statuses.set(userId, { status, priority, assignedAt });
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
