import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotificationsToUser } from "@/lib/push";

export type RoutingBranch = {
  id: string;
  organisation_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  geofence_geojson: unknown;
  is_hq: boolean;
  active: boolean;
};

export type RoutingCoverage = {
  organisation_id: string;
  branch_id: string | null;
  emergency_type_code: string;
  priority: number;
  active: boolean;
};

export type RoutingLink = {
  organisation_id: string;
  branch_id: string | null;
  status: string;
  roster_entry_id?: string | null;
};

export type RoutingTarget = {
  organisation_id: string;
  branch_id: string | null;
  emergency_type_code: string;
  tier: number;
};

export type ResponderAvailability = "available" | "en_route" | "on_scene" | "busy" | "off_duty" | "unavailable";

export type CandidateResponder = {
  user_id: string;
  branch_id: string | null;
  role: string;
  availability: ResponderAvailability | null;
  last_seen_at: string | null;
};

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const earthRadiusMeters = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
}

function asCoordinatePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
}

export function pointInPolygonGeoJson(geojson: unknown, lat: number, lng: number) {
  if (!geojson || typeof geojson !== "object") return false;
  const parsed = geojson as { type?: string; coordinates?: unknown };
  if (parsed.type !== "Polygon" || !Array.isArray(parsed.coordinates) || parsed.coordinates.length === 0) return false;
  const ring = parsed.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 3) return false;
  const points = ring.map(asCoordinatePair).filter((point): point is [number, number] => Boolean(point));
  if (points.length < 3) return false;

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = (yi > lat) !== (yj > lat)
      && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function branchMatchesLocation(branch: RoutingBranch, lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return true;
  if (branch.geofence_geojson && pointInPolygonGeoJson(branch.geofence_geojson, lat, lng)) return true;
  if (branch.geofence_geojson) return false;
  if (branch.lat == null || branch.lng == null) return true;
  return haversineMeters(lat, lng, branch.lat, branch.lng) <= 25_000;
}

function hasCoverage(coverageRows: RoutingCoverage[], organisationId: string, branchId: string | null, emergencyTypeCode: string) {
  return coverageRows.some((row) =>
    row.active
    && row.organisation_id === organisationId
    && row.emergency_type_code === emergencyTypeCode
    && (row.branch_id == null || row.branch_id === branchId),
  );
}

function chooseBranch(candidates: RoutingBranch[], preferredBranchId: string | null, lat: number | null, lng: number | null) {
  const scoped = preferredBranchId ? candidates.filter((branch) => branch.id === preferredBranchId) : candidates;
  const matched = scoped.filter((branch) => branch.active && branchMatchesLocation(branch, lat, lng));
  if (!matched.length) return null;
  const sorted = [...matched].sort((a, b) => {
    if (a.is_hq !== b.is_hq) return a.is_hq ? -1 : 1;
    if (lat != null && lng != null && a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
      return haversineMeters(lat, lng, a.lat, a.lng) - haversineMeters(lat, lng, b.lat, b.lng);
    }
    return a.name.localeCompare(b.name);
  });
  return sorted[0];
}

export function planAlertTargets(input: {
  emergencyTypeCode: string;
  lifeThreat: boolean;
  lat: number | null;
  lng: number | null;
  links: RoutingLink[];
  linkedBranches: RoutingBranch[];
  linkedCoverage: RoutingCoverage[];
  partnerBranches: RoutingBranch[];
  partnerCoverage: RoutingCoverage[];
}) {
  const result: RoutingTarget[] = [];
  const seen = new Set<string>();
  const add = (target: RoutingTarget) => {
    const key = `${target.organisation_id}:${target.branch_id ?? "all"}:${target.tier}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(target);
  };

  for (const link of input.links.filter((item) => item.status === "active")) {
    const branches = input.linkedBranches.filter((branch) => branch.organisation_id === link.organisation_id);
    const chosen = chooseBranch(branches, link.branch_id, input.lat, input.lng);
    if (link.branch_id && !chosen) continue;
    const branchId = chosen?.id ?? link.branch_id ?? null;
    if (!hasCoverage(input.linkedCoverage, link.organisation_id, branchId, input.emergencyTypeCode)) continue;
    add({
      organisation_id: link.organisation_id,
      branch_id: branchId,
      emergency_type_code: input.emergencyTypeCode,
      tier: 1,
    });
  }

  const includePartners = result.length === 0;
  if (includePartners) {
    for (const coverage of input.partnerCoverage.filter((item) => item.active && item.emergency_type_code === input.emergencyTypeCode)) {
      const branches = input.partnerBranches.filter((branch) => branch.organisation_id === coverage.organisation_id);
      const chosen = chooseBranch(branches, coverage.branch_id, input.lat, input.lng);
      if (coverage.branch_id && !chosen) continue;
      add({
        organisation_id: coverage.organisation_id,
        branch_id: chosen?.id ?? coverage.branch_id ?? null,
        emergency_type_code: input.emergencyTypeCode,
        tier: 2,
      });
    }
  }

  return result.sort((a, b) => a.tier - b.tier);
}

export function pickDispatchRecipients(candidates: CandidateResponder[], targetBranches: Array<string | null>) {
  const responders = candidates
    .filter((candidate) => ["responder", "dispatcher"].includes(candidate.role))
    .filter((candidate) => targetBranches.some((branchId) => !branchId || !candidate.branch_id || candidate.branch_id === branchId));
  const available = responders
    .filter((candidate) => candidate.availability === "available")
    .sort((a, b) => new Date(b.last_seen_at ?? 0).getTime() - new Date(a.last_seen_at ?? 0).getTime());
  if (available.length) return available;

  const dispatchSupervisors = candidates
    .filter((candidate) => ["owner", "admin", "manager"].includes(candidate.role))
    .filter((candidate) => targetBranches.some((branchId) => !branchId || !candidate.branch_id || candidate.branch_id === branchId));
  return dispatchSupervisors;
}

export async function routeAlertAndNotify(alertId: string) {
  const db = createAdminClient();
  const { data: alert, error: alertError } = await db
    .from("alerts")
    .select("id,device_id,type_code,lat,lng,devices!inner(user_id,device_name)")
    .eq("id", alertId)
    .single();
  if (alertError || !alert) throw new Error(alertError?.message ?? "Alert not found.");

  const ownerId = (alert.devices as { user_id?: string | null } | null)?.user_id ?? null;
  const typeCode = alert.type_code === "sos" ? "general" : (alert.type_code ?? "general");
  const [{ data: typeRow }, { data: links }, { data: partnerOrgs }, { data: partnerBranches }, { data: partnerCoverage }] = await Promise.all([
    db.from("emergency_types").select("code,life_threat").eq("code", typeCode).maybeSingle(),
    ownerId
      ? db.from("organisation_user_links").select("organisation_id,branch_id,status,roster_entry_id").eq("user_id", ownerId).eq("status", "active")
      : Promise.resolve({ data: [] as RoutingLink[] }),
    db.from("organisations")
      .select("id")
      .eq("is_partner", true)
      .eq("status", "active")
      .or(`blocked_until.is.null,blocked_until.lte.${new Date().toISOString()}`),
    db.from("organisation_branches").select("id,organisation_id,name,lat,lng,geofence_geojson,is_hq,active"),
    db.from("organisation_emergency_coverage").select("organisation_id,branch_id,emergency_type_code,priority,active").eq("active", true).eq("emergency_type_code", typeCode),
  ]);
  const rosterLinkedRows = (links ?? []).filter((item) => Boolean(item.roster_entry_id));
  const rawLinkedOrgIds = [...new Set(rosterLinkedRows.map((item) => item.organisation_id))];
  const { data: activeLinkedOrgs } = rawLinkedOrgIds.length
    ? await db.from("organisations")
      .select("id")
      .in("id", rawLinkedOrgIds)
      .eq("status", "active")
      .or(`blocked_until.is.null,blocked_until.lte.${new Date().toISOString()}`)
    : { data: [] as Array<{ id: string }> };
  const activeLinkedOrgIds = new Set((activeLinkedOrgs ?? []).map((row) => row.id));
  const filteredLinks = rosterLinkedRows.filter((link) => activeLinkedOrgIds.has(link.organisation_id));
  const linkedOrgIds = [...new Set(filteredLinks.map((item) => item.organisation_id))];
  const [{ data: linkedBranches }, { data: linkedCoverage }] = linkedOrgIds.length
    ? await Promise.all([
      db.from("organisation_branches").select("id,organisation_id,name,lat,lng,geofence_geojson,is_hq,active").in("organisation_id", linkedOrgIds),
      db.from("organisation_emergency_coverage").select("organisation_id,branch_id,emergency_type_code,priority,active").in("organisation_id", linkedOrgIds).eq("active", true).eq("emergency_type_code", typeCode),
    ])
    : [{ data: [] as RoutingBranch[] }, { data: [] as RoutingCoverage[] }];

  const partnerOrgIds = new Set((partnerOrgs ?? []).map((row) => row.id));
  const filteredPartnerCoverage = (partnerCoverage ?? []).filter((row) => partnerOrgIds.has(row.organisation_id));
  const filteredPartnerBranches = (partnerBranches ?? []).filter((branch) => partnerOrgIds.has(branch.organisation_id));

  const targets = planAlertTargets({
    emergencyTypeCode: typeCode,
    lifeThreat: typeRow?.life_threat ?? true,
    lat: alert.lat,
    lng: alert.lng,
    links: filteredLinks as RoutingLink[],
    linkedBranches: (linkedBranches ?? []) as RoutingBranch[],
    linkedCoverage: (linkedCoverage ?? []) as RoutingCoverage[],
    partnerBranches: filteredPartnerBranches as RoutingBranch[],
    partnerCoverage: filteredPartnerCoverage as RoutingCoverage[],
  });

  await db.from("alert_dispatch_targets").delete().eq("alert_id", alertId);
  if (targets.length) {
    const { error: targetError } = await db.from("alert_dispatch_targets").insert(targets.map((target) => ({
      alert_id: alertId,
      organisation_id: target.organisation_id,
      branch_id: target.branch_id,
      emergency_type_code: target.emergency_type_code,
      tier: target.tier,
      status: "pending",
    })));
    if (targetError) throw new Error(targetError.message);
  }

  const primary = targets[0] ?? null;
  const { error: updateError } = await db.from("alerts").update({
    primary_organisation_id: primary?.organisation_id ?? null,
    primary_branch_id: primary?.branch_id ?? null,
    routed_at: new Date().toISOString(),
    routing_status: primary ? "routed" : "no_target",
  }).eq("id", alertId);
  if (updateError) throw new Error(updateError.message);

  await db.from("alert_routing_events").insert({
    alert_id: alertId,
    stage: primary ? "routed" : "no_target",
    details: {
      type_code: typeCode,
      life_threat: typeRow?.life_threat ?? true,
      targets,
    },
  });

  if (!targets.length) return { targets: 0, recipients: 0 };

  const byOrg = new Map<string, Array<string | null>>();
  for (const target of targets) {
    const list = byOrg.get(target.organisation_id) ?? [];
    list.push(target.branch_id);
    byOrg.set(target.organisation_id, list);
  }

  const recipientIds = new Set<string>();
  const assignmentCandidates: Array<{ user_id: string; organisation_id: string; branch_id: string | null }> = [];
  for (const [organisationId, branchIds] of byOrg.entries()) {
    const { data: members } = await db
      .from("organisation_memberships")
      .select("user_id,branch_id,role,status")
      .eq("organisation_id", organisationId)
      .eq("status", "active")
      .in("role", ["owner", "admin", "manager", "dispatcher", "responder", "viewer"]);
    const { data: presence } = await db
      .from("responder_presence")
      .select("user_id,availability,last_seen_at")
      .eq("organisation_id", organisationId);
    const presenceByUserId = new Map((presence ?? []).map((row) => [row.user_id, row]));

    const candidates: CandidateResponder[] = (members ?? []).map((member) => ({
      user_id: member.user_id,
      branch_id: member.branch_id,
      role: member.role,
      availability: (presenceByUserId.get(member.user_id)?.availability ?? null) as ResponderAvailability | null,
      last_seen_at: presenceByUserId.get(member.user_id)?.last_seen_at ?? null,
    }));
    const recipients = pickDispatchRecipients(candidates, branchIds);
    for (const recipient of recipients) {
      recipientIds.add(recipient.user_id);
      if (recipient.role === "responder" || recipient.role === "dispatcher") {
        assignmentCandidates.push({
          user_id: recipient.user_id,
          organisation_id: organisationId,
          branch_id: recipient.branch_id ?? branchIds.find(Boolean) ?? null,
        });
      }
    }

    if (!recipients.length) {
      await db.from("alert_routing_events").insert({
        alert_id: alertId,
        stage: "no_available_responder",
        details: { organisation_id: organisationId, branch_ids: branchIds },
      });
    }
  }

  const title = typeCode === "medical" ? "Medical alert" : "General alert";
  const body = `${(alert.devices as { device_name?: string | null } | null)?.device_name ?? alert.device_id} needs assistance.`;
  const notifications = [...recipientIds].map((userId) => ({
    user_id: userId,
    type: "system",
    title,
    body,
    href: "/responder",
    payload: { alertId, typeCode },
  }));
  if (notifications.length) {
    const { error: notificationError } = await db.from("notifications").insert(notifications);
    if (notificationError) throw new Error(notificationError.message);
  }

  await Promise.all([...recipientIds].map(async (userId) => {
    await sendPushNotificationsToUser(userId, {
      title,
      body,
      tag: `basteon-alert-${alertId}`,
      url: "/responder",
    });
  }));

  const firstAssignment = assignmentCandidates.find((candidate) => candidate.branch_id != null);
  if (firstAssignment) {
    await db.from("alert_assignments").insert({
      alert_id: alertId,
      organisation_id: firstAssignment.organisation_id,
      branch_id: firstAssignment.branch_id,
      responder_user_id: firstAssignment.user_id,
      status: "assigned",
    });
    await db.from("alerts").update({ assigned_to: firstAssignment.user_id }).eq("id", alertId);
  }

  return { targets: targets.length, recipients: recipientIds.size };
}
