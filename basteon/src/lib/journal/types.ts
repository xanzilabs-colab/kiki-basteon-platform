export type JournalKind = "moment" | "voice" | "thought" | "feeling";
export type JournalSymbol = "flower" | "stone" | "star" | "butterfly" | "key" | "lantern" | "cloud";
export type Mood = "sunny" | "breezy" | "cloudy" | "drizzle" | "storm" | "fog" | "rainbow";

export type EntryPayloadV1 = {
  v: 1;
  text?: string;
  caption?: string;
  mood?: Mood;
  media?: { mime: string; bytes: number; durationMs?: number; width?: number; height?: number };
};

export type ChapterPayloadV1 = { v: 1; title: string };

export type JournalKeyRow = {
  kdf: "pbkdf2-sha256"; kdf_iterations: number; salt: string; wrapped_dek: string; wrap_iv: string;
  recovery_wrapped_dek: string | null; recovery_iv: string | null; key_version: number;
};
export type JournalSettingsRow = { world: string; auto_lock_seconds: number; last_prompt_date: string | null };
export type JournalChapterRow = { id: string; title_enc: string; title_iv: string; sort_order: number; started_at: string; closed_at: string | null };
export type JournalEntryRow = {
  id: string; kind: JournalKind; symbol: JournalSymbol; chapter_id: string | null; privacy: "only_me" | "kiki_can_read";
  payload_enc: string; payload_iv: string; media_path: string | null; media_bytes: number; occurred_at: string; created_at: string; updated_at: string;
};