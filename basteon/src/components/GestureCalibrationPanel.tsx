"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bluetooth, Download, RotateCcw, Send, ShieldCheck, Trash2, Upload } from "lucide-react";
import { KikiTrigger, type GestureProfile, type TriggerEvent } from "@/lib/kikiTrigger";
import {
  analyze,
  profileTrust,
  recommend,
  validateMapping,
  type Action,
  type GestureStat,
  type Sample,
} from "@/lib/triggerGestures/analyze";

const ACTIONS: { id: Action; label: string }[] = [
  { id: "sos", label: "SOS" },
  { id: "medical", label: "Medical alert" },
  { id: "duress", label: "Discreet SOS" },
  { id: "cancel", label: "Cancel countdown" },
];

type Step = "preflight" | "warmup" | "calibrate" | "review" | "verify" | "done";
type WaitKind = "warmup" | "sample" | "verify" | "hold" | null;
type Accessory = { ref: string | null; label: string; kind: string };

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `gesture-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function gradeLabel(grade: GestureStat["grade"]) {
  return grade === "A" ? "A · reliable" : grade === "B" ? "B · usable" : "C · avoid";
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
  status: { appVersion?: string | null; androidSdk?: number; phoneModel?: string | null },
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
}: {
  practice: boolean;
  onStartPractice: () => void;
  status: { appVersion?: string | null; androidSdk?: number; phoneModel?: string | null };
}) {
  const [profiles, setProfiles] = useState<GestureProfile[]>([]);
  const [accessories, setAccessories] = useState<Accessory[]>([]);
  const [selectedAccessory, setSelectedAccessory] = useState("");
  const [profileName, setProfileName] = useState("");
  const [kind, setKind] = useState<GestureProfile["kind"]>("earbuds");
  const [profileId, setProfileId] = useState("");
  const [step, setStep] = useState<Step>("preflight");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [tapCount, setTapCount] = useState(1);
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
  const [rawEvents, setRawEvents] = useState<string[]>([]);
  const [trace, setTrace] = useState<Array<{ at: string; layer: string; status: string }>>([]);
  const [verifyActions, setVerifyActions] = useState<Action[]>([]);
  const [verifyActionIndex, setVerifyActionIndex] = useState(0);
  const [verifyHits, setVerifyHits] = useState(0);
  const [verifyResult, setVerifyResult] = useState("");
  const [holdChecks, setHoldChecks] = useState(0);
  const [holdSeen, setHoldSeen] = useState(0);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const waitKindRef = useRef<WaitKind>(null);
  const verifyActionRef = useRef<Action | null>(null);
  const verifyActionsRef = useRef<Action[]>([]);
  const verifyActionIndexRef = useRef(0);
  const verifyHitsRef = useRef(0);
  const tapCountRef = useRef(1);
  const profileIdRef = useRef("");
  const waitingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const finalizeVerificationRef = useRef<() => Promise<void>>(async () => undefined);
  const finalizingRef = useRef(false);
  tapCountRef.current = tapCount;
  verifyActionsRef.current = verifyActions;
  verifyActionIndexRef.current = verifyActionIndex;
  verifyHitsRef.current = verifyHits;

  const analysis = useMemo(() => analyze(samples), [samples]);
  const recommendations = useMemo(() => recommend(analysis.gestures), [analysis.gestures]);
  const mappedErrors = useMemo(() => validateMapping(mapping, analysis.gestures), [mapping, analysis.gestures]);
  const trust = useMemo(
    () => profileTrust(analysis.gestures, mapping, step === "done"),
    [analysis.gestures, mapping, step],
  );
  const connected = accessories.find((item) => item.ref === selectedAccessory);

  const syncProfiles = useCallback(async (next: GestureProfile[]) => {
    const response = await fetch("/api/trigger/profiles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profiles: next }),
    });
    if (response.status === 409) {
      setMessage("Saved on this phone. Sign in to Kiki and register the Android trigger to enable account backup.");
      return;
    }
    if (!response.ok) throw new Error("Profile saved on this phone, but server backup failed.");
  }, []);

  const loadProfiles = useCallback(async () => {
    const local = await KikiTrigger.getProfiles();
    setProfiles(local.profiles);
    const response = await fetch("/api/trigger/profiles", { cache: "no-store" });
    if (response.status === 401) {
      setMessage("Profiles are saved on this phone. Sign in on Kiki to access encrypted server backup.");
      return;
    }
    if (!response.ok) throw new Error("Phone profiles loaded, but server backup could not be checked.");
    const payload = await response.json() as { profiles?: GestureProfile[] };
    const merged = new Map(local.profiles.map((profile) => [profile.id, profile]));
    for (const profile of payload.profiles ?? []) {
      if (!merged.has(profile.id)) merged.set(profile.id, profile);
    }
    const result = [...merged.values()].slice(0, 20);
    if (local.profiles.length === 0 && result.length > 0 && practice) {
      const imported = await KikiTrigger.importProfiles({ json: JSON.stringify(result) });
      setProfiles(imported.profiles);
    } else {
      setProfiles(local.profiles);
    }
  }, [practice]);

  useEffect(() => {
    void KikiTrigger.connectedAccessories()
      .then(({ devices }) => {
        setAccessories(devices);
        if (devices[0]) {
          setSelectedAccessory(devices[0].ref ?? "");
          setProfileName(devices[0].label);
          if (devices[0].kind in { earbuds: true, wired: true, car: true, speaker: true, watch: true, ring: true, other: true }) {
            setKind(devices[0].kind as GestureProfile["kind"]);
          }
        }
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not identify connected audio accessories."));
    void KikiTrigger.getTrace().then(({ entries }) => setTrace(entries)).catch(() => setTrace([]));
  }, []);

  useEffect(() => {
    void loadProfiles().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load saved gesture profiles."));
  }, [loadProfiles]);

  useEffect(() => {
    const subscription = KikiTrigger.addListener("event", (event: TriggerEvent) => {
      if (event.type === "raw") {
        const description = `${new Date().toLocaleTimeString()} · ${event.tok ?? "?"} · ${event.src ?? "unknown"} · ${event.keyCode ?? "key"}${event.heldMs ? ` · held ${event.heldMs}ms` : ""}`;
        setRawEvents((previous) => [description, ...previous].slice(0, 12));
        return;
      }
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
        setMessage(`Kiki received ${humanize(signature)} (${signature}).`);
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
      if (active === "hold") {
        setHoldChecks((count) => count + 1);
        if (signature.includes("H")) setHoldSeen((count) => count + 1);
        setMessage(signature.includes("H")
          ? `Kiki received a hold token in ${signature}.`
          : `Kiki received ${signature}, but not a distinct hold token.`);
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
        verifyHitsRef.current = 0;
        setVerifyHits(0);
        verifyActionIndexRef.current = 0;
        setVerifyActionIndex(0);
        verifyActionRef.current = verifyActionsRef.current[0] ?? null;
        setVerifyResult("That attempt did not match the selected action. All verification progress reset; start again with the first assigned action.");
        return;
      }
      const next = verifyHitsRef.current + 1;
      if (next < 3) {
        verifyHitsRef.current = next;
        setVerifyHits(next);
        setVerifyResult(`Verified ${next} of 3 consecutive ${action} gestures.`);
        return;
      }
      verifyHitsRef.current = 0;
      setVerifyHits(0);
      const nextActionIndex = verifyActionIndexRef.current + 1;
      if (nextActionIndex < verifyActionsRef.current.length) {
        verifyActionIndexRef.current = nextActionIndex;
        verifyActionRef.current = verifyActionsRef.current[nextActionIndex];
        setVerifyActionIndex(nextActionIndex);
        setVerifyResult(`${action} passed. Now verify ${verifyActionsRef.current[nextActionIndex]}.`);
      } else {
        setVerifyResult("Every assigned action passed three consecutive tests.");
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

  function resetWizard() {
    setStep("preflight");
    setSamples([]);
    setTapCount(1);
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
    setHoldChecks(0);
    setHoldSeen(0);
    const newId = id();
    setProfileId(newId);
    profileIdRef.current = newId;
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
    if (sampleNumber < 3) {
      setSampleNumber(sampleNumber + 1);
    } else if (tapCount < 6) {
      setTapCount(tapCount + 1);
      setSampleNumber(1);
    } else {
      setStep("review");
      setMessage("Calibration samples complete. Review stability and choose distinct gestures.");
    }
  }

  async function acceptNoSignal() {
    await KikiTrigger.stopCapture();
    appendSample({ prompted: tapCountRef.current, sig: "", presses: 0, gaps: [] });
  }

  async function saveDraftForVerification() {
    if (!practice) return setError("Start Practice before saving or verifying a gesture profile.");
    if (!profileName.trim() || !profileId) return setError("Enter a name for this profile.");
    if (!mapping.sos || !mapping.cancel) return setError("Assign both SOS and Cancel before verification.");
    if (mappedErrors.length) return setError(mappedErrors.join(" "));
    const draft = asNativeProfile(
      profileId, profileName, kind, connected?.ref || null, mapping, samples, analysis.timing, status, null,
    );
    setBusy(true);
    setError("");
    try {
      await KikiTrigger.saveProfile({ profile: draft });
      await KikiTrigger.setActiveMode({ mode: "auto" });
      setProfiles((previous) => [...previous.filter((profile) => profile.id !== draft.id), draft]);
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
      await syncProfiles([...profiles.filter((profile) => profile.id !== draft.id), draft]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the draft profile for verification.");
    } finally {
      setBusy(false);
    }
  }

  async function finalizeVerification() {
    const verified = asNativeProfile(
      profileId, profileName, kind, connected?.ref || null, mapping, samples, analysis.timing, status, Date.now(),
    );
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

  async function downloadExport() {
    setError("");
    try {
      const { json } = await KikiTrigger.exportProfiles();
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "kiki-gesture-profiles.json";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export gesture profiles.");
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    if (!practice) return setError("Start Practice before importing profiles.");
    setBusy(true);
    setError("");
    try {
      const imported = await KikiTrigger.importProfiles({ json: await file.text() });
      setProfiles(imported.profiles);
      await syncProfiles(imported.profiles);
      setMessage(`Imported ${imported.profiles.length} gesture profile(s).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profile import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSavedProfile(profile: GestureProfile) {
    if (!practice) return setError("Start Practice before changing profiles.");
    setBusy(true);
    setError("");
    try {
      await KikiTrigger.deleteProfile({ id: profile.id });
      const next = profiles.filter(({ id: savedId }) => savedId !== profile.id);
      setProfiles(next);
      await syncProfiles(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that profile.");
    } finally {
      setBusy(false);
    }
  }

  async function renameSavedProfile(profile: GestureProfile, name: string) {
    const updated = { ...profile, name: name.trim() };
    if (!updated.name || updated.name.length > 40) return;
    try {
      await KikiTrigger.saveProfile({ profile: updated });
      const next = profiles.map((item) => item.id === updated.id ? updated : item);
      setProfiles(next);
      await syncProfiles(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename the profile.");
    }
  }

  async function resetAll() {
    if (!practice) return setError("Start Practice before resetting mappings.");
    if (!window.confirm("Remove all saved gesture profiles from this phone?")) return;
    setBusy(true);
    setError("");
    try {
      await KikiTrigger.importProfiles({ json: "[]" });
      setProfiles([]);
      await syncProfiles([]);
      resetWizard();
      setMessage("All gesture profiles were removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset gesture profiles.");
    } finally {
      setBusy(false);
    }
  }

  async function exportTrace() {
    try {
      const result = await KikiTrigger.getTrace();
      setTrace(result.entries);
      const url = URL.createObjectURL(new Blob([result.export], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "kiki-trigger-trace.json";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export the diagnostic trace.");
    }
  }

  async function shareCompatibilityReport() {
    if (!analysis.gestures.length) {
      setError("Capture at least one observed gesture before sharing a compatibility report.");
      return;
    }
    const consent = window.confirm(
      `Share an anonymous compatibility summary? It includes the phone model (${status.phoneModel || "not available"}), Android version, accessory type, and aggregate gesture signatures/reliability. It excludes device names/references, addresses, alert data, and raw event traces. The server temporarily hashes your IP for rate limiting; it is not stored with the report.`,
    );
    if (!consent) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/trigger/compat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opt_in: true,
          phone_model: status.phoneModel ?? undefined,
          android_sdk: status.androidSdk,
          accessory_kind: kind,
          signatures: analysis.gestures.map((gesture) => ({
            prompted: gesture.taps,
            signature: gesture.sig,
            reliability: gesture.reliability,
            grade: gesture.grade,
          })),
        }),
      });
      if (response.status === 429) throw new Error("The anonymous report limit was reached for this network. Try again in an hour.");
      if (!response.ok) throw new Error("The compatibility report could not be submitted. No report was confirmed saved.");
      setMessage("Anonymous compatibility summary submitted. It contains aggregate signatures only, not a device ID or raw trace.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit the compatibility report.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptRecommendations() {
    setMapping(recommendations);
    setMessage("Suggested gestures selected. Review each action and its warning before verification.");
  }

  async function startHoldTest() {
    if (holdChecks >= 3) return;
    await beginCapture("hold");
  }

  const activeVerifyAction = verifyActions[verifyActionIndex];
  const mappedReady = Boolean(mapping.sos && mapping.cancel && mappedErrors.length === 0);

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="rounded-xl border border-[var(--warn)] bg-[var(--surface-2)] p-3 text-sm font-semibold">
        Practice: no real alerts can be sent.
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Universal gesture profiles</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            Kiki records the actual media events your accessory sends. No click weights or brand assumptions are used.
            Capture repeatedly, assign only observed signatures, then verify each action before Live mode.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" type="button" onClick={() => void downloadExport()}><Download size={15} />Export profiles</button>
          <label className="btn cursor-pointer"><Upload size={15} />Import<input className="sr-only" type="file" accept="application/json,.json" disabled={!practice || busy} onChange={(event) => void importFile(event.target.files?.[0])} /></label>
        </div>
      </div>
      <p className="rounded-xl bg-[var(--surface-2)] p-3 text-xs leading-relaxed text-[var(--muted)]">
        Profiles are stored in encrypted phone preferences. When signed in with a registered Android trigger, profile names, mappings, and aggregate calibration samples sync to your Kiki account for backup. Trigger tokens and Bluetooth addresses are never included.
      </p>
      {!practice && (
        <div className="rounded-xl bg-[var(--surface-2)] p-3 text-sm">
          Start Practice to calibrate or change profiles. Existing phone profiles can be viewed, but only Practice can capture, import, rename, or delete them.
          <button className="btn btn-primary ml-2" type="button" onClick={onStartPractice}>Start Practice</button>
        </div>
      )}
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <label className="grid gap-1">Connected accessory
          <select className="input" disabled={!practice || accessories.length === 0} value={selectedAccessory} onChange={(event) => setSelectedAccessory(event.target.value)}>
            {accessories.length === 0 && <option value="">No accessory detected</option>}
            {accessories.map((accessory, index) => <option key={`${accessory.ref ?? "any"}-${index}`} value={accessory.ref ?? ""}>{accessory.label} · {accessory.kind}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Profile name
          <input className="input" maxLength={40} value={profileName} onChange={(event) => setProfileName(event.target.value)} />
        </label>
        <label className="grid gap-1">Accessory type
          <select className="input" value={kind} onChange={(event) => setKind(event.target.value as GestureProfile["kind"])}>
            {["earbuds", "wired", "car", "speaker", "watch", "ring", "other"].map((option) =>
              <option key={option} value={option}>{option}</option>
            )}
          </select>
        </label>
        <label className="grid gap-1">Active matching
          <select className="input" disabled={!practice || busy} value="auto" onChange={(event) => void KikiTrigger.setActiveMode({ mode: event.target.value })}>
            <option value="auto">Auto · connected profiles</option>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
      </div>
      <p className="rounded-xl bg-[var(--surface-2)] p-3 text-xs leading-relaxed text-[var(--muted)]">
        Close music/video apps, set media volume to a middle level, and keep the screen on. Volume-key gestures change your volume and can fail at minimum or maximum. Some holds are intercepted by Android or a voice assistant and may never reach Kiki. A profile with no accessory reference applies to any connected media accessory.
      </p>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" type="button" disabled={!practice || accessories.length === 0 || busy} onClick={() => {
          resetWizard();
          setStep("warmup");
          setMessage("Press your accessory button once. Capture raw events below to check compatibility.");
        }}>Start calibration</button>
        {step !== "preflight" && <button className="btn" type="button" disabled={busy} onClick={resetWizard}><RotateCcw size={15} />Reset wizard</button>}
      </div>

      {step === "warmup" && (
        <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
          <h3 className="font-semibold">1. Warm-up</h3>
          <p className="text-sm">Press your button once. If nothing arrives in 10 seconds, try again with music/video apps closed. Android or a voice assistant may capture the gesture before Kiki.</p>
          <button className="btn" type="button" disabled={!practice || waiting} onClick={() => void beginCapture("warmup")}>{waiting && waitKind === "warmup" ? "Listening…" : "Capture one press"}</button>
          {warmupSignature && <p className="text-sm text-[var(--ok)]">Detected: {humanize(warmupSignature)} · <code>{warmupSignature}</code></p>}
          {noSignal && !warmupSignature && <p role="alert" className="text-sm text-[var(--warn)]">No signal detected. This control may not send media-button events to apps.</p>}
          {warmupSignature && <button className="btn btn-primary" type="button" onClick={() => { setStep("calibrate"); setNoSignal(false); }}>Continue to repeated calibration</button>}
          <div className="rounded-lg bg-[var(--surface-2)] p-2">
            <p className="text-xs font-semibold">Raw events received</p>
            <ol className="mt-1 space-y-1 text-xs">{rawEvents.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ol>
          </div>
          <button className="btn" type="button" onClick={() => void exportTrace()}><Download size={14} />Export diagnostics</button>
        </div>
      )}

      {step === "calibrate" && (
        <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
          <h3 className="font-semibold">2. Repeatable tap calibration</h3>
          <p className="text-sm">Sample {sampleNumber} of 3 · tap {tapCount} time(s) at your normal speed, then pause. {waiting ? "Listening for your sequence…" : "Start capture before each attempt."}</p>
          <div className="flex gap-1" aria-label={`Tap count ${tapCount} of 6`}>
            {Array.from({ length: 6 }, (_, index) => <span key={index} className={`h-2 flex-1 rounded ${index < tapCount ? "bg-[var(--accent)]" : "bg-[var(--line)]"}`} />)}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" type="button" disabled={!practice || waiting || Boolean(pendingSample)} onClick={() => void beginCapture("sample")}>{waiting ? "Listening…" : "Start sample"}</button>
            <button className="btn" type="button" disabled={!practice || waiting} onClick={() => { setPendingSample(null); setNoSignal(false); }}>Retry sample</button>
            {noSignal && <button className="btn" type="button" onClick={() => void acceptNoSignal()}>I tapped, record no signal</button>}
          </div>
          {pendingSample && <div className="rounded-lg bg-[var(--surface-2)] p-3 text-sm">
            <p>Detected <b>{humanize(pendingSample.sig)}</b> · signature <code>{pendingSample.sig}</code> · {pendingSample.presses} events.</p>
            <button className="btn btn-primary mt-2" type="button" onClick={() => appendSample(pendingSample)}>Record sample</button>
          </div>}
          {noSignal && <p role="alert" className="text-sm text-[var(--warn)]">No complete media gesture arrived. Retry or record this attempt as unseen; do not invent a mapping.</p>}
          <p className="text-xs text-[var(--muted)]">Samples recorded: {samples.length}/18. No-signal attempts are explicit and count toward reliability.</p>
        </div>
      )}

      {(step === "review" || step === "verify" || step === "done") && (
        <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">3. What your accessory sends</h3>
            <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-xs">Trust: {trust.replaceAll("_", " ")}</span>
          </div>
          {analysis.gestures.length === 0 ? <p className="text-sm text-[var(--muted)]">No complete gesture samples were detected yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead><tr><th className="p-2">Prompt</th><th className="p-2">Observed signal</th><th className="p-2">Grade</th><th className="p-2">Reliability</th><th className="p-2">Risk / notes</th></tr></thead>
                <tbody>{analysis.gestures.map((gesture) => <tr key={`${gesture.taps}-${gesture.sig}`} className="border-t border-[var(--line)]">
                  <td className="p-2">{gesture.taps} tap(s)</td>
                  <td className="p-2">{humanize(gesture.sig)} · <code>{gesture.sig}</code></td>
                  <td className="p-2">{gradeLabel(gesture.grade)}</td>
                  <td className="p-2">{Math.round(gesture.reliability * 100)}% ({gesture.samples}/{gesture.total})</td>
                  <td className="p-2">{Math.round(gesture.risk * 100)}% · {gesture.notes.join(" ") || "No additional warning."}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
          {analysis.unseen.length > 0 && <p className="text-sm text-[var(--warn)]">No events were received for {analysis.unseen.join(", ")} tap(s). Those gestures cannot be assigned.</p>}
          {analysis.indistinguishable.map(({ sig, taps }) => <p key={sig} className="text-sm text-[var(--warn)]">Tap counts {taps.join(" and ")} produced the same signal ({sig}); Kiki cannot distinguish them.</p>)}
          <div className="flex flex-wrap gap-2">
            <button className="btn" type="button" onClick={() => void acceptRecommendations()} disabled={!analysis.gestures.length}>Accept suggested setup</button>
            <button className="btn" type="button" disabled={waiting || !practice || holdChecks >= 3} onClick={() => void startHoldTest()}>Optional hold check {holdChecks}/3</button>
          </div>
          {holdChecks > 0 && <p className="text-xs text-[var(--muted)]">Hold events received: {holdSeen}/{holdChecks}. A hold is not offered as an assignment unless repeated event traces demonstrate it.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {ACTIONS.map(({ id: action, label }) => {
              const chosen = mapping[action];
              const options = analysis.gestures.filter((gesture) =>
                !Object.entries(mapping).some(([otherAction, signature]) => otherAction !== action && signature === gesture.sig)
              );
              return <label key={action} className="grid gap-1 text-sm">{label}
                <select className="input" value={chosen ?? ""} onChange={(event) => setMapping((previous) => ({ ...previous, [action]: event.target.value || undefined }))}>
                  <option value="">Not assigned</option>
                  {options.map((gesture) => <option key={gesture.sig} value={gesture.sig}>{humanize(gesture.sig)} · {gesture.sig} · {gradeLabel(gesture.grade)}</option>)}
                </select>
              </label>;
            })}
          </div>
          {Object.entries(mapping).map(([action, signature]) => {
            const gesture = analysis.gestures.find((item) => item.sig === signature);
            return gesture && gesture.grade === "C" ? <p className="text-xs text-[var(--warn)]" key={`${action}-warning`}>{action} uses a C-grade gesture. It will require explicit verification and remains a risk.</p> : null;
          })}
          {mappedErrors.map((item) => <p key={item} className="text-sm text-[var(--crit)]">{item}</p>)}
          {step === "review" && <button className="btn btn-primary" type="button" disabled={!practice || busy || !mappedReady} onClick={() => void saveDraftForVerification()}>
            <ShieldCheck size={15} />Save draft and verify 3 times
          </button>}
          {step === "verify" && <div className="rounded-lg bg-[var(--surface-2)] p-3 text-sm">
            <p>Verification {verifyActionIndex + 1}/{verifyActions.length}: perform <b>{activeVerifyAction}</b> three consecutive times. Each attempt must match the saved profile in Practice.</p>
            <p className="mt-1" role="status">{verifyResult || `Successful attempts: ${verifyHits}/3.`}</p>
            <button className="btn btn-primary mt-2" type="button" disabled={!practice || waiting || busy} onClick={() => void retryFailedVerification()}>
              {waiting ? "Listening…" : `Capture ${activeVerifyAction ?? "gesture"} verification`}
            </button>
            {noSignal && <p className="mt-2 text-xs text-[var(--warn)]">No sequence arrived. Try again; a failed attempt resets the consecutive count.</p>}
          </div>}
          {step === "done" && <p className="text-sm text-[var(--ok)]">Verified locally on this phone. Live alerts still require a connected accessory and a profile with SOS and Cancel; profile verification expires after 90 days and after app/Android updates.</p>}
        </div>
      )}

      {profiles.length > 0 && (
        <div className="space-y-2 rounded-xl bg-[var(--surface-2)] p-3">
          <h3 className="font-semibold">Saved profiles</h3>
          {profiles.map((profile) => {
            const profileAnalysis = analyze(profile.library.map((sample) => ({
              prompted: sample.prompted, sig: sample.sig, presses: sample.presses, gaps: sample.gaps,
            })));
            const assigned: Partial<Record<Action, string>> = {};
            Object.entries(profile.mapping).forEach(([signature, action]) => { assigned[action as Action] = signature; });
            const state = profileTrust(profileAnalysis.gestures, assigned, Boolean(profile.verifiedAt));
            return <div key={profile.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] p-2">
              <input className="input min-w-[160px] flex-1" defaultValue={profile.name} maxLength={40} disabled={!practice || busy} aria-label="Profile name" onBlur={(event) => {
                if (event.target.value !== profile.name) void renameSavedProfile(profile, event.target.value);
              }} />
              <span className="text-xs">{profile.kind} · {state.replaceAll("_", " ")}</span>
              <button className="btn" type="button" disabled={!practice || busy} onClick={() => {
                setProfileId(profile.id);
                profileIdRef.current = profile.id;
                setProfileName(profile.name);
                setKind(profile.kind);
                setSelectedAccessory(profile.deviceRef ?? "");
                setMapping(assigned);
                setSamples(profile.library.map((sample) => ({ prompted: sample.prompted, sig: sample.sig, presses: sample.presses, gaps: sample.gaps })));
                const gestures = analyze(profile.library.map((sample) => ({ prompted: sample.prompted, sig: sample.sig, presses: sample.presses, gaps: sample.gaps })));
                setStep("review");
                setMessage(`Re-check ${profile.name}; edit mappings and verify before using Live mode.`);
                void gestures;
              }}>Re-check</button>
              <button className="btn" type="button" disabled={!practice || busy} aria-label={`Delete ${profile.name}`} onClick={() => void deleteSavedProfile(profile)}><Trash2 size={14} /></button>
            </div>;
          })}
          <button className="btn text-[var(--crit)]" type="button" disabled={!practice || busy} onClick={() => void resetAll()}>Reset to nothing</button>
        </div>
      )}

      <details className="rounded-xl border border-[var(--line)] p-3" open={legacyOpen} onToggle={(event) => setLegacyOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer font-semibold">Advanced · legacy click-count settings</summary>
        <p className="mt-2 text-sm text-[var(--muted)]">Older click-count assignments are not used by the signature matcher. Recalibrate above for best results; Kiki never converts old counts into guessed gesture signatures.</p>
      </details>

      <div className="space-y-2 rounded-xl border border-[var(--line)] p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold"><Activity size={16} />Input · gesture · match · server trace</h3>
          <div className="flex flex-wrap gap-2">
            <button className="btn" type="button" disabled={busy || !analysis.gestures.length} onClick={() => void shareCompatibilityReport()}><Send size={14} />Share anonymous compatibility</button>
            <button className="btn" type="button" onClick={() => void exportTrace()}><Download size={14} />Export trace</button>
          </div>
        </div>
        <p className="text-xs text-[var(--muted)]">Trace exports contain timestamps, key codes, normalized signatures, match results and response statuses only. They do not include access tokens, device addresses, or coordinates.</p>
        <ol className="max-h-48 space-y-1 overflow-auto font-mono text-xs text-[var(--muted)]">
          {trace.map((entry, index) => <li key={`${entry.at}-${index}`}>{entry.at} · {entry.layer} · {entry.status}</li>)}
        </ol>
      </div>
      {message && <p className="text-sm" role="status">{message}</p>}
      {error && <p className="text-sm text-[var(--crit)]" role="alert">{error}</p>}
      {busy && <p className="text-sm text-[var(--muted)]">Saving gesture profile…</p>}
    </section>
  );
}
