import { NextResponse } from "next/server";
import { z } from "zod";
import { admin, noStore } from "@/lib/triggerRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Signature = z.object({
  prompted: z.number().int().min(1).max(6),
  signature: z.string().max(20).regex(/^[TNPSUDHX-]*$/),
  reliability: z.number().min(0).max(1),
  grade: z.enum(["A", "B", "C"]),
}).strict();
const Body = z.object({
  opt_in: z.literal(true),
  phone_model: z.string().trim().max(40).optional(),
  android_sdk: z.number().int().min(1).max(1000).optional(),
  accessory_kind: z.enum(["earbuds", "wired", "car", "speaker", "watch", "ring", "other"]),
  signatures: z.array(Signature).max(18),
}).strict();

const requests = new Map<string, number[]>();
const hash = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null) as unknown);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: noStore });
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = await hash(address);
  const now = Date.now();
  const recent = (requests.get(key) ?? []).filter((time) => now - time < 60 * 60 * 1000);
  if (recent.length >= 5) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: noStore });
  recent.push(now);
  if (requests.size > 1000) requests.clear();
  requests.set(key, recent);

  const { error } = await admin().from("trigger_compat_reports").insert({
    phone_model: parsed.data.phone_model || null,
    android_sdk: parsed.data.android_sdk ?? null,
    accessory_kind: parsed.data.accessory_kind,
    summary: { signatures: parsed.data.signatures },
  });
  if (error) return NextResponse.json({ error: "compat_report_failed" }, { status: 500, headers: noStore });
  return NextResponse.json({ ok: true }, { status: 201, headers: noStore });
}
