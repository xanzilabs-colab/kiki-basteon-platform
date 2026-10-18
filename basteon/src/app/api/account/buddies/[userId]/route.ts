import { NextResponse } from "next/server";
import { buddyAccount } from "../_shared";

type Context = { params: Promise<{ userId: string }> };

function validUserId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function relationshipAction(request: Request, context: Context, action: "remove" | "block" | "unblock") {
  const account = await buddyAccount(request);
  if ("response" in account) return account.response;
  const { userId } = await context.params;
  if (!validUserId(userId) || userId === account.user.id) {
    return NextResponse.json({ error: "invalid_buddy" }, { status: 400 });
  }

  const rpc = {
    remove: "remove_buddy_connection",
    block: "block_buddy_connection",
    unblock: "unblock_buddy_connection",
  }[action];
  const { data, error } = await account.db.rpc(rpc, {
    p_user: account.user.id,
    p_other: userId,
  });
  if (error) {
    console.error(`Buddy ${action} failed`, error);
    return NextResponse.json({ error: "buddy_action_unavailable" }, { status: 500 });
  }
  const result = typeof data === "string" ? data : Array.isArray(data) ? data[0] : data;
  const expectedResult = action === "remove" ? "removed" : action === "block" ? "blocked" : "unblocked";
  if (result === expectedResult) {
    return NextResponse.json({ result });
  }
  const statusCodes: Record<string, number> = {
    not_connected: 404,
    not_blocked: 404,
    not_found: 404,
    invalid_target: 400,
  };
  return NextResponse.json({ error: result ?? "buddy_action_unavailable" }, { status: statusCodes[String(result)] ?? 500 });
}

export async function DELETE(request: Request, context: Context) {
  return relationshipAction(request, context, "remove");
}

export async function POST(request: Request, context: Context) {
  return relationshipAction(request, context, "block");
}

export async function PATCH(request: Request, context: Context) {
  return relationshipAction(request, context, "unblock");
}
