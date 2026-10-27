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
  const views = (data ?? []).map(toNotificationView);
  const recordIds = [...new Set(views.flatMap((item) => {
    const recordId = typeof item.payload.recordId === "string" ? item.payload.recordId : null;
    return item.type === "safety_intel" && recordId ? [recordId] : [];
  }))];
  if (recordIds.length === 0) {
    return NextResponse.json({ notifications: views, unreadCount: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  }
  const { data: acknowledgements, error: acknowledgementError } = await db.from("safety_intel_alert_acknowledgements")
    .select("record_id")
    .eq("user_id", user.id)
    .in("record_id", recordIds);
  if (acknowledgementError) {
    console.error("Could not load safety intelligence acknowledgements.", acknowledgementError);
    return NextResponse.json({ error: "notifications_unavailable" }, { status: 500 });
  }
  const acknowledged = new Set((acknowledgements ?? []).map((row) => row.record_id));
  const notifications = views.map((item) => {
    const recordId = typeof item.payload.recordId === "string" ? item.payload.recordId : null;
    return item.type === "safety_intel" && recordId
      ? { ...item, acknowledged: acknowledged.has(recordId) }
      : item;
  });
  return NextResponse.json({ notifications, unreadCount: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
