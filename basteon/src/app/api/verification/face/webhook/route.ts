import { NextResponse } from "next/server";

// Live providers must verify a signed webhook here before looking up a session by provider id.
// Simulation never accepts webhooks; it fetches results server-side in /complete.
export async function POST() {
  return NextResponse.json({ error: "provider_not_configured" }, { status: 501 });
}