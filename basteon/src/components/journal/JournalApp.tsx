"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Barlow } from "next/font/google";
import { ArrowLeft, Camera, ChevronsUpDown, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudSun, Eye, EyeOff, Image as ImageIcon, Info, KeyRound, List, Lock, Mic, Pause, PenLine, Play, Plus, Rainbow, Settings, Sprout, Square, Sun, Trash2, Trees, Wind, X } from "lucide-react";
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

const barlow = Barlow({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--jr-disp", display: "swap" });
type DecryptedEntry = JournalEntryRow & { payload: EntryPayloadV1 };
type Gate = "loading" | "setup" | "unlock" | "recovery";
const defaults: Record<JournalKind, JournalSymbol> = { moment: "flower", voice: "lantern", thought: "butterfly", feeling: "cloud" };
const moods: Mood[] = ["sunny", "breezy", "cloudy", "drizzle", "storm", "fog", "rainbow"];
const MOOD_ICON: Record<Mood, typeof Sun> = { sunny: Sun, breezy: Wind, cloudy: Cloud, drizzle: CloudDrizzle, storm: CloudLightning, fog: CloudFog, rainbow: Rainbow };
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
  if (gate === "loading") return <main className={`${styles.loading} ${barlow.variable}`}>Opening your garden...</main>;
  if (!unlocked) return <main className={`${styles.shell} ${barlow.variable}`}>{gate === "setup" ? <Setup userId={userId} onReady={() => setGate("unlock")} /> : gate === "recovery" ? <Recovery onBack={() => setGate("unlock")} onUnlocked={() => undefined} /> : <Unlock onRecovery={() => setGate("recovery")} onUnlocked={() => undefined} />}</main>;
  return <main className={`${styles.shell} ${barlow.variable} ${settings.calm ? styles.calm : ""}`}>{list ? <JournalGarden entries={entries} calm={settings.calm} list={list} onList={() => setList(!list)} onSelect={setSelected} onLeave={() => setComposer("thought")} /> : <GardenScene entries={entries} calm={settings.calm} onList={() => setList(true)} onSelect={setSelected} onLeave={() => setComposer("thought")} />}<div className={styles.topActions}><button aria-label="Quick hide" title="Quick hide" onClick={() => { lock(); location.assign("/"); }}><EyeOff /></button><button aria-label="Journal settings" title="Journal settings" onClick={() => setSettingsOpen(true)}><Settings /></button></div>{composer && <LeaveSheet kind={composer} userId={userId!} onClose={() => setComposer(null)} onSaved={async () => { setComposer(null); await loadEntries(); }} />}{selected && <EntryViewer entry={selected} userId={userId!} onClose={() => setSelected(null)} onDeleted={async () => { setSelected(null); await loadEntries(); }} />}{settingsOpen && <JournalSettings settings={settings} onClose={() => setSettingsOpen(false)} onChange={setSettings} onLock={lock} />}</main>;
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
  const [secret, setSecret] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [show, setShow] = useState(false);
  async function open() { setBusy(true); setError(""); try { const keys = await api.getKeys(); if (!keys) return; const kek = await deriveKek(secret, fromB64(keys.salt), keys.kdf_iterations); setSessionKey(await unwrapDek(keys.wrapped_dek, keys.wrap_iv, kek)); onUnlocked(); } catch { setError("That lock does not match. Try again."); } finally { setBusy(false); } }
  return <section className={`${styles.setupScreen} ${styles.lockScreen}`}><div className={styles.setupIntro}><a className={styles.setupBack} href="/account" aria-label="Back to account"><ArrowLeft size={24}/>Back</a><div className={styles.treeTile}><Trees size={30}/></div><p>Your private journal</p><h1>Welcome back.</h1><span>Your garden is still yours. Enter your lock to open it on this device.</span></div><form className={`${styles.setupForm} ${styles.unlockCard}`} onSubmit={(event) => { event.preventDefault(); if (secret && !busy) void open(); }}><label htmlFor="journal-lock">Enter your lock</label><div className={`${styles.pw} ${error ? styles.pwErr : ""}`}><input id="journal-lock" className={styles.pwInput} autoFocus type={show ? "text" : "password"} placeholder="Your lock" autoComplete="current-password" value={secret} onChange={(event) => setSecret(event.target.value)} aria-describedby="journal-lock-err" /><button type="button" className={styles.eye} aria-label={show ? "Hide lock" : "Show lock"} onClick={() => setShow(!show)}>{show ? <EyeOff size={22}/> : <Eye size={22}/>}</button></div><p id="journal-lock-err" className={styles.unlockError} role="alert">{error}</p><div className={styles.lockStack}><button type="submit" className={styles.setupPrimary} disabled={busy || !secret}><Lock size={20}/>{busy ? "Opening your garden..." : "Open garden"}</button><button type="button" className={styles.setupGhost} onClick={onRecovery}>Forgot your lock?</button></div><p className={styles.only}><Lock size={16}/>Only you can open this journal.</p></form></section>;
}
function Recovery({ onBack, onUnlocked }: { onBack: () => void; onUnlocked: () => void }) { const [code, setCode] = useState(""); const [secret, setSecret] = useState(""); const [error, setError] = useState(""); async function recover() { const bytes = parseRecoveryCode(code); if (!bytes) return setError("That code doesn't match."); try { const keys = await api.getKeys(); if (!keys?.recovery_wrapped_dek || !keys.recovery_iv) throw new Error(); const dek = await unwrapDek(keys.recovery_wrapped_dek, keys.recovery_iv, await recoveryKeyFromBytes(bytes), true); const bundle = await createKeyBundle(secret); const raw = await crypto.subtle.exportKey("raw", dek); const main = await (await import("@/lib/journal/crypto")).wrapDek(await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]), await deriveKek(secret, fromB64(bundle.rpcArgs.p_salt), bundle.rpcArgs.p_kdf_iterations)); await api.rewrapKeys({ p_kdf_iterations: bundle.rpcArgs.p_kdf_iterations, p_salt: bundle.rpcArgs.p_salt, p_wrapped_dek: main.wrapped, p_wrap_iv: main.iv }); setSessionKey(await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])); onUnlocked(); } catch { setError("That code doesn't match."); } } return <section className={styles.card}><KeyRound size={36}/><h1>Recovery</h1><p>Without your lock or your recovery code, the journal can&apos;t be opened. You can reset it, which deletes everything.</p><label>Recovery code<input className="input" value={code} onChange={(event) => setCode(event.target.value)} /></label><label>New lock<input className="input" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<button className="btn btn-primary" disabled={secret.length < 6} onClick={() => void recover()}>Open and change lock</button><button className="btn btn-ghost" onClick={onBack}>Back</button></section>; }
function JournalGarden({ entries, calm, list, onList, onSelect, onLeave }: { entries: DecryptedEntry[]; calm: boolean; list: boolean; onList: () => void; onSelect: (entry: DecryptedEntry) => void; onLeave: () => void }) { const [now, setNow] = useState(new Date()); useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []); const phase = skyPhase(now); const colors = SKY[phase.phase]; const ordered = useMemo(() => [...entries].sort((a,b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)), [entries]); const layout = layoutWorld(ordered.map((entry) => ({ id: entry.id, chapterId: entry.chapter_id }))); const mood = [...entries].sort((a,b) => Date.parse(b.occurred_at)-Date.parse(a.occurred_at)).find((entry) => entry.payload.mood && entry.occurred_at.slice(0,10) === localDate())?.payload.mood; if (list) return <ListView entries={entries} onList={onList} onSelect={onSelect} onLeave={onLeave} />; return <section className={styles.world} aria-label="Your garden, with journal entries along a path"><div className={styles.worldHeader}><h1>Your garden</h1><button className="btn" onClick={onList}><List size={16}/>List</button></div><svg viewBox={`0 0 ${Math.max(layout.width, 900)} 480`} preserveAspectRatio="xMidYMid slice" style={{ background: `linear-gradient(${colors.top}, ${colors.bottom})` }}><path d="M0 270 Q200 210 390 270 T760 245 T1200 260 V480H0Z" fill={colors.far}/><path d="M0 315 Q200 250 450 330 T900 290 T1400 310 V480H0Z" fill={colors.mid}/><path d="M0 350 Q260 300 520 365 T1000 335 T1400 360 V480H0Z" fill={colors.ground}/><path d="M0 420 Q190 330 400 410 T800 390 T1400 405" fill="none" stroke="#d9c6a4" strokeWidth="28" opacity=".75"/><circle cx={phase.sunProgress === null ? 770 : 100 + phase.sunProgress * 700} cy={phase.phase === "night" ? 80 : 90} r="28" fill={phase.phase === "night" ? "#f4edcf" : "#ffd27a"}/>{jacarandaInBloom(now) && <circle cx="780" cy="220" r="72" fill="#b79cf2" opacity=".85"/>}<text x="770" y="330" fill="#fff" fontSize="18">Still writing this one.</text>{layout.placed.map((placed) => { const entry = entries.find((item) => item.id === placed.id)!; return <g key={placed.id} transform={`translate(${placed.x} ${365 - placed.y * 110}) scale(${placed.scale})`} onClick={() => onSelect(entry)} className={styles.entry}><circle r="31" fill="#000" opacity=".12" transform="translate(5 26)"/><foreignObject x="-27" y="-27" width="54" height="54"><div className={styles.symbol}><Symbol symbol={entry.symbol}/></div></foreignObject></g>; })}</svg>{mood && <p className={styles.weather}>{mood}</p>}{entries.length === 0 && <button className={styles.first} onClick={onLeave}>This is your garden. Leave something here.</button>}</section>; }
const KIND_LABEL: Record<JournalKind, string> = { moment: "Moment", voice: "Voice", thought: "Thought", feeling: "Feeling" };
const KIND_TILE: Record<JournalKind, string> = { moment: "#f8dcea", voice: "#e3d7f8", thought: "#f3e7d4", feeling: "#dccbe9" };
const KIND_ICON = { moment: Camera, voice: Mic, thought: PenLine, feeling: CloudSun };
function dayLabel(value: string) { const date = new Date(value); const today = new Date(); const yesterday = new Date(); yesterday.setDate(today.getDate() - 1); if (date.toDateString() === today.toDateString()) return "Today"; if (date.toDateString() === yesterday.toDateString()) return "Yesterday"; return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }); }
function ListView({ entries, onList, onSelect, onLeave }: { entries: DecryptedEntry[]; onList: () => void; onSelect: (entry: DecryptedEntry) => void; onLeave: () => void }) {
  const [filter, setFilter] = useState<JournalKind | "all">("all"); const [hide, setHide] = useState(false);
  const sorted = [...entries].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)); const shown = sorted.filter((entry) => filter === "all" || entry.kind === filter);
  const groups: { label: string; items: DecryptedEntry[] }[] = []; shown.forEach((entry) => { const label = dayLabel(entry.occurred_at); const last = groups[groups.length - 1]; if (last?.label === label) last.items.push(entry); else groups.push({ label, items: [entry] }); });
  const kinds: (JournalKind | "all")[] = ["all", "moment", "voice", "thought", "feeling"];
  return <section className={`${styles.listView} ${hide ? styles.hidePreview : ""}`} aria-label="Journal list">
    <div className={styles.listHead}><p className={styles.eyebrow}>{entries.length} {entries.length === 1 ? "entry" : "entries"}</p><h1>Garden</h1><div className={`${styles.gseg} ${styles.gsegList}`} role="tablist" aria-label="View"><i className={`${styles.thumb} ${styles.thumbRight}`} /><button role="tab" aria-selected="false" onClick={onList}><Trees size={18}/>Garden</button><button role="tab" aria-selected="true"><List size={18}/>List</button></div><button className={`${styles.gb} ${styles.hideBtn}`} aria-pressed={hide} aria-label="Hide previews" onClick={() => setHide(!hide)}><EyeOff size={22}/></button></div>
    <div className={styles.listBody}>
      <div className={styles.chips}>{kinds.map((kind) => <button key={kind} className={`${styles.chip} ${filter === kind ? styles.chipOn : ""}`} onClick={() => setFilter(kind)}>{kind === "all" ? "All" : KIND_LABEL[kind]}<b>{kind === "all" ? entries.length : entries.filter((entry) => entry.kind === kind).length}</b></button>)}</div>
      {groups.map((group) => <div key={group.label}><div className={styles.dlabel}>{group.label}</div><div className={styles.grp}>{group.items.map((entry) => { const Icon = KIND_ICON[entry.kind]; const time = new Date(entry.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); return <button key={entry.id} className={styles.er} onClick={() => onSelect(entry)}><span className={styles.tile} style={{ background: KIND_TILE[entry.kind] }}><Icon size={22}/></span><span className={styles.erText}><b className={styles.rt}>{entry.payload.text?.slice(0, 80) || entry.payload.caption || (entry.kind === "voice" ? "Voice note" : entry.kind === "moment" ? "Photo" : KIND_LABEL[entry.kind])}</b><span>{KIND_LABEL[entry.kind]} · {time}</span></span></button>; })}</div></div>)}
      {!groups.length && <div className={styles.empty}><div className={styles.emptyIll}><Sprout size={30}/></div><h3>Nothing here yet</h3><p>Leave a photo, a voice, a thought, or a feeling and it will bloom in your garden.</p></div>}
    </div>
    <div className={`${styles.gpanel} ${styles.gpanelList}`}><button className={styles.violetBtn} onClick={onLeave}><Plus size={22}/>Leave something here</button></div>
  </section>;
}
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
    <div className={styles.scrim} onClick={(event) => { if (event.target === event.currentTarget && !recording) onClose(); }}>
      <section className={`${styles.sheet} ${styles.leaveSheet}`} role="dialog" aria-modal="true" aria-label="Leave something here">
        <div className={styles.grab} />
        <div className={styles.shScroll}>
          <div className={styles.shTop}><h2>Leave something here</h2><button className={styles.x} onClick={onClose} aria-label="Close"><X size={18} /></button></div>
          <div className={styles.types} role="tablist">
            {(["moment", "voice", "thought", "feeling"] as JournalKind[]).map((item) => (
              <button type="button" role="tab" aria-selected={current === item} className={`${styles.optB} ${current === item ? styles.optOn : ""}`} onClick={() => chooseKind(item)} key={item} disabled={recording}>
                {item === "moment" ? <Camera size={24} /> : item === "voice" ? <Mic size={24} /> : item === "thought" ? <PenLine size={24} /> : <CloudSun size={24} />}{item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          {current === "thought" && <><span className={styles.label}>What&apos;s on your mind?</span><textarea className={styles.ta} style={{ minHeight: 150 }} maxLength={5000} placeholder="Write it down. It stays between you and the garden." value={text} onChange={(event) => setText(event.target.value)} /></>}
          {current === "feeling" && <><span className={styles.label}>How does it feel?</span><div className={styles.wx}>{moods.map((item) => { const Icon = MOOD_ICON[item]; return <button type="button" key={item} className={`${styles.optB} ${mood === item ? styles.optOn : ""}`} onClick={() => setMood(item)}><Icon size={24} />{item[0].toUpperCase() + item.slice(1)}</button>; })}</div><span className={styles.label}>Anything you want to add? <span className={styles.opt}>· optional</span></span><textarea className={styles.ta} style={{ minHeight: 96 }} maxLength={5000} placeholder="A few words" value={text} onChange={(event) => setText(event.target.value)} /></>}
          {current === "moment" && (
            <>
              <span className={styles.label}>Photo</span>
              <input ref={fileInput} className={mediaStyles.fileInput} id="journal-photo-library" type="file" accept="image/*" onChange={selectFile} aria-label="Choose an image" />
              <input className={mediaStyles.fileInput} id="journal-photo-camera" type="file" accept="image/*" capture="environment" onChange={selectFile} aria-label="Take a photo" />
              {file && previewUrl && file.type.startsWith("image/") ? (
                <div className={styles.ph}><img src={previewUrl} alt={`Selected photo: ${file.name}`} /><button type="button" className={styles.rm} aria-label="Remove photo" onClick={() => { setFile(null); setDurationMs(undefined); }}><X size={16} /></button></div>
              ) : (
                <div className={styles.drop}><div className={styles.dropIc}><ImageIcon size={26} /></div><b>Add a photo</b><span>Take one now or pick from your library.</span><div className={styles.two}><label htmlFor="journal-photo-camera" className={styles.tonalBtn}><Camera size={20} />Take</label><label htmlFor="journal-photo-library" className={styles.tonalBtn}><ImageIcon size={20} />Library</label></div></div>
              )}
              <span className={styles.label}>Caption <span className={styles.opt}>· optional</span></span><textarea className={styles.ta} style={{ minHeight: 84 }} maxLength={300} placeholder="A caption" value={text} onChange={(event) => setText(event.target.value)} />
            </>
          )}
          {current === "voice" && (
            <>
              <span className={styles.label}>Voice note</span>
              <input ref={fileInput} className={mediaStyles.fileInput} id="journal-audio-file" type="file" accept="audio/*" onChange={selectFile} aria-label="Choose an audio file" />
              {recording ? (
                <div className={styles.rec}><div className={styles.tm}><span className={styles.recdot} />{formatDuration(recordingMs)}</div><div className={styles.live} aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i key={index} style={{ "--h": `${12 + Math.round(Math.abs(Math.sin(index * 1.7)) * 26)}px`, "--d": `${(index % 7) / 9}s` } as React.CSSProperties} />)}</div><button type="button" className={styles.recbtn} onClick={() => stopRecording()} aria-label="Stop recording"><Square size={30} /></button><span className={styles.hint} role="status">Recording… tap to stop</span></div>
              ) : file && previewUrl && file.type.startsWith("audio/") ? (
                <AudioPlayer src={previewUrl} fallbackMs={durationMs} onRemove={() => { setFile(null); setDurationMs(undefined); }} />
              ) : (
                <div className={styles.rec}><button type="button" className={styles.recbtn} disabled={saving} onClick={() => void startRecording()} aria-label="Start recording"><Mic size={32} /></button><b className={styles.recTitle}>Tap to record</b><span className={styles.hint}>Or <label htmlFor="journal-audio-file" className={styles.linkb}>choose a file</label></span></div>
              )}
              <span className={styles.label}>Caption <span className={styles.opt}>· optional</span></span><textarea className={styles.ta} style={{ minHeight: 84 }} maxLength={5000} placeholder="A caption" value={text} onChange={(event) => setText(event.target.value)} />
            </>
          )}
        </div>
        <div className={styles.shFoot}>
          <p className={styles.only}><Lock size={16} />Only me. Saved to your private journal.</p>
          <button className={styles.violetBtn} disabled={!canSave} onClick={() => void save()}><Lock size={20} />Leave it here</button>
        </div>
      </section>
    </div>
  );
}

function AudioPlayer({ src, fallbackMs, onRemove }: { src: string; fallbackMs?: number; onRemove?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null); const [playing, setPlaying] = useState(false); const [time, setTime] = useState(0); const [duration, setDuration] = useState((fallbackMs ?? 0) / 1000);
  const bars = useMemo(() => Array.from({ length: 30 }, (_, index) => Math.round(20 + 70 * Math.abs(Math.sin(index * .55 + 3) * Math.cos(index * .21 + 3.9)))), []);
  const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const filled = duration ? Math.round((time / duration) * bars.length) : 0;
  return <div className={styles.player}>
    <audio ref={audio} src={src} preload="metadata" onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }} onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)} />
    <button type="button" className={styles.plBtn} aria-label={playing ? "Pause" : "Play"} onClick={() => { const element = audio.current; if (!element) return; if (playing) { element.pause(); setPlaying(false); } else { void element.play(); setPlaying(true); } }}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
    <div className={styles.wave} onClick={(event) => { const element = audio.current; if (!element || !duration) return; const rect = event.currentTarget.getBoundingClientRect(); element.currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration; }}>{bars.map((height, index) => <i key={index} className={index < filled ? styles.waveOn : ""} style={{ height: `${height}%` }} />)}</div>
    <div className={styles.plTime}>{fmt(time)} / {fmt(duration)}</div>
    {onRemove && <button type="button" className={styles.plX} aria-label="Remove recording" onClick={onRemove}><X size={18} /></button>}
  </div>;
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

  const [confirming, setConfirming] = useState(false);
  const KindIcon = KIND_ICON[entry.kind]; const when = `${dayLabel(entry.occurred_at)} · ${new Date(entry.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; const body = entry.payload.text || entry.payload.caption;
  async function remove() {
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

  if (confirming) return (
    <div className={styles.scrim} onClick={(event) => { if (event.target === event.currentTarget) setConfirming(false); }}>
      <section className={`${styles.sheet} ${styles.leaveSheet}`} role="dialog" aria-modal="true" aria-label="Delete entry">
        <div className={styles.grab} />
        <div className={styles.shScroll}><div className={styles.conf}><div className={styles.confIll}><Trash2 size={30} /></div><h3>Delete this {entry.kind}?</h3><p>It will be removed from your garden for good. This can&apos;t be undone.</p></div></div>
        <div className={styles.shFoot}><button className={styles.delBtn} disabled={busy} onClick={() => void remove()}><Trash2 size={20} />Delete</button><button className={styles.tonalBtn} style={{ height: 56 }} onClick={() => setConfirming(false)}>Keep it</button></div>
      </section>
    </div>
  );

  return (
    <div className={styles.scrim} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`${styles.sheet} ${styles.leaveSheet}`} role="dialog" aria-modal="true" aria-label="Journal entry">
        <div className={styles.grab} />
        <div className={styles.shScroll}>
          <div className={styles.shTop} style={{ justifyContent: "flex-end", paddingBottom: 6 }}><button className={styles.x} onClick={onClose} aria-label="Close"><X size={18} /></button></div>
          <div className={styles.wxhero}><div className={styles.wxTile} style={{ background: KIND_TILE[entry.kind] }}><KindIcon size={32} /></div><div><b>{KIND_LABEL[entry.kind]}</b><span>{when}</span></div></div>
          {entry.kind === "thought" && body && <div className={styles.big}>{body}</div>}
          {entry.kind === "feeling" && body && <div className={styles.quote}>{body}</div>}
          {entry.media_path && (
            <div className={styles.viewerMedia}>
              {mediaUrl && mediaMime.startsWith("image/") && <div className={styles.ph}><img src={mediaUrl} alt="Journal attachment" /></div>}
              {mediaUrl && mediaMime.startsWith("audio/") && <AudioPlayer src={mediaUrl} fallbackMs={entry.payload.media?.durationMs} />}
              {mediaUrl && !mediaMime.startsWith("image/") && !mediaMime.startsWith("audio/") && <a className={styles.tonalBtn} href={mediaUrl} download={`garden-${entry.kind}-attachment`}>Download attachment</a>}
              {!mediaUrl && mediaError && <p role="alert" className={styles.cap}>This attachment could not be opened on this device.</p>}
              {!mediaUrl && !mediaError && <div className={styles.skel} role="status"><Lock size={18} />Opening encrypted attachment…</div>}
            </div>
          )}
          {(entry.kind === "moment" || entry.kind === "voice") && body && <div className={styles.cap}>{body}</div>}
          <p className={styles.only} style={{ marginTop: 6 }}><Lock size={16} />Only me</p>
        </div>
        <div className={styles.shFoot}><button className={styles.delBtn} disabled={busy} onClick={() => setConfirming(true)}><Trash2 size={20} />Delete</button></div>
      </section>
    </div>
  );
}
function JournalSettings({ settings, onClose, onChange, onLock }: { settings: { autoLock: number; calm: boolean }; onClose: () => void; onChange: (settings: { autoLock: number; calm: boolean }) => void; onLock: () => void }) {
  async function setAutoLock(autoLock: number) { await api.updateSettings(autoLock); onChange({ ...settings, autoLock }); }
  function setCalm(calm: boolean) { localStorage.setItem("kiki-journal-calm", calm ? "1" : "0"); onChange({ ...settings, calm }); }
  const options = [60, 300, 900, 1800];
  const values = options.includes(settings.autoLock) ? options : [...options, settings.autoLock].sort((a, b) => a - b);
  return <div className={styles.scrim} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`${styles.sheet} ${styles.leaveSheet}`} role="dialog" aria-modal="true" aria-label="Journal settings">
      <div className={styles.grab} />
      <div className={styles.shScroll}>
        <div className={styles.shTop}><div><span className={styles.eyebrowMuted}>Journal controls</span><h2>Settings</h2></div><button className={styles.x} onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className={styles.grp}>
          <div className={styles.rowi}><div className={styles.rowT}><b>Auto-lock</b><span>Lock after you&apos;ve been away</span></div><div className={styles.sel}><select aria-label="Auto-lock" value={settings.autoLock} onChange={(event) => void setAutoLock(Number(event.target.value))}>{values.map((value) => <option value={value} key={value}>{value === 60 ? "1 minute" : `${value / 60} minutes`}</option>)}</select><ChevronsUpDown size={18} /></div></div>
          <div className={styles.rowi}><div className={styles.rowT}><b>Calm mode</b><span>Reduce garden motion</span></div><label className={styles.sw}><input type="checkbox" aria-label="Calm mode" checked={settings.calm} onChange={(event) => setCalm(event.target.checked)} /><i /></label></div>
        </div>
        <div className={styles.callout}><Info size={22} /><div>Without your lock or your recovery code, the journal can&apos;t be recovered by anyone, including us.</div></div>
      </div>
      <div className={styles.shFoot}><button className={styles.plumBtn} onClick={onLock}><Lock size={20} />Lock journal now</button></div>
    </section>
  </div>;
}