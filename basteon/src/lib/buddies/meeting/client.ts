export const categoryLabel = (value: string) => value.replaceAll("_", " ");

const errors: Record<string, string> = {
  unauthenticated: "Please sign in again.", forbidden: "You do not have access to this page.", not_member: "This Bubble is closed or you are no longer a member.",
  stale_round: "The options changed. Refresh and choose again.", membership_changed: "Bubble membership changed. Generate new options.",
  invalid_candidate: "That spot is no longer available. Choose another option.", rate_limited: "Please wait a moment before trying again.",
  waiting_for_locations: "Every Buddy needs to share a current meeting location.", BUDDIES_UNAVAILABLE: "Buddies is unavailable right now.",
};

export async function meetingFetch<T>(url: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal } : { cache: "no-store", signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errors[data?.error] ?? "Could not load or save Buddy places. Please try again.");
  return data as T;
}

export async function currentMeetingLocation(): Promise<{ lat: number; lng: number }> {
  if (!navigator.geolocation) throw new Error("Location is unavailable on this device.");
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
    () => reject(new Error("Location could not be shared. Check your location permission.")),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
  ));
}

export type PublicSpot = { id: string; name: string; category: string; lat: number; lng: number; address: string | null; quality: number; open_24h: boolean };
export type CommunityAlert = { id: string; kind: string; lat: number; lng: number; location_label: string | null; detail: string | null; created_at: string; expires_at: string; upvotes: number; voted: boolean };
export type MeetingCandidate = { id: string; name: string; category: string; source: string; lat: number; lng: number; address: string | null; distanceM: number; maxDistanceM: number; balanced: boolean; votes: number; yourVote: boolean; rejected: boolean };
export type MeetingView = { round: number; selectedCandidateId: string | null; total: number; ready: number; membershipChanged: boolean; candidates: MeetingCandidate[]; lookFor: Array<{ alias: string; you: boolean; topColor: string | null; carryingBag: boolean | null }> };
export const directionsUrl = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;