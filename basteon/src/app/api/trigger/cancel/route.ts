import { NextResponse } from "next/server";
import { admin, isInvalidTokenError, noStore, readToken, sha256 } from "@/lib/triggerRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = readToken(request);
  if (!token) return NextResponse.json({ ok: false }, { status: 401, headers: noStore });

  const { data, error } = await admin().rpc("trigger_cancel", { p_token_hash: sha256(token) });
  if (error) {
    return NextResponse.json(
      { ok: false },
      { status: isInvalidTokenError(error.message) ? 401 : 500, headers: noStore },
    );
  }
  return NextResponse.json(
    { ok: Boolean(data?.ok) },
    { status: data?.ok ? 200 : 404, headers: noStore },
  );
}
