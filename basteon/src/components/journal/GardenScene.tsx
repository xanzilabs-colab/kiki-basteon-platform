"use client";

import { useEffect, useMemo, useState } from "react";
import { List, Sparkles } from "lucide-react";
import type { EntryPayloadV1, JournalEntryRow, JournalSymbol, Mood } from "@/lib/journal/types";
import { layoutWorld } from "@/lib/journal/world/layout";
import { jacarandaInBloom, seasonOf, skyPhase } from "@/lib/journal/world/sky";
import styles from "./journal.module.css";

type GardenEntry = JournalEntryRow & { payload: EntryPayloadV1 };
type Props = { entries: GardenEntry[]; calm: boolean; onList: () => void; onSelect: (entry: GardenEntry) => void; onLeave: () => void };
const localDate = () => new Date().toLocaleDateString("en-CA");

export function GardenScene({ entries, calm, onList, onSelect, onLeave }: Props) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  const phase = skyPhase(now); const season = seasonOf(now); const isNight = phase.phase === "night" || phase.phase === "dusk";
  const ordered = useMemo(() => [...entries].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at)), [entries]);
  const layout = layoutWorld(ordered.map((entry) => ({ id: entry.id, chapterId: entry.chapter_id })));
  const mood = [...entries].sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at)).find((entry) => entry.payload.mood && entry.occurred_at.slice(0, 10) === localDate())?.payload.mood as Mood | undefined;
  return <section className={`${styles.garden} ${calm ? styles.gardenCalm : ""}`} aria-label="Your private journal garden">
    <div className={styles.gardenSky}>
      {isNight ? <div className={styles.stars} aria-hidden="true">{Array.from({ length: 20 }, (_, index) => <i key={index} style={{ left: `${(index * 37) % 96 + 2}%`, top: `${(index * 53) % 39 + 5}%`, animationDelay: `${index * -0.21}s` }} />)}</div> : <div className={styles.sun} aria-hidden="true" style={{ left: `${14 + (phase.sunProgress ?? .7) * 70}%` }} />}
      <div className={styles.clouds} aria-hidden="true"><i /><i /><i /></div><div className={styles.hillFar} aria-hidden="true" /><div className={styles.hillMid} aria-hidden="true" />
      <SeasonalTree jacaranda={jacarandaInBloom(now)} season={season} /><div className={styles.gardenGround} aria-hidden="true"><i className={styles.path} /><i className={styles.fence} /></div>
      {mood && <div className={`${styles.weatherLayer} ${styles[`weather${mood[0].toUpperCase()}${mood.slice(1)}`]}`} aria-hidden="true" />}
    </div>
    <header className={styles.gardenHeader}><div><p>{phase.phase === "golden" ? "Golden hour" : phase.phase === "night" ? "Quiet night" : "Your private place"}</p><h1>Garden</h1></div><button className={styles.gardenList} onClick={onList}><List size={17} /><span>List</span></button></header>
    <div className={styles.gardenWalk} style={{ width: `${Math.max(layout.width, 900)}px` }}>{layout.placed.map((placed) => { const entry = entries.find((item) => item.id === placed.id); return entry ? <button key={entry.id} className={`${styles.gardenEntry} ${styles[`depth${placed.layer}`]}`} style={{ left: `${placed.x}px`, bottom: `${64 + placed.y * 96}px`, transform: `translateX(-50%) scale(${placed.scale})` }} onClick={() => onSelect(entry)} aria-label={`Open ${entry.kind} from ${new Date(entry.occurred_at).toLocaleDateString()}`}><EntryToken symbol={entry.symbol} today={entry.occurred_at.slice(0, 10) === localDate()} /></button> : null; })}<span className={styles.writingSign}>Still writing<br />this one.</span></div>
    <div className={styles.gardenFooter}>{entries.length === 0 ? <button className={styles.gardenWelcome} onClick={onLeave}><Sparkles size={16} />This is your garden. Leave something here.</button> : <button className={styles.gardenPrompt} onClick={onLeave}><span>Give me one moment</span><small>A photo, a voice, a thought, or a feeling.</small></button>}</div>
  </section>;
}

function SeasonalTree({ jacaranda, season }: { jacaranda: boolean; season: string }) {
  const leaves = jacaranda ? "#b79cf2" : season === "autumn" ? "#dd9e7b" : season === "winter" ? "#8d7191" : "#c787b7";
  return <svg className={styles.tree} viewBox="0 0 180 250" aria-hidden="true"><path d="M104 245c-5-61 4-88-29-135m30 92c15-55 41-80 41-120m-42 70C73 108 61 81 60 51" fill="none" stroke="#694e55" strokeWidth="11" strokeLinecap="round" />{season !== "winter" && <g fill={leaves}>{[[65,42,28],[100,33,33],[137,49,28],[49,75,30],[100,76,39],[147,89,29],[71,112,32],[123,115,35]].map(([cx,cy,r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} opacity=".96" />)}</g>}{jacaranda && <g fill="#f7c1df" opacity=".86"><circle cx="42" cy="148" r="3"/><circle cx="149" cy="150" r="3"/><circle cx="132" cy="171" r="2"/></g>}</svg>;
}

function EntryToken({ symbol, today }: { symbol: JournalSymbol; today: boolean }) {
  return <span className={styles.entryToken}><span className={styles.entryShadow} />{today && <span className={styles.entrySparkle}>*</span>}<svg viewBox="0 0 48 48" aria-hidden="true">{symbol === "flower" && <><path d="M24 45V27" stroke="#3e7d68" strokeWidth="2.5" strokeLinecap="round"/><g fill="#f0629f"><circle cx="24" cy="12" r="6"/><circle cx="33" cy="19" r="6"/><circle cx="30" cy="29" r="6"/><circle cx="18" cy="29" r="6"/><circle cx="15" cy="19" r="6"/></g><circle cx="24" cy="22" r="4" fill="#ffd27a"/></>}{symbol === "stone" && <path d="M8 40C6 32 12 22 22 20c10-2 20 6 18 18-1 4-4 6-10 6H16c-5 0-7-2-8-4Z" fill="#a89bb8"/>}{symbol === "star" && <path d="m24 6 4.7 12.5 13.4.6-10.5 8.4 3.6 12.9L24 33l-11.2 7.4 3.6-12.9L5.9 19.1l13.4-.6Z" fill="#ffd27a"/>}{symbol === "butterfly" && <g fill="#b79cf2"><path d="M24 24C14 6 4 12 8 24c2 6 10 6 16 0Z"/><path d="M24 24C34 6 44 12 40 24c-2 6-10 6-16 0Z"/><path d="M24 24c-8 4-14 16-8 18 4 1 8-8 8-18Z" fill="#ffb7d5"/><path d="M24 24c8 4 14 16 8 18-4 1-8-8-8-18Z" fill="#ffb7d5"/></g>}{symbol === "key" && <g fill="none" stroke="#7c54d6" strokeWidth="4" strokeLinecap="round"><circle cx="16" cy="16" r="8"/><path d="m22 22 18 18m-6-6 4-4m0 8 4-4"/></g>}{symbol === "lantern" && <><path d="M18 8h12M20 8v5m8-5v5" stroke="#4a2e94" strokeWidth="2.5" strokeLinecap="round"/><path d="M16 14h16l2 22c0 4-4 6-10 6s-10-2-10-6Z" fill="#f3edff" stroke="#4a2e94" strokeWidth="2"/><ellipse cx="24" cy="30" rx="5" ry="7" fill="#ffd27a"/></>}{symbol === "cloud" && <path d="M14 36a8 8 0 0 1 0-16 10 10 0 0 1 19-2 8 8 0 0 1 1 18Z" fill="#e3d6ff"/>}</svg></span>;
}