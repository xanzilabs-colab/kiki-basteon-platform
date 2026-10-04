import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toNotificationView } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const db = createAdminClient();
  const [{ data, error }, { count }] = await Promise.all([
    db.from("notifications").select("id,type,title,body,href,payload,read_at,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
  ]);
  if (error) return NextResponse.json({ error: "notifications_unavailable" }, { status: 500 });
  return NextResponse.json({ notifications: (data ?? []).map(toNotificationView), unreadCount: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
