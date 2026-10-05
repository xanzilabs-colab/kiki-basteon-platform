export const STEP = 132;
export const CHAPTER_GAP = 220;
export const PAD_LEFT = 240;
export const PAD_RIGHT = 360;
export type LayoutInput = { id: string; chapterId: string | null };
export type Placed = { id: string; x: number; y: number; scale: number; layer: 0 | 1 | 2 };
function fnv1a(value: string): number { let hash = 0x811c9dc5; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; } return hash >>> 0; }
const LAYER_Y = [0, .18, .34]; const LAYER_SCALE = [1, .82, .66];
export function layoutWorld(entries: LayoutInput[]) { const placed: Placed[] = []; const signs: { chapterId: string; x: number }[] = []; let x = PAD_LEFT; let previousChapter: string | null | undefined; for (const entry of entries) { if (previousChapter !== undefined && entry.chapterId !== previousChapter) { x += CHAPTER_GAP; if (entry.chapterId) signs.push({ chapterId: entry.chapterId, x: x - CHAPTER_GAP * .5 }); } else if (previousChapter === undefined && entry.chapterId) signs.push({ chapterId: entry.chapterId, x: x - 90 }); previousChapter = entry.chapterId; const hash = fnv1a(entry.id); const layer = ((hash >>> 8) % 3) as 0 | 1 | 2; const jitter = ((hash & 255) / 255 - .5) * STEP * .5; const yJitter = (((hash >>> 11) & 255) / 255 - .5) * .04; placed.push({ id: entry.id, x: x + jitter, y: LAYER_Y[layer] + yJitter, scale: LAYER_SCALE[layer], layer }); x += STEP; } return { placed, signs, width: x + PAD_RIGHT }; }