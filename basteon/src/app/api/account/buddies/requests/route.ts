import { NextResponse } from "next/server";
import { createNotification } from "@/lib/notifications";
import { normalizeKikiId } from "@/lib/buddyIds";
import { buddyAccount } from "../_shared";

type RpcResult = { result: string; target_id?: string | null; request_id?: string | null; other_user_id?: string | null };

function firstResult(data: unknown): RpcResult | null {
  if (Array.isArray(data)) return (data[0] as RpcResult | undefined) ?? null;
  return data && typeof data === "object" ? data as RpcResult : null;
}

export async function POST(request: Request) {
  const account = await buddyAccount(request);
  if ("response" in account) return account.response;

  const body: unknown = await request.json().catch(() => null);
  const kikiId = body && typeof body === "object" && "kikiId" in body ? normalizeKikiId(body.kikiId) : null;
  if (!kikiId) return NextResponse.json({ error: "invalid_kiki_id" }, { status: 400 });

  const { data, error } = await account.db.rpc("send_buddy_connection_request", {
    p_sender: account.user.id,
    p_kiki_id: kikiId,
  });
  if (error) {
    console.error("Buddy request failed", error);
    return NextResponse.json({ error: "request_unavailable" }, { status: 500 });
  }

  const result = firstResult(data);
  if (!result) return NextResponse.json({ error: "request_unavailable" }, { status: 500 });
  if (result.result === "request_sent" && result.target_id) {
    const { data: sender } = await account.db.from("profiles").select("full_name").eq("id", account.user.id).single();
    await createNotification({
      userId: result.target_id,
      type: "buddy_request",
      title: "New buddy request",
      body: `${sender?.full_name?.trim() || "A Kiki member"} wants to connect with you.`,
      href: "/account/profile/buddies",
      payload: { requestId: result.request_id ?? null },
    });
    return NextResponse.json({ result: result.result, requestId: result.request_id });
  }

  const statusCodes: Record<string, number> = {
    not_found: 404,
    self: 400,
    blocked: 403,
    already_connected: 409,
    already_pending: 409,
    incoming_pending: 409,
  };
  const messages: Record<string, string> = {
    not_found: "buddy_not_found",
    self: "cannot_add_self",
    blocked: "buddy_not_found",
    already_connected: "already_connected",
    already_pending: "request_already_pending",
    incoming_pending: "incoming_request_exists",
  };
  return NextResponse.json(
    { error: messages[result.result] ?? "request_unavailable" },
    { status: statusCodes[result.result] ?? 500 },
  );
}

export async function PATCH(request: Request) {
  const account = await buddyAccount(request);
  if ("response" in account) return account.response;

  const body: unknown = await request.json().catch(() => null);
  const requestId = body && typeof body === "object" && "requestId" in body && typeof body.requestId === "string"
    ? body.requestId
    : null;
  const accept = body && typeof body === "object" && "accept" in body && typeof body.accept === "boolean"
    ? body.accept
    : null;
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) || accept === null) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { data, error } = await account.db.rpc("respond_buddy_connection_request", {
    p_user: account.user.id,
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) {
    console.error("Buddy request response failed", error);
    return NextResponse.json({ error: "response_unavailable" }, { status: 500 });
  }

  const result = firstResult(data);
  if (!result) return NextResponse.json({ error: "response_unavailable" }, { status: 500 });
  if (result.result === "accepted" && result.other_user_id) {
    const { data: recipient } = await account.db.from("profiles").select("full_name").eq("id", account.user.id).single();
    await createNotification({
      userId: result.other_user_id,
      type: "buddy_request_accepted",
      title: "Buddy request accepted",
      body: `${recipient?.full_name?.trim() || "Your new buddy"} accepted your request.`,
      href: "/account/profile/buddies",
    });
    return NextResponse.json({ result: result.result });
  }
  if (result.result === "declined") return NextResponse.json({ result: result.result });

  const statusCodes: Record<string, number> = { not_found: 404, not_recipient: 403, blocked: 403 };
  return NextResponse.json(
    { error: result.result },
    { status: statusCodes[result.result] ?? 500 },
  );
}
