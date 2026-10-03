import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await client.from("devices").select("id,device_id,device_name,active,last_seen_at,linked_at").order("linked_at", { ascending: false });
  return NextResponse.json(data ?? []);
}