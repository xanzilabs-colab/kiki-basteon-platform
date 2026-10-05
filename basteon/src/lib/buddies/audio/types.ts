import { z } from "zod";

export const micModeSchema = z.enum(["open", "walkie-talkie"]);
export type MicMode = z.infer<typeof micModeSchema>;
export type VirtualWalk = {
  id: string;
  status: "ringing" | "active";
  callerId: string;
  calleeId: string | null;
  incoming: boolean;
  stale: boolean;
};

const envelope = { version: z.literal(1), walkId: z.string().uuid(), senderId: z.string().uuid() };
export const signalSchema = z.discriminatedUnion("kind", [
  z.object({ ...envelope, kind: z.literal("ready") }).strict(),
  z.object({ ...envelope, kind: z.literal("offer"), sdp: z.string().min(1).max(65536) }).strict(),
  z.object({ ...envelope, kind: z.literal("answer"), sdp: z.string().min(1).max(65536) }).strict(),
  z.object({ ...envelope, kind: z.literal("ice"), candidate: z.object({
    candidate: z.string().max(4096), sdpMid: z.string().max(256).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }).strict() }).strict(),
]);
export type AudioSignal = z.infer<typeof signalSchema>;
export function parseSignal(input: unknown): AudioSignal | null {
  const result = signalSchema.safeParse(input);
  return result.success ? result.data : null;
}
export const modeStatusSchema = z.object({
  version: z.literal(1), kind: z.literal("mode"), mode: micModeSchema, transmitting: z.boolean(),
}).strict();
export type ModeStatus = z.infer<typeof modeStatusSchema>;
export function parseModeStatus(input: unknown): ModeStatus | null {
  if (typeof input !== "string" || input.length > 1024) return null;
  try { const result = modeStatusSchema.safeParse(JSON.parse(input)); return result.success ? result.data : null; }
  catch { return null; }
}