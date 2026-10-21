import { z } from "zod";
import { MEET_CATEGORIES } from "./types";

export const coordinates = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) });
export const placeSchema = z.object({ name: z.string().trim().min(2).max(200), category: z.enum(MEET_CATEGORIES), address: z.string().trim().min(3).max(300) }).strict();
const polygonPosition = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
export const communityRegionSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.tuple([z.array(polygonPosition).min(4).max(101)]),
}).strict().superRefine(({ coordinates: [ring] }, context) => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "polygon_must_be_closed", path: ["coordinates", 0] });
  }
  if (new Set(ring.slice(0, -1).map(([lng, lat]) => `${lng},${lat}`)).size < 3) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "polygon_needs_three_vertices", path: ["coordinates", 0] });
  }
});
export const alertSchema = z.object({
  kind: z.enum(["unsafe_area", "poor_lighting", "harassment", "road_hazard"]),
  address: z.string().trim().min(3).max(300).optional(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  region: communityRegionSchema.optional(),
  detail: z.string().trim().min(4).max(500),
}).strict().superRefine((value, context) => {
  const hasLat = value.lat !== undefined;
  const hasLng = value.lng !== undefined;
  if (hasLat !== hasLng) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "location_coordinates_must_be_paired", path: [hasLat ? "lng" : "lat"] });
  }
  if (!value.address && !hasLat) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "address_or_location_required", path: ["address"] });
  }
  if (value.region && (!hasLat || !hasLng)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "area_requires_center_coordinates", path: ["region"] });
  }
});
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