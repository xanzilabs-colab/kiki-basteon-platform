import { z } from "zod";
import { meetingBody, meetingError, meetingJson, meetingRpc, meetingSession } from "../../../_meeting";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateCommunityText } from "@/lib/communities/guardrails";
import { recordGuardResult } from "@/lib/communities/server";

const idSchema = z.string().uuid();
const commentSchema = z.object({ body: z.string().trim().min(2).max(300) }).strict();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return meetingJson({ error: "not_found" }, 404);
    const { client } = await meetingSession(request);
    return meetingJson(await meetingRpc(client, "list_community_alert_comments", { p_alert_id: id.data }));
  } catch (error) { return meetingError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return meetingJson({ error: "not_found" }, 404);
    const { user } = await meetingSession(request);
    const body = await meetingBody(request, commentSchema);
    if (!body) return meetingJson({ error: "invalid_comment" }, 400);
    const guard = evaluateCommunityText(body.body);
    const db = createAdminClient();
    if (guard.decision === "refuse") {
      const moderation = await recordGuardResult(db, user.id, null, guard);
      return meetingJson({
        error: "comment_refused",
        reason: guard.reason,
        noticeSent: moderation.noticeSent,
        eventRecorded: moderation.eventRecorded,
      }, 422);
    }
    const result = await meetingRpc(db, "add_community_alert_comment", {
      p_user_id: user.id,
      p_alert_id: id.data,
      p_body: guard.safeText,
    });
    const moderation = await recordGuardResult(db, user.id, null, guard);
    await db.channel("community-alerts").send({ type: "broadcast", event: "changed", payload: {} })
      .catch((error) => console.error("Community alert comment broadcast failed", error));
    return meetingJson({
      ...(typeof result === "object" && result !== null ? result : {}),
      redacted: guard.decision === "redact",
      noticeSent: moderation.noticeSent,
      eventRecorded: moderation.eventRecorded,
    }, 201);
  } catch (error) { return meetingError(error); }
}
