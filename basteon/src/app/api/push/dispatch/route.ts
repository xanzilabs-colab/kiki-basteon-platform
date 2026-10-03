import { NextResponse } from "next/server";
import { z } from "zod";
import { sendPushNotifications } from "@/lib/push";

const payloadSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(240),
  tag: z.string().min(1).max(120),
  url: z.string().startsWith("/"),
});

export async function POST(request: Request) {
  if (request.headers.get("x-push-dispatch-secret") !== process.env.PUSH_DISPATCH_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const input = payloadSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  await sendPushNotifications(input.data);
  return NextResponse.json({ ok: true });
}