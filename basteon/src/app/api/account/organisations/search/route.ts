import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId } from "@/lib/organisation";

export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json([]);
  const db = createAdminClient();
  const { data, error } = await db
    .from("organisations")
    .select("id,name,slug,organisation_type,status,support_email,support_phone,organisation_branches(id,name,city)")
    .eq("status", "active")
    .eq("is_partner", false)
    .neq("organisation_type", "responder_partner")
    .ilike("name", `%${q}%`)
    .order("name")
    .limit(12);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}
