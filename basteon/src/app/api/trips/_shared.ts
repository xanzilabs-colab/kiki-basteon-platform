import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function requireTripUser() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "user") return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { user };
}