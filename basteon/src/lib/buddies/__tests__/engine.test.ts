import { describe, expect, it } from "vitest";
import {
  buildNearbyView, resolveRef, suggestMeetingPoints, evaluateQueryPattern, canPing, assertNoLeak,
  type BuddyPresence, type LatLng, type MeetCandidate, type QueryEvent,
} from "../index";
import { snapToCell } from "../geo";
import { stabiliseBand } from "../privacy";

const SECRET = "test-secret-not-for-prod";
const NOW = 1_800_000_000_000;
const line = (from: LatLng, to: LatLng, n = 12): LatLng[] =>
  Array.from({ length: n + 1 }, (_, i) => ({
    lat: from.lat + ((to.lat - from.lat) * i) / n,
    lng: from.lng + ((to.lng - from.lng) * i) / n,
  }));

const A0 = { lat: -23.9, lng: 29.45 };
const A1 = { lat: -23.85, lng: 29.45 };

function person(id: string, over: Partial<BuddyPresence> = {}): BuddyPresence {
  return {
    userId: id, tripId: `trip-${id}`, nickname: `Nick-${id}`, avatar: "🙂",
    position: { lat: -23.89, lng: 29.45 },
    route: line({ lat: -23.895, lng: 29.45 }, { lat: -23.855, lng: 29.45 }),
    destination: { lat: -23.855, lng: 29.45 },
    mode: "walk", leaveFrom: NOW, leaveTo: NOW + 15 * 60_000,
    audience: "all_verified", contactIds: [], blockedIds: [], privacyZones: [],
    visible: true, verified: true, suspended: false, tripActive: true, ...over,
  };
}
const view = (viewer: BuddyPresence, cands: BuddyPresence[], pairStates = {}) =>
  buildNearbyView({ viewer, now: NOW, secret: SECRET, pairStates }, cands);

describe("visibility & leak guard", () => {
  const viewer = person("v");
  const near = person("n1", { position: { lat: -23.8915, lng: 29.4502 }, route: line({ lat: -23.893, lng: 29.4503 }, { lat: -23.853, lng: 29.4503 }) });

  it("shows a compatible nearby user with no exact data", () => {
    const r = view(viewer, [near]);
    expect(r.avatars).toHaveLength(1);
    const json = JSON.stringify(r.avatars);
    expect(json).not.toContain('"n1"'); // no userId
    expect(json).not.toMatch(/-23\.\d{3,}/);
    expect(() => assertNoLeak(r.avatars)).not.toThrow();
    expect(r.avatars[0].ref).toHaveLength(16);
  });
  it("leak guard throws on forbidden keys / coordinate strings", () => {
    expect(() => assertNoLeak({ lat: 1 })).toThrow();
    expect(() => assertNoLeak({ note: "at -23.89123, 29.45123" })).toThrow();
  });
  it("hidden / unverified / suspended / inactive users are never shown, and cannot see", () => {
    for (const bad of [{ visible: false }, { verified: false }, { suspended: true }, { tripActive: false }]) {
      expect(view(viewer, [{ ...near, ...bad }]).avatars).toHaveLength(0);
      expect(view({ ...viewer, ...bad }, [near]).avatars).toHaveLength(0);
    }
  });
  it("blocked users are invisible both ways; contacts-only audience is respected", () => {
    expect(view(viewer, [{ ...near, blockedIds: ["v"] }]).avatars).toHaveLength(0);
    expect(view({ ...viewer, blockedIds: ["n1"] }, [near]).avatars).toHaveLength(0);
    expect(view(viewer, [{ ...near, audience: "contacts_only" }]).avatars).toHaveLength(0);
    expect(view(viewer, [{ ...near, audience: "contacts_only", contactIds: ["v"] }]).avatars).toHaveLength(1);
  });
  it("ref resolves only when present in the current view", () => {
    const r = view(viewer, [near]);
    expect(resolveRef(SECRET, "v", r.avatars, [near], r.avatars[0].ref)?.userId).toBe("n1");
    expect(resolveRef(SECRET, "v", [], [near], r.avatars[0].ref)).toBeNull();
  });
});

describe("privacy zones", () => {
  const viewer = person("v");
  const near = person("n1", { position: { lat: -23.8915, lng: 29.4502 } });
  it("hides a user standing inside their home zone and shows nothing to a viewer inside theirs", () => {
    const zone = { center: near.position, radiusM: 200 };
    expect(view(viewer, [{ ...near, privacyZones: [zone] }]).avatars).toHaveLength(0);
    const r = view({ ...viewer, privacyZones: [{ center: viewer.position, radiusM: 100 }] }, [near]);
    expect(r.avatars).toHaveLength(0);
    expect(r.empty).toBe("in_privacy_zone");
  });
  it("hides destination label when destination is inside a privacy zone", () => {
    const areaOf = (p: LatLng) => ({ id: "x", label: "Some Suburb" });
    const open = buildNearbyView({ viewer, now: NOW, secret: SECRET, areaOf }, [near]);
    expect(open.avatars[0].destinationArea).toBe("Some Suburb");
    const homeDest = { ...near, privacyZones: [{ center: near.destination, radiusM: 300 }] };
    const hidden = buildNearbyView({ viewer, now: NOW, secret: SECRET, areaOf }, [homeDest]);
    expect(hidden.avatars.every((a) => a.destinationArea === null)).toBe(true);
  });
});

describe("matching", () => {
  const viewer = person("v");
  it("shows nearby visible people travelling in a different direction", () => {
    const opposite = person("o", {
      position: { lat: -23.8915, lng: 29.4502 },
      route: line({ lat: -23.855, lng: 29.4503 }, { lat: -23.895, lng: 29.4503 }),
      destination: { lat: -23.895, lng: 29.4503 },
    });
    expect(view(viewer, [opposite]).avatars).toHaveLength(1);
  });
  it("shows nearby visible people with a different departure window", () => {
    const late = person("l", { position: { lat: -23.8915, lng: 29.4502 }, leaveFrom: NOW + 3600_000, leaveTo: NOW + 4000_000 });
    expect(view(viewer, [late]).avatars).toHaveLength(1);
  });
  it("caps the number of avatars", () => {
    const many = Array.from({ length: 30 }, (_, i) => person(`m${i}`, { position: { lat: -23.8915, lng: 29.4502 } }));
    expect(view(viewer, many).avatars.length).toBeLessThanOrEqual(12);
  });
});

describe("anti-trilateration", () => {
  it("movement inside one grid cell changes nothing the client can see", () => {
    const target = person("t", { position: { lat: -23.8925, lng: 29.4505 } });
    const c = snapToCell({ lat: -23.89, lng: 29.45 }, 250).center;
    const offs = [[0, 0], [0.0007, 0.0007], [-0.0007, 0.0007], [0.0007, -0.0007], [-0.0007, -0.0007]];
    const outs = offs.map(([dy, dx]) =>
      JSON.stringify(view(person("v", { position: { lat: c.lat + dy, lng: c.lng + dx } }), [target]).avatars));
    expect(new Set(outs).size).toBe(1);
  });
  it("band changes need confirmation and are rate limited (boundary oracle)", () => {
    // alternating readings never confirm
    let st = stabiliseBand(undefined, 1, NOW);
    let flips = 0;
    for (let i = 1; i <= 20; i++) {
      const next = stabiliseBand(st, i % 2 ? 0 : 1, NOW + i * 30_000);
      if (next.band !== st.band) flips++;
      st = next;
    }
    expect(flips).toBe(0);
    // raw value flips every 60s for 20 min: naive = ~20 changes, limiter allows at most one per 2 min
    let s2 = stabiliseBand(undefined, 1, NOW);
    let naive = 0, limited = 0, prevRaw = 1;
    for (let i = 1; i <= 40; i++) {
      const raw = Math.floor((i - 1) / 2) % 2 === 0 ? 0 : 1;
      if (raw !== prevRaw) naive++;
      prevRaw = raw;
      const next = stabiliseBand(s2, raw, NOW + i * 30_000);
      if (next.band !== s2.band) limited++;
      s2 = next;
    }
    expect(naive).toBeGreaterThanOrEqual(15);
    expect(limited).toBeLessThanOrEqual(10);
    expect(limited).toBeLessThan(naive);
  });
  it("guard flags a viewer who tracks one target across a wide area with changing bands", () => {
    const evs: QueryEvent[] = Array.from({ length: 8 }, (_, i) => ({
      t: NOW - (8 - i) * 60_000,
      viewer: { lat: -23.9 + i * 0.004, lng: 29.45 },
      refs: ["abc"],
      bands: { abc: i % 3 },
    }));
    expect(evaluateQueryPattern(evs, NOW).action).toBe("flag");
  });
  it("guard throttles bursts and blocks mass profile harvesting; allows normal use", () => {
    const burst: QueryEvent[] = Array.from({ length: 6 }, (_, i) => ({ t: NOW - i * 5000, viewer: A0, refs: ["a"], bands: { a: 0 } }));
    expect(evaluateQueryPattern(burst, NOW).action).toBe("throttle");
    const harvest: QueryEvent[] = Array.from({ length: 50 }, (_, i) => ({ t: NOW - i * 600_000, viewer: A0, refs: [`r${i}`], bands: { [`r${i}`]: 0 } }));
    expect(evaluateQueryPattern(harvest, NOW).action).toBe("block");
    const normal: QueryEvent[] = [{ t: NOW - 120_000, viewer: A0, refs: ["a"], bands: { a: 0 } }];
    expect(evaluateQueryPattern(normal, NOW).action).toBe("allow");
  });
});

describe("pings", () => {
  const ok = { pingsToday: 0, pingsToThisTargetThisTrip: 0, lastDeclinedAt: null, blockedEitherWay: false };
  it("enforces limits", () => {
    expect(canPing(ok, NOW).ok).toBe(true);
    expect(canPing({ ...ok, pingsToday: 10 }, NOW).reason).toBe("daily_limit");
    expect(canPing({ ...ok, pingsToThisTargetThisTrip: 1 }, NOW).reason).toBe("already_pinged");
    expect(canPing({ ...ok, lastDeclinedAt: NOW - 1000 }, NOW).reason).toBe("cooldown");
    expect(canPing({ ...ok, blockedEitherWay: true }, NOW).reason).toBe("blocked");
  });
});

describe("meeting point", () => {
  const members = [
    { userId: "a", position: { lat: -23.9, lng: 29.45 }, destination: { lat: -23.85, lng: 29.45 }, maxWalkM: 800 },
    { userId: "b", position: { lat: -23.896, lng: 29.452 }, destination: { lat: -23.85, lng: 29.45 }, maxWalkM: 800 },
  ];
  const base = { kind: "fuel_station", isSafePlace: false, litScore: 0.8, busyScore: 0.8, cctv: true, isolationScore: 0.1 };
  const cands: MeetCandidate[] = [
    { ...base, id: "good", name: "Garage", position: { lat: -23.898, lng: 29.451 }, isSafePlace: true, openUntil: NOW + 6 * 3600_000 },
    { ...base, id: "isolated", name: "Dark lot", position: { lat: -23.898, lng: 29.4505 }, isolationScore: 0.9 },
    { ...base, id: "far", name: "Far mall", position: { lat: -23.85, lng: 29.45 } },
    { ...base, id: "home", name: "Someone's house", position: { lat: -23.898, lng: 29.4508 }, isPrivate: true },
    { ...base, id: "closed", name: "Closed shop", position: { lat: -23.8985, lng: 29.4512 }, openUntil: NOW + 5 * 60_000 },
  ];
  it("suggests only safe, open, reachable, non-private points and keeps per-member data separate", () => {
    const res = suggestMeetingPoints(members, cands, NOW);
    expect(res.map((r) => r.candidateId)).toEqual(["good"]);
    expect(res[0].perMember.a.walkMin).toBeGreaterThan(0);
    expect(JSON.stringify(res[0].shared)).not.toMatch(/\d+ ?m\b|walkMin/);
  });
});
