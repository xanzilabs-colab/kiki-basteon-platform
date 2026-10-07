"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, CloudSun, EyeOff, KeyRound, List, Lock, Mic, PenLine, Plus, Settings, Sprout, Square, Trees, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { createKeyBundle, decryptBytes, decryptJson, deriveKek, encryptBytes, encryptJson, fromB64, parseRecoveryCode, recoveryKeyFromBytes, unwrapDek } from "@/lib/journal/crypto";
import { getSessionKey, lockSession, setSessionKey, useIsUnlocked } from "@/lib/journal/session";
import * as api from "@/lib/journal/api";
import type { EntryPayloadV1, JournalEntryRow, JournalKind, JournalSymbol, Mood } from "@/lib/journal/types";
import { layoutWorld } from "@/lib/journal/world/layout";
import { jacarandaInBloom, seasonOf, skyPhase } from "@/lib/journal/world/sky";
import { SKY } from "@/lib/journal/world/tokens";
import { GardenScene } from "./GardenScene";
import styles from "./journal.module.css";
import mediaStyles from "./journal-media.module.css";

type DecryptedEntry = JournalEntryRow & { payload: EntryPayloadV1 };
type Gate = "loading" | "setup" | "unlock" | "recovery";
const defaults: Record<JournalKind, JournalSymbol> = { moment: "flower", voice: "lantern", thought: "butterfly", feeling: "cloud" };
const moods: Mood[] = ["sunny", "breezy", "cloudy", "drizzle", "storm", "fog", "rainbow"];
const localDate = () => new Date().toLocaleDateString("en-CA");
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_FILE_BYTES = MAX_MEDIA_BYTES - 28;
const errorCopy: Record<api.JournalErrorCode, string> = { not_authenticated: "Please sign in again.", journal_not_set_up: "Set up your journal first.", already_set_up: "Your journal is already set up.", quota_exceeded: "Your garden is full. Delete something to make room.", too_many_chapters: "That's a lot of chapters. Close or delete one first.", chapter_not_found: "That chapter is no longer here.", entry_not_found: "That entry is no longer here.", entry_exists: "Couldn't save that. Try again.", invalid_input: "Couldn't save that. Try again.", unknown: "Couldn't save that. Try again." };
function message(error: unknown) { return error instanceof api.JournalError ? errorCopy[error.code] : "Couldn't save that. Try again."; }

export function JournalApp() {
  const unlocked = useIsUnlocked(); const [gate, setGate] = useState<Gate>("loading"); const [userId, setUserId] = useState<string | null>(null); const [settings, setSettings] = useState<{ autoLock: number; calm: boolean }>({ autoLock: 300, calm: false });
  const [entries, setEntries] = useState<DecryptedEntry[]>([]); const [composer, setComposer] = useState<JournalKind | null>(null); const [list, setList] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [selected, setSelected] = useState<DecryptedEntry | null>(null);
  const urls = useRef(new Set<string>()); const idle = useRef<number | null>(null); const hidden = useRef<number | null>(null);
  const lock = () => { if (idle.current) window.clearTimeout(idle.current); if (hidden.current) window.clearTimeout(hidden.current); urls.current.forEach(URL.revokeObjectURL); urls.current.clear(); lockSession(); setEntries([]); setComposer(null); setSelected(null); };
  const resetTimer = () => { if (!unlocked) return; if (idle.current) window.clearTimeout(idle.current); idle.current = window.setTimeout(lock, settings.autoLock * 1000); };
  useEffect(() => { void (async () => { const { data: { user } } = await createClient().auth.getUser(); if (!user) return; setUserId(user.id); const [keys, stored] = await Promise.all([api.getKeys(), api.getSettings()]); setSettings({ autoLock: stored?.auto_lock_seconds ?? 300, calm: localStorage.getItem("kiki-journal-calm") === "1" }); setGate(keys ? "unlock" : "setup"); })(); }, []);
  useEffect(() => { if (!unlocked) return; const events = ["pointerdown", "keydown", "scroll", "touchstart"]; events.forEach((event) => window.addEventListener(event, resetTimer, { passive: true })); const visibility = () => { if (document.hidden) hidden.current = window.setTimeout(lock, settings.autoLock * 1000); else if (hidden.current) { window.clearTimeout(hidden.current); hidden.current = null; } }; document.addEventListener("visibilitychange", visibility); const escape = (() => { let last = 0; return (event: KeyboardEvent) => { if (event.key === "Escape") { const now = Date.now(); if (now - last < 800) { lock(); location.assign("/"); } last = now; } }; })(); window.addEventListener("keydown", escape); resetTimer(); return () => { events.forEach((event) => window.removeEventListener(event, resetTimer)); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("keydown", escape); }; }, [unlocked, settings.autoLock]);
  useEffect(() => { if (!unlocked || !userId) return; void loadEntries(); }, [unlocked, userId]);
  async function loadEntries() { const key = getSessionKey(); if (!key || !userId) return; try { const rows = await api.listEntries(); const values = await Promise.all(rows.map(async (row) => ({ ...row, payload: await decryptJson<EntryPayloadV1>(key, row.payload_enc, row.payload_iv, `entry:${userId}:${row.id}`) }))); setEntries(values); } catch { toast.error("Couldn't open your journal."); } }
  if (gate === "loading") return <main className={styles.loading}>Opening your garden...</main>;
  if (!unlocked) return <main className={styles.shell}>{gate === "setup" ? <Setup userId={userId} onReady={() => setGate("unlock")} /> : gate === "recovery" ? <Recovery onBack={() => setGate("unlock")} onUnlocked={() => undefined} /> : <Unlock onRecovery={() => setGate("recovery")} onUnlocked={() => undefined} />}</main>;
  return <main className={`${styles.shell} ${settings.calm ? styles.calm : ""}`}>{list ? <JournalGarden entries={entries} calm={settings.calm} list={list} onList={() => setList(!list)} onSelect={setSelected} onLeave={() => setComposer("thought")} /> : <GardenScene entries={entries} calm={settings.calm} onList={() => setList(true)} onSelect={setSelected} onLeave={() => setComposer("thought")} />}<div className={styles.topActions}><button aria-label="Quick hide" title="Quick hide" onClick={() => { lock(); location.assign("/"); }}><EyeOff /></button><button aria-label="Journal settings" title="Journal settings" onClick={() => setSettingsOpen(true)}><Settings /></button></div><button className={styles.leave} onClick={() => setComposer("thought")}><Plus />Leave something here</button>{composer && <LeaveSheet kind={composer} userId={userId!} onClose={() => setComposer(null)} onSaved={async () => { setComposer(null); await loadEntries(); }} />}{selected && <EntryViewer entry={selected} userId={userId!} onClose={() => setSelected(null)} onDeleted={async () => { setSelected(null); await loadEntries(); }} />}{settingsOpen && <JournalSettings settings={settings} onClose={() => setSettingsOpen(false)} onChange={setSettings} onLock={lock} />}</main>;
}

function Setup({ userId, onReady }: { userId: string | null; onReady: () => void }) {
  const [lockType, setLockType] = useState<"pin" | "passphrase">("pin"); const [secret, setSecret] = useState(""); const [confirm, setConfirm] = useState(""); const [recovery, setRecovery] = useState<string | null>(null); const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false);
  const validSecret = lockType === "pin" ? /^\d{6,8}$/.test(secret) : secret.length >= 12;
  function chooseLock(next: "pin" | "passphrase") { setLockType(next); setSecret(""); setConfirm(""); }
  async function begin() { if (!userId || !validSecret || secret !== confirm) return; if (lockType === "pin" && (/^(.)\1+$/.test(secret) || "12345678901234567890".includes(secret))) return toast.error("Choose a less predictable PIN."); setBusy(true); try { const bundle = await createKeyBundle(secret); await api.setupKeys({ ...bundle.rpcArgs, p_lock_type: lockType }); setSessionKey(bundle.sessionKey); localStorage.setItem("kiki-journal-lock-type", lockType); setRecovery(bundle.recoveryCode); } catch (error) { toast.error(message(error)); } finally { setBusy(false); } }
  if (recovery) return <section className={styles.setupScreen}><div className={styles.setupIntro}><Sprout size={34}/><p>Your private journal</p><h1>Keep your recovery code.</h1><span>It is the only way back in if you lose your lock.</span></div><div className={styles.setupForm}><code className={styles.recovery}>{recovery}</code><button className={styles.setupSecondary} onClick={() => void navigator.clipboard.writeText(recovery)}>Copy recovery code</button><label className={styles.setupCheck}><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)}/> I&apos;ve saved it somewhere safe</label><button className={styles.setupPrimary} disabled={!saved} onClick={onReady}>Continue</button></div></section>;
  return <section className={styles.setupScreen}><div className={styles.setupIntro}><a className={styles.setupBack} href="/account" aria-label="Back to account"><ArrowLeft size={18}/> Back</a><Sprout size={34}/><p>Your private journal</p><h1>This is your garden.</h1><span>What you leave here is locked on your device before it is saved. Only you can open it.</span></div><div className={styles.setupForm}><div className={styles.lockChoice} role="group" aria-label="Choose a journal lock"><button type="button" className={lockType === "pin" ? styles.lockChoiceActive : ""} onClick={() => chooseLock("pin")}>PIN code<small>6 to 8 digits</small></button><button type="button" className={lockType === "passphrase" ? styles.lockChoiceActive : ""} onClick={() => chooseLock("passphrase")}>Passphrase<small>12+ characters</small></button></div><label>{lockType === "pin" ? "Choose a PIN" : "Choose a passphrase"}<input className="input" type="password" inputMode={lockType === "pin" ? "numeric" : "text"} pattern={lockType === "pin" ? "[0-9]*" : undefined} maxLength={lockType === "pin" ? 8 : undefined} autoComplete="new-password" value={secret} onChange={(event) => setSecret(lockType === "pin" ? event.target.value.replace(/\D/g, "") : event.target.value)} /></label><small>{lockType === "pin" ? "Use 6 to 8 digits. Avoid repeated or predictable numbers." : "Use a memorable phrase with at least 12 characters."}</small><label>Confirm your {lockType === "pin" ? "PIN" : "passphrase"}<input className="input" type="password" inputMode={lockType === "pin" ? "numeric" : "text"} pattern={lockType === "pin" ? "[0-9]*" : undefined} maxLength={lockType === "pin" ? 8 : undefined} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(lockType === "pin" ? event.target.value.replace(/\D/g, "") : event.target.value)} /></label><button className={styles.setupPrimary} disabled={busy || secret !== confirm || !validSecret} onClick={() => void begin()}>{busy ? "Creating your garden..." : "Begin"}</button></div></section>;
}
function Unlock({ onRecovery, onUnlocked }: { onRecovery: () => void; onUnlocked: () => void }) {
  const [secret, setSecret] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function open() { setBusy(true); setError(""); try { const keys = await api.getKeys(); if (!keys) return; const kek = await deriveKek(secret, fromB64(keys.salt), keys.kdf_iterations); setSessionKey(await unwrapDek(keys.wrapped_dek, keys.wrap_iv, kek)); onUnlocked(); } catch { setError("That lock does not match. Try again."); } finally { setBusy(false); } }
  return <section className={styles.setupScreen}><div className={styles.setupIntro}><a className={styles.setupBack} href="/account" aria-label="Back to account"><ArrowLeft size={18}/> Back</a><Trees size={34}/><p>Your private journal</p><h1>Welcome back.</h1><span>Your garden is still yours. Enter your lock to open it on this device.</span></div><div className={styles.setupForm}><label>Enter your lock<input className="input" autoFocus type="password" autoComplete="current-password" value={secret} onChange={(event) => setSecret(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void open()} /></label>{error && <p className={styles.unlockError} role="alert">{error}</p>}<button className={styles.setupPrimary} disabled={busy || !secret} onClick={() => void open()}>{busy ? "Opening your garden..." : "Open garden"}</button><button className={styles.setupSecondary} onClick={onRecovery}>Forgot your lock?</button></div></section>;
}
function Recovery({ onBack, onUnlocked }: { onBack: () => void; onUnlocked: () => void }) { const [code, setCode] = useState(""); const [secret, setSecret] = useState(""); const [error, setError] = useState(""); async function recover() { const bytes = parseRecoveryCode(code); if (!bytes) return setError("That code doesn't match."); try { const keys = await api.getKeys(); if (!keys?.recovery_wrapped_dek || !keys.recovery_iv) throw new Error(); const dek = await unwrapDek(keys.recovery_wrapped_dek, keys.recovery_iv, await recoveryKeyFromBytes(bytes), true); const bundle = await createKeyBundle(secret); const raw = await crypto.subtle.exportKey("raw", dek); const main = await (await import("@/lib/journal/crypto")).wrapDek(await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]), await deriveKek(secret, fromB64(bundle.rpcArgs.p_salt), bundle.rpcArgs.p_kdf_iterations)); await api.rewrapKeys({ p_kdf_iterations: bundle.rpcArgs.p_kdf_iterations, p_salt: bundle.rpcArgs.p_salt, p_wrapped_dek: main.wrapped, p_wrap_iv: main.iv }); setSessionKey(await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])); onUnlocked(); } catch { setError("That code doesn't match."); } } return <section className={styles.card}><KeyRound size={36}/><h1>Recovery</h1><p>Without your lock or your recovery code, the journal can&apos;t be opened. You can reset it, which deletes everything.</p><label>Recovery code<input className="input" value={code} onChange={(event) => setCode(event.target.value)} /></label><label>New lock<input className="input" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<button className="btn btn-primary" disabled={secret.length < 6} onClick={() => void recover()}>Open and change lock</button><button className="btn btn-ghost" onClick={onBack}>Back</button></section>; }
function JournalGarden({ entries, calm, list, onList, onSelect, onLeave }: { entries: DecryptedEntry[]; calm: boolean; list: boolean; onList: () => void; onSelect: (entry: DecryptedEntry) => void; onLeave: () => void }) { const [now, setNow] = useState(new Date()); useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []); const phase = skyPhase(now); const colors = SKY[phase.phase]; const ordered = useMemo(() => [...entries].sort((a,b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)), [entries]); const layout = layoutWorld(ordered.map((entry) => ({ id: entry.id, chapterId: entry.chapter_id }))); const mood = [...entries].sort((a,b) => Date.parse(b.occurred_at)-Date.parse(a.occurred_at)).find((entry) => entry.payload.mood && entry.occurred_at.slice(0,10) === localDate())?.payload.mood; if (list) return <section className={styles.list}><header><h1>Your garden</h1><button className="btn" onClick={onList}>Garden</button></header>{[...entries].sort((a,b) => Date.parse(b.occurred_at)-Date.parse(a.occurred_at)).map((entry) => <button key={entry.id} onClick={() => onSelect(entry)} className={styles.listRow}><Symbol symbol={entry.symbol}/><span><b>{entry.kind}</b><small>{new Date(entry.occurred_at).toLocaleString()}</small><em>{entry.payload.text?.slice(0,80) || entry.payload.caption || (entry.kind === "voice" ? "Voice note" : "Photo")}</em></span></button>)}{!entries.length && <button className="btn" onClick={onLeave}>Leave something here</button>}</section>; return <section className={styles.world} aria-label="Your garden, with journal entries along a path"><div className={styles.worldHeader}><h1>Your garden</h1><button className="btn" onClick={onList}><List size={16}/>List</button></div><svg viewBox={`0 0 ${Math.max(layout.width, 900)} 480`} preserveAspectRatio="xMidYMid slice" style={{ background: `linear-gradient(${colors.top}, ${colors.bottom})` }}><path d="M0 270 Q200 210 390 270 T760 245 T1200 260 V480H0Z" fill={colors.far}/><path d="M0 315 Q200 250 450 330 T900 290 T1400 310 V480H0Z" fill={colors.mid}/><path d="M0 350 Q260 300 520 365 T1000 335 T1400 360 V480H0Z" fill={colors.ground}/><path d="M0 420 Q190 330 400 410 T800 390 T1400 405" fill="none" stroke="#d9c6a4" strokeWidth="28" opacity=".75"/><circle cx={phase.sunProgress === null ? 770 : 100 + phase.sunProgress * 700} cy={phase.phase === "night" ? 80 : 90} r="28" fill={phase.phase === "night" ? "#f4edcf" : "#ffd27a"}/>{jacarandaInBloom(now) && <circle cx="780" cy="220" r="72" fill="#b79cf2" opacity=".85"/>}<text x="770" y="330" fill="#fff" fontSize="18">Still writing this one.</text>{layout.placed.map((placed) => { const entry = entries.find((item) => item.id === placed.id)!; return <g key={placed.id} transform={`translate(${placed.x} ${365 - placed.y * 110}) scale(${placed.scale})`} onClick={() => onSelect(entry)} className={styles.entry}><circle r="31" fill="#000" opacity=".12" transform="translate(5 26)"/><foreignObject x="-27" y="-27" width="54" height="54"><div className={styles.symbol}><Symbol symbol={entry.symbol}/></div></foreignObject></g>; })}</svg>{mood && <p className={styles.weather}>{mood}</p>}{entries.length === 0 && <button className={styles.first} onClick={onLeave}>This is your garden. Leave something here.</button>}</section>; }
function Symbol({ symbol }: { symbol: JournalSymbol }) { return <span aria-hidden="true">{{ flower: "✿", stone: "●", star: "★", butterfly: "♢", key: "⌘", lantern: "◉", cloud: "☁" }[symbol]}</span>; }
function formatDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function LeaveSheet({ kind, userId, onClose, onSaved }: { kind: JournalKind; userId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [current, setCurrent] = useState<JournalKind>(kind);
  const [text, setText] = useState("");
  const [mood, setMood] = useState<Mood>("sunny");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | undefined>();
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordingStartedAt = useRef(0);
  const needsMedia = current === "moment" || current === "voice";

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setRecordingMs(performance.now() - recordingStartedAt.current), 250);
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(() => () => {
    const activeRecorder = recorder.current;
    if (activeRecorder && activeRecorder.state !== "inactive") {
      activeRecorder.ondataavailable = null;
      activeRecorder.onstop = null;
      activeRecorder.stop();
    }
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function chooseKind(next: JournalKind) {
    if (recording) return;
    setCurrent(next);
    setFile(null);
    setDurationMs(undefined);
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (selected.size > MAX_FILE_BYTES) return toast.error("Choose a file smaller than 25 MB.");
    const extension = selected.name.split(".").pop()?.toLowerCase() ?? "";
    const audioExtensions = ["aac", "amr", "flac", "m4a", "mp3", "oga", "ogg", "wav", "webm", "3gp"];
    const valid = current === "moment"
      ? selected.type.startsWith("image/")
      : selected.type.startsWith("audio/") || audioExtensions.includes(extension);
    if (!valid) return toast.error(current === "moment" ? "Choose an image file." : "Choose an audio file.");
    setFile(selected);
    setDurationMs(undefined);
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Voice recording is not available in this browser.");
      return;
    }
    let acquired: MediaStream | null = null;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = acquired;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const activeRecorder = new MediaRecorder(acquired, mimeType ? { mimeType } : undefined);
      recorder.current = activeRecorder;
      chunks.current = [];
      activeRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      activeRecorder.onstop = () => {
        const elapsed = Math.round(performance.now() - recordingStartedAt.current);
        const blob = new Blob(chunks.current, { type: activeRecorder.mimeType || "audio/webm" });
        const type = blob.type || "audio/webm";
        const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        stream.current?.getTracks().forEach((track) => track.stop());
        stream.current = null;
        recorder.current = null;
        setRecording(false);
        setRecordingMs(elapsed);
        if (!blob.size) return toast.error("No audio was captured. Try recording again.");
        if (blob.size > MAX_FILE_BYTES) return toast.error("That recording is over 25 MB. Record a shorter note.");
        setFile(new File([blob], `garden-voice-note.${extension}`, { type }));
        setDurationMs(elapsed);
      };
      setFile(null);
      setDurationMs(undefined);
      recordingStartedAt.current = performance.now();
      setRecordingMs(0);
      activeRecorder.start(250);
      setRecording(true);
    } catch {
      acquired?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      recorder.current = null;
      toast.error("Allow microphone access to record a voice note.");
    }
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  async function save() {
    const key = getSessionKey();
    if (!key) return toast.error("Unlock your garden before saving.");
    if ((!text.trim() && current === "thought") || (needsMedia && !file) || recording) {
      return toast.error(needsMedia ? "Choose or record a file before saving." : "Add a thought before saving.");
    }
    if (file && file.size > MAX_FILE_BYTES) return toast.error("Choose a file smaller than 25 MB.");
    const id = crypto.randomUUID();
    setSaving(true);
    let path: string | null = null;
    try {
      let media: EntryPayloadV1["media"];
      if (file) {
        const encrypted = await encryptBytes(key, new Uint8Array(await file.arrayBuffer()), `media:${userId}:${id}`);
        path = `${userId}/${id}/${crypto.randomUUID()}.bin`;
        await api.uploadMedia(path, encrypted);
        media = { mime: file.type || (current === "voice" ? "audio/webm" : "image/jpeg"), bytes: encrypted.byteLength, ...(durationMs ? { durationMs } : {}) };
      }
      const payload: EntryPayloadV1 = {
        v: 1,
        ...(text.trim() ? (current === "moment" ? { caption: text.trim().slice(0, 300) } : { text: text.trim().slice(0, 5000) }) : {}),
        ...(current === "feeling" ? { mood } : {}),
        ...(media ? { media } : {}),
      };
      const encryptedPayload = await encryptJson(key, payload, `entry:${userId}:${id}`);
      await api.createEntry({ p_id: id, p_kind: current, p_symbol: defaults[current], p_chapter_id: null, p_payload_enc: encryptedPayload.enc, p_payload_iv: encryptedPayload.iv, p_media_path: path, p_media_bytes: media?.bytes ?? 0, p_occurred_at: new Date().toISOString() });
      toast.success("Left safely in your garden.");
      await onSaved();
    } catch (error) {
      if (path) { try { await api.removeMedia([path]); } catch {} }
      toast.error(message(error));
    } finally {
      setSaving(false);
    }
  }

  const accept = current === "moment" ? "image/*" : "audio/*";
  const canSave = !saving && !recording && (!needsMedia || Boolean(file)) && (current !== "thought" || Boolean(text.trim()));
  return (
    <div className={styles.scrim}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-label="Leave something here">
        <button className={styles.close} onClick={onClose} aria-label="Close"><X /></button>
        <h2>Leave something here</h2>
        <div className={styles.kindGrid}>
          {(["moment", "voice", "thought", "feeling"] as JournalKind[]).map((item) => (
            <button type="button" className={current === item ? styles.selected : ""} onClick={() => chooseKind(item)} key={item} disabled={recording}>
              {item === "moment" ? <Camera /> : item === "voice" ? <Mic /> : item === "thought" ? <PenLine /> : <CloudSun />}<span>A {item}</span>
            </button>
          ))}
        </div>
        {current === "feeling" && <div className={styles.moods}>{moods.map((item) => <button type="button" className={mood === item ? styles.selected : ""} onClick={() => setMood(item)} key={item}>{item}</button>)}</div>}
        {needsMedia && (
          <div className={mediaStyles.mediaPicker}>
            <input ref={fileInput} className={mediaStyles.fileInput} type="file" accept={accept} onChange={selectFile} aria-label={current === "moment" ? "Choose an image" : "Choose an audio file"} />
            <div className={mediaStyles.mediaActions}>
              <button type="button" className="btn" disabled={saving || recording} onClick={() => fileInput.current?.click()}>
                {current === "moment" ? <Camera size={17} /> : <Mic size={17} />}
                {current === "moment" ? "Choose photo" : "Choose from device"}
              </button>
              {current === "voice" && (
                <button type="button" className="btn" disabled={saving} onClick={() => recording ? stopRecording() : void startRecording()}>
                  {recording ? <Square size={16} /> : <Mic size={17} />}
                  {recording ? `Stop recording · ${formatDuration(recordingMs)}` : "Record voice note"}
                </button>
              )}
            </div>
            {recording && <p className={mediaStyles.recordingStatus} role="status">Recording voice note · {formatDuration(recordingMs)}</p>}
            {file && (
              <div className={mediaStyles.mediaPreview}>
                {previewUrl && file.type.startsWith("image/") && <img src={previewUrl} alt={`Selected photo: ${file.name}`} />}
                {previewUrl && file.type.startsWith("audio/") && <audio controls preload="metadata" src={previewUrl} />}
                <div className={mediaStyles.fileDetails}><strong>{file.name}</strong><small>{(file.size / (1024 * 1024)).toFixed(1)} MB{durationMs ? ` · ${formatDuration(durationMs)}` : ""}</small></div>
                <button type="button" className={mediaStyles.removeMedia} aria-label="Remove selected file" onClick={() => { setFile(null); setDurationMs(undefined); }}><X size={18} /></button>
              </div>
            )}
          </div>
        )}
        <textarea className="input" maxLength={current === "moment" ? 300 : 5000} placeholder={current === "feeling" ? "Anything you want to add?" : current === "moment" ? "A caption (optional)" : "Describe it"} value={text} onChange={(event) => setText(event.target.value)} />
        <button className="btn btn-primary" disabled={!canSave} onClick={() => void save()}><Lock size={16} />Leave it here</button>
      </section>
    </div>
  );
}

function EntryViewer({ entry, userId, onClose, onDeleted }: { entry: DecryptedEntry; userId: string; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const mediaMime = entry.payload.media?.mime || (entry.kind === "voice" ? "audio/webm" : "image/jpeg");

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setMediaUrl(null);
    setMediaError(false);
    const key = getSessionKey();
    if (entry.media_path && key) {
      void (async () => {
        try {
          const encrypted = await api.downloadMedia(entry.media_path!);
          const decrypted = await decryptBytes(key, encrypted, `media:${userId}:${entry.id}`);
          const bytes = new Uint8Array(decrypted.byteLength);
          bytes.set(decrypted);
          const blob = new Blob([bytes.buffer], { type: mediaMime });
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setMediaUrl(objectUrl);
        } catch {
          if (!cancelled) setMediaError(true);
        }
      })();
    } else if (entry.media_path) {
      setMediaError(true);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry.id, entry.media_path, mediaMime, userId]);

  async function remove() {
    if (!confirm("Delete this? It can't be undone.")) return;
    setBusy(true);
    try {
      const path = await api.deleteEntry(entry.id);
      if (path) await api.removeMedia([path]);
      await onDeleted();
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.scrim}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-label="Journal entry">
        <button className={styles.close} onClick={onClose} aria-label="Close"><X /></button>
        <p>{new Date(entry.occurred_at).toLocaleString()}</p>
        <h2><Symbol symbol={entry.symbol} /> {entry.kind}</h2>
        <p><Lock size={14} /> Only me</p>
        <p className={styles.entryText}>{entry.payload.text || entry.payload.caption || (entry.kind === "voice" ? "Voice note" : "Photo")}</p>
        {entry.media_path && (
          <div className={mediaStyles.savedMedia}>
            {mediaUrl && mediaMime.startsWith("image/") && <img src={mediaUrl} alt="Journal attachment" />}
            {mediaUrl && mediaMime.startsWith("audio/") && <audio controls preload="metadata" src={mediaUrl} />}
            {mediaUrl && !mediaMime.startsWith("image/") && !mediaMime.startsWith("audio/") && <a className="btn" href={mediaUrl} download={`garden-${entry.kind}-attachment`}>Download attachment</a>}
            {!mediaUrl && mediaError && <p role="alert">This attachment could not be opened on this device.</p>}
            {!mediaUrl && !mediaError && <p role="status">Opening encrypted attachment…</p>}
          </div>
        )}
        <button className="btn" disabled={busy} onClick={() => void remove()}>Delete</button>
      </section>
    </div>
  );
}
function JournalSettings({ settings, onClose, onChange, onLock }: { settings: { autoLock: number; calm: boolean }; onClose: () => void; onChange: (settings: { autoLock: number; calm: boolean }) => void; onLock: () => void }) { async function setAutoLock(autoLock: number) { await api.updateSettings(autoLock); onChange({ ...settings, autoLock }); } function setCalm(calm: boolean) { localStorage.setItem("kiki-journal-calm", calm ? "1" : "0"); onChange({ ...settings, calm }); } return <div className={styles.scrim}><section className={styles.sheet} role="dialog" aria-modal="true" aria-label="Journal settings"><button className={styles.close} onClick={onClose}><X/></button><p className={styles.sheetEyebrow}>Journal controls</p><h2>Settings</h2><label>Auto-lock<select className="input" value={settings.autoLock} onChange={(event) => void setAutoLock(Number(event.target.value))}>{[60,300,900].map((value) => <option value={value} key={value}>{value === 60 ? "1 minute" : `${value / 60} minutes`}</option>)}</select></label><label className={styles.settingToggle}><span>Calm mode<small>Reduce garden motion</small></span><input type="checkbox" checked={settings.calm} onChange={(event) => setCalm(event.target.checked)}/></label><p>Without your lock or your recovery code, the journal cannot be recovered by anyone, including us.</p><button className={styles.setupSecondary} onClick={onLock}>Lock journal now</button></section></div>; }