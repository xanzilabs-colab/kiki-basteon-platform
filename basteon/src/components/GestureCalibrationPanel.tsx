"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bluetooth, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { KikiTrigger, type GestureProfile, type TriggerEvent } from "@/lib/kikiTrigger";
import {
  analyze,
  recommend,
  validateMapping,
  type Action,
  type Sample,
} from "@/lib/triggerGestures/analyze";

const ACTIONS: { id: Action; label: string }[] = [
  { id: "sos", label: "SOS" },
  { id: "medical", label: "Medical alert" },
  { id: "duress", label: "Discreet SOS" },
  { id: "cancel", label: "Cancel countdown" },
];

type Step = "preflight" | "warmup" | "calibrate" | "review" | "verify" | "done";
type WaitKind = "warmup" | "sample" | "verify" | null;
type Accessory = { ref: string | null; label: string; kind: string };

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
}: {
  practice: boolean;
  onStartPractice: () => void;
  status: { appVersion?: string | null; androidSdk?: number };
}) {
  const [profiles, setProfiles] = useState<GestureProfile[]>([]);
  const [accessories, setAccessories] = useState<Accessory[]>([]);
  const [selectedAccessory, setSelectedAccessory] = useState("");
  const [profileName, setProfileName] = useState("");
  const [kind, setKind] = useState<GestureProfile["kind"]>("earbuds");
  const [activeMode, setActiveMode] = useState("auto");
  const [savedSetupsOpen, setSavedSetupsOpen] = useState(false);
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
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNeedsRetry, setBackupNeedsRetry] = useState(false);
  const [verifyActions, setVerifyActions] = useState<Action[]>([]);
  const [verifyActionIndex, setVerifyActionIndex] = useState(0);
  const [verifyHits, setVerifyHits] = useState(0);
  const [verifyResult, setVerifyResult] = useState("");
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
  const connected = accessories.find((item) => item.ref === selectedAccessory);

  const syncProfiles = useCallback(async (next: GestureProfile[]) => {
    setError("");
    setBackupBusy(true);
    try {
      const response = await fetch("/api/trigger/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles: next }),
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
      const { devices } = await KikiTrigger.connectedAccessories();
      setAccessories(devices);
      if (devices[0]) {
        setSelectedAccessory((current) => current || devices[0].ref || "");
        setProfileName((current) => current || devices[0].label);
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

  useEffect(() => { void loadAccessories(); }, [loadAccessories]);

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

  useEffect(() => {
    const needsRecheck = profiles.some((profile) => !isProfileCurrent(profile, status));
    if (needsRecheck) setSavedSetupsOpen(true);
  }, [profiles, status.appVersion, status.androidSdk]);

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
    const deviceRef = connected?.ref ?? profiles.find((profile) => profile.id === profileId)?.deviceRef ?? null;
    const draft = asNativeProfile(profileId, profileName, kind, deviceRef, mapping, samples, analysis.timing, status, null);
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
    const deviceRef = connected?.ref ?? profiles.find((profile) => profile.id === profileId)?.deviceRef ?? null;
    const verified = asNativeProfile(profileId, profileName, kind, deviceRef, mapping, samples, analysis.timing, status, Date.now());
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

  async function acceptRecommendations() {
    setMapping(recommendations);
    setMessage("Suggested gestures selected. Review each action and its warning before verification.");
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
          <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Set up your button</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            Connect your accessory, capture the gestures you want, and verify SOS and Cancel to unlock Live mode.
          </p>
        </div>
      </div>
      <ol className="grid grid-cols-4 gap-2 text-center text-xs" aria-label="Setup progress">
        {(["warmup", "calibrate", "review", "verify"] as const).map((item, index) => {
          const current = ["warmup", "calibrate", "review", "verify", "done"].indexOf(step) === index ||
            (step === "done" && index === 3);
          return <li key={item} className={`rounded-lg px-2 py-2 ${current ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--muted)]"}`}>
            {index + 1}. {item === "warmup" ? "Connect" : item === "calibrate" ? "Capture" : item === "review" ? "Choose" : "Verify"}
          </li>;
        })}
      </ol>
      {!practice && <p className="text-sm text-[var(--muted)]">Start Practice above before setting up buttons. No real alerts can be sent during setup.</p>}
      <details className="rounded-xl border border-[var(--line)] p-3" open={step === "preflight"}>
        <summary className="cursor-pointer font-semibold">Accessory and profile settings</summary>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <label className="grid gap-1">Connected accessory
            <select className="input" disabled={!practice || accessories.length === 0} value={selectedAccessory} onChange={(event) => setSelectedAccessory(event.target.value)}>
              {accessories.length === 0 && <option value="">No accessory detected</option>}
              {accessories.map((accessory, index) => <option key={`${accessory.ref ?? "any"}-${index}`} value={accessory.ref ?? ""}>{accessory.label} · {accessory.kind}</option>)}
            </select>
            {practice && <button className="w-fit text-xs underline" type="button" onClick={() => void loadAccessories()}>Refresh accessories</button>}
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
          <label className="grid gap-1">Use profile
            <select className="input" disabled={!practice || busy} value={activeMode} onChange={(event) => {
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
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">Close music apps before capturing button patterns.</p>
      </details>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" type="button" disabled={!practice || accessories.length === 0 || busy} onClick={() => {
          resetWizard();
          setStep("warmup");
          setMessage("Press the accessory once to check that Kiki receives its media event.");
        }}>{step === "preflight" ? "Start setup" : "Start new setup"}</button>
        {step !== "preflight" && <button className="btn" type="button" disabled={busy} onClick={resetWizard}><RotateCcw size={15} />Reset wizard</button>}
      </div>
      {practice && accessories.length === 0 && <p className="text-sm text-[var(--warn)]">Connect your accessory, then choose Refresh accessories.</p>}

      {step === "warmup" && (
        <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
          <h3 className="font-semibold">1. Check connection</h3>
          <p className="text-sm">Press your accessory once.</p>
          <button className="btn" type="button" disabled={!practice || waiting} onClick={() => void beginCapture("warmup")}>{waiting && waitKind === "warmup" ? "Listening…" : "Check button"}</button>
          {warmupSignature && <p className="text-sm text-[var(--ok)]">Button detected. You can continue.</p>}
          {noSignal && !warmupSignature && <p role="alert" className="text-sm text-[var(--warn)]">Kiki did not receive a signal. Try again with music apps closed. Some controls are not sent to Android apps.</p>}
          {warmupSignature && <button className="btn btn-primary" type="button" onClick={() => { setStep("calibrate"); setNoSignal(false); }}>Continue</button>}
        </div>
      )}

      {step === "calibrate" && (
        <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
          <h3 className="font-semibold">2. Capture your button patterns</h3>
          <p className="text-sm">Press {tapCount} time(s), then pause. Attempt {sampleNumber} of 3. {waiting ? "Listening…" : "Tap Start, then press your accessory."}</p>
          <div className="flex gap-1" aria-label={`Tap count ${tapCount} of 6`}>
            {Array.from({ length: 6 }, (_, index) => <span key={index} className={`h-2 flex-1 rounded ${index < tapCount ? "bg-[var(--accent)]" : "bg-[var(--line)]"}`} />)}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" type="button" disabled={!practice || waiting || Boolean(pendingSample)} onClick={() => void beginCapture("sample")}>{waiting ? "Listening…" : "Start"}</button>
            <button className="btn" type="button" disabled={!practice || waiting} onClick={() => { setPendingSample(null); setNoSignal(false); }}>Try again</button>
            {noSignal && <button className="btn" type="button" onClick={() => void acceptNoSignal()}>Record no signal</button>}
          </div>
          {pendingSample && <div className="rounded-lg bg-[var(--surface-2)] p-3 text-sm">
            <p>Kiki detected: <b>{humanize(pendingSample.sig)}</b>.</p>
            <button className="btn btn-primary mt-2" type="button" onClick={() => appendSample(pendingSample)}>Continue</button>
          </div>}
          {noSignal && <p role="alert" className="text-sm text-[var(--warn)]">No button signal arrived. Try again, or record it as unavailable.</p>}
          <p className="text-xs text-[var(--muted)]">Kiki checks common 1–6 press patterns three times each, so it can avoid confusing one action with another.</p>
        </div>
      )}

      {(step === "review" || step === "verify" || step === "done") && (
        <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
          <h3 className="font-semibold">3. Choose actions</h3>
          {analysis.gestures.length === 0 ? <p className="text-sm text-[var(--muted)]">No complete gesture samples were detected yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[320px] text-left text-sm">
                <thead><tr><th className="p-2">Button press</th><th className="p-2">Detected pattern</th><th className="p-2">Consistency</th></tr></thead>
                <tbody>{analysis.gestures.map((gesture) => <tr key={`${gesture.taps}-${gesture.sig}`} className="border-t border-[var(--line)]">
                  <td className="p-2">{gesture.taps} tap(s)</td>
                  <td className="p-2">{humanize(gesture.sig)}</td>
                  <td className="p-2">{Math.round(gesture.reliability * 100)}%</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
          {analysis.unseen.length > 0 && <p className="text-sm text-[var(--warn)]">No events were received for {analysis.unseen.join(", ")} tap(s). Those gestures cannot be assigned.</p>}
          {analysis.indistinguishable.map(({ sig, taps }) => <p key={sig} className="text-sm text-[var(--warn)]">Tap counts {taps.join(" and ")} produced the same signal ({sig}); Kiki cannot distinguish them.</p>)}
          <button className="btn" type="button" onClick={() => void acceptRecommendations()} disabled={!analysis.gestures.length}>Suggest actions</button>
          <div className="grid gap-2 sm:grid-cols-2">
            {ACTIONS.map(({ id: action, label }) => {
              const chosen = mapping[action];
              const options = analysis.gestures.filter((gesture) =>
                !Object.entries(mapping).some(([otherAction, signature]) => otherAction !== action && signature === gesture.sig)
              );
              return <label key={action} className="grid gap-1 text-sm">{label}
                <select className="input" value={chosen ?? ""} onChange={(event) => setMapping((previous) => ({ ...previous, [action]: event.target.value || undefined }))}>
                  <option value="">Not assigned</option>
                  {options.map((gesture) => <option key={gesture.sig} value={gesture.sig}>{gesture.taps} tap(s) · {humanize(gesture.sig)} · {Math.round(gesture.reliability * 100)}% repeatable</option>)}
                </select>
              </label>;
            })}
          </div>
          {Object.entries(mapping).map(([action, signature]) => {
            const gesture = analysis.gestures.find((item) => item.sig === signature);
            return gesture && gesture.grade === "C" ? <p className="text-xs text-[var(--warn)]" key={`${action}-warning`}>{action} uses an inconsistent or easy-to-trigger pattern. Choose a different one if available.</p> : null;
          })}
          {mappedErrors.map((item) => <p key={item} className="text-sm text-[var(--crit)]">{item}</p>)}
          {step === "review" && <button className="btn btn-primary" type="button" disabled={!practice || busy || !mappedReady} onClick={() => void saveDraftForVerification()}>
            <ShieldCheck size={15} />Continue to safety check
          </button>}
          {step === "verify" && <div className="rounded-lg bg-[var(--surface-2)] p-3 text-sm">
            <p>Safety check {verifyActionIndex + 1}/{verifyActions.length}: perform <b>{activeVerifyAction}</b> three times so Kiki can confirm it reliably.</p>
            <p className="mt-1" role="status">{verifyResult || `Confirmed ${verifyHits} of 3.`}</p>
            <button className="btn btn-primary mt-2" type="button" disabled={!practice || waiting || busy} onClick={() => void retryFailedVerification()}>
              {waiting ? "Listening…" : `Check ${activeVerifyAction ?? "button"} pattern`}
            </button>
            {noSignal && <p className="mt-2 text-xs text-[var(--warn)]">No signal arrived. Try again.</p>}
          </div>}
          {step === "done" && <p className="text-sm text-[var(--ok)]">Setup complete. SOS and Cancel are verified for this phone and accessory.</p>}
        </div>
      )}

      {profiles.length > 0 && (
        <details className="rounded-xl border border-[var(--line)] p-3" open={savedSetupsOpen} onToggle={(event) => setSavedSetupsOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer font-semibold">Saved button setups ({profiles.length})</summary>
          <div className="mt-3 space-y-2">
          {profiles.map((profile) => {
            const assigned: Partial<Record<Action, string>> = {};
            Object.entries(profile.mapping).forEach(([signature, action]) => { assigned[action as Action] = signature; });
            const verified = isProfileCurrent(profile, status);
            return <div key={profile.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] p-2">
              <input className="input min-w-[160px] flex-1" defaultValue={profile.name} maxLength={40} disabled={!practice || busy} aria-label="Profile name" onBlur={(event) => {
                if (event.target.value !== profile.name) void renameSavedProfile(profile, event.target.value);
              }} />
              <span className="text-xs">{verified ? "Ready" : "Needs re-check"}</span>
              <button className="btn" type="button" disabled={!practice || busy} onClick={() => {
                setProfileId(profile.id);
                profileIdRef.current = profile.id;
                setProfileName(profile.name);
                setKind(profile.kind);
                setSelectedAccessory(profile.deviceRef ?? "");
                setMapping(assigned);
                setSamples(profile.library.map((sample) => ({ prompted: sample.prompted, sig: sample.sig, presses: sample.presses, gaps: sample.gaps })));
                setStep("review");
                setMessage(`Check the ${profile.name} buttons three times to enable Live mode.`);
              }}>{verified ? "Edit" : "Re-check"}</button>
              <button className="btn" type="button" disabled={!practice || busy} aria-label={`Delete ${profile.name}`} onClick={() => void deleteSavedProfile(profile)}><Trash2 size={14} /></button>
            </div>;
          })}
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">Your button setups are saved on this phone.</p>
        </details>
      )}

      {message && <p className={`text-sm ${backupNeedsRetry ? "text-[var(--warn)]" : ""}`} role="status">{message}</p>}
      {error && <p className="text-sm text-[var(--crit)]" role="alert">{error}</p>}
      {backupNeedsRetry && profiles.length > 0 && <button
        className="btn"
        type="button"
        disabled={busy || backupBusy}
        onClick={() => void syncProfiles(profiles)}
      >{backupBusy ? "Retrying account backup…" : "Retry account backup"}</button>}
      {busy && <p className="text-sm text-[var(--muted)]">Saving gesture profile…</p>}
    </section>
  );
}
