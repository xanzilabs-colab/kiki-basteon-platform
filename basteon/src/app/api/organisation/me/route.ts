import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";
import { reconcileRosterMemberships } from "@/lib/orgRosterMemberships";
import { currentResponderStatusByUser } from "@/lib/currentResponderStatus";

const settingsSchema = z.object({
  organisationId: z.string().uuid(),
  allowEmailDomain: z.boolean(),
  allowWorkId: z.boolean(),
  requireInvite: z.boolean(),
  autoApproveLinks: z.boolean(),
  rosterIdCaseMode: z.enum(["upper", "lower", "as_is"]).optional(),
  workIdRegex: z.string().optional().nullable().refine((value) => {
    if (!value?.trim()) return true;
    try { new RegExp(value); return true; } catch { return false; }
  }, "Work/student ID regex is invalid."),
});

export async function GET() {
  const { userId, memberships } = await requireOrganisationAccess();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (memberships.length === 0) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const organisationId = memberships[0].organisation_id as string;
  const db = createAdminClient();
  let rosterSyncWarning = false;
  try {
    await reconcileRosterMemberships(db, { organisationId });
  } catch (error) {
    rosterSyncWarning = true;
    console.error("organisation roster reconciliation failed; serving active membership", error);
  }
  const [{ data: organisation }, { data: branches }, { data: members, error: membersError }, { data: settings }, { data: domains }, { data: coverage }, { data: onboarding }, { data: units }, { data: presence }, { data: policy }, { data: globalSupport }, { data: organisationSupport }, { data: authUsers, error: authUsersError }] = await Promise.all([
    db.from("organisations").select("*").eq("id", organisationId).single(),
    db.from("organisation_branches").select("*").eq("organisation_id", organisationId).order("created_at", { ascending: true }),
    db.from("organisation_memberships").select("id,user_id,branch_id,membership_type,role,status,created_at").eq("organisation_id", organisationId).order("created_at"),
    db.from("organisation_link_settings").select("*").eq("organisation_id", organisationId).maybeSingle(),
    db.from("organisation_domains").select("*").eq("organisation_id", organisationId).order("priority", { ascending: true }),
    db.from("organisation_emergency_coverage").select("id,branch_id,emergency_type_code,priority,active").eq("organisation_id", organisationId).eq("active", true),
    db.from("organisation_onboarding").select("*").eq("organisation_id", organisationId).maybeSingle(),
    db.from("organisation_units").select("*").eq("organisation_id", organisationId).order("created_at"),
    db.from("responder_presence").select("user_id,branch_id,unit_id,availability,last_seen_at,profiles(full_name)").eq("organisation_id", organisationId).order("last_seen_at", { ascending: false }),
    db.from("organisation_dispatch_policies").select("*").eq("organisation_id", organisationId).maybeSingle(),
    db.from("support_contacts").select("*").eq("scope", "global").eq("active", true).order("purpose", { ascending: true }).order("contact_name", { ascending: true }),
    db.from("support_contacts").select("*").eq("scope", "organisation").eq("organisation_id", organisationId).eq("active", true).order("purpose", { ascending: true }).order("contact_name", { ascending: true }),
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (membersError || authUsersError) {
    return NextResponse.json({ error: membersError?.message ?? authUsersError?.message ?? "Could not load organisation members." }, { status: 500 });
  }
  const emailByUserId = new Map((authUsers?.users ?? []).map((user) => [user.id, user.email ?? null]));
  const memberIds = (members ?? []).map((member) => member.user_id);
  const { data: memberProfiles, error: profilesError } = memberIds.length
    ? await db.from("profiles").select("id,full_name,phone").in("id", memberIds)
    : { data: [], error: null };
  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });
  const profileById = new Map((memberProfiles ?? []).map((profile) => [profile.id, profile]));
  const membersWithEmail = (members ?? []).map((member) => {
    const profile = profileById.get(member.user_id);
    return { ...member, profiles: { full_name: profile?.full_name ?? null, phone: profile?.phone ?? null, email: emailByUserId.get(member.user_id) ?? null } };
  });

  let assignmentRows: any[] = [];
  let recentAssignments: any[] = [];
  let responderPerformance: any[] = [];
  let auditTrail: any[] = [];

  const alertAssignments = await db.from("alert_assignments")
      .select("id,alert_id,organisation_id,branch_id,responder_user_id,status,assigned_at,acknowledged_at,completed_at")
      .eq("organisation_id", organisationId)
      .order("assigned_at", { ascending: false })
      .limit(250);
  if (alertAssignments.error) {
    return NextResponse.json({ error: `Could not load responder assignment history: ${alertAssignments.error.message}` }, { status: 500 });
  }
  assignmentRows = (alertAssignments.data ?? []) as any[];
  const currentAssignments = await db.from("alert_assignments")
    .select("id,responder_user_id,status,assigned_at")
    .eq("organisation_id", organisationId)
    .in("status", ["assigned", "acknowledged", "en_route", "on_scene"]);
  if (currentAssignments.error) {
    return NextResponse.json({ error: `Could not load current responder statuses: ${currentAssignments.error.message}` }, { status: 500 });
  }
  const activeAssignments = currentAssignments.data ?? [];
  const activeAssignmentIds = activeAssignments.map((assignment: any) => assignment.id).filter(Boolean);
  const currentStatusEvents = activeAssignmentIds.length
    ? await db.from("alert_assignment_events")
      .select("assignment_id,created_at")
      .in("assignment_id", activeAssignmentIds)
      .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (currentStatusEvents.error) {
    return NextResponse.json({ error: `Could not load current responder status events: ${currentStatusEvents.error.message}` }, { status: 500 });
  }
  const statusUpdatedAtByAssignment = new Map<string, string>();
  for (const event of currentStatusEvents.data ?? []) {
    if (event.assignment_id && event.created_at && !statusUpdatedAtByAssignment.has(event.assignment_id)) {
      statusUpdatedAtByAssignment.set(event.assignment_id, event.created_at);
    }
  }
  const currentResponseStatus = currentResponderStatusByUser(activeAssignments.map((assignment: any) => ({
    ...assignment,
    status_updated_at: statusUpdatedAtByAssignment.get(assignment.id) ?? assignment.assigned_at,
  })));
  const alertIds = [...new Set(assignmentRows.map((row) => row.alert_id).filter(Boolean))];

  const alertQueries = alertIds.length
      ? await Promise.all([
        db.from("alert_assignment_events")
          .select("id,alert_id,assignment_id,actor_id,action,from_status,to_status,created_at,profiles(full_name)")
          .in("alert_id", alertIds)
          .order("created_at", { ascending: false })
          .limit(250),
        db.from("alert_events")
          .select("id,alert_id,actor_id,from_status,to_status,note,created_at,profiles(full_name)")
          .in("alert_id", alertIds)
          .order("created_at", { ascending: false })
          .limit(250),
        db.from("alert_routing_events")
          .select("id,alert_id,stage,details,created_at")
          .in("alert_id", alertIds)
          .order("created_at", { ascending: false })
          .limit(250),
        db.from("alerts")
          .select("id,status,triggered_at,assigned_to,primary_organisation_id,primary_branch_id")
          .in("id", alertIds),
      ])
      : [
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
      ] as const;

  const [assignmentEvents, alertEvents, routingEvents, alertRowsResult] = alertQueries;
  const queryError = (alertQueries as Array<{ error?: { message: string } | null }>).find((result) => result.error)?.error;
  if (queryError) {
    return NextResponse.json({ error: `Could not load responder audit history: ${queryError.message}` }, { status: 500 });
  }
  const alertRowsData = ((alertRowsResult as { data?: any[] } | undefined)?.data ?? []) as any[];
  const alertById = new Map(alertRowsData.map((row: any) => [row.id, row]));
  const responderNameByUserId = new Map<string, string | null>();
  for (const profile of memberProfiles ?? []) {
    responderNameByUserId.set(profile.id, profile.full_name ?? null);
  }

  recentAssignments = (assignmentRows ?? []).map((assignment: any) => {
      const alert = alertById.get(assignment.alert_id);
      const responderName = responderNameByUserId.get(assignment.responder_user_id) ?? emailByUserId.get(assignment.responder_user_id) ?? null;
      return {
        id: assignment.id,
        alertId: assignment.alert_id,
        responderUserId: assignment.responder_user_id ?? null,
        responderName,
        status: assignment.status,
        assignedAt: assignment.assigned_at ?? null,
        acknowledgedAt: assignment.acknowledged_at ?? null,
        completedAt: assignment.completed_at ?? null,
        alertStatus: alert?.status ?? null,
        triggeredAt: alert?.triggered_at ?? null,
        branchId: assignment.branch_id ?? null,
        responseSeconds: assignment.acknowledged_at && assignment.assigned_at
          ? Math.max(0, (new Date(assignment.acknowledged_at).getTime() - new Date(assignment.assigned_at).getTime()) / 1000)
          : null,
      };
    });

    responderPerformance = (() => {
      const byUser = new Map<string, any>();
      for (const assignment of assignmentRows) {
        const userId = assignment.responder_user_id;
        if (!userId) continue;
        const record = byUser.get(userId) ?? {
          userId,
          name: responderNameByUserId.get(userId) ?? emailByUserId.get(userId) ?? "Unknown responder",
          totalAssignments: 0,
          acceptedAssignments: 0,
          onSceneAssignments: 0,
          completedAssignments: 0,
          acknowledgeSeconds: [] as number[],
          completionSeconds: [] as number[],
          lastActivity: null as string | null,
        };
        record.totalAssignments += 1;
        if (assignment.acknowledged_at || ["acknowledged", "en_route", "on_scene", "completed"].includes(assignment.status)) record.acceptedAssignments += 1;
        if (assignment.status === "on_scene") record.onSceneAssignments += 1;
        if (assignment.status === "completed") record.completedAssignments += 1;
        if (assignment.assigned_at && assignment.acknowledged_at) {
          record.acknowledgeSeconds.push(Math.max(0, (new Date(assignment.acknowledged_at).getTime() - new Date(assignment.assigned_at).getTime()) / 1000));
        }
        if (assignment.assigned_at && assignment.completed_at) {
          record.completionSeconds.push(Math.max(0, (new Date(assignment.completed_at).getTime() - new Date(assignment.assigned_at).getTime()) / 1000));
        }
        const latest = [assignment.assigned_at, assignment.acknowledged_at, assignment.completed_at].filter(Boolean).sort().at(-1) ?? null;
        if (latest && (!record.lastActivity || new Date(latest).getTime() > new Date(record.lastActivity).getTime())) {
          record.lastActivity = latest;
        }
        byUser.set(userId, record);
      }

      return [...byUser.values()].map((record: any) => ({
        userId: record.userId,
        name: record.name,
        totalAssignments: record.totalAssignments,
        acceptedAssignments: record.acceptedAssignments,
        onSceneAssignments: record.onSceneAssignments,
        completedAssignments: record.completedAssignments,
        avgAcknowledgeSeconds: record.acknowledgeSeconds.length ? Math.round(record.acknowledgeSeconds.reduce((sum: number, value: number) => sum + value, 0) / record.acknowledgeSeconds.length) : null,
        avgCompletionSeconds: record.completionSeconds.length ? Math.round(record.completionSeconds.reduce((sum: number, value: number) => sum + value, 0) / record.completionSeconds.length) : null,
        lastActivity: record.lastActivity,
        successRate: record.totalAssignments ? Math.round((record.completedAssignments / record.totalAssignments) * 100) : 0,
      })).sort((left: any, right: any) => (right.completedAssignments + right.onSceneAssignments) - (left.completedAssignments + left.onSceneAssignments));
    })();

    auditTrail = [...((assignmentEvents as any)?.data ?? []), ...((alertEvents as any)?.data ?? []), ...((routingEvents as any)?.data ?? [])]
      .map((event: any) => {
        const actorName = event.actor_id && event.profiles?.full_name ? event.profiles.full_name : (event.actor_id ? responderNameByUserId.get(event.actor_id) ?? emailByUserId.get(event.actor_id) ?? null : null);
        const alert = alertById.get(event.alert_id);
        return {
          id: event.id,
          alertId: event.alert_id,
          actorId: event.actor_id ?? null,
          actorName,
          category: event.action ? "assignment" : event.stage ? "routing" : "alert",
          action: event.action ?? event.stage ?? "status_update",
          fromStatus: event.from_status ?? null,
          toStatus: event.to_status ?? null,
          createdAt: event.created_at ?? null,
          note: event.note ?? ((event.details && typeof event.details === "object" && "reason" in event.details) ? String((event.details as any).reason) : null),
          alertStatus: alert?.status ?? null,
        };
      })
      .sort((left: any, right: any) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime())
      .slice(0, 60);
  return NextResponse.json({
    userId,
    organisation,
    memberships,
    branches: branches ?? [],
    members: membersWithEmail,
    settings,
    domains: domains ?? [],
    coverage: coverage ?? [],
    onboarding: onboarding ?? null,
    units: units ?? [],
    currentResponseStatus: currentResponseStatus.get(userId) ?? null,
    responderPresence: (presence ?? []).map((row: any) => ({
      ...row,
      response_status: currentResponseStatus.get(row.user_id) ?? null,
      profiles: { ...(row.profiles ?? {}), email: emailByUserId.get(row.user_id) ?? null },
    })),
    dispatchPolicy: policy ?? null,
    supportContacts: {
      global: globalSupport ?? [],
      organisation: organisationSupport ?? [],
    },
    blocked: {
      isBlocked: Boolean(
        organisation?.status === "suspended"
        && (!organisation?.blocked_until || new Date(organisation.blocked_until).getTime() > Date.now()),
      ),
      until: organisation?.blocked_until ?? null,
      reason: organisation?.blocked_reason ?? null,
    },
    responderHistory: recentAssignments,
    responderPerformance,
    alertAuditTrail: auditTrail,
    rosterSyncWarning,
  });
}

export async function PATCH(request: Request) {
  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (memberships.length === 0) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const payload = settingsSchema.safeParse(await request.json());
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  const allowedOrganisationIds = new Set(memberships.map((m: any) => m.organisation_id));
  if (!allowedOrganisationIds.has(payload.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const { error } = await db.from("organisation_link_settings").upsert({
    organisation_id: payload.data.organisationId,
    allow_email_domain: payload.data.allowEmailDomain,
    allow_work_id: payload.data.allowWorkId,
    require_invite: payload.data.requireInvite,
    auto_approve_links: payload.data.autoApproveLinks,
    work_id_regex: payload.data.workIdRegex?.trim() || null,
    ...(payload.data.rosterIdCaseMode ? { roster_id_case_mode: payload.data.rosterIdCaseMode } : {}),
  }, { onConflict: "organisation_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
