import { z } from "zod";
import { MEET_CATEGORIES } from "./types";

export const coordinates = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) });
export const placeSchema = coordinates.extend({ name: z.string().trim().min(2).max(200), category: z.enum(MEET_CATEGORIES), address: z.string().trim().max(300).nullable().optional() }).strict();
export const alertSchema = coordinates.extend({ kind: z.enum(["unsafe_area", "poor_lighting", "harassment", "road_hazard"]), locationLabel: z.string().trim().min(3).max(300), detail: z.string().trim().min(4).max(500) }).strict();
export const searchSchema = coordinates.extend({ radius: z.number().int().min(100).max(20000).default(3000) }).strict();
export const spotActionSchema = z.discriminatedUnion("action", [
  coordinates.extend({ action: z.literal("location"), allowLandmarks: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal("generate"), regenerate: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal("vote"), round: z.number().int().positive(), candidateId: z.string().uuid() }).strict(),
]);
export const feedbackSchema = z.object({ round: z.number().int().positive(), candidateId: z.string().uuid(), reason: z.enum(["too_far", "closed", "unsafe", "not_suitable"]) }).strict();
export const TOP_COLORS = ["black", "white", "red", "blue", "green", "yellow", "pink", "purple", "grey", "brown"] as const;
export const lookForSchema = z.object({ topColor: z.enum(TOP_COLORS).nullable(), carryingBag: z.boolean().nullable() }).strict();
export const adminActionSchema = z.discriminatedUnion("action", [
  placeSchema.extend({ action: z.literal("create"), quality: z.number().int().min(1).max(5), open24h: z.boolean() }).strict(),
  z.object({ action: z.literal("review"), id: z.string().uuid(), status: z.enum(["pending", "approved", "rejected"]), quality: z.number().int().min(1).max(5), active: z.boolean(), open24h: z.boolean() }).strict(),
  z.object({ action: z.literal("resolve"), id: z.string().uuid() }).strict(),
]);