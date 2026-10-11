import { z } from "zod";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCard } from "@/lib/games/teach/engine";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject", "remove", "verify_author", "resolve_report"]),
  cardId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  reportId: z.string().uuid().optional(),
  area: z.string().trim().max(120).optional(),
  reportStatus: z.enum(["actioned", "dismissed"]).optional(),
});

async function getAdmin() {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  const { data: profile, error: profileError } = await client.from("profiles")
    .select("role,full_name").eq("id", user.id).maybeSingle();
  if (profileError) {
    console.error("teach moderator profile lookup failed", profileError);
    throw new Error("moderator_profile_unavailable");
  }
  if (profile?.role !== "admin") return null;
  return { user, name: profile.full_name || "Admin" };
}

export async function GET() {
  let reviewer: Awaited<ReturnType<typeof getAdmin>>;
  try {
    reviewer = await getAdmin();
  } catch (error) {
    console.error("teach moderator authentication failed", error);
    return NextResponse.json({ error: "moderator_auth_unavailable" }, { status: 500 });
  }
  if (!reviewer) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = createAdminClient();
  const [{ data: cards, error: cardsError }, { data: reports, error: reportsError }] = await Promise.all([
    db.from("teach_cards")
      .select("id,author_id,topic_id,problem,tip,example,check_q,check_options,check_answer,tier,status,flagged,helpful_distinct,report_count,created_at")
      .or("status.eq.pending,flagged.eq.true")
      .order("created_at", { ascending: true }).limit(100),
    db.from("teach_reports")
      .select("id,card_id,session_id,reporter_id,reason,status,created_at")
      .eq("status", "open").order("created_at", { ascending: true }).limit(100),
  ]);
  if (cardsError || reportsError) {
    console.error("teach moderation queue load failed", { cardsError, reportsError });
    return NextResponse.json({ error: "moderation_queue_unavailable" }, { status: 500 });
  }
  return NextResponse.json({
    banner: "Community tips are not professional advice.",
    cards: cards ?? [],
    reports: reports ?? [],
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  let reviewer: Awaited<ReturnType<typeof getAdmin>>;
  try {
    reviewer = await getAdmin();
  } catch (error) {
    console.error("teach moderator authentication failed", error);
    return NextResponse.json({ error: "moderator_auth_unavailable" }, { status: 500 });
  }
  if (!reviewer) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const input = parsed.data;
  const db = createAdminClient();

  if (input.action === "verify_author") {
    if (!input.userId) return NextResponse.json({ error: "user_required" }, { status: 400 });
    const { error } = await db.from("teach_verified_authors").upsert({
      user_id: input.userId,
      area: input.area ?? null,
      verified_by: reviewer.name,
      verified_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) {
      console.error("teach provider verification failed", error);
      return NextResponse.json({ error: "provider_verification_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (input.action === "resolve_report") {
    if (!input.reportId || !input.reportStatus) return NextResponse.json({ error: "report_fields_required" }, { status: 400 });
    const { error } = await db.from("teach_reports").update({ status: input.reportStatus })
      .eq("id", input.reportId).eq("status", "open");
    if (error) {
      console.error("teach report resolution failed", error);
      return NextResponse.json({ error: "report_update_failed" }, { status: 500 });
    }
    const { data: report, error: lookupError } = await db.from("teach_reports")
      .select("card_id").eq("id", input.reportId).single();
    if (lookupError) return NextResponse.json({ error: "report_lookup_failed" }, { status: 500 });
    if (report.card_id) {
      const { error: refreshError } = await db.rpc("teach_refresh_card", { p_card: report.card_id });
      if (refreshError) return NextResponse.json({ error: "card_report_count_update_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!input.cardId) return NextResponse.json({ error: "card_required" }, { status: 400 });
  const { data: card, error: cardError } = await db.from("teach_cards")
    .select("*").eq("id", input.cardId).single();
  if (cardError) return NextResponse.json({ error: "card_not_found" }, { status: 404 });
  const status = input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "removed";
  if (input.action === "approve") {
    if (card.report_count > 0) {
      return NextResponse.json({ error: "resolve_open_reports_before_approval" }, { status: 409 });
    }
    let authorVerified = true;
    if (card.author_id) {
      const { data: author, error: authorError } = await db.from("teach_verified_authors")
        .select("user_id").eq("user_id", card.author_id).maybeSingle();
      if (authorError) {
        console.error("teach author verification lookup failed", authorError);
        return NextResponse.json({ error: "author_verification_lookup_failed" }, { status: 500 });
      }
      authorVerified = Boolean(author);
    }
    const verdict = validateCard({
      problem: card.problem,
      tip: card.tip,
      example: card.example ?? "",
      checkQ: card.check_q,
      checkOptions: card.check_options,
      checkAnswer: card.check_answer,
    }, { verified: authorVerified });
    if (!verdict.ok) return NextResponse.json({ error: "card_failed_safety_scan", code: verdict.code }, { status: 409 });
  }
  const { error } = await db.from("teach_cards").update({
    status,
    flagged: input.action === "approve" ? false : card.flagged,
    reviewed_by: reviewer.name,
    reviewed_at: new Date().toISOString(),
  }).eq("id", card.id);
  if (error) {
    console.error("teach moderation card update failed", error);
    return NextResponse.json({ error: "card_review_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
