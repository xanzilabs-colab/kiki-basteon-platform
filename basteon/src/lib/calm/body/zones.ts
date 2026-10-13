export const ZONES = [
  { id: "jaw", label: "Jaw", tip: "Let your tongue rest and soften your jaw." },
  { id: "neck", label: "Neck", tip: "Slowly turn your head side to side, as far as is comfortable." },
  { id: "shoulders", label: "Shoulders", tip: "Lift them to your ears, then let them drop. Three times." },
  { id: "chest", label: "Chest", tip: "Rest a hand there and breathe out slowly." },
  { id: "stomach", label: "Stomach", tip: "Rest a hand on your belly and breathe low and slow." },
  { id: "back", label: "Back", tip: "Roll your shoulders back and let your spine lengthen." },
  { id: "hands", label: "Hands", tip: "Squeeze gently, then open and shake them out." },
  { id: "legs", label: "Legs", tip: "Press your feet into the floor and notice the support." },
  { id: "feet", label: "Feet", tip: "Wiggle your toes and feel the ground." },
] as const;
export type ZoneId = (typeof ZONES)[number]["id"];
export type Intensity = 0 | 1 | 2 | 3;
export type ZoneMap = Partial<Record<ZoneId, Intensity>>;

export const INTENSITY_LABEL = ["Nothing", "A little", "Quite a bit", "A lot"] as const;
export const cycleIntensity = (i: Intensity | undefined): Intensity => (((i ?? 0) + 1) % 4) as Intensity;
export const activeZones = (m: ZoneMap) => (Object.entries(m) as [ZoneId, Intensity][]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
export const tipsFor = (m: ZoneMap) => activeZones(m).slice(0, 3).map(([id]) => ZONES.find((z) => z.id === id)!);
export const suggestBreathing = (m: ZoneMap) => activeZones(m).filter(([, v]) => v >= 3).length >= 2;

export interface BodySession { at: string; zones: ZoneMap; before?: number | null; after?: number | null }
export function summarize(sessions: BodySession[]) {
  const sums: Record<string, { total: number; n: number }> = {};
  for (const s of sessions) for (const [id, v] of Object.entries(s.zones)) if (v) (sums[id] ??= { total: 0, n: 0 }, sums[id].total += v!, sums[id].n++);
  const top = Object.entries(sums).map(([id, x]) => ({ id, avg: Math.round((x.total / x.n) * 10) / 10, n: x.n })).sort((a, b) => b.n - a.n || b.avg - a.avg).slice(0, 3);
  const rated = sessions.filter((s) => s.before != null && s.after != null);
  const helped = rated.length ? Math.round((rated.filter((s) => (s.after as number) > (s.before as number)).length / rated.length) * 100) : null;
  return { top, helpedPct: helped, count: sessions.length };
}
