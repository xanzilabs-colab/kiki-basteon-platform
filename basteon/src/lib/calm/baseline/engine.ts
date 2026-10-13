export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const COLORS = ["red", "blue", "green", "yellow", "orange", "grey"] as const;
export const ITEMS = ["bag", "umbrella", "phone", "coffee", "none"] as const;
export type Color = (typeof COLORS)[number];
export type Item = (typeof ITEMS)[number];
export type Zone = "door" | "counter" | "window" | "centre";

export interface Exit { id: string; label: string; x: number; y: number }
export interface Template { id: string; name: string; width: number; height: number; exits: Exit[]; windowLabel: string }
export interface Person { id: number; x: number; y: number; zone: Zone; color: Color; item: Item; pose: "standing" | "sitting" }
export interface Scene { template: string; seed: number; people: Person[]; exits: Exit[] }

export const TEMPLATES: Template[] = [
  { id: "cafe", name: "Corner café", width: 100, height: 60, windowLabel: "by the window",
    exits: [{ id: "front", label: "the front door", x: 50, y: 58 }, { id: "side", label: "the side door", x: 98, y: 30 }] },
  { id: "platform", name: "Station platform", width: 100, height: 60, windowLabel: "by the wall",
    exits: [{ id: "stairs", label: "the stairs", x: 50, y: 58 }, { id: "far", label: "the far exit", x: 2, y: 30 }, { id: "lift", label: "the lift", x: 98, y: 8 }] },
];

export const LEVELS = {
  1: { people: 4, studyMs: 9000, questions: 3, change: false },
  2: { people: 6, studyMs: 8000, questions: 4, change: true },
  3: { people: 8, studyMs: 7000, questions: 4, change: true },
} as const;
export type Level = 1 | 2 | 3;

const zoneOf = (x: number, y: number): Zone =>
  x < 22 ? "window" : y > 46 && Math.abs(x - 50) < 22 ? "door" : x > 68 && y < 26 ? "counter" : "centre";

export function generateScene(seed: number, level: Level): Scene {
  const rng = mulberry32(seed);
  const tpl = TEMPLATES[Math.floor(rng() * TEMPLATES.length)];
  const n = LEVELS[level].people;
  const spots: { x: number; y: number }[] = [];
  for (let x = 8; x <= 92; x += 12) for (let y = 8; y <= 52; y += 11) spots.push({ x, y });
  spots.sort(() => rng() - 0.5);
  const chosen: { x: number; y: number }[] = [];
  for (const s of spots) {
    if (chosen.length >= n) break;
    if (chosen.every((c) => Math.hypot(c.x - s.x, c.y - s.y) >= 16)) chosen.push(s);
  }
  const colours = [...COLORS].sort(() => rng() - 0.5);
  const people: Person[] = chosen.map((s, i) => ({
    id: i, x: s.x, y: s.y, zone: zoneOf(s.x, s.y),
    color: colours[i % colours.length],
    item: ITEMS[Math.floor(rng() * ITEMS.length)],
    pose: rng() < 0.4 ? "sitting" : "standing",
  }));
  return { template: tpl.id, seed, people, exits: tpl.exits };
}

export interface Question { id: string; kind: "exits" | "colour" | "count" | "yesno" | "change"; text: string; options: string[]; answer: number }

function numOptions(correct: number, rng: Rng): { options: string[]; answer: number } {
  const set = new Set<number>([correct]);
  const cand = [correct - 1, correct + 1, correct + 2, correct - 2].filter((v) => v >= 0);
  for (const v of cand.sort(() => rng() - 0.5)) { if (set.size >= 3) break; set.add(v); }
  const vals = [...set].sort((a, b) => a - b);
  return { options: vals.map(String), answer: vals.indexOf(correct) };
}

export function buildQuestions(scene: Scene, level: Level, rng: Rng): Question[] {
  const tpl = TEMPLATES.find((t) => t.id === scene.template)!;
  const qs: Question[] = [];
  const e = numOptions(scene.exits.length, rng);
  qs.push({ id: "exits", kind: "exits", text: "How many ways out did you notice?", ...e });
  const ex = scene.exits[0];
  const byDist = [...scene.people].map((p) => ({ p, d: Math.hypot(p.x - ex.x, p.y - ex.y) })).sort((a, b) => a.d - b.d);
  if (byDist.length > 1 && byDist[1].d - byDist[0].d >= 10) {
    const right = byDist[0].p.color;
    const opts = [right, ...COLORS.filter((c) => c !== right).sort(() => rng() - 0.5).slice(0, 2)].sort(() => rng() - 0.5);
    qs.push({ id: "colour", kind: "colour", text: `What colour was the top of the person closest to ${ex.label}?`, options: opts, answer: opts.indexOf(right) });
  }
  const bags = scene.people.filter((p) => p.item === "bag").length;
  qs.push({ id: "bags", kind: "count", text: "How many people were carrying a bag?", ...numOptions(bags, rng) });
  const sitting = scene.people.some((p) => p.zone === "window" && p.pose === "sitting");
  qs.push({ id: "sit", kind: "yesno", text: `Was anyone sitting ${tpl.windowLabel}?`, options: ["Yes", "No"], answer: sitting ? 0 : 1 });
  return qs.slice(0, LEVELS[level].questions);
}

export type ChangeKind = "left" | "colour" | "item";
export function applyChange(scene: Scene, rng: Rng): { scene: Scene; kind: ChangeKind } {
  const people = scene.people.map((p) => ({ ...p }));
  const kinds: ChangeKind[] = ["left", "colour", "item"];
  const kind = kinds[Math.floor(rng() * kinds.length)];
  const i = Math.floor(rng() * people.length);
  if (kind === "left" && people.length > 2) people.splice(i, 1);
  else if (kind === "colour") {
    const others = COLORS.filter((c) => c !== people[i].color);
    people[i].color = others[Math.floor(rng() * others.length)];
    return { scene: { ...scene, people }, kind: "colour" };
  } else if (kind === "item" || people.length <= 2) {
    people[i].item = people[i].item === "bag" ? "none" : "bag";
    return { scene: { ...scene, people }, kind: "item" };
  }
  return { scene: { ...scene, people }, kind: "left" };
}

export const CHANGE_OPTIONS = ["Someone left", "A top colour changed", "A bag appeared or disappeared"];
export const changeAnswer = (k: ChangeKind) => (k === "left" ? 0 : k === "colour" ? 1 : 2);

export function sessionSummary(results: boolean[]) {
  const correct = results.filter(Boolean).length;
  return { correct, total: results.length, pct: results.length ? Math.round((correct / results.length) * 100) : 0 };
}

export function nextLevel(current: Level, recentPct: number[]): Level {
  const lastTwo = recentPct.slice(-2);
  return current < 3 && lastTwo.length === 2 && lastTwo.every((p) => p >= 75) ? ((current + 1) as Level) : current;
}
