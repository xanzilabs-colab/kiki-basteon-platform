import { NextResponse } from "next/server";
import { z } from "zod";
import { routeAlertAndNotify } from "@/lib/alertRouting";

const payloadSchema = z.object({
  alertId: z.string().uuid(),
});

export async function POST(request: Request) {
  const dispatchSecret = process.env.PUSH_DISPATCH_SECRET;
  if (!dispatchSecret || request.headers.get("x-push-dispatch-secret") !== dispatchSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const input = payloadSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const routing = await routeAlertAndNotify(input.data.alertId);
  return NextResponse.json({ ok: true, ...routing });
}