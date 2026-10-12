import { NextResponse } from "next/server";
import { processTriggerWork } from "@/lib/triggerWorker";
import { noStore } from "@/lib/triggerRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

async function promote(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }

  try {
    const result = await processTriggerWork(true);
    return NextResponse.json(result, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "trigger_worker_failed" }, { status: 500, headers: noStore });
  }
}

export async function GET(request: Request) {
  return promote(request);
}

export async function POST(request: Request) {
  return promote(request);
}
