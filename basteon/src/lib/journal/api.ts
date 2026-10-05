import { createClient } from "@/lib/supabase/client";
import type { JournalChapterRow, JournalEntryRow, JournalKeyRow, JournalSettingsRow } from "./types";
export type JournalErrorCode = "not_authenticated" | "journal_not_set_up" | "already_set_up" | "quota_exceeded" | "too_many_chapters" | "chapter_not_found" | "entry_not_found" | "entry_exists" | "invalid_input" | "unknown";
export class JournalError extends Error { constructor(public readonly code: JournalErrorCode) { super(code); this.name = "JournalError"; } }
function fail(error: { message?: string; code?: string } | null): never { const message = error?.message ?? ""; const code: JournalErrorCode = ["not_authenticated", "journal_not_set_up", "already_set_up", "quota_exceeded", "too_many_chapters", "chapter_not_found", "entry_not_found", "entry_exists"].find((candidate) => message.includes(candidate)) as JournalErrorCode ?? (error?.code === "23514" || message.includes("invalid_input") ? "invalid_input" : "unknown"); throw new JournalError(code); }
async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> { const { data, error } = await createClient().rpc(name, args); if (error) fail(error); return data as T; }
export async function getKeys() { const { data, error } = await createClient().from("journal_keys").select("kdf,kdf_iterations,salt,wrapped_dek,wrap_iv,recovery_wrapped_dek,recovery_iv,key_version").maybeSingle(); if (error) fail(error); return data as JournalKeyRow | null; }
export async function getSettings() { const { data, error } = await createClient().from("journal_settings").select("world,auto_lock_seconds,last_prompt_date").maybeSingle(); if (error) fail(error); return data as JournalSettingsRow | null; }
export async function listEntries(options: { before?: string; limit?: number } = {}) { let query = createClient().from("journal_entries").select("id,kind,symbol,chapter_id,privacy,payload_enc,payload_iv,media_path,media_bytes,occurred_at,created_at,updated_at").order("occurred_at", { ascending: false }).limit(options.limit ?? 200); if (options.before) query = query.lt("occurred_at", options.before); const { data, error } = await query; if (error) fail(error); return (data ?? []) as JournalEntryRow[]; }
export async function listChapters() { const { data, error } = await createClient().from("journal_chapters").select("id,title_enc,title_iv,sort_order,started_at,closed_at").order("sort_order"); if (error) fail(error); return (data ?? []) as JournalChapterRow[]; }
export const setupKeys = (args: Record<string, unknown>) => rpc<void>("journal_setup_keys", args);
export const rewrapKeys = (args: Record<string, unknown>) => rpc<void>("journal_rewrap_keys", args);
export const setRecovery = (args: Record<string, unknown>) => rpc<void>("journal_set_recovery", args);
export const createChapter = (id: string, enc: string, iv: string) => rpc<void>("journal_create_chapter", { p_id: id, p_title_enc: enc, p_title_iv: iv });
export const updateChapter = (id: string, enc?: string, iv?: string, close = false) => rpc<void>("journal_update_chapter", { p_id: id, p_title_enc: enc ?? null, p_title_iv: iv ?? null, p_close: close });
export const deleteChapter = (id: string) => rpc<void>("journal_delete_chapter", { p_id: id });
export const createEntry = (args: Record<string, unknown>) => rpc<string>("journal_create_entry", args);
export const updateEntry = (args: Record<string, unknown>) => rpc<void>("journal_update_entry", args);
export const deleteEntry = (id: string) => rpc<string | null>("journal_delete_entry", { p_id: id });
export const updateSettings = (autoLockSeconds?: number, world?: string) => rpc<void>("journal_update_settings", { p_auto_lock_seconds: autoLockSeconds ?? null, p_world: world ?? null });
export const markPromptShown = (localDate: string) => rpc<void>("journal_mark_prompt_shown", { p_local_date: localDate });
export const getUsage = () => rpc<{ used_bytes: number; entry_count: number; quota_bytes: number }>("journal_usage");
export const resetAll = () => rpc<string[]>("journal_reset_all");
export async function uploadMedia(path: string, bytes: Uint8Array) { const { error } = await createClient().storage.from("journal-media").upload(path, bytes, { contentType: "application/octet-stream", upsert: false }); if (error) fail(error); }
export async function downloadMedia(path: string) { const { data, error } = await createClient().storage.from("journal-media").download(path); if (error) fail(error); return new Uint8Array(await data.arrayBuffer()); }
export async function removeMedia(paths: string[]) { if (!paths.length) return; const { error } = await createClient().storage.from("journal-media").remove(paths); if (error) fail(error); }