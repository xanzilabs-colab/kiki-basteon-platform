"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, ChevronDown, ChevronRight, CircleHelp, RotateCcw, ShieldCheck, Trash2, X } from "lucide-react";
import { KikiTrigger, type EverydayDevice, type GestureProfile, type TriggerEvent } from "@/lib/kikiTrigger";
import styles from "@/app/account/profile/triggers/lab/triggerLab.module.css";
import {
  analyze,
  quickPresetAssignments,
  validateMapping,
  type Action,
  type Sample,
} from "@/lib/triggerGestures/analyze";
import { resolveGestureProfileName } from "@/lib/triggerGestures/profileSetup";

const ACTIONS: { id: Action; label: string }[] = [
  { id: "sos", label: "SOS" },
  { id: "medical", label: "Medical alert" },
  { id: "duress", label: "Discreet SOS" },
  { id: "cancel", label: "Cancel countdown" },
];

type Step = "preflight" | "warmup" | "calibrate" | "review" | "verify" | "done";
type WaitKind = "warmup" | "sample" | "verify" | null;
type Accessory = { ref: string | null; label: string; kind: string };
type DeviceConfiguration = { ref: string | null; label: string; kind: string; connected: boolean; profiles: GestureProfile[] };

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `gesture-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function isProfileCurrent(profile: GestureProfile, status: { appVersion?: string | null; androidSdk?: number }) {
  return profile.verifiedAt !== null &&
    profile.appVersion === status.appVersion &&
    profile.androidSdk === status.androidSdk &&
    Date.now() >= profile.verifiedAt &&
    Date.now() - profile.verifiedAt <= 90 * 24 * 60 * 60 * 1000;
}

function humanize(signature: string) {
  const tokens: Record<string, string> = {
    T: "Play or pause",
    N: "Next track",
    P: "Previous track",
    S: "Stop",
    U: "Volume up",
    D: "Volume down",
    H: "Hold event",
    X: "Other media key",
    "-": " · pause · ",
  };
  return [...signature].map((token) => tokens[token] ?? token).join("");
}

function asNativeProfile(
  profileId: string,
  name: string,
  kind: GestureProfile["kind"],
  deviceRef: string | null,
  mapping: Partial<Record<Action, string>>,
  samples: Sample[],
  timing: { gapMs: number; settleMs: number },
  status: { appVersion?: string | null; androidSdk?: number },
  verifiedAt: number | null,
): GestureProfile {
  const nativeMapping: GestureProfile["mapping"] = {};
  Object.entries(mapping).forEach(([action, signature]) => {
    if (signature) nativeMapping[signature] = action as Action;
  });
  return {
    id: profileId,
    name: name.trim(),
    kind,
    deviceRef,
    gapMs: timing.gapMs,
    settleMs: timing.settleMs,
    mapping: nativeMapping,
    library: samples.map((sample) => ({
      prompted: sample.prompted,
      sig: sample.sig,
      presses: sample.presses,
      gaps: sample.gaps,
    })),
    verifiedAt,
    appVersion: status.appVersion ?? null,
    androidSdk: status.androidSdk ?? null,
  };
}

export default function GestureCalibrationPanel({
  practice,
  onStartPractice,
  status,
  requestedDeviceRef = "",
}: {
  practice: boolean;
  onStartPractice: () => void;
  status: { appVersion?: string | null; androidSdk?: number };
  requestedDeviceRef?: string;
}) {
  const [profiles, setProfiles] = useState<GestureProfile[]>([]);
  const [accessories, setAccessories] = useState<Accessory[]>([]);
  const [registeredDevices, setRegisteredDevices] = useState<EverydayDevice[]>([]);
  const [selectedAccessory, setSelectedAccessory] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileNameEdited, setProfileNameEdited] = useState(false);
  const [kind, setKind] = useState<GestureProfile["kind"]>("earbuds");
  const [activeMode, setActiveMode] = useState("auto");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingAction, setEditingAction] = useState<Action | null>(null);
  const [savedSetupsOpen, setSavedSetupsOpen] = useState(false);
  const [profileId, setProfileId] = useState(() => id());
  const [step, setStep] = useState<Step>("preflight");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [tapCount, setTapCount] = useState(1);
  const [maxTapCount, setMaxTapCount] = useState(3);
  const [sampleNumber, setSampleNumber] = useState(1);
  const [waiting, setWaiting] = useState(false);
  const [waitKind, setWaitKind] = useState<WaitKind>(null);
  const [pendingSample, setPendingSample] = useState<Sample | null>(null);
  const [noSignal, setNoSignal] = useState(false);
  const [warmupSignature, setWarmupSignature] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<Action, string>>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNeedsRetry, setBackupNeedsRetry] = useState(false);
  const [verifyActions, setVerifyActions] = useState<Action[]>([]);
  const [verifyActionIndex, setVerifyActionIndex] = useState(0);
  const [verifyHits, setVerifyHits] = useState(0);
  const [verifyResult, setVerifyResult] = useState("");
  const savedSetupsRef = useRef<HTMLDetailsElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const settingsSheetRef = useRef<HTMLElement>(null);
  const actionSheetRef = useRef<HTMLElement>(null);
  const returnScrollPositionRef = useRef<number | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const autoFocusedDeviceRef = useRef("");
  const previousStepRef = useRef(step);
  const waitKindRef = useRef<WaitKind>(null);
  const verifyActionRef = useRef<Action | null>(null);
  const verifyActionsRef = useRef<Action[]>([]);
  const verifyActionIndexRef = useRef(0);
  const verifyHitsRef = useRef(0);
  const tapCountRef = useRef(1);
  const profileIdRef = useRef(profileId);
  const mappingRef = useRef(mapping);
  const waitingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const finalizeVerificationRef = useRef<() => Promise<void>>(async () => undefined);
  const finalizingRef = useRef(false);
  tapCountRef.current = tapCount;
  mappingRef.current = mapping;
  verifyActionsRef.current = verifyActions;
  verifyActionIndexRef.current = verifyActionIndex;
  verifyHitsRef.current = verifyHits;

  const analysis = useMemo(() => analyze(samples), [samples]);
  const mappedErrors = useMemo(() => validateMapping(mapping, analysis.gestures), [mapping, analysis.gestures]);
  const connected = accessories.find((item) => (item.ref ?? "") === selectedAccessory);
  const generatedProfileName = connected?.label.trim() || "Bluetooth accessory";
  const profileNameForSave = resolveGestureProfileName(profileName, profileNameEdited, generatedProfileName);

  useEffect(() => {
    if (!requestedDeviceRef) return;
    setSelectedAccessory(requestedDeviceRef);
  }, [requestedDeviceRef]);

  const deviceConfigurations = useMemo(() => {
    const byRef = new Map<string, DeviceConfiguration>();
    const canonicalRef = (ref: string) => {
      const device = registeredDevices.find((item) => item.ref === ref || item.profileRef === ref);
      return device?.profileRef || ref;
    };
    const addDevice = (ref: string | null, label: string, deviceKind: string, isConnected: boolean) => {
      const key = ref ?? "unassigned";
      const existing = byRef.get(key);
      if (existing) {
        existing.connected ||= isConnected;
        if (existing.label === "Configured accessory" && label) existing.label = label;
        return;
      }
      byRef.set(key, { ref, label, kind: deviceKind, connected: isConnected, profiles: [] });
    };

    registeredDevices.forEach((device) => addDevice(
      device.profileRef || device.ref,
      device.name || device.btName || "Bluetooth accessory",
      device.kind,
      device.status === "connected",
    ));
    accessories.forEach((device) => addDevice(device.ref, device.label, device.kind, true));
    profiles.forEach((profile) => {
      const ref = profile.deviceRef ? canonicalRef(profile.deviceRef) : null;
      const key = ref ?? "unassigned";
      const group = byRef.get(key);
      if (group) {
        group.profiles.push(profile);
      } else {
        addDevice(ref, profile.name || "Configured accessory", profile.kind, false);
        byRef.get(key)?.profiles.push(profile);
      }
    });
    return [...byRef.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || a.label.localeCompare(b.label));
  }, [accessories, profiles, registeredDevices]);

  useEffect(() => {
    if (!requestedDeviceRef || autoFocusedDeviceRef.current === requestedDeviceRef) return;
    const device = registeredDevices.find((item) =>
      item.ref === requestedDeviceRef || item.profileRef === requestedDeviceRef
    );
    const canonicalRef = device?.profileRef || device?.ref || requestedDeviceRef;
    const profile = profiles.find((item) => {
      if (item.deviceRef === canonicalRef || item.deviceRef === requestedDeviceRef) return true;
      const assignedDevice = registeredDevices.find((candidate) =>
        candidate.ref === item.deviceRef || candidate.profileRef === item.deviceRef
      );
      return assignedDevice?.profileRef === canonicalRef || assignedDevice?.ref === requestedDeviceRef;
    });
    if (!profile) return;
    autoFocusedDeviceRef.current = requestedDeviceRef;
    setSavedSetupsOpen(true);
    const frame = requestAnimationFrame(() => {
      const row = [...(savedSetupsRef.current?.querySelectorAll<HTMLElement>("[data-profile-id]") ?? [])]
        .find((element) => element.dataset.profileId === profile.id);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [profiles, registeredDevices, requestedDeviceRef]);

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const frame = requestAnimationFrame(() => {
      stepHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      stepHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    const sheet = editingAction ? actionSheetRef.current : settingsOpen ? settingsSheetRef.current : null;
    if (!sheet) return;
    const frame = requestAnimationFrame(() => {
      const target = editingAction
        ? sheet.querySelector<HTMLButtonElement>(".option:not(:disabled)")
        : sheet;
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [editingAction, settingsOpen]);

  const syncProfiles = useCallback(async (next: GestureProfile[], deleteProfileIds: string[] = []) => {
    setError("");
    setBackupBusy(true);
    try {
      const response = await fetch("/api/trigger/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles: next, deleteProfileIds }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setBackupNeedsRetry(true);
        if (response.status === 401 || payload?.error === "unauthorized") {
          setMessage("Your setup is saved securely on this phone and alerts can keep using it. Sign in to back it up.");
        } else if (response.status === 409 || payload?.error === "android_trigger_not_registered") {
          setMessage("Your setup is saved securely on this phone and alerts can keep using it. Reconnect the Kiki trigger in Settings to back it up.");
        } else if (response.status === 400 || payload?.error === "bad_request") {
          setMessage("Your setup is saved securely on this phone and alerts can keep using it. Account backup could not accept it; retry after updating the setup.");
        } else if (response.status === 503 || payload?.error === "profile_backup_not_ready") {
          setMessage("Your setup is saved securely on this phone and alerts can keep using it. Account backup is not ready yet; try again later.");
        } else {
          setMessage("Your setup is saved securely on this phone and alerts can keep using it. Account backup did not finish; try again later.");
        }
        return;
      }
      setBackupNeedsRetry(false);
      setMessage(next.length ? "Saved on this phone and backed up to your account." : "Your account backup is up to date.");
    } catch {
      setBackupNeedsRetry(true);
      setMessage("Your setup is saved securely on this phone and alerts can keep using it. Account backup could not connect; check your connection and retry later.");
    } finally {
      setBackupBusy(false);
    }
  }, []);

  const loadAccessories = useCallback(async () => {
    try {
      const [{ devices }, { devices: savedDevices }] = await Promise.all([
        KikiTrigger.connectedAccessories(),
        KikiTrigger.devices(),
      ]);
      setAccessories(devices);
      setRegisteredDevices(savedDevices);
      if (devices[0]) {
        setSelectedAccessory((current) => current || devices[0].ref || "");
        if (devices[0].kind in { earbuds: true, wired: true, car: true, speaker: true, watch: true, ring: true, other: true }) {
          setKind((current) => current === "earbuds" ? devices[0].kind as GestureProfile["kind"] : current);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not find the connected accessory.");
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    const local = await KikiTrigger.getProfiles();
    setProfiles(local.profiles);
    setActiveMode(local.mode || "auto");
    let response: Response;
    try {
      response = await fetch("/api/trigger/profiles", { cache: "no-store" });
    } catch {
      setBackupNeedsRetry(local.profiles.length > 0);
      setMessage("Your button setups are saved on this phone. Account backup status could not be checked.");
      return;
    }
    if (!response.ok) {
      setBackupNeedsRetry(local.profiles.length > 0);
      setMessage("Your button setups are saved on this phone. Account backup status could not be checked.");
      return;
    }
    const payload = await response.json() as { profiles?: GestureProfile[] };
    const remoteProfiles = payload.profiles ?? [];
    const merged = new Map<string, GestureProfile>();
    for (const profile of remoteProfiles) merged.set(profile.id, { ...profile, verifiedAt: null });
    for (const profile of local.profiles) merged.set(profile.id, profile);
    const result = [...merged.values()].slice(0, 20);
    const remoteOnly = remoteProfiles.filter((profile) => !local.profiles.some((localProfile) => localProfile.id === profile.id));
    if (practice && remoteOnly.length > 0) {
      if (local.profiles.length === 0) {
        const imported = await KikiTrigger.importProfiles({ json: JSON.stringify(result) });
        setProfiles(imported.profiles);
      } else {
        for (const profile of remoteOnly) {
          await KikiTrigger.saveProfile({ profile: { ...profile, verifiedAt: null } });
        }
        const refreshed = await KikiTrigger.getProfiles();
        setProfiles(refreshed.profiles);
      }
    } else {
      setProfiles(result);
    }
  }, [practice]);

  useEffect(() => {
    void loadAccessories();
    let handle: { remove: () => void } | null = null;
    let active = true;
    void KikiTrigger.addListener("devices", () => { void loadAccessories(); }).then((subscription) => {
      if (active) handle = subscription;
      else void subscription.remove();
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not listen for accessory changes."));
    return () => {
      active = false;
      if (handle) void handle.remove();
    };
  }, [loadAccessories]);

  useEffect(() => {
    void loadProfiles().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load saved gesture profiles."));
  }, [loadProfiles]);

  useEffect(() => {
    const subscription = KikiTrigger.addListener("event", (event: TriggerEvent) => {
      if (event.type !== "sequence") return;
      const signature = event.signature ?? event.sequence ?? "";
      const active = waitKindRef.current;
      if (!waitingRef.current || !active) return;
      waitingRef.current = false;
      setWaiting(false);
      setWaitKind(null);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      void KikiTrigger.stopCapture();
      if (active === "warmup") {
        setWarmupSignature(signature);
        setMessage("Button detected. Continue to capture the patterns you want to use.");
        return;
      }
      if (active === "sample") {
        setPendingSample({
          prompted: tapCountRef.current,
          sig: signature,
          presses: event.presses ?? signature.replaceAll("-", "").length,
          gaps: event.gapsMs ?? [],
        });
        setNoSignal(false);
        return;
      }
      const action = verifyActionRef.current;
      const hit = Boolean(
        action &&
        event.matchStatus === "hit" &&
        event.profileId === profileIdRef.current &&
        event.pattern === action
      );
      if (!hit) {
        const expected = action ? mappingRef.current[action] : undefined;
        setVerifyHits(0);
        verifyHitsRef.current = 0;
        setVerifyResult(`Expected ${humanize(expected ?? "")}; received ${humanize(signature)}. Retry this pattern or adjust its assignment.`);
        return;
      }
      verifyHitsRef.current = 1;
      setVerifyHits(1);
      const nextActionIndex = verifyActionIndexRef.current + 1;
      if (nextActionIndex < verifyActionsRef.current.length) {
        verifyActionIndexRef.current = nextActionIndex;
        verifyActionRef.current = verifyActionsRef.current[nextActionIndex];
        setVerifyActionIndex(nextActionIndex);
        setVerifyResult(`${action} passed. Now verify ${verifyActionsRef.current[nextActionIndex]}.`);
      } else {
        setVerifyResult("Every assigned action passed its check.");
        if (finalizingRef.current) return;
        finalizingRef.current = true;
        void finalizeVerificationRef.current();
      }
    });

    return () => {
      void subscription.then((handle) => handle.remove());
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      waitingRef.current = false;
      waitKindRef.current = null;
      void KikiTrigger.stopCapture();
    };
  }, []);

  useEffect(() => {
    if (practice) {
      void loadProfiles().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not refresh gesture profiles."));
    }
  }, [practice, loadProfiles]);

  useEffect(() => {
    const needsRecheck = profiles.some((profile) => !isProfileCurrent(profile, status));
    if (needsRecheck) setSavedSetupsOpen(true);
  }, [profiles, status.appVersion, status.androidSdk]);

  function resetWizard() {
    setStep("preflight");
    setSamples([]);
    setTapCount(1);
    setMaxTapCount(3);
    setSampleNumber(1);
    setPendingSample(null);
    setMapping({});
    setWarmupSignature("");
    setNoSignal(false);
    setMessage("");
    setError("");
    setVerifyActions([]);
    verifyActionsRef.current = [];
    setVerifyActionIndex(0);
    verifyActionIndexRef.current = 0;
    setVerifyHits(0);
    verifyHitsRef.current = 0;
    finalizingRef.current = false;
    const newId = id();
    setProfileId(newId);
    profileIdRef.current = newId;
  }

  function rememberPagePosition() {
    returnScrollPositionRef.current = window.scrollY;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function restorePagePosition() {
    const position = returnScrollPositionRef.current;
    const focusTarget = returnFocusRef.current;
    returnScrollPositionRef.current = null;
    returnFocusRef.current = null;
    requestAnimationFrame(() => {
      focusTarget?.focus({ preventScroll: true });
      if (position !== null) window.scrollTo({ top: position, behavior: "auto" });
    });
  }

  function closeSettings() {
    setSettingsOpen(false);
    restorePagePosition();
  }

  function closeActionPicker() {
    setEditingAction(null);
    restorePagePosition();
  }

  async function beginCapture(kind: Exclude<WaitKind, null>) {
    if (!practice) {
      setError("Start Practice first. Practice mode cannot send real alerts.");
      return;
    }
    setError("");
    setPendingSample(null);
    setNoSignal(false);
    setWaiting(true);
    waitingRef.current = true;
    waitKindRef.current = kind;
    setWaitKind(kind);
    try {
      await KikiTrigger.startCapture({
        gapMs: analysis.timing.gapMs,
        settleMs: analysis.timing.settleMs,
        verification: kind === "verify",
        profileId: kind === "verify" ? profileIdRef.current : undefined,
      });
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        waitingRef.current = false;
        waitKindRef.current = null;
        setWaiting(false);
        setWaitKind(null);
        setNoSignal(true);
        setVerifyResult(kind === "verify" ? "No matching sequence arrived. Retry after adjusting your rhythm." : "");
        void KikiTrigger.stopCapture();
      }, 10_000);
    } catch (cause) {
      waitingRef.current = false;
      waitKindRef.current = null;
      setWaiting(false);
      setWaitKind(null);
      setError(cause instanceof Error ? cause.message : "Could not start safe gesture capture.");
    }
  }

  function appendSample(sample: Sample) {
    const next = [...samples, sample];
    setSamples(next);
    setPendingSample(null);
    setNoSignal(false);
    setMessage(sample.sig ? `Recorded sample ${sampleNumber} for ${tapCount} tap(s).` : `Recorded no signal for ${tapCount} tap(s).`);
    if (tapCount < maxTapCount) {
      setTapCount(tapCount + 1);
      setSampleNumber(1);
    } else {
      setStep("review");
      setMessage("Quick capture complete. Review the received event sequences and assign each action.");
    }
  }

  async function acceptNoSignal() {
    await KikiTrigger.stopCapture();
    appendSample({ prompted: tapCountRef.current, sig: "", presses: 0, gaps: [] });
  }

  async function saveDraftForVerification() {
    if (!practice) return setError("Start Practice before saving or verifying a gesture profile.");
    if (!profileNameForSave || !profileId) return setError("Enter a name for this profile.");
    if (!mapping.sos || !mapping.cancel) return setError("Assign both SOS and Cancel before verification.");
    if (mappedErrors.length) return setError(mappedErrors.join(" "));
    const existingProfile = profiles.find((profile) => profile.id === profileId);
    const deviceRef = connected ? connected.ref : existingProfile?.deviceRef ?? (selectedAccessory || null);
    const draft = asNativeProfile(profileId, profileNameForSave, kind, deviceRef, mapping, samples, analysis.timing, status, null);
    setBusy(true);
    setError("");
    try {
      const { profile: savedDraft } = await KikiTrigger.saveProfile({ profile: draft });
      setProfiles((previous) => [...previous.filter((profile) => profile.id !== savedDraft.id), savedDraft]);
      const actions = ACTIONS.map(({ id: action }) => action).filter((action) => mapping[action]);
      setVerifyActions(actions);
      verifyActionsRef.current = actions;
      setVerifyActionIndex(0);
      verifyActionIndexRef.current = 0;
      verifyActionRef.current = actions[0] ?? null;
      profileIdRef.current = draft.id;
      setVerifyHits(0);
      verifyHitsRef.current = 0;
      finalizingRef.current = false;
      setVerifyResult("");
      setStep("verify");
      await syncProfiles([...profiles.filter((profile) => profile.id !== savedDraft.id), savedDraft]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the draft profile for verification.");
    } finally {
      setBusy(false);
    }
  }

  async function finalizeVerification() {
    const existingProfile = profiles.find((profile) => profile.id === profileId);
    const deviceRef = connected ? connected.ref : existingProfile?.deviceRef ?? (selectedAccessory || null);
    const verified = asNativeProfile(profileId, profileNameForSave, kind, deviceRef, mapping, samples, analysis.timing, status, Date.now());
    try {
      await KikiTrigger.saveProfile({ profile: verified });
      const next = [...profiles.filter((profile) => profile.id !== verified.id), verified];
      setProfiles(next);
      setStep("done");
      setMessage("Gesture profile is verified and saved on this phone.");
      await syncProfiles(next);
    } catch (cause) {
      finalizingRef.current = false;
      setError(cause instanceof Error ? cause.message : "The verification passed, but the profile could not be finalized.");
    }
  }
  finalizeVerificationRef.current = finalizeVerification;

  async function retryFailedVerification() {
    if (!verifyActionRef.current) return;
    setNoSignal(false);
    await beginCapture("verify");
  }

  async function deleteSavedProfile(profile: GestureProfile) {
    if (!practice) return setError("Start Practice before changing profiles.");
    setBusy(true);
    setError("");
    try {
      await KikiTrigger.deleteProfile({ id: profile.id });
      const next = profiles.filter(({ id: savedId }) => savedId !== profile.id);
      setProfiles(next);
      await syncProfiles(next, [profile.id]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that profile.");
    } finally {
      setBusy(false);
    }
  }

  async function renameSavedProfile(profile: GestureProfile, name: string) {
    const updated = { ...profile, name: name.trim() };
    if (!updated.name || updated.name.length > 40) {
      setError("Enter a profile name between 1 and 40 characters.");
      return;
    }
    try {
      await KikiTrigger.saveProfile({ profile: updated });
      const next = profiles.map((item) => item.id === updated.id ? updated : item);
      setProfiles(next);
      await syncProfiles(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename the profile.");
    }
  }

  async function acceptRecommendations() {
    setMapping(quickPresetAssignments(analysis.gestures));
    setMessage("Suggested 3-tap SOS and 2-tap Cancel patterns use the exact events your accessory sent. You can change any assignment.");
  }

  function editSavedProfile(profile: GestureProfile) {
    const assigned: Partial<Record<Action, string>> = {};
    Object.entries(profile.mapping).forEach(([signature, action]) => { assigned[action as Action] = signature; });
    const device = registeredDevices.find((item) => item.ref === profile.deviceRef || item.profileRef === profile.deviceRef);
    setProfileId(profile.id);
    profileIdRef.current = profile.id;
    setProfileName(profile.name);
    setProfileNameEdited(true);
    setKind(profile.kind);
    setSelectedAccessory(device?.profileRef || device?.ref || profile.deviceRef || "");
    setMapping(assigned);
    setSamples(profile.library.map((sample) => ({ prompted: sample.prompted, sig: sample.sig, presses: sample.presses, gaps: sample.gaps })));
    setTapCount(1);
    setMaxTapCount(3);
    setStep("review");
    setMessage(`Edit the SOS and other event assignments for ${profile.name}. Each assigned pattern is checked once.`);
  }

  function startDeviceConfiguration(device: DeviceConfiguration) {
    resetWizard();
    setSelectedAccessory(device.ref ?? "");
    setProfileName(device.label || "Bluetooth accessory");
    setProfileNameEdited(false);
    setKind(device.kind in { earbuds: true, wired: true, car: true, speaker: true, watch: true, ring: true, other: true }
      ? device.kind as GestureProfile["kind"]
      : "other");
    setSettingsOpen(false);
    setMessage(device.connected ? "Device selected. Check its button event to begin." : "Device configuration retained. Connect the accessory to capture its events.");
  }

  const activeVerifyAction = verifyActions[verifyActionIndex];
  const mappedReady = Boolean(mapping.sos && mapping.cancel && mappedErrors.length === 0);
  const currentStep = step === "preflight" ? "warmup" : step;
  const currentStepIndex = currentStep === "warmup" ? 0
    : currentStep === "calibrate" ? 1
      : currentStep === "review" ? 2
        : 3;

  function assignGesture(action: Action, signature: string | undefined) {
    setMapping((previous) => {
      const next = { ...previous };
      if (signature) next[action] = signature;
      else delete next[action];
      return next;
    });
    closeActionPicker();
  }

  return (
    <section className={styles.wizard}>
      <ol className={styles.steps} aria-label="Setup progress">
        {(["Connect", "Capture", "Choose", "Verify"] as const).map((label, index) => {
          const done = currentStep === "done" || index < currentStepIndex;
          const current = !done && index === currentStepIndex;
          return <li className={`${styles.step} ${done ? styles.stepDone : ""} ${current ? styles.stepCurrent : ""}`} key={label} aria-current={current ? "step" : undefined}>
            <i className={styles.stepMarker}>{done ? <Check size={15} /> : index + 1}</i>{label}
          </li>;
        })}
      </ol>

      <button className={styles.settingsButton} type="button" onClick={() => {
        rememberPagePosition();
        setSettingsOpen(true);
      }}>
        <span>Accessory and profile settings</span><ChevronDown size={18} />
      </button>
      {practice && accessories.length === 0 && <p className={`${styles.message} ${styles.messageWarning}`}><AlertCircle size={17} />Connect your accessory, then refresh the accessory list in settings.</p>}

      {(step === "preflight" || step === "warmup") && <section className={styles.card} aria-labelledby="trigger-connect-title">
        <h2 className={styles.cardTitle} id="trigger-connect-title" ref={stepHeadingRef} tabIndex={-1}>1 · Check connection</h2>
        <p className={styles.cardCopy}>Press your accessory once so Kiki can check that it receives the button signal.</p>
        {selectedAccessory && !connected && <p className={`${styles.message} ${styles.messageWarning}`} role="status"><AlertCircle size={17} />The selected accessory is not connected. Connect it or choose a connected device in settings before capturing.</p>}
        {waiting && waitKind === "warmup" ? <div className={styles.listening} role="status"><i className={styles.listenDot} /><i className={styles.listenDot} /><i className={styles.listenDot} />Listening…</div> : <>
          {warmupSignature
            ? <div className={`${styles.message} ${styles.messageSuccess}`} role="status"><Check size={17} />Button detected. Continue to capture the patterns you want to use.</div>
            : <button className={styles.primaryButton} type="button" disabled={!practice || !connected || waiting} onClick={() => void beginCapture("warmup")}>Check button</button>}
        </>}
        {noSignal && !warmupSignature && <p className={`${styles.message} ${styles.messageWarning}`} role="status"><AlertCircle size={17} />Kiki did not receive a signal. Try again with music apps closed. Some controls may not be sent to Android.</p>}
      </section>}

      {step === "calibrate" && <section className={styles.card} aria-labelledby="trigger-capture-title">
        <h2 className={styles.cardTitle} id="trigger-capture-title" ref={stepHeadingRef} tabIndex={-1}>2 · Capture patterns</h2>
        <p className={styles.cardCopy}>Press <b>{tapCount} time{tapCount === 1 ? "" : "s"}</b>, then pause. One short sample per pattern.</p>
        <div className={styles.pips} aria-label={`Tap count ${tapCount} of 6`}>
          {Array.from({ length: 6 }, (_, index) => {
            const width = index < tapCount - 1 ? 100 : 0;
            return <span className={styles.pip} key={index}><i className={styles.pipFill} style={{ width: `${width}%` }} /></span>;
          })}
        </div>
        {waiting && waitKind === "sample" ? <div className={styles.listening} role="status"><i className={styles.listenDot} /><i className={styles.listenDot} /><i className={styles.listenDot} />Listening…</div> : pendingSample ? <div className={styles.samplePreview}>
          <p>Kiki detected: <b>{humanize(pendingSample.sig) || "No signal"}</b>.</p>
          <div className={styles.sampleActions}>
            <button className={styles.primaryButton} type="button" onClick={() => appendSample(pendingSample)}>Use this sample</button>
            <button className={styles.secondaryButton} type="button" onClick={() => { setPendingSample(null); setNoSignal(false); }}>Try again</button>
          </div>
        </div> : <div className={styles.buttonRow}>
          <button className={styles.primaryButton} type="button" disabled={!practice || waiting} onClick={() => void beginCapture("sample")}>Start capture</button>
          {noSignal && <button className={styles.warningButton} type="button" onClick={() => void acceptNoSignal()}>Record no signal</button>}
        </div>}
        {noSignal && <p className={`${styles.message} ${styles.messageWarning}`} role="status"><AlertCircle size={17} />No button signal arrived. Try again, or record it as unavailable.</p>}
        <p className={styles.fieldHelp}>Kiki records the event sequence your accessory sends for each tap pattern.</p>
      </section>}

      {step === "review" && <section className={styles.card} aria-labelledby="trigger-choose-title">
        <h2 className={styles.cardTitle} id="trigger-choose-title" ref={stepHeadingRef} tabIndex={-1}>3 · Choose actions</h2>
        <p className={styles.cardCopy}>Choose from the exact ordered events your accessory sent. Play/Pause and volume sequences stay distinct.</p>
        <label className={`${styles.field} ${styles.profileNameField}`}>Profile name
          <input
            maxLength={40}
            value={resolveGestureProfileName(profileName, profileNameEdited, generatedProfileName)}
            onChange={(event) => { setProfileName(event.target.value); setProfileNameEdited(true); }}
            placeholder="Name this setup"
          />
        </label>
        {profileNameEdited && !profileName.trim() && <p className={`${styles.message} ${styles.messageError}`} role="alert">Enter a profile name between 1 and 40 characters.</p>}
        {analysis.gestures.length === 0 ? <p className={styles.messageWarning}>No complete gesture samples were detected yet.</p> : <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Requested taps</th><th>Actual event sequence</th><th>Capture</th></tr></thead>
            <tbody>
              {analysis.gestures.map((gesture) => <tr key={`${gesture.taps}-${gesture.sig}`}>
                <td>{gesture.taps} tap{gesture.taps === 1 ? "" : "s"}</td>
                <td>{humanize(gesture.sig)}</td>
                <td><span className={styles.repeatable}>{gesture.total > 1 ? `${gesture.samples}/${gesture.total} matched` : "Captured once"}</span></td>
              </tr>)}
              {analysis.unseen.map((count) => <tr key={`unseen-${count}`}>
                <td className={styles.dimmed}>{count} taps</td><td className={styles.dimmed}>No signal</td><td className={styles.dimmed}>—</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
        {analysis.unseen.length > 0 && <p className={`${styles.message} ${styles.messageWarning}`}><AlertCircle size={17} />No events were received for {analysis.unseen.join(", ")} taps. Those gestures cannot be assigned.</p>}
        {analysis.indistinguishable.map(({ sig, taps }) => <p className={`${styles.message} ${styles.messageWarning}`} key={sig}><AlertCircle size={17} />Tap counts {taps.join(" and ")} produced the same signal ({humanize(sig)}), so Kiki cannot distinguish them.</p>)}
        <button className={`${styles.secondaryButton} ${styles.suggestActionsButton}`} type="button" onClick={() => void acceptRecommendations()} disabled={!analysis.gestures.length}>Suggest actions</button>
        <div className={styles.actionList}>
          {ACTIONS.map(({ id: action, label }) => {
            const signature = mapping[action];
            const gesture = analysis.gestures.find((item) => item.sig === signature);
            return <button
              className={`${styles.actionButton} ${signature ? styles.actionButtonSelected : ""}`}
              type="button"
              key={action}
              onClick={() => {
                rememberPagePosition();
                setEditingAction(action);
              }}
              aria-label={`Choose gesture for ${label}. Current: ${gesture ? `${gesture.taps} taps, ${humanize(gesture.sig)}` : "Not assigned"}`}
            >
              <span className={styles.actionBody}>
                <small className={styles.actionLabel}>{label}</small>
                <b className={styles.actionValue}>{gesture ? `${gesture.taps} tap${gesture.taps === 1 ? "" : "s"} · ${humanize(gesture.sig)}` : "Not assigned"}</b>
              </span>
              <ChevronRight size={18} className={styles.actionChevron} />
            </button>;
          })}
        </div>
        {mappedErrors.map((item) => <p className={`${styles.message} ${styles.messageError}`} key={item}><AlertCircle size={17} />{item}</p>)}
        {maxTapCount === 3 && <button className={`${styles.secondaryButton} ${styles.captureMoreButton}`} type="button" disabled={!practice || waiting || busy} onClick={() => {
          setTapCount(4);
          setSampleNumber(1);
          setMaxTapCount(6);
          setStep("calibrate");
          setMessage("Capture extra 4–6 tap patterns only if this accessory supports them.");
        }}>Capture optional 4–6 tap patterns</button>}
      </section>}

      {step === "verify" && <section className={styles.card} aria-labelledby="trigger-verify-title">
        <h2 className={styles.cardTitle} id="trigger-verify-title" ref={stepHeadingRef} tabIndex={-1}>4 · Safety check</h2>
        <p className={styles.cardCopy}>Perform each assigned event pattern once. Kiki checks the exact event sequence for this action.</p>
        <div className={styles.verificationList}>
          {verifyActions.map((action, index) => {
            const done = index < verifyActionIndex;
            const current = index === verifyActionIndex;
            const signature = mapping[action];
            const gesture = analysis.gestures.find((item) => item.sig === signature);
            return <div className={styles.verificationRow} key={action}>
              <span className={`${styles.verificationIcon} ${done ? styles.verificationIconDone : current ? styles.verificationIconCurrent : ""}`}>
                {done ? <Check size={17} /> : index + 1}
              </span>
              <span className={styles.verificationBody}><b>{ACTIONS.find((item) => item.id === action)?.label}</b><span>{gesture ? `${gesture.taps} tap${gesture.taps === 1 ? "" : "s"} · ${humanize(gesture.sig)}` : "Assigned gesture"}</span></span>
              <span className={styles.verificationPips} aria-label={current ? `${verifyHits} of 1 confirmed` : done ? "Complete" : "Not started"}>
                <i className={done || (current && verifyHits > 0) ? styles.pipPassed : ""} />
              </span>
            </div>;
          })}
        </div>
        {verifyResult && <p className={`${styles.message} ${verifyResult.startsWith("That attempt") || verifyResult.startsWith("No matching") ? styles.messageWarning : styles.messageInfo}`} role="status">
          {verifyResult.startsWith("That attempt") || verifyResult.startsWith("No matching") ? <AlertCircle size={17} /> : <CircleHelp size={17} />}{verifyResult}
        </p>}
        {activeVerifyAction && <p className={styles.verifyPrompt}>Safety check {verifyActionIndex + 1}/{verifyActions.length}: perform <b>{ACTIONS.find((item) => item.id === activeVerifyAction)?.label}</b> once.</p>}
        {waiting && waitKind === "verify" ? <div className={styles.listening} role="status"><i className={styles.listenDot} /><i className={styles.listenDot} /><i className={styles.listenDot} />Listening…</div> : <button className={styles.primaryButton} type="button" disabled={!practice || busy || !activeVerifyAction} onClick={() => void retryFailedVerification()}><ShieldCheck size={18} />Check {ACTIONS.find((item) => item.id === activeVerifyAction)?.label ?? "button"} pattern</button>}
        {verifyResult.startsWith("Expected ") && <button className={`${styles.secondaryButton} ${styles.adjustAssignmentsButton}`} type="button" disabled={busy || waiting} onClick={() => setStep("review")}>Adjust event assignments</button>}
        {noSignal && <p className={`${styles.message} ${styles.messageWarning}`} role="status"><AlertCircle size={17} />No signal arrived. Try again.</p>}
      </section>}

      {step === "done" && <section className={styles.card} aria-labelledby="trigger-done-title">
        <div className={styles.verificationIcon + " " + styles.verificationIconDone} style={{ width: 64, height: 64, margin: "4px auto 14px" }}><Check size={30} /></div>
        <h2 className={styles.cardTitle} id="trigger-done-title" ref={stepHeadingRef} tabIndex={-1} style={{ textAlign: "center" }}>Setup complete</h2>
        <p className={styles.cardCopy} style={{ textAlign: "center" }}>SOS and Cancel are verified for this phone and accessory.</p>
      </section>}

      {profiles.length > 0 && <details ref={savedSetupsRef} className={`${styles.card} ${styles.savedCard}`} open={savedSetupsOpen} onToggle={(event) => setSavedSetupsOpen(event.currentTarget.open)}>
        <summary className={styles.savedHeader}><span className={styles.savedTitle}>Saved button setups ({profiles.length})</span><ChevronDown size={17} /></summary>
        <div className={styles.savedRows}>
          {profiles.map((profile) => {
            const verified = isProfileCurrent(profile, status);
            return <div className={styles.savedRow} key={profile.id} data-profile-id={profile.id}>
              <label className={styles.savedName}><input defaultValue={profile.name} maxLength={40} disabled={!practice || busy} aria-label={`Name for ${profile.name}`} onBlur={(event) => {
                if (event.target.value !== profile.name) void renameSavedProfile(profile, event.target.value);
              }} /></label>
              <span className={`${styles.badge} ${verified ? "" : styles.badgeNeedsCheck}`}>{verified ? "Ready" : "Needs re-check"}</span>
              <button className={styles.secondaryButton} type="button" disabled={!practice || busy} onClick={() => editSavedProfile(profile)}>{verified ? "Edit" : "Re-check"}</button>
              <button className={`${styles.iconButton} ${styles.iconButtonDanger}`} type="button" disabled={!practice || busy} aria-label={`Delete ${profile.name}`} onClick={() => void deleteSavedProfile(profile)}><Trash2 size={15} /></button>
            </div>;
          })}
        </div>
        <p className={styles.phoneSaved}>Your button setups are saved on this phone.</p>
      </details>}

      {message && <p className={`${styles.message} ${backupNeedsRetry ? styles.messageWarning : styles.messageInfo}`} role="status">
        {backupNeedsRetry ? <CircleHelp size={17} /> : <Check size={17} />}{message}
      </p>}
      {error && <p className={`${styles.message} ${styles.messageError}`} role="alert"><AlertCircle size={17} />{error}</p>}
      {backupNeedsRetry && profiles.length > 0 && <button className={styles.secondaryButton} type="button" disabled={busy || backupBusy} onClick={() => void syncProfiles(profiles)}>{backupBusy ? "Retrying account backup…" : "Retry account backup"}</button>}
      {busy && <p className={styles.phoneSaved} role="status">Saving gesture profile…</p>}

      <div className={styles.footer}>
        {(step === "preflight" || step === "warmup") && <button className={styles.primaryButton} type="button" disabled={!warmupSignature || !practice || busy} onClick={() => { setStep("calibrate"); setNoSignal(false); setMessage(""); }}>Continue</button>}
        {step === "review" && <button className={styles.primaryButton} type="button" disabled={!practice || busy || !mappedReady || !profileNameForSave} onClick={() => void saveDraftForVerification()}><ShieldCheck size={18} />Continue to safety check</button>}
        {step === "done" && <Link className={styles.primaryButton} href="/account/profile/triggers">Done</Link>}
        {(step === "calibrate" || step === "verify") && <button className={styles.ghostButton} type="button" disabled={busy || waiting} onClick={resetWizard}><RotateCcw size={15} />Reset setup</button>}
      </div>

      {settingsOpen && typeof document !== "undefined" && createPortal(<div className={styles.settingsOverlay} role="presentation" onClick={closeSettings} onKeyDown={(event) => { if (event.key === "Escape") closeSettings(); }}>
        <section className={styles.sheet} ref={settingsSheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="trigger-settings-title" onClick={(event) => event.stopPropagation()}>
          <div className={styles.grabber} />
          <header className={styles.sheetHeader}><h2 className={styles.sheetTitle} id="trigger-settings-title">Accessory and profile</h2><button className={styles.sheetClose} type="button" onClick={closeSettings} aria-label="Close settings"><X size={19} /></button></header>
          <div className={styles.formGrid}>
            <label className={styles.field}>Connected accessory
              <select disabled={!practice || accessories.length === 0} value={selectedAccessory} onChange={(event) => {
                const ref = event.target.value;
                setSelectedAccessory(ref);
                if (!profileNameEdited) {
                  setProfileName(accessories.find((item) => (item.ref ?? "") === ref)?.label ?? "");
                }
              }}>
                {accessories.length === 0 && <option value="">No accessory detected</option>}
                {accessories.map((accessory, index) => <option key={`${accessory.ref ?? "any"}-${index}`} value={accessory.ref ?? ""}>{accessory.label} · {accessory.kind}</option>)}
              </select>
            </label>
            <button className={styles.ghostButton} type="button" disabled={!practice} onClick={() => void loadAccessories()}>Refresh accessories</button>
            <label className={styles.field}>Profile name
              <input maxLength={40} value={resolveGestureProfileName(profileName, profileNameEdited, generatedProfileName)} onChange={(event) => {
                setProfileName(event.target.value);
                setProfileNameEdited(true);
              }} placeholder="Name this setup" />
            </label>
            <label className={styles.field}>Accessory type
              <select value={kind} onChange={(event) => setKind(event.target.value as GestureProfile["kind"])}>
                {["earbuds", "wired", "car", "speaker", "watch", "ring", "other"].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className={styles.field}>Use profile
              <select disabled={!practice || busy} value={activeMode} onChange={(event) => {
                const mode = event.target.value;
                setBusy(true);
                void KikiTrigger.setActiveMode({ mode })
                  .then(() => setActiveMode(mode))
                  .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not select the gesture profile."))
                  .finally(() => setBusy(false));
              }}>
                <option value="auto">Auto · connected accessory</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </label>
            <p className={styles.fieldHelp}>Close music apps before capturing button patterns. Practice mode cannot send real alerts.</p>
          </div>
          <section className={styles.deviceConfigurations} aria-labelledby="trigger-device-configurations-title">
            <h3 id="trigger-device-configurations-title">Connected Devices</h3>
            {deviceConfigurations.length === 0 && <p className={styles.fieldHelp}>Connect an accessory or refresh the list. Previously configured devices stay available here.</p>}
            {deviceConfigurations.map((device) => (
              <details className={styles.deviceConfiguration} key={device.ref ?? "unassigned"} open={Boolean(requestedDeviceRef && device.ref === requestedDeviceRef)}>
                <summary>
                  <span>{device.label}</span>
                  <small>{device.connected ? "Connected" : "Not connected"} · {device.profiles.length} profile{device.profiles.length === 1 ? "" : "s"}</small>
                </summary>
                {device.profiles.map((profile) => (
                  <div className={styles.deviceProfile} key={profile.id}>
                    <b>{profile.name}</b>
                    <span>{Object.entries(profile.mapping).map(([signature, action]) => `${ACTIONS.find((item) => item.id === action)?.label ?? action}: ${humanize(signature)}`).join(" · ") || "No actions assigned"}</span>
                    <button className={styles.secondaryButton} type="button" disabled={!practice || busy} onClick={() => { editSavedProfile(profile); setSettingsOpen(false); }}>
                      Edit this profile
                    </button>
                  </div>
                ))}
                <button className={styles.ghostButton} type="button" disabled={!practice || busy} onClick={() => startDeviceConfiguration(device)}>
                  {device.profiles.length ? "Add another profile" : "Create device profile"}
                </button>
              </details>
            ))}
          </section>
          <div className={styles.sheetButtons}><button className={styles.primaryButton} type="button" onClick={closeSettings}>Save settings</button></div>
        </section>
      </div>, document.body)}

      {editingAction && typeof document !== "undefined" && createPortal(<div className={styles.settingsOverlay} role="presentation" onClick={closeActionPicker} onKeyDown={(event) => { if (event.key === "Escape") closeActionPicker(); }}>
        <section className={styles.sheet} ref={actionSheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="trigger-action-title" onClick={(event) => event.stopPropagation()}>
          <div className={styles.grabber} />
          <header className={styles.sheetHeader}><h2 className={styles.sheetTitle} id="trigger-action-title">{ACTIONS.find((item) => item.id === editingAction)?.label}</h2><button className={styles.sheetClose} type="button" onClick={closeActionPicker} aria-label="Close gesture options"><X size={19} /></button></header>
          <div className={styles.options}>
            <button className={`${styles.option} ${!mapping[editingAction] ? styles.optionActive : ""}`} type="button" onClick={() => assignGesture(editingAction, undefined)}>
              <span className={styles.optionBody}><b>Not assigned</b></span><i className={styles.radio} />
            </button>
            {analysis.gestures.map((gesture) => {
              const assignedElsewhere = Object.entries(mapping).some(([other, signature]) => other !== editingAction && signature === gesture.sig);
              return <button
                className={`${styles.option} ${mapping[editingAction] === gesture.sig ? styles.optionActive : ""}`}
                key={gesture.sig}
                type="button"
                disabled={assignedElsewhere}
                onClick={() => assignGesture(editingAction, gesture.sig)}
              >
                <span className={styles.optionBody}>
                  <b>{gesture.taps} tap{gesture.taps === 1 ? "" : "s"} · {humanize(gesture.sig)}</b>
                  <span>{assignedElsewhere ? "Used by another action" : gesture.grade === "C" ? "Easy to trigger by accident" : `${Math.round(gesture.reliability * 100)}% repeatable`}</span>
                </span>
                <i className={styles.radio} />
              </button>;
            })}
          </div>
        </section>
      </div>, document.body)}
    </section>
  );
}
