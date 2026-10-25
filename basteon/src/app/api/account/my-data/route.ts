import { NextResponse } from "next/server";
import { authenticated, admin, fail, reportDatabaseFailure } from "@/app/api/calm/_shared";
import { deleteUserStorage } from "@/lib/account/deleteUserStorage";
import { checkAccountPin } from "@/lib/account/securityPin.server";
import { sameOrigin } from "@/lib/verification/http";

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const auth = await authenticated();
  if (auth.response) return auth.response;

  const db = admin();
  const body = await request.json().catch(() => ({}));
  const pinCheck = await checkAccountPin(db, auth.userId, body?.pin);
  if (!pinCheck.ok) return fail(pinCheck.error, pinCheck.status);

  try {
    await deleteUserStorage(db, auth.userId);
  } catch (error) {
    console.error("account_data_storage_deletion_failed", { message: error instanceof Error ? error.message : "unknown" });
    return fail("Your uploaded files could not be fully removed. Please try again.", 500);
  }

  const { error } = await db.rpc("account_delete_user_data", { p_user_id: auth.userId });
  if (error) {
    reportDatabaseFailure("account_delete_user_data", error);
    return fail("Your account data could not be fully removed. Please try again.", 500);
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
