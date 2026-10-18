import { NextResponse } from "next/server";
import { createNotification } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/verification/http";

const gameLabels: Record<string, string> = {
  morabaraba: "Morabaraba",
  linkup: "Kiki Links",
  teach_one: "Each One Teach One",
  read_room: "Read the Room",
};
const gamePaths: Record<string, string> = {
  morabaraba: "/games/play",
  linkup: "/games/linkup",
  teach_one: "/games/teach",
  read_room: "/games/read-room",
};

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const raw: unknown = await request.json().catch(() => null);
  const roomId = raw && typeof raw === "object" && "roomId" in raw && typeof raw.roomId === "string" ? raw.roomId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roomId)) {
    return NextResponse.json({ error: "invalid_room" }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: room, error } = await db.from("game_rooms")
    .select("id,game,host_id,guest_id,status,invite_status,invite_expires_at")
    .eq("id", roomId)
    .eq("host_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("Game invite notification lookup failed", error);
    return NextResponse.json({ error: "invite_unavailable" }, { status: 500 });
  }
  if (
    !room
    || !room.guest_id
    || room.status !== "ready_check"
    || room.invite_status !== "pending"
    || !room.invite_expires_at
    || Date.parse(room.invite_expires_at) <= Date.now()
    || !gamePaths[room.game]
  ) {
    return NextResponse.json({ error: "invite_unavailable" }, { status: 409 });
  }

  const [{ data: block }, { data: gameBlock }, { data: owner }] = await Promise.all([
    db.from("buddy_blocks").select("user_id")
      .or(`and(user_id.eq.${user.id},blocked_user_id.eq.${room.guest_id}),and(user_id.eq.${room.guest_id},blocked_user_id.eq.${user.id})`)
      .maybeSingle(),
    db.from("game_blocks").select("blocker_id")
      .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${room.guest_id}),and(blocker_id.eq.${room.guest_id},blocked_id.eq.${user.id})`)
      .maybeSingle(),
    db.from("profiles").select("full_name").eq("id", user.id).single(),
  ]);
  if (block || gameBlock) return NextResponse.json({ error: "invite_unavailable" }, { status: 409 });

  const name = (owner?.full_name as string | null)?.trim() || "Your buddy";
  const notificationIds = await createNotification({
    userId: room.guest_id,
    type: "game_invite",
    title: `${gameLabels[room.game]} invitation`,
    body: `${name} invited you to play ${gameLabels[room.game]}.`,
    href: gamePaths[room.game],
    payload: { roomId: room.id, game: room.game },
  }, db);
  if (notificationIds.length === 0) {
    return NextResponse.json({ error: "notification_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ delivered: true });
}
