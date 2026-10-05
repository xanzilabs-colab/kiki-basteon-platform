import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  const { id } = await params;
  const walkId = new URL(request.url).searchParams.get("walkId");
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(walkId).success)
    return NextResponse.json({ error: "invalid_call" }, { status: 400, headers });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
  const { data, error } = await client.rpc("buddy_can_use_audio_topic", {
    p_topic: `buddy-audio:${id}:${walkId}:${user.id}`, p_send: true,
  });
  if (error || data !== true) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const urls = process.env.BUDDY_TURN_URLS?.split(",").map((url) => url.trim()).filter((url) => /^turns?:[^\s]+$/.test(url));
  if (urls?.length && process.env.BUDDY_TURN_USERNAME && process.env.BUDDY_TURN_CREDENTIAL)
    iceServers.push({ urls, username: process.env.BUDDY_TURN_USERNAME, credential: process.env.BUDDY_TURN_CREDENTIAL });
  return NextResponse.json({ iceServers, turnConfigured: iceServers.length > 1 }, { headers });
}