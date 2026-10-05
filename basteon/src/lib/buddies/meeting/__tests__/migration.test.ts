import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(fileURLToPath(new URL("../../../../../supabase/migrations/20261024000000_buddy_safe_places_and_meeting.sql", import.meta.url)), "utf8");

describe("meeting migration contracts", () => {
  it("matches the existing orchestrator RPC signatures and camel-case payload", () => {
    expect(sql).toContain("get_bubble_meeting_inputs(p_user_id uuid, p_bubble_id uuid)");
    expect(sql).toContain("save_bubble_spot_candidates(p_user_id uuid, p_bubble_id uuid, p_candidates jsonb, p_regenerate boolean");
    for (const key of ["total", "ready", "locations", "userId", "destLat", "destLng", "allowLandmarks", "excludeSpotIds", "excludeOsmRefs"]) expect(sql).toContain(`'${key}'`);
  });
  it("keeps raw locations and candidate writes service-only", () => {
    expect(sql).toContain("public.save_bubble_spot_candidates(uuid, uuid, jsonb, boolean) from public, anon, authenticated");
    expect(sql).toContain("public.save_bubble_spot_candidates(uuid, uuid, jsonb, boolean) to service_role");
    expect(sql).toContain("m.left_at is null");
    expect(sql).toContain("expires_at > now() for update");
    expect(sql).not.toContain("create policy");
  });
  it("requires fresh inputs, current rounds, and all active votes", () => {
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain("raise exception 'stale_round'");
    expect(sql).toContain("v.user_id = m.user_id and v.candidate_id = p_candidate_id");
    expect(sql).toContain("raise exception 'membership_changed'");
    expect(sql).toContain("member_ids is distinct from");
    expect(sql).toContain("generation_requested_at > now() - interval '30 seconds'");
  });
  it("checks current review eligibility when reading and voting, not just ranking", () => {
    const readFunction = sql.split("create function public.get_bubble_meeting(")[1].split("create function public.vote_bubble_spot(")[0];
    const voteFunction = sql.split("create function public.vote_bubble_spot(")[1].split("create function public.feedback_bubble_spot(")[0];
    for (const body of [readFunction, voteFunction]) {
      expect(body).toContain("s.active and s.review_status = 'approved'");
      expect(body).toContain("s.reverify_by >= current_date");
      expect(body).toContain("not coalesce(l.allow_landmarks, false)");
    }
  });
});