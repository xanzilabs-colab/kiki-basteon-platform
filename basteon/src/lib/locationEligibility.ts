export type PermissionState = "granted" | "prompt" | "denied" | "unsupported";
export type LocationReason = "ok" | "app_setting_off" | "permission_denied" | "permission_not_granted" | "unsupported" | "loading";

export type PrivacySettings = { liveLocationSharing: boolean; safetyIntelAlerts: boolean };
export const defaultPrivacy: PrivacySettings = { liveLocationSharing: false, safetyIntelAlerts: false };

/**
 * Single gate for any feature that reads or sends the user's location in the background (nearby responders,
 * safety intelligence alerts, trip pings). Both the in-app setting and the browser permission must allow it.
 */
export function locationEligibility(liveLocationSharing: boolean | null, permission: PermissionState): { allowed: boolean; reason: LocationReason } {
  if (liveLocationSharing === null) return { allowed: false, reason: "loading" };
  if (!liveLocationSharing) return { allowed: false, reason: "app_setting_off" };
  if (permission === "denied") return { allowed: false, reason: "permission_denied" };
  if (permission === "unsupported") return { allowed: false, reason: "unsupported" };
  if (permission === "prompt") return { allowed: false, reason: "permission_not_granted" };
  return { allowed: true, reason: "ok" };
}

export const reasonText: Record<LocationReason, string> = {
  ok: "",
  loading: "Checking location settings…",
  app_setting_off: "Live location is off. Turn on Live Location Sharing in Profile to use this.",
  permission_denied: "Location is blocked in your browser. Allow it in your browser's site settings.",
  permission_not_granted: "Allow location access to continue.",
  unsupported: "This device doesn't support location.",
};
