"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  CircleCheck,
  ExternalLink,
  House,
  List,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Settings2,
  Shield,
  X,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useEmergencyTypes } from "@/hooks/useEmergencyTypes";
import { membershipTypeOptionsForOrganisation, roleHintForMembershipType } from "@/lib/organisationCategories";
import { formatCurrentResponderStatus } from "@/lib/currentResponderStatus";
import { useAppDialog } from "@/components/AppDialogProvider";
import { createClient } from "@/lib/supabase/client";

type MeResponse = {
  userId?: string;
  organisation: any;
  memberships: Array<{ role: string; organisation_id: string }>;
  branches: Array<any>;
  members: Array<any>;
  settings: any;
  domains: Array<any>;
  coverage: Array<any>;
  units: Array<any>;
  responderPresence: Array<any>;
  responderHistory?: Array<{
    id: string;
    alertId: string | null;
    responderUserId: string | null;
    responderName: string | null;
    status: string | null;
    assignedAt: string | null;
    acknowledgedAt: string | null;
    completedAt: string | null;
    alertStatus: string | null;
    triggeredAt: string | null;
    branchId: string | null;
    responseSeconds: number | null;
  }>;
  responderPerformance?: Array<{
    userId: string;
    name: string;
    totalAssignments: number;
    acceptedAssignments: number;
    onSceneAssignments: number;
    completedAssignments: number;
    avgAcknowledgeSeconds: number | null;
    avgCompletionSeconds: number | null;
    lastActivity: string | null;
    successRate: number;
  }>;
  alertAuditTrail?: Array<{
    id: string;
    alertId: string | null;
    actorId: string | null;
    actorName: string | null;
    category: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    createdAt: string | null;
    note: string | null;
    alertStatus: string | null;
  }>;
  dispatchPolicy: { acknowledge_timeout_seconds: number; escalation_timeout_seconds: number; auto_assign_enabled: boolean } | null;
  supportContacts: {
    global: Array<any>;
    organisation: Array<any>;
  };
  blocked: {
    isBlocked: boolean;
    until: string | null;
    reason: string | null;
  };
  onboarding: {
    organisation_profile_done: boolean;
    branches_done: boolean;
    linking_rules_done: boolean;
    coverage_done: boolean;
    responders_done: boolean;
    completed_at: string | null;
  } | null;
};

type DashboardTab = "home" | "beneficiaries" | "responders" | "members" | "roster" | "settings" | "configurations";
type ConfigurationDrawer = "branch" | "unit" | "coverage" | null;
type RosterEntry = {
  id: string;
  membership_type: string;
  identifier_type: "email" | "member_id" | "access_code";
  identifier_raw: string;
  display_name: string | null;
  status: "active" | "suspended" | "expired" | "removed";
  valid_from: string;
  valid_until: string | null;
  source: string;
  claimed_by_user_id: string | null;
  claimed_at: string | null;
  max_claims: number;
  updated_at: string;
};
type OrganisationLinkRequest = {
  id: string;
  userId: string;
  name: string;
  membershipType: string;
  createdAt: string;
};

function formatResponseDuration(seconds: number | null) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function SettingsSwitch({ checked, onChange, title, description }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <div className="org-setting-row">
      <div className="min-w-0">
        <p className="org-setting-title">{title}</p>
        <p className="org-setting-description">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        className={`org-switch ${checked ? "is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

function parseRosterText(text: string, defaultType: "email" | "member_id" | "access_code") {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = [",", "\t", ";"].reduce((best, candidate) =>
    lines[0].split(candidate).length > lines[0].split(best).length ? candidate : best,
  ",");
  const rows = lines.map((line) => {
    const values: string[] = [];
    let value = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && quoted) { value += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) { values.push(value.trim()); value = ""; }
      else value += char;
    }
    values.push(value.trim());
    return values;
  });

  const header = rows[0].map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const emailIndex = header.findIndex((value) => ["email", "emailaddress", "mail", "e-mail"].includes(value));
  const idIndex = header.findIndex((value) => ["id", "memberid", "studentid", "studentnumber", "studentno", "workid", "staffid", "staffno", "employeeid", "employeenumber", "accesscode", "code"].includes(value));
  const nameIndex = header.findIndex((value) => ["name", "fullname", "displayname", "membername"].includes(value));
  const hasHeader = emailIndex >= 0 || idIndex >= 0;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows.flatMap((row) => {
    const values: Array<{ identifier: string; identifierType: "email" | "member_id" | "access_code" }> = [];
    if (emailIndex >= 0 && row[emailIndex]) values.push({ identifier: row[emailIndex], identifierType: "email" });
    if (idIndex >= 0 && row[idIndex]) values.push({
      identifier: row[idIndex],
      identifierType: header[idIndex] === "accesscode" || header[idIndex] === "code" ? "access_code" : "member_id",
    });
    if (!values.length) {
      for (const candidate of row.filter(Boolean)) {
        values.push({ identifier: candidate, identifierType: candidate.includes("@") ? "email" : defaultType });
      }
    }
    return values.filter((value) => value.identifier.trim()).map((value) => ({
      ...value,
      displayName: nameIndex >= 0 ? row[nameIndex] || null : null,
      membershipType: "member",
      maxClaims: 1,
    }));
  });
}

export function OrganisationConsole() {
  const { confirm } = useAppDialog();
  const [state, setState] = useState<MeResponse | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [branchCity, setBranchCity] = useState("");
  const [branchLat, setBranchLat] = useState("");
  const [branchLng, setBranchLng] = useState("");
  const [branchGeofence, setBranchGeofence] = useState("");
  const [branchIsHq, setBranchIsHq] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState("");
  const [configurationDrawer, setConfigurationDrawer] = useState<ConfigurationDrawer>(null);
  const [responderName, setResponderName] = useState("");
  const [responderEmail, setResponderEmail] = useState("");
  const [responderPhone, setResponderPhone] = useState("");
  const [responderRole, setResponderRole] = useState("responder");
  const [responderBranch, setResponderBranch] = useState("");
  const [responderUnit, setResponderUnit] = useState("");
  const [editingMemberUserId, setEditingMemberUserId] = useState("");
  const [editMemberName, setEditMemberName] = useState("");
  const [editMemberPhone, setEditMemberPhone] = useState("");
  const [editMemberRole, setEditMemberRole] = useState("responder");
  const [editMemberBranch, setEditMemberBranch] = useState("");
  const [editMemberUnit, setEditMemberUnit] = useState("");
  const [editMemberStatus, setEditMemberStatus] = useState("active");
  const [editMemberAvailability, setEditMemberAvailability] = useState("off_duty");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [generatedCredentials, setGeneratedCredentials] = useState<{ email: string; password: string; fullName: string } | null>(null);
  const [generatedCredentialPdfUrl, setGeneratedCredentialPdfUrl] = useState("");
  const [coverageTypeCode, setCoverageTypeCode] = useState("general");
  const [coverageBranchId, setCoverageBranchId] = useState("");
  const [unitName, setUnitName] = useState("");
  const [unitBranchId, setUnitBranchId] = useState("");
  const [unitType, setUnitType] = useState("other");
  const [editingUnitId, setEditingUnitId] = useState("");
  const [domainValue, setDomainValue] = useState("");
  const [domainMembershipType, setDomainMembershipType] = useState("staff");
  const [domainPriority, setDomainPriority] = useState("100");
  const [allowEmailDomain, setAllowEmailDomain] = useState(true);
  const [allowWorkId, setAllowWorkId] = useState(true);
  const [requireInvite, setRequireInvite] = useState(false);
  const [autoApproveLinks, setAutoApproveLinks] = useState(true);
  const [workIdRegex, setWorkIdRegex] = useState("");
  const [rosterIdCaseMode, setRosterIdCaseMode] = useState<"upper" | "lower" | "as_is">("upper");
  const [supportContactName, setSupportContactName] = useState("");
  const [supportContactType, setSupportContactType] = useState<"email" | "phone">("email");
  const [supportContactValue, setSupportContactValue] = useState("");
  const [supportContactPurpose, setSupportContactPurpose] = useState("general support");
  const [rosterRows, setRosterRows] = useState<RosterEntry[]>([]);
  const [rosterTotal, setRosterTotal] = useState(0);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [linkRequests, setLinkRequests] = useState<OrganisationLinkRequest[]>([]);
  const [linkRequestsLoading, setLinkRequestsLoading] = useState(false);
  const [rosterSearch, setRosterSearch] = useState("");
  const [benSearch, setBenSearch] = useState("");
  const [benBranch, setBenBranch] = useState("");
  const [memSearch, setMemSearch] = useState("");
  const [memBranch, setMemBranch] = useState("");
  const [respSearch, setRespSearch] = useState("");
  const [respBranch, setRespBranch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [rosterIdentifierType, setRosterIdentifierType] = useState<"email" | "member_id" | "access_code">("email");
  const [rosterIdentifier, setRosterIdentifier] = useState("");
  const [rosterMembershipType, setRosterMembershipType] = useState("member");
  const [rosterDisplayName, setRosterDisplayName] = useState("");
  const [rosterValidUntil, setRosterValidUntil] = useState("");
  const [rosterMaxClaims, setRosterMaxClaims] = useState("1");
  const [rosterBulkText, setRosterBulkText] = useState("");
  const [rosterImportSource, setRosterImportSource] = useState<"csv" | "pasted">("pasted");
  const [activeTab, setActiveTab] = useState<DashboardTab>("home");
  const [dashboardUnlocked, setDashboardUnlocked] = useState(false);
  const organisationId = state?.organisation?.id ?? "";
  const emergencyTypes = useEmergencyTypes();
  const membershipTypeOptions = useMemo(
    () => membershipTypeOptionsForOrganisation(state?.organisation ?? {}),
    [state?.organisation],
  );
  const rosterImportPreview = useMemo(
    () => parseRosterText(rosterBulkText, rosterIdentifierType),
    [rosterBulkText, rosterIdentifierType],
  );

  async function refresh() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/organisation/me", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not load organisation.");
      setBusy(false);
      return;
    }
    setState(body as MeResponse);
    setLastSyncedAt(new Date().toISOString());
    setBusy(false);
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab]);
  useEffect(() => {
    if (!configurationDrawer) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeConfigurationDrawer();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [configurationDrawer]);
  useEffect(() => {
    if (!organisationId) return;
    const client = createClient();
    const channel = client.channel(`organisation-presence-${organisationId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "responder_presence",
        filter: `organisation_id=eq.${organisationId}`,
      }, (payload) => {
        const changed = (payload.eventType === "DELETE" ? payload.old : payload.new) as {
          user_id?: string;
          availability?: string;
          branch_id?: string | null;
          unit_id?: string | null;
          last_seen_at?: string;
        };
        if (!changed.user_id) return;
        setState((current) => {
          if (!current) return current;
          const existing = current.responderPresence.find((row: any) => row.user_id === changed.user_id);
          if (payload.eventType === "DELETE") {
            return { ...current, responderPresence: current.responderPresence.filter((row: any) => row.user_id !== changed.user_id) };
          }
          if (!existing) {
            const member = current.members.find((row: any) => row.user_id === changed.user_id);
            return {
              ...current,
              responderPresence: [...current.responderPresence, {
                ...changed,
                profiles: member?.profiles ?? { full_name: null, phone: null, email: null },
              }],
            };
          }
          return {
            ...current,
            responderPresence: current.responderPresence.map((row: any) => row.user_id === changed.user_id
              ? { ...row, ...changed }
              : row),
          };
        });
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "alert_assignments",
        filter: `organisation_id=eq.${organisationId}`,
      }, () => {
        void refresh();
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [organisationId]);
  useEffect(() => { setLogoUrl(state?.organisation?.logo_url ?? ""); }, [state?.organisation?.logo_url]);
  useEffect(() => {
    if (!state?.settings) return;
    setAllowEmailDomain(Boolean(state.settings.allow_email_domain));
    setAllowWorkId(Boolean(state.settings.allow_work_id));
    setRequireInvite(Boolean(state.settings.require_invite));
    setAutoApproveLinks(Boolean(state.settings.auto_approve_links));
    setWorkIdRegex(state.settings.work_id_regex ?? "");
    setRosterIdCaseMode(state.settings.roster_id_case_mode ?? "upper");
  }, [state?.settings]);
  useEffect(() => {
    setDomainMembershipType((current) => membershipTypeOptions.some((option) => option.value === current) ? current : (membershipTypeOptions[0]?.value ?? "staff"));
    setRosterMembershipType((current) => membershipTypeOptions.some((option) => option.value === current) ? current : (membershipTypeOptions[0]?.value ?? "member"));
  }, [membershipTypeOptions]);

  const dashboardUnlockStorageKey = organisationId ? `org-dashboard-unlocked:${organisationId}` : "";
  const branchOptions = state?.branches ?? [];
  const units = state?.units ?? [];
  const responders = state?.responderPresence ?? [];
  const members = useMemo(() => state?.members ?? [], [state?.members]);
  const visibleMembers = useMemo(
    () => members.filter((member) => !["removed", "revoked", "archived", "unlinked"].includes(String(member.status ?? "").toLowerCase())),
    [members],
  );
  const onboarding = state?.onboarding ?? {
    organisation_profile_done: false,
    branches_done: false,
    linking_rules_done: false,
    coverage_done: false,
    responders_done: false,
    completed_at: null,
  };
  const onboardingProgress = [onboarding.organisation_profile_done, onboarding.branches_done, onboarding.linking_rules_done, onboarding.coverage_done, onboarding.responders_done].filter(Boolean).length;
  const onboardingComplete = onboardingProgress >= 5;
  const inOnboardingMode = !dashboardUnlocked;
  const responderRoles = new Set(["owner", "admin", "manager", "dispatcher", "responder", "viewer"]);
  const responderMembers = visibleMembers.filter((member) => responderRoles.has(member.role));
  const beneficiaryMembers = visibleMembers.filter((member) => !responderRoles.has(member.role) || member.membership_type === "member");
  const memberUserIds = useMemo(() => new Set(visibleMembers.map((member) => member.user_id)), [visibleMembers]);
  const presenceOnlyResponders = useMemo(
    () => responders.filter((presence) => !memberUserIds.has(presence.user_id)),
    [memberUserIds, responders],
  );

  const matchesQuery = (query: string, ...values: unknown[]) => {
    const needle = query.trim().toLowerCase();
    return !needle || values.some((value) => String(value ?? "").toLowerCase().includes(needle));
  };
  const filteredBeneficiaries = beneficiaryMembers.filter((member) => (!benBranch || member.branch_id === benBranch) && matchesQuery(benSearch, member.profiles?.full_name, member.profiles?.email, member.membership_type, member.status));
  const filteredMembers = visibleMembers.filter((member) => (!memBranch || member.branch_id === memBranch) && matchesQuery(memSearch, member.profiles?.full_name, member.profiles?.email, member.role, member.membership_type, member.status));
  const filteredPresenceOnly = presenceOnlyResponders.filter((presence) => (!memBranch || presence.branch_id === memBranch) && matchesQuery(memSearch, presence.profiles?.full_name, presence.profiles?.email, presence.availability));
  const emailByUser = new Map(members.map((member) => [member.user_id, member.profiles?.email]));
  const filteredResponders = responders.filter((presence) => (!respBranch || presence.branch_id === respBranch) && matchesQuery(respSearch, presence.profiles?.full_name, presence.profiles?.email ?? emailByUser.get(presence.user_id), presence.response_status, presence.availability));
  const listToolbar = (query: string, setQuery: (value: string) => void, branch: string, setBranch: (value: string) => void, placeholder: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <input className="org-list-search" aria-label={placeholder} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} />
      <select className="org-list-search" style={{ maxWidth: 220 }} aria-label="Filter by branch" value={branch} onChange={(event) => setBranch(event.target.value)}>
        <option value="">All branches</option>
        {branchOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </div>
  );

  async function memberAction(userId: string, action: "revoke" | "block" | "unblock") {
    if (!organisationId) return;
    const label = action === "revoke" ? "Revoke this person's access? They will need to link again." : action === "block" ? "Block this person? They will lose access and cannot re-link until unblocked." : "";
    if (label && !(await confirm(label, { title: action === "revoke" ? "Revoke access?" : "Block this person?", confirmLabel: action === "revoke" ? "Revoke access" : "Block person", danger: true }))) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/organisation/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organisationId, userId, action }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) setError((body as any)?.error ?? "Could not update member.");
    else { setMessage(action === "revoke" ? "Access revoked." : action === "block" ? "Member blocked." : "Member unblocked."); await refresh(); }
    setBusy(false);
  }

  async function deleteRosterEntry(entry: RosterEntry) {
    if (!organisationId || !(await confirm("Delete this roster entry? Anyone linked through it will lose access.", {
      title: "Delete roster entry?",
      confirmLabel: "Delete entry",
      danger: true,
    }))) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/organisation/roster", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organisationId, id: entry.id }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) setError((body as any)?.error ?? "Could not delete roster entry.");
    else { setMessage("Roster entry deleted."); await loadRoster(); await refresh(); }
    setBusy(false);
  }

  async function loadRoster(query = rosterSearch) {
    if (!organisationId) return;
    setRosterLoading(true);
    const response = await fetch(`/api/organisation/roster?organisationId=${organisationId}&page=1&pageSize=100&q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not load roster.");
      setRosterLoading(false);
      return;
    }
    setRosterRows((body as any)?.rows ?? []);
    setRosterTotal(Number((body as any)?.total ?? 0));
    setRosterLoading(false);
  }

  async function loadLinkRequests() {
    if (!organisationId) return;
    setLinkRequestsLoading(true);
    const response = await fetch(`/api/organisation/link-requests?organisationId=${organisationId}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not load pending link requests.");
      setLinkRequestsLoading(false);
      return;
    }
    setLinkRequests(Array.isArray(body) ? body : []);
    setLinkRequestsLoading(false);
  }

  async function resolveLinkRequest(linkId: string, action: "approve" | "reject") {
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/link-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, linkId, action }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? `Could not ${action} this link request.`);
      setBusy(false);
      return;
    }
    setMessage(action === "approve" ? "Link request approved; organisation access is now active." : "Link request rejected.");
    await Promise.all([loadLinkRequests(), refresh()]);
    setBusy(false);
  }

  useEffect(() => {
    if (!dashboardUnlockStorageKey) return;
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(dashboardUnlockStorageKey) === "1";
    setDashboardUnlocked(saved);
  }, [dashboardUnlockStorageKey, onboardingComplete]);

  useEffect(() => {
    if (!organisationId || activeTab !== "roster") return;
    void Promise.all([loadRoster(), loadLinkRequests()]);
  }, [organisationId, activeTab]);

  function unlockDashboard() {
    if (!dashboardUnlockStorageKey || typeof window === "undefined") return;
    window.localStorage.setItem(dashboardUnlockStorageKey, "1");
    setDashboardUnlocked(true);
    setActiveTab("home");
  }

  async function markOnboardingStep(step: "organisationProfileDone" | "branchesDone" | "linkingRulesDone" | "coverageDone" | "respondersDone") {
    if (!organisationId) return;
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/organisation/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, [step]: true }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not update onboarding.");
      setBusy(false);
      return;
    }
    setMessage("Onboarding progress updated.");
    await refresh();
  }

  async function addDomainRule(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        domain: domainValue,
        membershipType: domainMembershipType,
        roleHint: roleHintForMembershipType(domainMembershipType),
        priority: Number(domainPriority) || 100,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not add domain rule.");
      setBusy(false);
      return;
    }
    setDomainValue("");
    setDomainPriority("100");
    setMessage("Domain rule added.");
    await refresh();
  }

  async function removeDomainRule(id: string) {
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/domains", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, id }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not remove domain rule.");
      setBusy(false);
      return;
    }
    setMessage("Domain rule removed.");
    await refresh();
  }

  async function createBranch(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    const lat = branchLat.trim() ? Number(branchLat) : null;
    const lng = branchLng.trim() ? Number(branchLng) : null;
    if ((lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
      (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180))) {
      setError("Enter a valid latitude and longitude.");
      return;
    }
    let geofence: unknown = null;
    if (branchGeofence.trim()) {
      try {
        geofence = JSON.parse(branchGeofence);
      } catch {
        setError("Geofence must be valid JSON polygon.");
        return;
      }
    }
    setBusy(true);
    setMessage("");
    setError("");
    const wasEditing = Boolean(editingBranchId);
    try {
      const response = await fetch("/api/organisation/branches", {
        method: wasEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId,
          ...(editingBranchId ? { branchId: editingBranchId } : {}),
          name: branchName,
          code: branchCode || null,
          address: branchAddress || null,
          city: branchCity || null,
          lat,
          lng,
          geofenceGeojson: geofence,
          isHq: branchIsHq,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? (wasEditing ? "Could not update branch." : "Could not create branch."));
      setBranchName("");
      setBranchCode("");
      setBranchAddress("");
      setBranchCity("");
      setBranchLat("");
      setBranchLng("");
      setBranchGeofence("");
      setBranchIsHq(false);
      setEditingBranchId("");
      setConfigurationDrawer(null);
      setMessage(wasEditing ? "Branch updated." : "Branch added.");
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : (wasEditing ? "Could not update branch." : "Could not create branch."));
    } finally {
      setBusy(false);
    }
  }

  function editBranch(branch: any) {
    setEditingBranchId(branch.id);
    setBranchName(branch.name ?? "");
    setBranchCode(branch.code ?? "");
    setBranchAddress(branch.address ?? "");
    setBranchCity(branch.city ?? "");
    setBranchLat(branch.lat == null ? "" : String(branch.lat));
    setBranchLng(branch.lng == null ? "" : String(branch.lng));
    setBranchGeofence(branch.geofence_geojson ? JSON.stringify(branch.geofence_geojson, null, 2) : "");
    setBranchIsHq(Boolean(branch.is_hq));
    setConfigurationDrawer("branch");
    setError("");
    setMessage("");
  }

  function cancelBranchEdit() {
    setEditingBranchId("");
    setBranchName("");
    setBranchCode("");
    setBranchAddress("");
    setBranchCity("");
    setBranchLat("");
    setBranchLng("");
    setBranchGeofence("");
    setBranchIsHq(false);
    setError("");
    setConfigurationDrawer(null);
  }

  function openNewBranch() {
    cancelBranchEdit();
    setMessage("");
    setConfigurationDrawer("branch");
  }

  function openNewUnit() {
    setEditingUnitId("");
    setUnitName("");
    setUnitBranchId("");
    setUnitType("other");
    setError("");
    setMessage("");
    setConfigurationDrawer("unit");
  }

  function closeConfigurationDrawer() {
    if (configurationDrawer === "branch") {
      cancelBranchEdit();
    } else if (configurationDrawer === "unit") {
      setEditingUnitId("");
      setUnitName("");
      setUnitBranchId("");
      setUnitType("other");
      setError("");
      setConfigurationDrawer(null);
    } else {
      setError("");
      setConfigurationDrawer(null);
    }
  }

  async function addResponder(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setMessage("");
    setError("");
    setGeneratedCredentials(null);
    setGeneratedCredentialPdfUrl("");
    if (!responderBranch) {
      setError("Responders and dispatchers must be assigned to a branch.");
      setBusy(false);
      return;
    }
    const response = await fetch("/api/organisation/responders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        fullName: responderName,
        email: responderEmail,
        phone: responderPhone || null,
        branchId: responderBranch,
        unitId: responderUnit || null,
        role: responderRole,
        membershipType: "responder",
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not add responder account.");
      setBusy(false);
      return;
    }
    setGeneratedCredentials((body as any).credentials ?? null);
    setGeneratedCredentialPdfUrl((body as any).credentialPdfUrl ?? "");
    setResponderName("");
    setResponderEmail("");
    setResponderPhone("");
    setResponderRole("responder");
    setResponderBranch("");
    setResponderUnit("");
    setMessage("Responder account created.");
    await refresh();
  }

  async function createUnit(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    if (!editingUnitId && !unitBranchId) {
      setError("Unit branch is required.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const wasEditing = Boolean(editingUnitId);
    try {
      const response = await fetch("/api/organisation/units", {
        method: wasEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingUnitId
          ? { organisationId, unitId: editingUnitId, name: unitName, unitType }
          : { organisationId, branchId: unitBranchId, name: unitName, unitType }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? (wasEditing ? "Could not update unit." : "Could not create unit."));
      setUnitName("");
      setUnitBranchId("");
      setUnitType("other");
      setEditingUnitId("");
      setConfigurationDrawer(null);
      setMessage(wasEditing ? "Unit updated." : "Unit created.");
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : (wasEditing ? "Could not update unit." : "Could not create unit."));
    } finally {
      setBusy(false);
    }
  }

  function editUnit(unit: any) {
    setEditingUnitId(unit.id);
    setUnitName(unit.name ?? "");
    setUnitBranchId(unit.branch_id ?? "");
    setUnitType(unit.unit_type ?? "other");
    setConfigurationDrawer("unit");
    setError("");
    setMessage("");
  }

  async function setUnitActive(unitId: string, active: boolean) {
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/organisation/units", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId, unitId, active }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not update unit status.");
      setMessage(active ? "Unit activated." : "Unit deactivated.");
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not update unit status.");
    } finally {
      setBusy(false);
    }
  }
  async function setAvailability(userId: string, availability: string) {
    if (!organisationId) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/organisation/responders/availability", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, userId, availability }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not update availability.");
      setBusy(false);
      return;
    }
    setMessage("Availability updated.");
    await refresh();
  }

  async function saveOrganisationLogo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/organisation/logo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId, logoUrl: logoUrl.trim() || null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not save organisation logo.");
      setState((current) => current ? { ...current, organisation: { ...current.organisation, logo_url: body.logoUrl } } : current);
      setLogoUrl(body.logoUrl ?? "");
      setMessage("Organisation logo saved.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save organisation logo.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadOrganisationLogo() {
    if (!organisationId || !logoFile) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.set("organisationId", organisationId);
      form.set("file", logoFile);
      const response = await fetch("/api/organisation/logo", { method: "POST", body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (body?.error === "logo_upload_failed") {
          throw new Error(body.retryable
            ? "Image storage is temporarily unavailable. The upload was retried; please try again shortly."
            : "The image storage service rejected this logo. Please try a PNG, JPEG, or WebP image under 2 MB.");
        }
        throw new Error(body?.error ?? "Could not upload organisation logo.");
      }
      setState((current) => current ? { ...current, organisation: { ...current.organisation, logo_url: body.logoUrl } } : current);
      setLogoUrl(body.logoUrl ?? "");
      setLogoFile(null);
      setMessage("Organisation logo uploaded.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not upload organisation logo.");
    } finally {
      setBusy(false);
    }
  }

  async function regeneratePassword(userId: string) {
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/responders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, userId }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not regenerate password.");
      setBusy(false);
      return;
    }
    setGeneratedCredentials({ email: "Password reset", fullName: "Share securely", password: (body as any).password });
    setMessage("Password regenerated.");
    setBusy(false);
  }

  function beginEditMember(member: any) {
    const presence = responders.find((row) => row.user_id === member.user_id);
    setEditingMemberUserId(member.user_id);
    setEditMemberName(member.profiles?.full_name ?? member.user_id);
    setEditMemberPhone(member.profiles?.phone ?? "");
    setEditMemberRole(member.role ?? "responder");
    setEditMemberBranch(member.branch_id ?? "");
    setEditMemberUnit(presence?.unit_id ?? "");
    setEditMemberStatus(member.status ?? "active");
    setEditMemberAvailability(presence?.availability ?? "off_duty");
  }

  function cancelEditMember() {
    setEditingMemberUserId("");
    setEditMemberName("");
    setEditMemberPhone("");
    setEditMemberRole("responder");
    setEditMemberBranch("");
    setEditMemberUnit("");
    setEditMemberStatus("active");
    setEditMemberAvailability("off_duty");
  }

  async function saveMemberEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId || !editingMemberUserId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/responders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        organisationId,
        userId: editingMemberUserId,
        fullName: editMemberName,
        phone: editMemberPhone || null,
        role: editMemberRole,
        branchId: editMemberBranch,
        unitId: editMemberUnit || null,
        status: editMemberStatus,
        availability: editMemberAvailability,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not update member account.");
      setBusy(false);
      return;
    }
    setMessage("Member account updated.");
    cancelEditMember();
    await refresh();
  }

  async function addCoverage(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/organisation/coverage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        branchId: coverageBranchId || null,
        emergencyTypeCode: coverageTypeCode,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not save emergency coverage.");
      setBusy(false);
      return;
    }
    setMessage("Coverage saved.");
    setConfigurationDrawer(null);
    await refresh();
  }

  async function saveLinkSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        allowEmailDomain,
        allowWorkId,
        requireInvite,
        autoApproveLinks,
        workIdRegex: workIdRegex.trim() || null,
        rosterIdCaseMode,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not save linking settings.");
      setBusy(false);
      return;
    }
    setMessage("Linking configuration updated.");
    await refresh();
  }

  async function removeCoverage(id: string) {
    if (!organisationId) return;
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/organisation/coverage", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, id }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not remove coverage.");
      setBusy(false);
      return;
    }
    setMessage("Coverage removed.");
    await refresh();
  }

  async function addSupportContact(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/support-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        contactName: supportContactName,
        contactType: supportContactType,
        contactValue: supportContactValue,
        purpose: supportContactPurpose,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not add support contact.");
      setBusy(false);
      return;
    }
    setSupportContactName("");
    setSupportContactValue("");
    setSupportContactPurpose("general support");
    setMessage("Support contact added.");
    await refresh();
  }

  async function removeSupportContact(id: string) {
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/support-contacts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, id }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not remove support contact.");
      setBusy(false);
      return;
    }
    setMessage("Support contact removed.");
    await refresh();
  }

  async function addRosterEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        membershipType: rosterMembershipType,
        identifierType: rosterIdentifierType,
        identifier: rosterIdentifier,
        displayName: rosterDisplayName || null,
        validUntil: rosterValidUntil ? new Date(rosterValidUntil).toISOString() : null,
        maxClaims: Number(rosterMaxClaims) || 1,
        source: "manual",
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not add roster entry.");
      setBusy(false);
      return;
    }
    setRosterIdentifier("");
    setRosterDisplayName("");
    setRosterValidUntil("");
    setMessage("Roster entry added.");
    await loadRoster();
    setBusy(false);
  }

  async function importRosterEntries(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    const entries = parseRosterText(rosterBulkText, rosterIdentifierType);
    if (!entries.length) {
      setError("No email addresses or identifiers were found in that input.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, source: rosterImportSource, entries }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not import roster entries.");
      setBusy(false);
      return;
    }
    setMessage(`${Number(body?.inserted ?? 0)} roster entr${body?.inserted === 1 ? "y" : "ies"} imported${body?.duplicates ? `; ${body.duplicates} duplicates skipped` : ""}.`);
    setRosterBulkText("");
    await loadRoster();
    setBusy(false);
  }

  async function setRosterEntryStatus(entry: RosterEntry, status: RosterEntry["status"]) {
    if (!organisationId) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/organisation/roster", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, id: entry.id, status }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not update roster entry.");
      setBusy(false);
      return;
    }
    setMessage(status === "removed" ? "Roster entry removed." : "Roster entry updated.");
    await loadRoster();
    setBusy(false);
  }

  async function readRosterFile(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Roster files must be 5 MB or smaller.");
      return;
    }
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setError("Choose a CSV, TSV, or TXT file.");
      return;
    }
    setError("");
    setRosterImportSource(file.name.toLowerCase().endsWith(".csv") ? "csv" : "pasted");
    try {
      setRosterBulkText(await file.text());
    } catch {
      setError("The selected roster file could not be read.");
    }
  }

  const dashboardTabs: Array<{ key: DashboardTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
    { key: "home", label: "Home", icon: House },
    { key: "beneficiaries", label: "Beneficiaries", icon: Users },
    { key: "responders", label: "Responders", icon: Shield },
    { key: "members", label: "Staff and members", icon: UserCheck },
    { key: "roster", label: "Roster", icon: List },
    { key: "settings", label: "Settings", icon: SlidersHorizontal },
    { key: "configurations", label: "Configurations", icon: Building2 },
  ];
  const dashboardNavGroups: Array<{ label: string | null; tabs: typeof dashboardTabs }> = [
    { label: null, tabs: dashboardTabs.filter((tab) => tab.key === "home") },
    { label: "People", tabs: dashboardTabs.filter((tab) => ["beneficiaries", "responders", "members", "roster"].includes(tab.key)) },
    { label: "Organisation", tabs: dashboardTabs.filter((tab) => ["settings", "configurations"].includes(tab.key)) },
  ];

  const showHomePanel = !inOnboardingMode && activeTab === "home";
  const showBeneficiariesPanel = !inOnboardingMode && activeTab === "beneficiaries";
  const showRespondersPanel = !inOnboardingMode && activeTab === "responders";
  const showMembersPanel = !inOnboardingMode && activeTab === "members";
  const showRosterPanel = !inOnboardingMode && activeTab === "roster";
  const showSettingsPanel = !inOnboardingMode && activeTab === "settings";
  const showConfigurationsPanel = inOnboardingMode || activeTab === "configurations";
  const availableResponderCount = responders.filter((presence) => presence.availability === "available").length;
  const blockedNow = Boolean(state?.blocked?.isBlocked);
  const responderHistory = state?.responderHistory ?? [];
  const responderPerformance = state?.responderPerformance ?? [];
  const alertAuditTrail = state?.alertAuditTrail ?? [];
  const topResponders = [...responderPerformance].sort((a, b) => (b.completedAssignments + b.onSceneAssignments) - (a.completedAssignments + a.onSceneAssignments)).slice(0, 3);
  const roleLabel = String(state?.memberships?.[0]?.role ?? "owner").toLowerCase();
  const orgTypeLabel = String(state?.organisation?.organisation_type ?? "business").toLowerCase();
  const currentUser = members.find((member) => member.user_id === state?.userId);
  const currentUserName = currentUser?.profiles?.full_name?.trim() || currentUser?.profiles?.email || "Organisation account";
  const currentUserInitials = currentUserName.split(/\s+/).map((part: string) => part[0]).slice(0, 2).join("").toUpperCase();
  const activeTabLabel = dashboardTabs.find((tab) => tab.key === activeTab)?.label ?? "Configurations";

  if (!state) return error
    ? <div className="panel m-4 p-5"><p role="alert">{error}</p><button className="btn mt-3" onClick={() => void refresh()}>Try again</button></div>
    : <div className="panel m-4 p-5">Loading organisation console...</div>;

  return (
    <>
    <div className="org-console">
      <aside className="org-console-sidebar">
        <div className="org-console-brand">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M5 3h22v17l-11 9-11-9z" />
            <path d="M12 10h5a3 3 0 0 1 0 6h-5zm0 6h6a3 3 0 0 1 0 6h-6z" />
          </svg>
          <b>BASTEON</b>
        </div>
        <div className="org-console-org-card">
          <div className="org-console-org-mark">
            {state.organisation.logo_url
              ? <img src={state.organisation.logo_url} alt="" />
              : String(state.organisation.name ?? "O").trim().slice(0, 2).toUpperCase()}
          </div>
          <div className="org-console-org-details">
            <b>{state.organisation.name}</b>
            <small>{orgTypeLabel} · {roleLabel} access</small>
          </div>
        </div>
        {!inOnboardingMode && (
          <nav className="org-console-nav" aria-label="Organisation dashboard">
            {dashboardNavGroups.map((group) => (
              <div className="org-console-nav-group" key={group.label ?? "home"}>
                {group.label && <p className="org-console-nav-label">{group.label}</p>}
                {group.tabs.map((tab) => {
                  const Icon = tab.icon;
                  const selected = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      className={`org-console-nav-item ${selected ? "is-active" : ""}`}
                      onClick={() => setActiveTab(tab.key)}
                      aria-current={selected ? "page" : undefined}
                      aria-label={tab.label}
                      title={tab.label}
                    >
                      <Icon size={18} />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        )}
        <div className="org-console-account">
          <div className="org-console-account-avatar">{currentUserInitials}</div>
          <div className="org-console-account-details">
            <b>{currentUserName}</b>
            <small>{roleLabel}</small>
          </div>
        </div>
      </aside>
      <div className="org-console-main">
        <header className="org-console-topbar">
          <div className="org-console-breadcrumb">
            <span>{state.organisation.name}</span>
            <span aria-hidden="true">/</span>
            <b>{inOnboardingMode ? "Onboarding" : activeTabLabel}</b>
          </div>
          <div className="org-console-topbar-actions">
            <span className="org-console-sync">{lastSyncedAt ? `Synced ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Sync pending"}</span>
            <button className="btn org-console-refresh" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} /><span>Refresh</span></button>
            <a className="btn btn-primary org-console-response-link" href="/responder"><ExternalLink size={15} /><span>Response console</span></a>
          </div>
        </header>
      <main
        ref={contentRef}
        className={`org-console-content space-y-6 ${blockedNow ? "org-console-locked" : ""}`}
        aria-label="Organisation dashboard content"
        tabIndex={0}
      >
      <div className="org-console-content-inner space-y-6">
      {error && !configurationDrawer && <p role="alert" className="ops-login-error">{error}</p>}
      {message && <p role="status" className="ops-login-status">{message}</p>}
      {blockedNow && (
        <section className="panel p-5 space-y-3 org-console-lock-message">
          <h2 className="org-tab-title">Account blocked</h2>
          <p className="muted text-sm">
            This organisation account is temporarily blocked and cannot receive services or use dashboard actions right now.
          </p>
          <p className="text-sm">Blocked until: <b>{state.blocked.until ? new Date(state.blocked.until).toLocaleString() : "Not specified"}</b></p>
          {state.blocked.reason && <p className="text-sm">Reason: <b>{state.blocked.reason}</b></p>}
          <p className="text-sm">Contact admin support:</p>
          <ul className="space-y-1 text-sm">
            {(state.supportContacts?.global ?? []).map((contact: any) => (
              <li key={`blocked-support-${contact.id}`}>
                <b>{contact.contact_name}</b> · {contact.purpose} · {contact.contact_type === "email" ? contact.contact_value : contact.contact_value}
              </li>
            ))}
          </ul>
        </section>
      )}

      {inOnboardingMode && onboardingComplete && (
        <section className="org-console-hero panel p-4 space-y-3">
          <h2 className="pane-head">Onboarding complete</h2>
          <p className="muted text-sm">
            Your setup checklist is complete. Open the full dashboard to access tabs for home, beneficiaries, responders,
            staff/members, settings, and configurations.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => unlockDashboard()}>Go to dashboard</button>
            <button className="btn" disabled={busy} onClick={() => void refresh()}><RefreshCw size={16} />Refresh status</button>
          </div>
        </section>
      )}

      {generatedCredentials && (
        <section className="org-console-surface panel p-4 space-y-2">
          <h2 className="pane-head">Generated credentials</h2>
          <p className="text-sm">Email: <b>{generatedCredentials.email}</b></p>
          <p className="text-sm">Password: <b>{generatedCredentials.password}</b></p>
          {generatedCredentialPdfUrl && <a className="btn inline-flex w-fit" href={generatedCredentialPdfUrl}>Download onboarding credential PDF</a>}
          <p className="muted text-xs">Share these securely. Ask the responder to change password on first login.</p>
        </section>
      )}

      {showHomePanel && (
        <section className="org-console-surface org-console-home">
          <header className="org-console-page-heading">
            <div><h1>Operations overview</h1><p>Last synced {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "not synced yet"}</p></div>
            <button className="btn" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />Reload org data</button>
          </header>
          <div className="org-console-metrics">
            <div className="org-console-metric">
              <div>
                <p className="muted text-xs uppercase tracking-wider">Branches</p>
                <p className="text-2xl font-semibold">{branchOptions.length}</p>
                <p className="muted text-xs mt-1">Operational structure</p>
              </div>
            </div>
            <div className="org-console-metric">
              <div>
                <p className="muted text-xs uppercase tracking-wider">Units</p>
                <p className="text-2xl font-semibold">{units.length}</p>
                <p className="muted text-xs mt-1">Configured zones</p>
              </div>
            </div>
            <div className="org-console-metric">
              <div>
                <p className="muted text-xs uppercase tracking-wider">Responders</p>
                <p className="text-2xl font-semibold">{responderMembers.length + presenceOnlyResponders.length}</p>
                <p className="org-on-duty mt-1"><i />{availableResponderCount} On Duty</p>
              </div>
            </div>
            <div className="org-console-metric">
              <div>
                <p className="muted text-xs uppercase tracking-wider">Beneficiaries</p>
                <p className="text-2xl font-semibold">{beneficiaryMembers.length}</p>
                <p className="muted text-xs mt-1">Linked protected users</p>
              </div>
            </div>
          </div>
          <div className="org-home-columns">
            <div className="org-home-main-column">
              <section className="panel org-home-panel">
                <header className="org-home-panel-header">
                  <div>
                    <h3 className="org-home-title">Responder performance</h3>
                    <p>Recent assignments and response outcomes</p>
                  </div>
                  <button className="btn org-home-small-button" type="button" onClick={() => setActiveTab("responders")}>Open responders</button>
                </header>
                <div className="org-home-panel-body">
                  {topResponders[0] ? (
                    <>
                      <div className="org-home-featured-responder">
                        <div className="who">
                          <span className="org-home-avatar">{topResponders[0].name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
                          <div>
                            <b>{topResponders[0].name}</b>
                            <small>{topResponders[0].totalAssignments} assignments</small>
                          </div>
                        </div>
                        <span className="org-home-success">{topResponders[0].successRate}% success</span>
                      </div>
                      <div className="org-home-mini-stats">
                        <div><small>Accepted</small><b>{topResponders[0].acceptedAssignments}</b></div>
                        <div><small>On scene</small><b>{topResponders[0].onSceneAssignments}</b></div>
                        <div><small>Avg ack</small><b>{formatResponseDuration(topResponders[0].avgAcknowledgeSeconds)}</b></div>
                        <div><small>Avg complete</small><b>{formatResponseDuration(topResponders[0].avgCompletionSeconds)}</b></div>
                      </div>
                    </>
                  ) : <p className="muted text-sm">No responder activity has been recorded yet.</p>}
                </div>
              </section>

              <section className="panel org-home-panel">
                <header className="org-home-panel-header">
                  <h3 className="org-home-title">Recent dispatches</h3>
                  <button className="btn org-home-small-button" type="button" onClick={() => setActiveTab("responders")}>View all</button>
                </header>
                <div className="tbl-wrap">
                  <table className="tbl org-home-table">
                    <thead><tr><th>Responder</th><th>Outcome</th><th>When</th><th>Ack</th></tr></thead>
                    <tbody>
                      {responderHistory.slice(0, 5).map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.responderName ?? "Unassigned responder"}</td>
                          <td><span className="org-status-pill">{formatCurrentResponderStatus(entry.status) ?? entry.status ?? "Pending"}</span></td>
                          <td>{entry.assignedAt ? new Date(entry.assignedAt).toLocaleString() : "—"}</td>
                          <td>{formatResponseDuration(entry.responseSeconds)}</td>
                        </tr>
                      ))}
                      {responderHistory.length === 0 && <tr><td colSpan={4} className="muted text-center">No recent response history for this organisation yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel org-home-panel">
                <header className="org-home-panel-header">
                  <div>
                    <h3 className="org-home-title">Audit trail</h3>
                    <p>Every status change and assignment, in order</p>
                  </div>
                </header>
                <div className="tbl-wrap">
                  <table className="tbl org-home-table">
                    <thead><tr><th>Event</th><th>Detail</th><th>When</th><th>Type</th></tr></thead>
                    <tbody>
                      {alertAuditTrail.slice(0, 5).map((entry) => (
                        <tr key={entry.id}>
                          <td><b>{entry.action.replaceAll("_", " ")}</b></td>
                          <td>{entry.actorName ?? "System"}{entry.toStatus ? ` → ${formatCurrentResponderStatus(entry.toStatus)}` : entry.note ? ` · ${entry.note}` : ""}</td>
                          <td>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}</td>
                          <td>{entry.category}</td>
                        </tr>
                      ))}
                      {alertAuditTrail.length === 0 && <tr><td colSpan={4} className="muted text-center">No audit activity yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="org-home-side-panels">
              <section className="panel org-home-panel">
                <header className="org-home-panel-header">
                  <div>
                    <h3 className="org-home-title">Setup</h3>
                    <p>{onboardingProgress} of 5 steps complete</p>
                  </div>
                  <span className="org-progress-badge">{onboardingProgress === 5 ? "Complete" : `${onboardingProgress}/5`}</span>
                </header>
                <div className="org-home-panel-body">
                  <div className="org-progress-track"><div className="org-progress-fill" style={{ width: `${Math.min(100, (onboardingProgress / 5) * 100)}%` }} /></div>
                  <ul className="org-checklist">
                    <li><span>{onboarding.organisation_profile_done && <CircleCheck size={14} />}Organisation profile</span><small>{onboarding.organisation_profile_done ? "Done" : "Pending"}</small></li>
                    <li><span>{onboarding.branches_done && <CircleCheck size={14} />}Branches and units</span><small>{onboarding.branches_done ? "Done" : "Pending"}</small></li>
                    <li><span>{onboarding.linking_rules_done && <CircleCheck size={14} />}Linking rules</span><small>{onboarding.linking_rules_done ? "Done" : "Pending"}</small></li>
                    <li><span>{onboarding.coverage_done && <CircleCheck size={14} />}Emergency coverage</span><small>{onboarding.coverage_done ? "Done" : "Pending"}</small></li>
                    <li><span>{onboarding.responders_done && <CircleCheck size={14} />}Responders onboarded</span><small>{onboarding.responders_done ? "Done" : "Pending"}</small></li>
                  </ul>
                </div>
              </section>

              <section className="panel org-home-panel">
                <header className="org-home-panel-header"><h3 className="org-home-title">Quick actions</h3></header>
                <div className="org-console-quick-actions">
                  <button className="org-console-action" type="button" onClick={() => setActiveTab("responders")}><span><UserPlus size={16} className="org-action-icon responders" />Manage responders</span><ArrowRight size={14} /></button>
                  <button className="org-console-action" type="button" onClick={() => setActiveTab("members")}><span><Users size={16} className="org-action-icon staff" />Manage staff</span><ArrowRight size={14} /></button>
                  <button className="org-console-action" type="button" onClick={() => setActiveTab("beneficiaries")}><span><Users size={16} className="org-action-icon beneficiaries" />View beneficiaries</span><ArrowRight size={14} /></button>
                  <button className="org-console-action" type="button" onClick={() => setActiveTab("settings")}><span><Settings2 size={16} className="org-action-icon rules" />Linking rules</span><ArrowRight size={14} /></button>
                </div>
              </section>

              <section className="panel org-home-panel">
                <header className="org-home-panel-header"><h3 className="org-home-title">Recent operations</h3></header>
                <div className="org-home-panel-body org-home-operations">
                  {alertAuditTrail.slice(0, 4).map((entry) => {
                    const relatedAssignment = responderHistory.find((assignment) =>
                      assignment.alertId === entry.alertId &&
                      (!entry.actorId || assignment.responderUserId === entry.actorId),
                    );
                    const operationStatus = entry.toStatus
                      ? formatCurrentResponderStatus(entry.toStatus)
                      : entry.action.replaceAll("_", " ");
                    return (
                      <div key={`operation-${entry.id}`} className="org-console-log-row">
                        <div className="org-log-icon"><CircleCheck size={14} /></div>
                        <div>
                          <p>{entry.actorName ?? "System"} {entry.toStatus ? "set" : "performed"} {operationStatus}</p>
                          <small>{branchOptions.find((branch) => branch.id === relatedAssignment?.branchId)?.name ?? entry.category}</small>
                        </div>
                        <time>{entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</time>
                      </div>
                    );
                  })}
                  {alertAuditTrail.length === 0 && <p className="muted text-sm">No recent operations yet.</p>}
                </div>
              </section>
            </div>
          </div>
        </section>
      )}

      {inOnboardingMode && (
      <section className="panel p-4 space-y-3">
        <h2 className="pane-head">Onboarding checklist</h2>
        <p className="muted text-sm">Complete all five setup steps before go-live routing.</p>
        <p className="text-sm font-semibold">{onboardingProgress} / 5 complete</p>
        <div className="grid gap-2 md:grid-cols-2">
          <button className="btn justify-between" disabled={busy || onboarding.organisation_profile_done} onClick={() => void markOnboardingStep("organisationProfileDone")}><span>Organisation profile</span><span>{onboarding.organisation_profile_done ? "Done" : "Mark done"}</span></button>
          <button className="btn justify-between" disabled={busy || onboarding.branches_done} onClick={() => void markOnboardingStep("branchesDone")}><span>Branches</span><span>{onboarding.branches_done ? "Done" : "Mark done"}</span></button>
          <button className="btn justify-between" disabled={busy || onboarding.linking_rules_done} onClick={() => void markOnboardingStep("linkingRulesDone")}><span>Linking rules</span><span>{onboarding.linking_rules_done ? "Done" : "Mark done"}</span></button>
          <button className="btn justify-between" disabled={busy || onboarding.coverage_done} onClick={() => void markOnboardingStep("coverageDone")}><span>Emergency coverage</span><span>{onboarding.coverage_done ? "Done" : "Mark done"}</span></button>
          <button className="btn justify-between" disabled={busy || onboarding.responders_done} onClick={() => void markOnboardingStep("respondersDone")}><span>Responders</span><span>{onboarding.responders_done ? "Done" : "Mark done"}</span></button>
        </div>
      </section>
      )}

      {showBeneficiariesPanel && (
        <section className="panel p-6 space-y-4">
          <h2 className="org-tab-title">Beneficiaries & Residents</h2>
          <p className="muted text-xs">People linked to this organisation who are protected beneficiaries.</p>
          {listToolbar(benSearch, setBenSearch, benBranch, setBenBranch, "Search beneficiaries")}
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Branch</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {filteredBeneficiaries.map((member) => (
                  <tr key={member.id}>
                    <td>{member.profiles?.full_name || member.user_id}</td>
                    <td>{member.profiles?.email || "—"}</td>
                    <td>{member.membership_type}</td>
                    <td>{branchOptions.find((branch) => branch.id === member.branch_id)?.name ?? "—"}</td>
                    <td>{member.status}</td>
                    <td>
                      {member.role !== "owner" && member.user_id !== state.userId && (
                        <div className="flex flex-wrap gap-2">
                          <button className="btn" type="button" disabled={busy} onClick={() => void memberAction(member.user_id, "revoke")}>Revoke</button>
                          {member.status === "suspended"
                            ? <button className="btn" type="button" disabled={busy} onClick={() => void memberAction(member.user_id, "unblock")}>Unblock</button>
                            : <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void memberAction(member.user_id, "block")}>Block</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredBeneficiaries.length === 0 && <tr><td colSpan={6} className="muted text-center">{beneficiaryMembers.length === 0 ? "No beneficiaries linked yet." : "No beneficiaries match your filters."}</td></tr>}
              </tbody>
            </table>
          </div>

          <section className="space-y-3 border-t border-[var(--line)] pt-3">
            <h3 className="text-sm font-bold">Support / Help contacts</h3>
            <p className="muted text-xs">Global contacts are managed by admin. Add organisation-specific support contacts for responders and staff.</p>
            <form className="grid gap-3 md:grid-cols-4" onSubmit={(event) => void addSupportContact(event)}>
              <label className="field">Person name<input required value={supportContactName} onChange={(event) => setSupportContactName(event.target.value)} /></label>
              <label className="field">Type
                <select value={supportContactType} onChange={(event) => setSupportContactType(event.target.value as "email" | "phone")}>
                  <option value="email">email</option>
                  <option value="phone">phone</option>
                </select>
              </label>
              <label className="field">Value<input required value={supportContactValue} onChange={(event) => setSupportContactValue(event.target.value)} /></label>
              <label className="field">Purpose<input required value={supportContactPurpose} onChange={(event) => setSupportContactPurpose(event.target.value)} placeholder="blocked accounts, general support, errors..." /></label>
              <button className="btn btn-primary md:col-span-4 md:justify-self-start" disabled={busy}>Add support contact</button>
            </form>
            <input className="org-list-search" aria-label="Search support contacts" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Search support contacts" />
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Scope</th><th>Name</th><th>Type</th><th>Value</th><th>Purpose</th><th>Actions</th></tr></thead>
                <tbody>
                  {(state.supportContacts?.global ?? []).filter((contact: any) => matchesQuery(contactSearch, contact.contact_name, contact.contact_value, contact.purpose)).map((contact: any) => (
                    <tr key={`global-${contact.id}`}>
                      <td>Admin</td>
                      <td>{contact.contact_name}</td>
                      <td>{contact.contact_type}</td>
                      <td>{contact.contact_value}</td>
                      <td>{contact.purpose}</td>
                      <td className="muted text-xs">Managed by admin</td>
                    </tr>
                  ))}
                  {(state.supportContacts?.organisation ?? []).filter((contact: any) => matchesQuery(contactSearch, contact.contact_name, contact.contact_value, contact.purpose)).map((contact: any) => (
                    <tr key={`org-${contact.id}`}>
                      <td>Organisation</td>
                      <td>{contact.contact_name}</td>
                      <td>{contact.contact_type}</td>
                      <td>{contact.contact_value}</td>
                      <td>{contact.purpose}</td>
                      <td><button className="btn" type="button" disabled={busy} onClick={() => void removeSupportContact(contact.id)}>Remove</button></td>
                    </tr>
                  ))}
                  {((state.supportContacts?.global?.length ?? 0) + (state.supportContacts?.organisation?.length ?? 0)) === 0 && (
                    <tr><td colSpan={6} className="muted text-center">No support contacts available yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
        )}

      {(showSettingsPanel || inOnboardingMode) && (
      <section className="panel p-6 space-y-4">
        <div className="space-y-3 border-b border-[var(--line)] pb-4">
          <div>
            <h2 className="org-tab-title">Organisation logo</h2>
            <p className="muted mt-1 text-xs">Set a public image link or upload a logo. It appears in the responder console.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {state.organisation.logo_url
              ? <img src={state.organisation.logo_url} alt={`${state.organisation.name} logo`} className="h-14 w-14 rounded-xl border border-[var(--line)] bg-white object-contain p-1" />
              : <div className="grid h-14 w-14 place-items-center rounded-xl border border-[var(--line)] text-lg font-bold">{String(state.organisation.name ?? "O").trim().charAt(0).toUpperCase()}</div>}
            <form className="flex min-w-0 flex-1 flex-wrap gap-2" onSubmit={(event) => void saveOrganisationLogo(event)}>
              <label className="field min-w-[220px] flex-1">Logo image URL
                <input type="url" value={logoUrl} maxLength={2048} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://example.org/logo.png" />
              </label>
              <button className="btn self-end" disabled={busy}>Save link</button>
            </form>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose organisation logo image" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} />
            <button type="button" className="btn" disabled={busy || !logoFile} onClick={() => void uploadOrganisationLogo()}>Upload selected logo</button>
            <span className="muted text-xs">PNG, JPEG or WebP · max 2 MB</span>
          </div>
        </div>
        <div>
          <h2 className="org-tab-title">Linking Configuration</h2>
          <p className="muted mt-1 text-xs">Choose which identifier types people can use and whether eligible requests need approval.</p>
        </div>
        <form className="space-y-4" onSubmit={(event) => void saveLinkSettings(event)}>
          <div className="grid gap-2 md:grid-cols-2">
            <SettingsSwitch checked={allowEmailDomain} onChange={setAllowEmailDomain} title="Email addresses" description="Allow people to identify themselves with an email address." />
            <SettingsSwitch checked={allowWorkId} onChange={setAllowWorkId} title="Member and work IDs" description="Allow student, staff, member, and organisation-issued IDs." />
            <SettingsSwitch checked={requireInvite} onChange={(checked) => { setRequireInvite(checked); if (checked) setAutoApproveLinks(false); }} title="Manual approval" description="Keep new links pending until an organisation manager approves them." />
            <SettingsSwitch checked={autoApproveLinks} onChange={(checked) => { setAutoApproveLinks(checked); if (checked) setRequireInvite(false); }} title="Auto-approve eligible links" description="Activate a matching, eligible roster link immediately." />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="field">ID letter case
              <select value={rosterIdCaseMode} onChange={(event) => setRosterIdCaseMode(event.target.value as typeof rosterIdCaseMode)}>
                <option value="upper">Ignore case (uppercase)</option>
                <option value="lower">Ignore case (lowercase)</option>
                <option value="as_is">Case-sensitive</option>
              </select>
              <span className="mt-1 block text-[11px] font-normal text-[var(--muted)]">Applied consistently to roster imports and Kiki link checks.</span>
            </label>
            <label className="field">Work / Student ID format (optional)
              <input className="mt-1 w-full" value={workIdRegex} onChange={(event) => setWorkIdRegex(event.target.value)} placeholder="Example: ^[A-Z]{2}[0-9]{6}$" />
              <span className="mt-1 block text-[11px] font-normal text-[var(--muted)]">Use a regular expression to reject IDs that do not match your format.</span>
            </label>
          </div>
          <button className="btn btn-primary" disabled={busy}>Save linking configuration</button>
        </form>

        <form className="grid gap-3 border-t border-[var(--line)] pt-3 md:grid-cols-4" onSubmit={(event) => void addDomainRule(event)}>
          <label className="field md:col-span-2">Allowed domain
            <input required value={domainValue} onChange={(event) => setDomainValue(event.target.value)} placeholder="example.ac.za" />
          </label>
          <label className="field">Membership type
            <select value={domainMembershipType} onChange={(event) => setDomainMembershipType(event.target.value)}>
              {membershipTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="field">Priority
            <input type="number" min={1} max={1000} value={domainPriority} onChange={(event) => setDomainPriority(event.target.value)} />
          </label>
          <button className="btn btn-primary md:col-span-4 md:justify-self-start" disabled={busy}>Add domain rule</button>
        </form>

        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Allowed domain</th><th>Membership type</th><th>Priority</th><th>Actions</th></tr></thead>
            <tbody>
              {(state.domains ?? []).map((domain: any) => (
                <tr key={domain.id}>
                  <td>{domain.domain}</td>
                  <td>{domain.membership_type}</td>
                  <td>{domain.priority ?? 100}</td>
                  <td><button className="btn" disabled={busy} onClick={() => void removeDomainRule(domain.id)}>Remove</button></td>
                </tr>
              ))}
              {(state.domains ?? []).length === 0 && <tr><td colSpan={4} className="muted text-center">No domain rules configured yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {showRosterPanel && (
        <section className="panel p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="org-tab-title">Organisation access roster</h2>
              <p className="muted mt-1 text-xs">Only identifiers on this list can link to the organisation. Entries are never exposed to Kiki users.</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-2">
              <span className="muted text-xs">Roster entries</span>
              <strong className="ml-2 text-lg">{rosterTotal}</strong>
            </div>
          </div>

          <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold">Pending link requests</h3>
                <p className="muted mt-1 text-xs">Approving activates organisation membership and its associated access.</p>
              </div>
              <button className="btn" type="button" disabled={linkRequestsLoading} onClick={() => void loadLinkRequests()}>
                {linkRequestsLoading ? "Loading…" : "Refresh requests"}
              </button>
            </div>
            {linkRequestsLoading && linkRequests.length === 0 ? (
              <p className="muted mt-3 text-sm">Loading pending requests…</p>
            ) : linkRequests.length === 0 ? (
              <p className="muted mt-3 text-sm">No pending link requests.</p>
            ) : (
              <div className="mt-3 divide-y divide-[var(--line)]">
                {linkRequests.map((linkRequest) => (
                  <div key={linkRequest.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-semibold">{linkRequest.name}</p>
                      <p className="muted text-xs">
                        {linkRequest.membershipType} · Requested {new Date(linkRequest.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn" type="button" disabled={busy} onClick={() => void resolveLinkRequest(linkRequest.id, "reject")}>Reject</button>
                      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void resolveLinkRequest(linkRequest.id, "approve")}>Approve</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
            <h3 className="text-sm font-bold">Add one person</h3>
            <form className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => void addRosterEntry(event)}>
              <label className="field">Identifier type
                <select value={rosterIdentifierType} onChange={(event) => setRosterIdentifierType(event.target.value as typeof rosterIdentifierType)}>
                  <option value="email">Email</option>
                  <option value="member_id">Member / student / work ID</option>
                  <option value="access_code">Access code</option>
                </select>
              </label>
              <label className="field">Identifier
                <input required value={rosterIdentifier} onChange={(event) => setRosterIdentifier(event.target.value)} placeholder="Exact roster identifier" />
              </label>
              <label className="field">Membership type
                <select value={rosterMembershipType} onChange={(event) => setRosterMembershipType(event.target.value)}>
                  {membershipTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="field">Display name (optional)
                <input value={rosterDisplayName} onChange={(event) => setRosterDisplayName(event.target.value)} />
              </label>
              <label className="field">Valid until (optional)
                <input type="date" value={rosterValidUntil} onChange={(event) => setRosterValidUntil(event.target.value)} />
              </label>
              <label className="field">Maximum claims
                <input type="number" min="1" max="100" value={rosterMaxClaims} onChange={(event) => setRosterMaxClaims(event.target.value)} />
              </label>
              <button className="btn btn-primary self-end md:col-span-2 xl:col-span-2" disabled={busy}>Add roster entry</button>
            </form>
          </section>

          <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
            <h3 className="text-sm font-bold">Import roster from CSV or paste</h3>
            <p className="muted mt-1 text-xs">CSV headers such as email, member ID, student number, work ID, name, or access code are detected automatically.</p>
            <label className="field mt-3 block">Choose CSV, TSV, or TXT (max 5 MB)
              <input className="org-roster-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(event) => void readRosterFile(event.target.files?.[0])} />
            </label>
            <form className="mt-3 space-y-3" onSubmit={(event) => void importRosterEntries(event)}>
              <label className="field block">Paste entries or CSV contents
                <textarea rows={6} value={rosterBulkText} onChange={(event) => setRosterBulkText(event.target.value)} placeholder={"email,name\nperson@example.org,Alex Member\n\nOr paste one identifier per line"} />
              </label>
              {rosterBulkText.trim() && (
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-3">
                  <p className="text-xs font-semibold">Import preview: {rosterImportPreview.length} identifier{rosterImportPreview.length === 1 ? "" : "s"} detected</p>
                  <p className="muted mt-1 text-[11px]">
                    {rosterImportPreview.slice(0, 3).map((entry) => `${entry.identifierType}: ${entry.identifier}`).join(" · ") || "No usable identifiers detected."}
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <label className="field !flex flex-row items-center gap-2">Default type for plain IDs
                  <select value={rosterIdentifierType} onChange={(event) => setRosterIdentifierType(event.target.value as typeof rosterIdentifierType)}>
                    <option value="member_id">Member / student / work ID</option>
                    <option value="email">Email</option>
                    <option value="access_code">Access code</option>
                  </select>
                </label>
                <button className="btn btn-primary" disabled={busy || !rosterBulkText.trim()}>Import roster</button>
              </div>
            </form>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold">Allowed identifiers</h3>
              <form className="org-roster-search-form" onSubmit={(event) => { event.preventDefault(); void loadRoster(); }}>
                <input className="org-roster-search" aria-label="Search roster" value={rosterSearch} onChange={(event) => setRosterSearch(event.target.value)} placeholder="Search identifiers" />
                <button className="btn" disabled={rosterLoading}>Search</button>
              </form>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Identifier</th><th>Type</th><th>Name</th><th>Membership</th><th>Status</th><th>Claimed</th><th>Valid until</th><th>Source</th><th>Action</th></tr></thead>
                <tbody>
                  {rosterRows.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.identifier_raw}</td>
                      <td>{entry.identifier_type}</td>
                      <td>{entry.display_name || "—"}</td>
                      <td>{entry.membership_type}</td>
                      <td>{entry.status}</td>
                      <td>{entry.claimed_by_user_id ? (entry.claimed_at ? new Date(entry.claimed_at).toLocaleDateString() : "Yes") : "No"}</td>
                      <td>{entry.valid_until ? new Date(entry.valid_until).toLocaleDateString() : "Never"}</td>
                      <td>{entry.source}</td>
                      <td>
                        {entry.status === "active"
                          ? <button className="btn" type="button" disabled={busy} onClick={() => void setRosterEntryStatus(entry, "removed")}>Remove</button>
                          : <button className="btn" type="button" disabled={busy} onClick={() => void setRosterEntryStatus(entry, "active")}>Restore</button>}
                        <button className="btn btn-danger ml-2" type="button" disabled={busy} onClick={() => void deleteRosterEntry(entry)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {!rosterLoading && rosterRows.length === 0 && <tr><td colSpan={9} className="muted text-center">No roster entries found. Add an entry manually or import a CSV.</td></tr>}
                  {rosterLoading && <tr><td colSpan={9} className="muted text-center">Loading roster…</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      {showConfigurationsPanel && (
      <header className="org-console-page-heading">
        <div>
          <h1>Organisation hierarchy</h1>
          <p>Branches, security zones, and response hardware mapping.</p>
        </div>
      </header>
      )}

      {showConfigurationsPanel && (
      <section className="panel org-config-panel">
        <header className="org-config-panel-header">
          <div><h2 className="org-config-panel-title">Branches and stations</h2></div>
          <button className="btn btn-primary" type="button" onClick={openNewBranch}><Plus size={16} />Add branch</button>
        </header>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Address</th><th>City</th><th>HQ</th><th>Actions</th></tr></thead>
            <tbody>
              {branchOptions.map((branch) => (
                <tr key={branch.id}>
                  <td>{branch.name}</td>
                  <td>{branch.address || "—"}</td>
                  <td>{branch.city || "—"}</td>
                  <td>{branch.is_hq ? "Yes" : "No"}</td>
                  <td><button className="btn" type="button" disabled={busy} onClick={() => editBranch(branch)}>Edit</button></td>
                </tr>
              ))}
              {branchOptions.length === 0 && <tr><td colSpan={5} className="muted text-center">No branches configured yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {showConfigurationsPanel && (
      <section className="panel org-config-panel">
        <header className="org-config-panel-header">
          <div><h2 className="org-config-panel-title">Units</h2></div>
          <button className="btn btn-primary" type="button" onClick={openNewUnit}><Plus size={16} />Add unit</button>
        </header>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Type</th><th>Branch</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {units.map((unit) => (
                <tr key={unit.id}>
                  <td>{unit.name}</td>
                  <td>{unit.unit_type}</td>
                  <td>{branchOptions.find((branch) => branch.id === unit.branch_id)?.name ?? "—"}</td>
                  <td>{unit.active ? "Active" : "Inactive"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn" type="button" disabled={busy} onClick={() => editUnit(unit)}>Edit</button>
                      <button className="btn" type="button" disabled={busy} onClick={() => void setUnitActive(unit.id, !unit.active)}>{unit.active ? "Deactivate" : "Activate"}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {units.length === 0 && <tr><td colSpan={5} className="muted text-center">No units configured yet. Add a unit to group responders by zone.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {showConfigurationsPanel && (
      <section className="panel org-config-panel">
        <header className="org-config-panel-header">
          <div>
            <h2 className="org-config-panel-title">Emergency coverage</h2>
            <p>Which emergency types each branch responds to.</p>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => { setError(""); setMessage(""); setConfigurationDrawer("coverage"); }}><Plus size={16} />Add coverage</button>
        </header>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Type</th><th>Branch</th><th>Priority</th><th>Actions</th></tr></thead>
            <tbody>
              {(state.coverage ?? []).map((row: any) => (
                <tr key={row.id}>
                  <td>{emergencyTypes.find((type) => type.code === row.emergency_type_code)?.short_label ?? row.emergency_type_code}</td>
                  <td>{branchOptions.find((branch) => branch.id === row.branch_id)?.name ?? "All branches"}</td>
                  <td>{row.priority}</td>
                  <td><button className="btn" disabled={busy} onClick={() => void removeCoverage(row.id)}>Remove</button></td>
                </tr>
              ))}
              {(state.coverage ?? []).length === 0 && <tr><td colSpan={4} className="muted text-center">No emergency coverage configured yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {(showRespondersPanel || inOnboardingMode) && (
      <section className="panel p-6 space-y-4">
        <h2 className="org-tab-title flex items-center gap-2"><UserPlus size={18} />Add Responder / Staff Account</h2>
        <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => void addResponder(event)}>
          <label className="field">Name<input required value={responderName} onChange={(event) => setResponderName(event.target.value)} /></label>
          <label className="field">Email<input required type="email" value={responderEmail} onChange={(event) => setResponderEmail(event.target.value)} /></label>
          <label className="field">Phone<input value={responderPhone} onChange={(event) => setResponderPhone(event.target.value)} /></label>
          <label className="field">Role
            <select value={responderRole} onChange={(event) => setResponderRole(event.target.value)}>
              <option value="dispatcher">Dispatcher</option>
              <option value="responder">Responder</option>
              <option value="manager">Manager</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <label className="field">Branch
            <select required value={responderBranch} onChange={(event) => setResponderBranch(event.target.value)}>
              <option value="">Select branch</option>
              {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label className="field">Unit
            <select value={responderUnit} onChange={(event) => setResponderUnit(event.target.value)}>
              <option value="">No unit</option>
              {units.filter((unit) => !responderBranch || unit.branch_id === responderBranch).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </label>
          <button className="btn btn-primary self-end" disabled={busy}>Create account</button>
        </form>
      </section>
      )}

      {showMembersPanel && (
      <section className="panel p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="org-tab-title flex items-center gap-2"><Shield size={18} />Members & Responder Accounts</h2>
          <button className="btn btn-primary" type="button" onClick={() => setActiveTab("responders")}>+ Add Staff Member</button>
        </div>
        {editingMemberUserId && (
          <form className="grid gap-3 border border-[var(--line)] bg-[var(--surface-2)] p-3 md:grid-cols-4" onSubmit={(event) => void saveMemberEdit(event)}>
            <label className="field">Name<input value={editMemberName} onChange={(event) => setEditMemberName(event.target.value)} required /></label>
            <label className="field">Phone<input value={editMemberPhone} onChange={(event) => setEditMemberPhone(event.target.value)} /></label>
            <label className="field">Role
              <select value={editMemberRole} onChange={(event) => setEditMemberRole(event.target.value)}>
                <option value="dispatcher">Dispatcher</option>
                <option value="responder">Responder</option>
                <option value="manager">Manager</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <label className="field">Branch
              <select value={editMemberBranch} onChange={(event) => setEditMemberBranch(event.target.value)} required>
                <option value="">Select branch</option>
                {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label className="field">Unit
              <select value={editMemberUnit} onChange={(event) => setEditMemberUnit(event.target.value)}>
                <option value="">No unit</option>
                {units.filter((unit) => !editMemberBranch || unit.branch_id === editMemberBranch).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </label>
            <label className="field">Status
              <select value={editMemberStatus} onChange={(event) => setEditMemberStatus(event.target.value)}>
                <option value="active">active</option>
                <option value="pending">pending</option>
                <option value="suspended">suspended</option>
                <option value="archived">archived</option>
              </select>
            </label>
            <label className="field">Availability
              <select value={editMemberAvailability} onChange={(event) => setEditMemberAvailability(event.target.value)}>
                <option value="available">available</option>
                <option value="busy">busy</option>
                <option value="off_duty">off_duty</option>
                <option value="unavailable">unavailable</option>
              </select>
            </label>
            <div className="flex items-end gap-2 md:col-span-4">
              <button className="btn btn-primary" disabled={busy}>Save account changes</button>
              <button className="btn" type="button" disabled={busy} onClick={cancelEditMember}>Cancel</button>
            </div>
          </form>
        )}
        {listToolbar(memSearch, setMemSearch, memBranch, setMemBranch, "Search staff / members")}
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Type</th><th>Branch</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredMembers.map((member) => (
                <tr key={member.id}>
                  <td>{member.profiles?.full_name || member.user_id}</td>
                  <td>{member.profiles?.email || "—"}</td>
                  <td>{member.role}</td>
                  <td>{member.membership_type}</td>
                  <td>{branchOptions.find((branch) => branch.id === member.branch_id)?.name ?? "—"}</td>
                  <td>{member.status}</td>
                  <td>
                    {(member.role === "responder" || member.role === "dispatcher" || member.role === "manager" || member.role === "viewer") && (
                      <div className="flex flex-wrap gap-2">
                        <button className="btn" type="button" disabled={busy} onClick={() => beginEditMember(member)}>Edit account</button>
                        <button className="btn" disabled={busy} onClick={() => void regeneratePassword(member.user_id)}>Generate new password</button>
                        <a className="btn" href={`/api/organisation/responders/${member.user_id}/credential-pdf?organisationId=${organisationId}`}>Credential PDF</a>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filteredPresenceOnly.map((presence) => (
                <tr key={`presence-${presence.user_id}`}>
                  <td>{presence.profiles?.full_name ?? presence.user_id}</td>
                  <td>{presence.profiles?.email || "—"}</td>
                  <td>responder</td>
                  <td>responder</td>
                  <td>{branchOptions.find((branch) => branch.id === presence.branch_id)?.name ?? "—"}</td>
                  <td><span className={`org-status-pill status-${(presence.response_status ?? presence.availability ?? "unknown").replaceAll("_", "-")}`}>{formatCurrentResponderStatus(presence.response_status ?? presence.availability) ?? "Not reported"}</span></td>
                  <td className="muted text-xs">Managed from responder roster</td>
                </tr>
              ))}
              {filteredMembers.length === 0 && filteredPresenceOnly.length === 0 && (
                <tr><td colSpan={7} className="muted text-center">No member or responder accounts match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {(showRespondersPanel || inOnboardingMode) && (
      <section className="panel p-6 space-y-4">
        <h2 className="org-tab-title">Responder Teams & Live Duty Status</h2>
        {listToolbar(respSearch, setRespSearch, respBranch, setRespBranch, "Search responders")}
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Current status</th><th>Branch</th><th>Unit</th><th>Last seen</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredResponders.map((presence) => (
                <tr key={presence.user_id}>
                  <td>{presence.profiles?.full_name ?? presence.user_id}</td>
                  <td>{presence.profiles?.email ?? emailByUser.get(presence.user_id) ?? "—"}</td>
                  <td><span className={`org-status-pill status-${(presence.response_status ?? presence.availability ?? "unknown").replaceAll("_", "-")}`}>{formatCurrentResponderStatus(presence.response_status ?? presence.availability) ?? "Not reported"}</span></td>
                  <td>{branchOptions.find((branch) => branch.id === presence.branch_id)?.name ?? "—"}</td>
                  <td>{units.find((unit) => unit.id === presence.unit_id)?.name ?? "—"}</td>
                  <td>{presence.last_seen_at ? new Date(presence.last_seen_at).toLocaleString() : "—"}</td>
                  <td>
                    <div className="org-availability-actions">
                      {["available", "busy", "off_duty", "unavailable"].map((value) => (
                        <button key={value} type="button" aria-pressed={presence.availability === value && !presence.response_status} disabled={busy || Boolean(presence.response_status) || presence.availability === value} onClick={() => void setAvailability(presence.user_id, value)}>{formatCurrentResponderStatus(value)}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredResponders.length === 0 && <tr><td colSpan={7} className="muted text-center">No responders match.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      )}
      </div>
      </main>
      {configurationDrawer && (
        <div className="org-console-config-drawer-layer">
          <button
            type="button"
            className="org-console-config-backdrop"
            aria-label="Close configuration form"
            onClick={closeConfigurationDrawer}
          />
          <aside
            className="org-console-config-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="org-console-config-drawer-title"
          >
            <header>
              <h2 id="org-console-config-drawer-title">
                {configurationDrawer === "branch"
                  ? (editingBranchId ? "Edit branch" : "Add branch")
                  : configurationDrawer === "unit"
                    ? (editingUnitId ? "Edit unit" : "Add unit")
                    : "Add emergency coverage"}
              </h2>
              <button type="button" className="org-console-config-close" onClick={closeConfigurationDrawer} aria-label="Close">
                <X size={20} />
              </button>
            </header>
            {error && <p role="alert" className="ops-login-error org-console-config-error">{error}</p>}
            {configurationDrawer === "branch" && (
              <form id="org-branches-form" className="org-console-config-form" onSubmit={(event) => void createBranch(event)}>
                <label className="field">Branch name<input autoFocus required value={branchName} onChange={(event) => setBranchName(event.target.value)} /></label>
                <label className="field">Branch code<input value={branchCode} onChange={(event) => setBranchCode(event.target.value)} /></label>
                <label className="field">Address<input value={branchAddress} onChange={(event) => setBranchAddress(event.target.value)} /></label>
                <label className="field">City<input value={branchCity} onChange={(event) => setBranchCity(event.target.value)} /></label>
                <label className="field">Latitude<input type="number" min="-90" max="90" step="any" value={branchLat} onChange={(event) => setBranchLat(event.target.value)} placeholder="-25.7461" /></label>
                <label className="field">Longitude<input type="number" min="-180" max="180" step="any" value={branchLng} onChange={(event) => setBranchLng(event.target.value)} placeholder="28.1881" /></label>
                <label className="field">Geofence GeoJSON (Polygon)
                  <textarea rows={5} value={branchGeofence} onChange={(event) => setBranchGeofence(event.target.value)} placeholder='{"type":"Polygon","coordinates":[[[28.1,-25.7],[28.2,-25.7],[28.2,-25.8],[28.1,-25.8],[28.1,-25.7]]]}' />
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input className="org-console-checkbox" type="checkbox" checked={branchIsHq} onChange={(event) => setBranchIsHq(event.target.checked)} />
                  Headquarters
                </label>
                <footer>
                  <button className="btn" type="button" disabled={busy} onClick={closeConfigurationDrawer}>Cancel</button>
                  <button className="btn btn-primary" disabled={busy}>{editingBranchId ? "Save branch" : "Add branch"}</button>
                </footer>
              </form>
            )}
            {configurationDrawer === "unit" && (
              <form id="org-units-form" className="org-console-config-form" onSubmit={(event) => void createUnit(event)}>
                <label className="field">Unit name<input autoFocus required value={unitName} onChange={(event) => setUnitName(event.target.value)} /></label>
                <label className="field">Unit type
                  <select value={unitType} onChange={(event) => setUnitType(event.target.value)}>
                    <option value="patrol_vehicle">Patrol vehicle</option>
                    <option value="ambulance">Ambulance</option>
                    <option value="response_team">Response team</option>
                    <option value="medical_team">Medical team</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="field">Branch
                  <select required disabled={Boolean(editingUnitId)} value={unitBranchId} onChange={(event) => setUnitBranchId(event.target.value)}>
                    <option value="">Select branch</option>
                    {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
                <footer>
                  <button className="btn" type="button" disabled={busy} onClick={closeConfigurationDrawer}>Cancel</button>
                  <button className="btn btn-primary" disabled={busy}>{editingUnitId ? "Save unit" : "Add unit"}</button>
                </footer>
              </form>
            )}
            {configurationDrawer === "coverage" && (
              <form className="org-console-config-form" onSubmit={(event) => void addCoverage(event)}>
                <label className="field">Emergency type
                  <select autoFocus value={coverageTypeCode} onChange={(event) => setCoverageTypeCode(event.target.value)}>
                    {emergencyTypes.map((type) => <option key={type.code} value={type.code}>{type.short_label}</option>)}
                  </select>
                </label>
                <label className="field">Branch
                  <select value={coverageBranchId} onChange={(event) => setCoverageBranchId(event.target.value)}>
                    <option value="">All branches (org-wide)</option>
                    {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
                <footer>
                  <button className="btn" type="button" disabled={busy} onClick={closeConfigurationDrawer}>Cancel</button>
                  <button className="btn btn-primary" disabled={busy}>Save coverage</button>
                </footer>
              </form>
            )}
          </aside>
        </div>
      )}
    </div>
    </div>
    <style jsx global>{`
      .org-console {
        --ink: #0d1117;
        --ink-2: #161b22;
        --sidebar-line: #262c36;
        --bg: #f3f4f6;
        --chrome: #ffffff;
        --surface-1: #ffffff;
        --surface-2: #fafbfc;
        --surface-3: #f3f5f7;
        --well: #ffffff;
        --line: #e3e6ea;
        --line-strong: #d0d5db;
        --text: #14181f;
        --text-2: #323b46;
        --muted: #5d6673;
        --dim: #8a93a0;
        --ok: #15803d;
        --ok-bg: #e6f5ec;
        --warn: #9a5b00;
        --warn-bg: #fff4df;
        --crit: #d62f3b;
        --line-focus: #0b7a6c;
        --kiki-control-speed: 180ms;
        --kiki-ease: ease;
        display: grid;
        grid-template-columns: 256px minmax(0, 1fr);
        width: 100%;
        position: fixed;
        inset: 0;
        height: 100dvh;
        min-height: 0;
        overflow: hidden;
        font-family: "Barlow", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        color: var(--text);
        background: var(--bg);
      }
      .org-console-sidebar {
        display: flex;
        min-height: 0;
        flex-direction: column;
        overflow: auto;
        padding: 16px 12px;
        background: var(--ink);
        color: #9aa4b2;
      }
      .org-console-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 4px 8px 18px;
        color: #fff;
        font: 700 16px "Barlow Semi Condensed", "Arial Narrow", sans-serif;
        letter-spacing: .22em;
      }
      .org-console-brand svg {
        width: 26px;
        height: 26px;
        flex: none;
        fill: #fff;
        stroke: none;
      }
      .org-console-brand svg path + path { fill: var(--ink); }
      .org-console-org-card {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        margin-bottom: 8px;
        padding: 10px;
        border: 1px solid var(--sidebar-line);
        border-radius: 10px;
        background: var(--ink-2);
      }
      .org-console-org-mark {
        display: grid;
        width: 34px;
        height: 34px;
        flex: none;
        place-items: center;
        overflow: hidden;
        border-radius: 8px;
        background: #f7c600;
        color: #111;
        font: 700 11px "Barlow Semi Condensed", "Arial Narrow", sans-serif;
      }
      .org-console-org-mark img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .org-console-org-details,
      .org-console-account-details {
        min-width: 0;
      }
      .org-console-org-details b,
      .org-console-account-details b {
        display: block;
        overflow: hidden;
        color: #fff;
        font-weight: 600;
        line-height: 1.2;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .org-console-org-details small,
      .org-console-account-details small {
        display: block;
        overflow: hidden;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .org-console-nav {
        display: grid;
        align-content: start;
        gap: 4px;
      }
      .org-console-nav-group { display: grid; gap: 2px; }
      .org-console-nav-label {
        margin: 0;
        padding: 16px 10px 6px;
        color: #6b7482;
        font-size: 12px;
      }
      .org-console-nav-item {
        display: flex;
        width: 100%;
        min-height: 38px;
        align-items: center;
        gap: 11px;
        padding: 9px 10px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #9aa4b2;
        font-weight: 500;
        text-align: left;
      }
      .org-console-nav-item:hover,
      .org-console-nav-item.is-active {
        background: #161b22;
        color: #fff;
      }
      .org-console-nav-item.is-active { background: #222a35; }
      .org-console-nav-item svg { flex: none; }
      .org-console-account {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: auto;
        padding: 14px 8px 0;
        border-top: 1px solid var(--sidebar-line);
      }
      .org-console-account-avatar {
        display: grid;
        width: 34px;
        height: 34px;
        flex: none;
        place-items: center;
        border-radius: 50%;
        background: #2a3340;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
      }
      .org-console-main {
        display: flex;
        min-width: 0;
        min-height: 0;
        height: 100%;
        flex-direction: column;
        overflow: hidden;
      }
      .org-console-topbar {
        display: flex;
        height: 60px;
        flex: none;
        align-items: center;
        gap: 14px;
        padding: 0 28px;
        border-bottom: 1px solid var(--line);
        background: #fff;
      }
      .org-console-breadcrumb {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
        color: var(--muted);
        white-space: nowrap;
      }
      .org-console-breadcrumb span:first-child {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .org-console-breadcrumb b { color: var(--text); font-weight: 500; }
      .org-console-topbar-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-left: auto;
      }
      .org-console-sync {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: var(--muted);
        font-size: 13px;
        white-space: nowrap;
      }
      .org-console-sync::before {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--ok);
        content: "";
      }
      .org-console .org-console-response-link {
        border-color: #0b7a6c;
        background: #0b7a6c;
        color: #fff;
        text-decoration: none;
      }
      .org-console .org-console-response-link:hover { background: #096659; }
      .org-console-content {
        width: 100%;
        max-width: none;
        min-height: 0;
        flex: 1 1 0;
        overflow: auto;
        margin: 0;
        padding: 28px;
        overscroll-behavior-y: contain;
        touch-action: pan-y;
        -webkit-overflow-scrolling: touch;
      }
      .org-console-content-inner {
        display: grid;
        width: 100%;
        max-width: 1180px;
        align-content: start;
        gap: 20px;
        margin: 0 auto;
      }
      .org-console .tbl-wrap {
        width: 100%;
        max-width: 100%;
        overflow: auto;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }
      .org-console .panel.org-config-panel {
        padding: 0;
        border-radius: 10px;
        box-shadow: none;
      }
      .org-console .org-config-panel-header {
        display: flex;
        min-height: 64px;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 22px;
        border-bottom: 1px solid var(--line);
      }
      .org-console .org-config-panel-header p {
        margin-top: 2px;
        color: var(--muted);
        font-size: 13px;
      }
      .org-console .org-config-panel-title {
        margin: 0;
        color: var(--text);
        font: 600 18px "Barlow Semi Condensed", "Arial Narrow", sans-serif;
      }
      .org-console .org-config-panel .tbl th,
      .org-console .org-config-panel .tbl td {
        padding-right: 22px;
        padding-left: 22px;
      }
      .org-console-config-drawer-layer {
        position: fixed;
        z-index: 1000;
        inset: 0;
      }
      .org-console-config-backdrop {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
        background: rgba(13, 17, 23, .45);
      }
      .org-console-config-drawer {
        position: absolute;
        inset: 0 0 0 auto;
        display: flex;
        width: min(440px, 100%);
        max-height: 100dvh;
        flex-direction: column;
        background: #fff;
        box-shadow: -8px 0 30px rgba(0, 0, 0, .15);
      }
      .org-console-config-drawer > header {
        display: flex;
        min-height: 64px;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 24px;
        border-bottom: 1px solid var(--line);
      }
      .org-console-config-drawer > header h2 {
        margin: 0;
        font: 600 20px "Barlow Semi Condensed", "Arial Narrow", sans-serif;
      }
      .org-console-config-close {
        display: grid;
        width: 36px;
        height: 36px;
        flex: none;
        place-items: center;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--muted);
      }
      .org-console-config-close:hover { background: var(--surface-3); color: var(--text); }
      .org-console-config-form {
        display: grid;
        flex: 1;
        align-content: start;
        gap: 16px;
        overflow: auto;
        padding: 24px;
      }
      .org-console-config-form footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin: auto -24px -24px;
        padding: 16px 24px;
        border-top: 1px solid var(--line);
        background: #fafbfc;
      }
      .org-console-config-error { margin: 16px 24px 0; }
      .org-console-locked > :not(.org-console-lock-message):not(.ops-login-error):not(.ops-login-status) {
        pointer-events: none;
        opacity: .45;
      }
      .org-console-lock-message {
        border-color: var(--warn);
        background: var(--warn-bg);
      }
      .org-console .page-title { color: var(--text); font-size: 1.125rem; font-weight: 800; line-height: 1.25; }
      .org-console-hash { margin-right: 7px; color: var(--muted); }
      .org-console .eyebrow { color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
      .org-console .muted { color: var(--muted); }
      .org-console-header {
        width: 100%;
        margin: 0;
        padding: 14px clamp(14px, 2vw, 28px);
        border: 0;
        border-bottom: 1px solid var(--line);
        border-radius: 0;
        background: var(--chrome);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        position: sticky;
        top: 0;
        z-index: 30;
      }
      .org-console-heading { display: flex; align-items: center; gap: 12px; }
      .org-console-title-row { display: flex; align-items: center; gap: 8px; }
      .org-console-header-actions { display: inline-flex; align-items: center; gap: 10px; }
      .org-console-avatar {
        width: 32px;
        height: 32px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        font-size: 11px;
        font-weight: 800;
        color: var(--text);
        background: var(--surface-2);
        border: 1px solid var(--line);
      }
      .org-console-mark {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        font-weight: 800;
        background: var(--surface-3);
        color: var(--text);
        border: 1px solid var(--line);
      }
      .org-console-pill {
        font-size: 10px;
        line-height: 1;
        text-transform: uppercase;
        letter-spacing: .08em;
        color: var(--text-2);
        border: 1px solid var(--line);
        background: var(--surface-2);
        padding: 5px 7px;
        border-radius: 7px;
      }
      .org-console .panel {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--surface-1);
        box-shadow: none;
      }
      .org-console-surface { display: grid; gap: 16px; }
      .org-console .pane-head {
        margin: 0;
        color: #ffffff;
        font-size: 1rem;
        font-weight: 800;
      }
      .org-tab-title {
        margin: 0;
        color: var(--text);
        font-size: 1rem;
        font-weight: 800;
      }
      .org-home-title {
        margin: 0;
        color: var(--text);
        font-size: .75rem;
        font-weight: 800;
        letter-spacing: .08em;
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .org-console-tabs-shell {
        padding: 8px 12px;
        background: var(--chrome);
        border: 1px solid var(--line);
        border-radius: 16px;
      }
      .org-console-tabs {
        display: flex;
        justify-content: center;
        flex-wrap: wrap;
        gap: 6px;
        width: 100%;
        scrollbar-width: none;
      }
      .org-console-tab {
        border: 1px solid transparent;
        background: transparent;
        color: var(--muted);
        font-weight: 700;
        min-height: 40px;
        border-radius: 12px;
        padding: 0 14px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
        transition: all .15s ease;
      }
      .org-console-tab:hover { background: var(--surface-3); color: var(--text); }
      .org-console-tab.is-active {
        border-color: var(--line);
        background: var(--surface-3);
        color: var(--text);
        box-shadow: none;
      }
      .org-roster-file {
        display: block;
        width: 100%;
        min-height: 48px;
        padding: 7px;
        border: 1px dashed var(--line-strong);
        border-radius: 10px;
        background: var(--well);
        color: var(--text);
        cursor: pointer;
      }
      .org-roster-file::file-selector-button {
        min-height: 32px;
        margin-right: 12px;
        padding: 0 12px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--surface-3);
        color: var(--text);
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .org-roster-file::-webkit-file-upload-button {
        min-height: 32px;
        margin-right: 12px;
        padding: 0 12px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--surface-3);
        color: var(--text);
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .org-roster-file:focus-visible,
      .org-roster-search:focus-visible {
        outline: 2px solid var(--line-focus);
        outline-offset: 2px;
      }
      .org-roster-search-form { display: flex; width: min(100%, 380px); gap: 8px; }
      .org-roster-search {
        width: 100%;
        min-width: 0;
        min-height: 38px;
        padding: 0 12px;
        border: 1px solid var(--line);
        border-radius: 9px;
        background: var(--well);
        color: var(--text);
      }
      .org-roster-search::placeholder { color: var(--muted); opacity: 1; }
      .org-console-hero { border-color: var(--line); background: var(--surface-2); }
      .org-console-metrics {
        display: grid;
        grid-template-columns: repeat(1, minmax(0, 1fr));
        gap: 12px;
      }
      @media (min-width: 640px) {
        .org-console-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (min-width: 1024px) {
        .org-console-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      }
      @media (max-width: 640px) {
        .org-console-header { align-items: flex-start; }
        .org-console-heading { min-width: 0; }
        .org-console-title-row { align-items: flex-start; flex-direction: column; gap: 5px; }
        .org-console-tabs-shell { padding: 6px; }
        .org-console-tab { padding: 0 10px; font-size: 12px; }
        .org-roster-search-form { width: 100%; }
      }
      .org-console-metric {
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--surface-2);
        min-height: 108px;
        padding: 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .org-console-metric p:first-child { color: var(--muted); }
      .org-console-metric p:nth-child(2) { color: var(--text); }
      .org-console-metric p:last-child { color: var(--text-2); }
      .org-metric-icon {
        width: 46px;
        height: 46px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        border: 1px solid;
      }
      .org-metric-icon.branch { color: var(--text); background: var(--surface-3); border-color: var(--line); }
      .org-metric-icon.unit { color: var(--text); background: var(--surface-3); border-color: var(--line); }
      .org-metric-icon.responder { color: var(--text); background: var(--surface-3); border-color: var(--line); }
      .org-metric-icon.beneficiary { color: var(--text); background: var(--surface-3); border-color: var(--line); }
      .org-console-surface-block {
        border: 1px solid #2a3147; border-radius: 14px; box-shadow: none; background: #1a1e2b;
      }
      .org-console-surface-block h3 { color: #ffffff; }
      .org-history-metrics {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(1, minmax(0, 1fr));
      }
      @media (min-width: 768px) {
        .org-history-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      .org-history-metric-card {
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--surface-2);
        padding: 14px;
      }
      .org-history-metric-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        font-size: 12px;
      }
      .org-history-metric-header strong { color: var(--text); }
      .org-history-metric-header span { color: var(--ok); }
      .org-history-metric-stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
        margin: 12px 0 0;
      }
      .org-history-metric-stats div {
        border: 1px solid var(--line);
        border-radius: 10px;
        background: rgba(255,255,255,0.02);
        padding: 8px 6px;
        text-align: center;
      }
      .org-history-metric-stats dt {
        color: var(--muted);
        font-size: 10px;
        margin-bottom: 4px;
      }
      .org-history-metric-stats dd {
        margin: 0;
        font-size: 12px;
        font-weight: 800;
      }
      .org-history-empty {
        border: 1px dashed var(--line);
        border-radius: 12px;
        padding: 16px;
        color: var(--muted);
        font-size: 12px;
      }
      .org-history-column {
        display: grid;
        gap: 10px;
      }
      .org-history-column-title {
        margin: 0;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: .08em;
        color: var(--muted);
        text-transform: uppercase;
      }
      .org-history-item {
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--surface-2);
        padding: 12px 13px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .org-history-item strong { display: block; font-size: 12px; }
      .org-history-item-meta {
        display: grid;
        justify-items: end;
        gap: 4px;
        text-align: right;
      }
      .org-history-item-meta span,
      .org-history-item-meta small {
        color: var(--muted);
        font-size: 10px;
      }
      .org-console-quick-actions {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(1, minmax(0, 1fr));
      }
      @media (min-width: 768px) {
        .org-console-quick-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (min-width: 1200px) {
        .org-console-quick-actions { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      }
      .org-console-action {
        border: 1px solid var(--line);
        min-height: 48px;
        border-radius: 12px;
        background: var(--surface-2);
        color: var(--text);
        width: 100%;
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 0 14px;
        font-size: 12px;
        font-weight: 700;
        transition: all .15s ease;
      }
      .org-console-action span {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .org-action-icon.responders { color: var(--text); }
      .org-action-icon.staff { color: var(--text); }
      .org-action-icon.beneficiaries { color: var(--text); }
      .org-action-icon.rules { color: var(--text); }
      .org-on-duty {
        color: var(--ok);
        font-size: 11px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .org-on-duty i {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--ok);
      }
      .org-console-action:hover { background: var(--surface-3); border-color: var(--line); }
      .org-progress-badge {
        font-size: 11px;
        font-weight: 800;
        color: #34d399;
        background: rgba(16, 185, 129, .1);
        border: 1px solid rgba(16, 185, 129, .25);
        border-radius: 999px;
        padding: 4px 10px;
      }
      .org-progress-track {
        width: 100%;
        height: 8px;
        border-radius: 999px;
        overflow: hidden;
        background: #1f2937;
      }
      .org-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #8b5cf6, #34d399);
      }
      .org-checklist {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 9px;
      }
      .org-checklist li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: #cbd5e1;
        font-size: 12px;
      }
      .org-checklist li span {
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }
      .org-checklist li svg { color: #34d399; }
      .org-checklist li small {
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: .08em;
        font-size: 10px;
      }
      .org-console-log-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 10px;
        border: 1px solid rgba(255, 255, 255, .06);
        border-radius: 12px;
        padding: 12px;
        background: #191d2a;
      }
      .org-console-log-row p { color: var(--text); }
      .org-log-icon {
        width: 30px;
        height: 30px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        color: #34d399;
        background: rgba(16, 185, 129, .1);
        border: 1px solid rgba(16, 185, 129, .22);
      }
      .org-console .field input,
      .org-console .field select,
      .org-console .field textarea {
        border: 1px solid rgba(255, 255, 255, .12);
        border-radius: 12px;
        min-height: 42px;
        background: #0f1219;
        color: #f8fafc;
      }
      .org-console .field { color: #cbd5e1; font-size: 12px; font-weight: 600; }
      .org-setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 72px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--surface-2);
        padding: 14px 16px;
      }
      .org-setting-title { margin: 0; color: var(--text); font-size: 13px; font-weight: 700; }
      .org-setting-description { margin: 4px 0 0; color: var(--muted); font-size: 11px; line-height: 1.45; }
      .org-switch {
        position: relative;
        flex: 0 0 auto;
        width: 44px;
        height: 25px;
        padding: 3px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: #343945;
        transition: background var(--kiki-control-speed) var(--kiki-ease), border-color var(--kiki-control-speed) var(--kiki-ease), box-shadow var(--kiki-control-speed) var(--kiki-ease);
      }
      .org-switch span {
        display: block;
        width: 17px;
        height: 17px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,.35);
        transition: transform var(--kiki-control-speed) var(--kiki-ease);
      }
      .org-switch.is-on { background: #22a06b; border-color: #22a06b; }
      .org-switch.is-on span { transform: translateX(18px); }
      .org-switch:focus-visible { outline: 2px solid #a855f7; outline-offset: 2px; }
      .org-console .field textarea { min-height: 110px; }
      .org-console .field input:focus,
      .org-console .field select:focus,
      .org-console .field textarea:focus { outline: 2px solid #a855f7; outline-offset: 1px; }
      .org-console .tbl thead th { background: var(--surface-2); color: var(--muted); border-bottom: 1px solid var(--line); }
      .org-console .tbl tbody td { color: var(--text-2); border-bottom: 1px solid var(--line); }
      .org-console .btn {
        border: 1px solid var(--line);
        background: var(--surface-2);
        color: var(--text);
        border-radius: 12px;
        min-height: 38px;
      }
      .org-console .btn:hover { background: var(--surface-3); }
      .org-console .btn-primary {
        border-color: var(--line);
        background: var(--surface-3);
        color: var(--text);
      }
      .org-console .btn-primary:hover { background: var(--surface-2); }
      @media (max-width: 768px) {
        .org-console-tabs { scroll-snap-type: x mandatory; padding-bottom: 4px; }
        .org-console-tab { scroll-snap-align: start; }
        .org-console .pane-head { font-size: 15px; }
        .org-console-header { position: static; padding: 12px 14px; }
        .org-console-content { padding: 12px 12px 0; }
      }
      .org-console .field input.org-roster-file { display: block; min-height: 56px; margin-top: 4px; padding: 10px 12px; line-height: 1.2; }
      .org-console .field input.org-roster-file::file-selector-button { margin: 0 12px 0 0; padding: 7px 14px; }
      .org-list-search { width: 100%; max-width: 320px; min-height: 38px; padding: 0 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--well); color: var(--text); }
      .org-list-search:focus { outline: 2px solid #a855f7; outline-offset: 1px; }
      .org-console .btn-danger { border-color: transparent; background: var(--crit); color: #fff; }
      .org-console .panel { padding-inline: clamp(14px, 2vw, 24px); }
      .org-console .org-console-content-inner.space-y-6 > :not([hidden]) ~ :not([hidden]) { margin-top: 0; }
      .org-console .org-console-page-heading {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      .org-console .org-console-page-heading h1 {
        margin: 0;
        color: var(--text);
        font: 700 30px/1.1 "Barlow Semi Condensed", "Arial Narrow", sans-serif;
      }
      .org-console .org-console-page-heading p { margin: 4px 0 0; color: var(--muted); }
      .org-console .org-console-home {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        align-items: start;
        gap: 20px;
      }
      .org-console .org-console-home > .org-console-page-heading,
      .org-console .org-console-home > .org-console-metrics {
        grid-column: 1 / -1;
      }
      .org-console .org-console-home > .org-console-page-heading { grid-row: 1; }
      .org-console .org-console-home > .org-console-metrics { grid-row: 2; }
      .org-home-columns {
        display: grid;
        grid-column: 1 / -1;
        grid-template-columns: minmax(0, 1fr) 360px;
        align-items: start;
        gap: 20px;
      }
      .org-home-main-column,
      .org-home-side-panels {
        display: grid;
        min-width: 0;
        gap: 20px;
      }
      .org-console .org-console-metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #fff;
      }
      .org-console .org-console-metric {
        min-height: 120px;
        align-items: flex-start;
        border: 0;
        border-radius: 0;
        background: transparent;
        padding: 20px 24px;
      }
      .org-console .org-console-metric + .org-console-metric { border-left: 1px solid var(--line); }
      .org-console .org-console-metric > div:first-child { min-width: 0; }
      .org-console .org-console-metric > div:first-child > p:first-child {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
        text-transform: none;
        letter-spacing: 0;
      }
      .org-console .org-console-metric > div:first-child > p:nth-child(2) {
        margin: 4px 0 2px;
        color: var(--text);
        font: 700 40px/1.1 "Barlow Semi Condensed", "Arial Narrow", sans-serif;
      }
      .org-console .org-console-metric > div:first-child > p:last-child {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
      }
      .org-console .org-metric-icon { display: none; }
      .org-console .org-home-panel {
        min-width: 0;
        padding: 0;
        border-radius: 10px;
        border: 1px solid var(--line);
        background: #fff;
        box-shadow: none;
      }
      .org-home-panel-header {
        display: flex;
        min-height: 62px;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 22px;
        border-bottom: 1px solid var(--line);
      }
      .org-home-panel-header p {
        margin: 1px 0 0;
        color: var(--muted);
        font-size: 13px;
      }
      .org-home-panel-body { padding: 22px; }
      .org-home-small-button {
        min-height: 32px !important;
        padding: 0 11px !important;
        font-size: 13px;
      }
      .org-home-featured-responder {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
      }
      .org-home-avatar {
        display: grid;
        width: 34px;
        height: 34px;
        flex: none;
        place-items: center;
        border-radius: 50%;
        background: #e8ecf0;
        color: #27313d;
        font-size: 12px;
        font-weight: 600;
      }
      .org-home-featured-responder .who b { font-weight: 500; }
      .org-home-featured-responder .who small { color: var(--muted); font-size: 12.5px; }
      .org-home-success {
        display: inline-flex;
        align-items: center;
        padding: 2px 9px;
        border-radius: 20px;
        background: var(--ok-bg);
        color: var(--ok);
        font-size: 12.5px;
        font-weight: 500;
        white-space: nowrap;
      }
      .org-home-mini-stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin-top: 18px;
        border: 1px solid var(--line);
        border-radius: 8px;
      }
      .org-home-mini-stats > div { min-width: 0; padding: 12px 16px; }
      .org-home-mini-stats > div + div { border-left: 1px solid var(--line); }
      .org-home-mini-stats small { color: var(--muted); }
      .org-home-mini-stats b {
        display: block;
        overflow: hidden;
        font: 700 22px "Barlow Semi Condensed", "Arial Narrow", sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .org-home-table { min-width: 680px; }
      .org-console .org-home-table th {
        padding: 10px 22px;
        background: #fafbfc;
        color: var(--muted);
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
      }
      .org-console .org-home-table td {
        padding: 13px 22px;
        border-top: 1px solid var(--line);
        color: var(--text-2);
        vertical-align: middle;
      }
      .org-console .org-home-table tbody tr:first-child td { border-top: 0; }
      .org-console .org-home-table tbody tr:hover { background: #fafbfc; }
      .org-console .org-home-table td[colspan] { padding: 36px; text-align: center; }
      .org-home-panel .org-console-quick-actions { gap: 0; }
      .org-console .org-home-panel .org-console-action {
        min-height: 46px;
        padding: 13px 22px;
      }
      .org-console .org-home-panel .org-console-action:first-child { border-top: 0; }
      .org-console .org-progress-badge {
        flex: none;
        padding: 2px 9px;
        border: 0;
        border-radius: 20px;
        background: var(--ok-bg);
        color: var(--ok);
        font-size: 12.5px;
        font-weight: 500;
      }
      .org-console .org-home-panel .org-checklist {
        gap: 0;
        margin-top: 14px;
      }
      .org-console .org-home-panel .org-checklist li {
        min-height: 37px;
        padding: 9px 0;
        border-top: 1px solid var(--line);
        color: var(--text-2);
        font-size: 13px;
      }
      .org-console .org-home-panel .org-checklist li span { gap: 10px; }
      .org-console .org-home-panel .org-checklist li svg { width: 17px; flex: none; }
      .org-console .org-home-panel .org-checklist li small {
        color: var(--dim);
        font-size: 12.5px;
        letter-spacing: 0;
        text-transform: none;
      }
      .org-home-operations { display: grid; gap: 0; }
      .org-console .org-home-operations .org-console-log-row {
        grid-template-columns: auto minmax(0, 1fr) auto;
        padding: 12px 0;
        border: 0;
        border-top: 1px solid var(--line);
        border-radius: 0;
      }
      .org-console .org-home-operations .org-console-log-row:first-child { padding-top: 0; border-top: 0; }
      .org-console .org-home-operations .org-console-log-row:last-child { padding-bottom: 0; }
      .org-home-operations .org-console-log-row p { margin: 0; font-size: 13px; font-weight: 500; }
      .org-home-operations .org-console-log-row small,
      .org-home-operations .org-console-log-row time {
        color: var(--muted);
        font-size: 12px;
        white-space: nowrap;
      }
      .org-console .org-home-operations .org-log-icon {
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 50%;
      }
      .org-console .panel {
        border-radius: 10px;
        background: #fff;
        box-shadow: none;
      }
      .org-console .pane-head,
      .org-console .org-tab-title { color: var(--text); }
      .org-console .org-home-title {
        color: var(--text);
        font: 600 18px "Barlow Semi Condensed", "Arial Narrow", sans-serif;
        letter-spacing: 0;
        text-transform: none;
      }
      .org-console .org-console-quick-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0;
      }
      .org-console .org-console-action {
        min-height: 46px;
        padding: 12px 0;
        border: 0;
        border-top: 1px solid var(--line);
        border-radius: 0;
        background: transparent;
        color: var(--text);
        font-size: 14px;
        font-weight: 500;
      }
      .org-console .org-console-action:hover { background: var(--surface-2); }
      .org-console .org-action-icon.responders,
      .org-console .org-action-icon.staff,
      .org-console .org-action-icon.beneficiaries,
      .org-console .org-action-icon.rules { color: var(--muted); }
      .org-console .org-history-metric-card,
      .org-console .org-history-item,
      .org-console .org-console-log-row {
        border-color: var(--line);
        border-radius: 8px;
        background: #fff;
      }
      .org-console .org-history-metric-stats div {
        border-color: var(--line);
        border-radius: 8px;
        background: var(--surface-2);
      }
      .org-console .org-progress-track { background: #e6eaee; }
      .org-console .org-progress-fill { background: #0b7a6c; }
      .org-console .org-checklist li { color: var(--text-2); }
      .org-console .org-checklist li svg { color: var(--ok); }
      .org-console .org-checklist li small { color: var(--dim); }
      .org-console .org-console-log-row { background: #fff; }
      .org-console .org-log-icon {
        border-color: var(--ok-bg);
        background: var(--ok-bg);
        color: var(--ok);
      }
      .org-console .org-console-surface-block {
        border-color: var(--line);
        border-radius: 10px;
        background: #fff;
      }
      .org-console .org-console-surface-block h3 { color: var(--text); }
      .org-console .field { color: var(--text); }
      .org-console .field input,
      .org-console .field select,
      .org-console .field textarea {
        border-color: var(--line-strong);
        border-radius: 8px;
        background: #fff;
        color: var(--text);
      }
      .org-console .field input:focus,
      .org-console .field select:focus,
      .org-console .field textarea:focus,
      .org-console .org-list-search:focus { outline: 2px solid #e3f4f1; border-color: #0b7a6c; }
      .org-console .org-console-checkbox {
        width: 16px;
        height: 16px;
        accent-color: #0b7a6c;
      }
      .org-console .org-setting-row { border-radius: 8px; background: #fff; }
      .org-console .org-switch { background: #c5ccd4; }
      .org-console .org-switch.is-on { border-color: #0b7a6c; background: #0b7a6c; }
      .org-console .org-switch span { box-shadow: none; }
      .org-console .tbl th,
      .org-console .tbl thead th {
        background: #fafbfc;
        color: var(--muted);
        border-bottom-color: var(--line);
      }
      .org-console .tbl tbody td { color: var(--text-2); border-bottom-color: var(--line); }
      .org-console .tbl tbody tr:hover { background: #fafbfc; }
      .org-console .org-status-pill {
        display: inline-flex;
        min-height: 24px;
        align-items: center;
        gap: 6px;
        padding: 2px 9px;
        border-radius: 20px;
        background: #eceff2;
        color: #3f4955;
        font-size: 12.5px;
        font-weight: 500;
        white-space: nowrap;
      }
      .org-console .org-status-pill::before {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
        content: "";
      }
      .org-console .org-status-pill.status-available { background: #e6f5ec; color: #15803d; }
      .org-console .org-status-pill.status-en-route,
      .org-console .org-status-pill.status-assigned,
      .org-console .org-status-pill.status-acknowledged { background: #fff4df; color: #9a5b00; }
      .org-console .org-status-pill.status-on-scene { background: #e3f4f1; color: #0b7a6c; }
      .org-console .org-status-pill.status-off-duty,
      .org-console .org-status-pill.status-unavailable,
      .org-console .org-status-pill.status-busy { background: #fdecee; color: #d62f3b; }
      .org-console .org-availability-actions {
        display: inline-flex;
        overflow: hidden;
        border: 1px solid var(--line-strong);
        border-radius: 8px;
      }
      .org-console .org-availability-actions button {
        min-height: 32px;
        padding: 5px 10px;
        border: 0;
        border-right: 1px solid var(--line);
        background: #fff;
        color: var(--muted);
        font-size: 12px;
      }
      .org-console .org-availability-actions button:last-child { border-right: 0; }
      .org-console .org-availability-actions button[aria-pressed="true"] { background: var(--ink); color: #fff; }
      .org-console .org-availability-actions button:disabled { cursor: default; opacity: .6; }
      .org-console .btn {
        min-height: 38px;
        border-color: var(--line-strong);
        border-radius: 8px;
        background: #fff;
        color: var(--text);
      }
      .org-console .btn:hover { background: #f6f7f9; }
      .org-console .btn-primary {
        border-color: #0b7a6c;
        background: #0b7a6c;
        color: #fff;
      }
      .org-console .btn-primary:hover { background: #096659; }
      .org-console .btn-danger { border-color: #f0c4c8; background: #fff; color: #d62f3b; }
      @media (max-width: 1000px) {
        .org-console { grid-template-columns: 64px minmax(0, 1fr); }
        .org-console-brand { justify-content: center; padding: 4px 0 18px; }
        .org-console-brand b,
        .org-console-org-details,
        .org-console-nav-label,
        .org-console-nav-item span,
        .org-console-account-details { display: none; }
        .org-console-org-card,
        .org-console-account { justify-content: center; padding-right: 0; padding-left: 0; }
        .org-console-nav-item { justify-content: center; padding-right: 0; padding-left: 0; }
        .org-console-topbar { padding-right: 18px; padding-left: 18px; }
        .org-console-content { padding: 22px; }
        .org-home-columns { grid-template-columns: minmax(0, 1fr); }
        .org-console .org-console-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .org-console .org-console-metric:nth-child(3) { border-left: 0; }
        .org-console .org-console-metric:nth-child(n + 3) { border-top: 1px solid var(--line); }
      }
      @media (max-width: 640px) {
        .org-console-topbar { height: 56px; gap: 8px; padding-right: 12px; padding-left: 12px; }
        .org-console-breadcrumb { font-size: 12px; }
        .org-console-topbar-actions { gap: 6px; }
        .org-console-sync,
        .org-console-refresh span,
        .org-console-response-link span { display: none; }
        .org-console .org-console-content { padding: 16px 12px; }
        .org-console .org-config-panel-header { align-items: flex-start; padding: 14px; }
        .org-console .org-config-panel .tbl th,
        .org-console .org-config-panel .tbl td { padding-right: 14px; padding-left: 14px; }
        .org-console-config-form { padding: 20px 16px; }
        .org-console-config-form footer { margin: auto -16px -20px; padding: 14px 16px; }
        .org-console .org-console-page-heading h1 { font-size: 26px; }
        .org-console .org-console-metric { min-height: 104px; padding: 16px; }
        .org-console .org-console-metric > div:first-child > p:nth-child(2) { font-size: 34px; }
        .org-home-mini-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .org-home-mini-stats > div:nth-child(3) { border-left: 0; }
        .org-home-mini-stats > div:nth-child(n + 3) { border-top: 1px solid var(--line); }
        .org-home-panel-header { align-items: flex-start; padding: 16px; }
        .org-home-panel-body { padding: 16px; }
        .org-console .org-home-panel .org-console-action { padding-right: 16px; padding-left: 16px; }
        .org-console .org-home-table th,
        .org-console .org-home-table td { padding-right: 14px; padding-left: 14px; }
      }
    `}</style>
    </>
  );
}
