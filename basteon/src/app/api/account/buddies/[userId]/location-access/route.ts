import { NextResponse } from "next/server";
import { z } from "zod";
import { buddyAccount } from "../../_shared";
import { areCurrentBuddies } from "@/app/api/trips/_guardians";

type Context = { params: Promise<{ userId: string }> };
const inputSchema = z.object({ enabled: z.boolean() }).strict();
const userIdSchema = z.string().uuid();

export async function PATCH(request: Request, context: Context) {
  const account = await buddyAccount(request);
  if ("response" in account) return account.response;
  const { userId } = await context.params;
  if (!userIdSchema.safeParse(userId).success || userId === account.user.id) {
    return NextResponse.json({ error: "invalid_buddy" }, { status: 400 });
  }
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_location_access" }, { status: 400 });

  const relation = await areCurrentBuddies(account.db, account.user.id, userId);
  if (relation.error) {
    console.error("Buddy location grant relationship check failed", relation.error);
    return NextResponse.json({ error: "location_access_unavailable" }, { status: 503 });
  }
  if (!relation.allowed) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const now = new Date().toISOString();
  const result = input.data.enabled
    ? await account.db.from("buddy_location_shares").upsert({
      owner_id: account.user.id,
      viewer_id: userId,
      enabled: true,
      granted_at: now,
      updated_at: now,
    }, { onConflict: "owner_id,viewer_id" })
    : await account.db.from("buddy_location_shares").delete()
      .eq("owner_id", account.user.id)
      .eq("viewer_id", userId);
  if (result.error) {
    console.error("Buddy location grant could not be updated", result.error);
    return NextResponse.json({ error: "location_access_unavailable" }, { status: 503 });
  }

  if (!input.data.enabled) {
    const { count, error } = await account.db.from("buddy_location_shares")
      .select("viewer_id", { count: "exact", head: true })
      .eq("owner_id", account.user.id)
      .eq("enabled", true);
    if (error) {
      console.error("Remaining buddy location grants could not be checked", error);
      return NextResponse.json({ error: "location_access_unavailable" }, { status: 503 });
    }
    if (!count) {
      const { error: clearError } = await account.db.from("buddy_live_locations")
        .delete().eq("user_id", account.user.id);
      if (clearError) {
        console.error("Buddy location could not be cleared after revoking access", clearError);
        return NextResponse.json({ error: "location_access_unavailable" }, { status: 503 });
      }
    }
  }

  return NextResponse.json({ enabled: input.data.enabled });
}
