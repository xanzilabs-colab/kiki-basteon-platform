"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bolt,
  Building2,
  CircleCheck,
  House,
  LayoutDashboard,
  RefreshCw,
  Settings2,
  Shield,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useEmergencyTypes } from "@/hooks/useEmergencyTypes";
import { membershipTypeOptionsForOrganisation, roleHintForMembershipType } from "@/lib/organisationCategories";

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
  const [state, setState] = useState<MeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [branchCity, setBranchCity] = useState("");
  const [branchLat, setBranchLat] = useState("");
  const [branchLng, setBranchLng] = useState("");
  const [branchGeofence, setBranchGeofence] = useState("");
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
  const [generatedCredentials, setGeneratedCredentials] = useState<{ email: string; password: string; fullName: string } | null>(null);
  const [generatedCredentialPdfUrl, setGeneratedCredentialPdfUrl] = useState("");
  const [coverageTypeCode, setCoverageTypeCode] = useState("general");
  const [coverageBranchId, setCoverageBranchId] = useState("");
  const [unitName, setUnitName] = useState("");
  const [unitBranchId, setUnitBranchId] = useState("");
  const [unitType, setUnitType] = useState("other");
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

  const organisationId = state?.organisation?.id ?? "";
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
  const filteredResponders = responders.filter((presence) => (!respBranch || presence.branch_id === respBranch) && matchesQuery(respSearch, presence.profiles?.full_name, presence.profiles?.email ?? emailByUser.get(presence.user_id), presence.availability));
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
    if (label && !window.confirm(label)) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/organisation/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organisationId, userId, action }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) setError((body as any)?.error ?? "Could not update member.");
    else { setMessage(action === "revoke" ? "Access revoked." : action === "block" ? "Member blocked." : "Member unblocked."); await refresh(); }
    setBusy(false);
  }

  async function deleteRosterEntry(entry: RosterEntry) {
    if (!organisationId || !window.confirm("Delete this roster entry? Anyone linked through it will lose access.")) return;
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
    const response = await fetch("/api/organisation/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        name: branchName,
        address: branchAddress || null,
        city: branchCity || null,
        lat: branchLat ? Number(branchLat) : null,
        lng: branchLng ? Number(branchLng) : null,
        geofenceGeojson: geofence,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not create branch.");
      setBusy(false);
      return;
    }
    setBranchName("");
    setBranchAddress("");
    setBranchCity("");
    setBranchLat("");
    setBranchLng("");
    setBranchGeofence("");
    setMessage("Branch added.");
    await refresh();
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
    if (!unitBranchId) {
      setError("Unit branch is required.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, branchId: unitBranchId, name: unitName, unitType }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not create unit.");
      setBusy(false);
      return;
    }
    setUnitName("");
    setUnitBranchId("");
    setUnitType("other");
    setMessage("Unit created.");
    await refresh();
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
    { key: "members", label: "Staff / Members", icon: Users },
    { key: "roster", label: "Roster", icon: Users },
    { key: "settings", label: "Settings", icon: Settings2 },
    { key: "configurations", label: "Configurations", icon: Building2 },
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
  const recentPresence = [...responders]
    .filter((presence) => presence.last_seen_at)
    .sort((a, b) => +new Date(b.last_seen_at) - +new Date(a.last_seen_at))
    .slice(0, 4);
  const roleLabel = String(state?.memberships?.[0]?.role ?? "owner").toLowerCase();
  const orgTypeLabel = String(state?.organisation?.organisation_type ?? "business").toLowerCase();

  if (!state) return error
    ? <div className="panel m-4 p-5"><p role="alert">{error}</p><button className="btn mt-3" onClick={() => void refresh()}>Try again</button></div>
    : <div className="panel m-4 p-5">Loading organisation console...</div>;

  return (
    <>
    <div className="org-console w-full">
      <header className="org-console-header">
        <div className="org-console-heading">
          <div className="org-console-mark">{String(state.organisation.name ?? "O").trim().charAt(0).toUpperCase()}</div>
          <div>
            <div className="org-console-title-row">
              <h1 className="page-title"><span className="org-console-hash">#</span>{state.organisation.name}</h1>
              <span className="org-console-pill">{orgTypeLabel}</span>
            </div>
            <p className="muted text-xs mt-1">Organisation operations • {roleLabel} access</p>
          </div>
        </div>
        <div className="org-console-header-actions">
          <button className="btn" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />Refresh</button>
          <div className="org-console-avatar">{String(state.organisation.name ?? "TH").trim().slice(0, 2).toUpperCase()}</div>
        </div>
      </header>
      <div className={`org-console-content space-y-6 ${blockedNow ? "org-console-locked" : ""}`}>
      {error && <p role="alert" className="ops-login-error">{error}</p>}
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

      {!inOnboardingMode && (
        <section className="org-console-tabs-shell">
          <nav className="org-console-tabs" aria-label="Organisation dashboard tabs">
            {dashboardTabs.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`org-console-tab ${selected ? "is-active" : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                  aria-pressed={selected}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
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
        <section className="org-console-surface space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="muted text-xs">
              Last synced: <span className="font-semibold text-[var(--text)]">{lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "Not synced yet"}</span>
            </p>
            <button className="btn" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />Reload org data</button>
          </div>
          <div className="org-console-metrics">
            <div className="org-console-metric">
              <div>
                <p className="muted text-xs uppercase tracking-wider">Branches</p>
                <p className="text-2xl font-semibold">{branchOptions.length}</p>
                <p className="muted text-xs mt-1">Operational structure</p>
              </div>
              <div className="org-metric-icon branch"><Building2 size={20} /></div>
            </div>
            <div className="org-console-metric">
              <div>
                <p className="muted text-xs uppercase tracking-wider">Units</p>
                <p className="text-2xl font-semibold">{units.length}</p>
                <p className="muted text-xs mt-1">Configured zones</p>
              </div>
              <div className="org-metric-icon unit"><LayoutDashboard size={20} /></div>
            </div>
            <div className="org-console-metric">
              <div>
                <p className="muted text-xs uppercase tracking-wider">Responders</p>
                <p className="text-2xl font-semibold">{responderMembers.length + presenceOnlyResponders.length}</p>
                <p className="org-on-duty mt-1"><i />{availableResponderCount} On Duty</p>
              </div>
              <div className="org-metric-icon responder"><Shield size={20} /></div>
            </div>
            <div className="org-console-metric">
              <div>
                <p className="muted text-xs uppercase tracking-wider">Beneficiaries</p>
                <p className="text-2xl font-semibold">{beneficiaryMembers.length}</p>
                <p className="muted text-xs mt-1">Linked protected users</p>
              </div>
              <div className="org-metric-icon beneficiary"><Users size={20} /></div>
            </div>
          </div>
          <section className="panel p-6 space-y-4">
            <h3 className="org-home-title"><Bolt size={14} />Organisation Quick Actions</h3>
            <div className="org-console-quick-actions">
              <button className="org-console-action" type="button" onClick={() => setActiveTab("responders")}><span><UserPlus size={16} className="org-action-icon responders" />Manage Responders</span><ArrowRight size={14} /></button>
              <button className="org-console-action" type="button" onClick={() => setActiveTab("members")}><span><Users size={16} className="org-action-icon staff" />Manage Staff</span><ArrowRight size={14} /></button>
              <button className="org-console-action" type="button" onClick={() => setActiveTab("beneficiaries")}><span><Users size={16} className="org-action-icon beneficiaries" />View Beneficiaries</span><ArrowRight size={14} /></button>
              <button className="org-console-action" type="button" onClick={() => setActiveTab("settings")}><span><Settings2 size={16} className="org-action-icon rules" />Linking Rules</span><ArrowRight size={14} /></button>
            </div>
          </section>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="panel p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white">Onboarding Checklist</h4>
                <span className="org-progress-badge">{onboardingProgress}/5 Complete</span>
              </div>
              <div className="org-progress-track"><div className="org-progress-fill" style={{ width: `${Math.min(100, (onboardingProgress / 5) * 100)}%` }} /></div>
              <ul className="org-checklist">
                <li><span><CircleCheck size={14} />Organisation profile</span><small>{onboarding.organisation_profile_done ? "Done" : "Pending"}</small></li>
                <li><span><CircleCheck size={14} />Branches & Units</span><small>{onboarding.branches_done ? "Done" : "Pending"}</small></li>
                <li><span><CircleCheck size={14} />Linking Rules</span><small>{onboarding.linking_rules_done ? "Done" : "Pending"}</small></li>
                <li><span><CircleCheck size={14} />Emergency Coverage</span><small>{onboarding.coverage_done ? "Done" : "Pending"}</small></li>
                <li><span><CircleCheck size={14} />Responders Onboarded</span><small>{onboarding.responders_done ? "Done" : "Pending"}</small></li>
              </ul>
            </div>
            <div className="panel p-6 space-y-3 lg:col-span-2">
              <h4 className="text-sm font-bold text-white">Recent Operations Log</h4>
              {recentPresence.length > 0 ? recentPresence.map((presence) => (
                <div key={`presence-log-${presence.user_id}-${presence.last_seen_at}`} className="org-console-log-row">
                  <div className="org-log-icon"><UserCheck size={14} /></div>
                  <div>
                    <p className="text-xs font-semibold">{presence.profiles?.full_name ?? presence.user_id} set {presence.availability}</p>
                    <p className="muted text-[11px]">{branchOptions.find((branch) => branch.id === presence.branch_id)?.name ?? "No branch"}</p>
                  </div>
                  <span className="muted text-[10px]">{presence.last_seen_at ? new Date(presence.last_seen_at).toLocaleTimeString() : "—"}</span>
                </div>
              )) : <p className="muted text-xs">No recent responder activity yet.</p>}
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
      <section className="panel p-6 space-y-4">
        <h2 className="org-tab-title flex items-center gap-2"><Building2 size={18} />Organisation Hierarchy</h2>
        <p className="muted text-xs">Manage branches, security zones, and response hardware mapping.</p>
        <h3 className="text-sm font-bold text-white">Branches / Stations</h3>
        <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => void createBranch(event)}>
          <label className="field">Branch name<input required value={branchName} onChange={(event) => setBranchName(event.target.value)} /></label>
          <label className="field">Address<input value={branchAddress} onChange={(event) => setBranchAddress(event.target.value)} /></label>
          <label className="field">City<input value={branchCity} onChange={(event) => setBranchCity(event.target.value)} /></label>
          <label className="field">Latitude<input value={branchLat} onChange={(event) => setBranchLat(event.target.value)} placeholder="-25.7461" /></label>
          <label className="field">Longitude<input value={branchLng} onChange={(event) => setBranchLng(event.target.value)} placeholder="28.1881" /></label>
          <label className="field md:col-span-2">Geofence GeoJSON (Polygon)
            <textarea value={branchGeofence} onChange={(event) => setBranchGeofence(event.target.value)} placeholder='{"type":"Polygon","coordinates":[[[28.1,-25.7],[28.2,-25.7],[28.2,-25.8],[28.1,-25.8],[28.1,-25.7]]]}' />
          </label>
          <button className="btn btn-primary self-end" disabled={busy}>Add branch</button>
        </form>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Address</th><th>City</th><th>HQ</th></tr></thead>
            <tbody>
              {branchOptions.map((branch) => (
                <tr key={branch.id}>
                  <td>{branch.name}</td>
                  <td>{branch.address || "—"}</td>
                  <td>{branch.city || "—"}</td>
                  <td>{branch.is_hq ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {showConfigurationsPanel && (
      <section className="panel p-6 space-y-4">
        <h2 className="org-tab-title">Units</h2>
        <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => void createUnit(event)}>
          <label className="field">Unit name<input required value={unitName} onChange={(event) => setUnitName(event.target.value)} /></label>
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
            <select required value={unitBranchId} onChange={(event) => setUnitBranchId(event.target.value)}>
              <option value="">Select branch</option>
              {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <button className="btn btn-primary self-end" disabled={busy}>Add unit</button>
        </form>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Type</th><th>Branch</th><th>Status</th></tr></thead>
            <tbody>
              {units.map((unit) => (
                <tr key={unit.id}>
                  <td>{unit.name}</td>
                  <td>{unit.unit_type}</td>
                  <td>{branchOptions.find((branch) => branch.id === unit.branch_id)?.name ?? "—"}</td>
                  <td>{unit.active ? "Active" : "Inactive"}</td>
                </tr>
              ))}
              {units.length === 0 && <tr><td colSpan={4} className="muted text-center">No units configured yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {showConfigurationsPanel && (
      <section className="panel p-6 space-y-4">
        <h2 className="org-tab-title">Emergency Coverage</h2>
        <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => void addCoverage(event)}>
          <label className="field">Emergency type
            <select value={coverageTypeCode} onChange={(event) => setCoverageTypeCode(event.target.value)}>
              {emergencyTypes.map((type) => <option key={type.code} value={type.code}>{type.short_label}</option>)}
            </select>
          </label>
          <label className="field">Branch
            <select value={coverageBranchId} onChange={(event) => setCoverageBranchId(event.target.value)}>
              <option value="">All branches (org-wide)</option>
              {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <button className="btn btn-primary self-end" disabled={busy}>Save coverage</button>
        </form>
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
                  <td>{presence.availability ?? "active"}</td>
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
            <thead><tr><th>Name</th><th>Email</th><th>Availability</th><th>Branch</th><th>Unit</th><th>Last seen</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredResponders.map((presence) => (
                <tr key={presence.user_id}>
                  <td>{presence.profiles?.full_name ?? presence.user_id}</td>
                  <td>{presence.profiles?.email ?? emailByUser.get(presence.user_id) ?? "—"}</td>
                  <td>{presence.availability}</td>
                  <td>{branchOptions.find((branch) => branch.id === presence.branch_id)?.name ?? "—"}</td>
                  <td>{units.find((unit) => unit.id === presence.unit_id)?.name ?? "—"}</td>
                  <td>{presence.last_seen_at ? new Date(presence.last_seen_at).toLocaleString() : "—"}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {["available", "busy", "off_duty", "unavailable"].map((value) => (
                        <button key={value} className="btn" disabled={busy || presence.availability === value} onClick={() => void setAvailability(presence.user_id, value)}>{value}</button>
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
    </div>
    <style jsx global>{`
      .org-console {
        font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        color: var(--text);
        background: var(--bg);
        width: 100%;
        max-width: none;
        min-height: 100dvh;
        margin: 0;
        padding: 0 0 28px;
      }
      .org-console-content {
        width: min(100%, 1560px);
        margin: 0 auto;
        padding: 18px clamp(12px, 1.6vw, 22px) 0;
      }
      .org-console-locked > :not(.org-console-lock-message):not(.ops-login-error):not(.ops-login-status) {
        pointer-events: none;
        opacity: .45;
      }
      .org-console-lock-message {
        border-color: var(--warn);
        background: var(--warn-bg);
      }
      .org-console .page-title { color: #ffffff; font-size: 1.125rem; font-weight: 800; line-height: 1.25; }
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
        transition: background .18s ease, border-color .18s ease;
      }
      .org-switch span {
        display: block;
        width: 17px;
        height: 17px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,.35);
        transition: transform .18s ease;
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
    `}</style>
    </>
  );
}
