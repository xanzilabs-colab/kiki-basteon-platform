import { safeJson, sameOrigin } from "@/lib/verification/http";
import { requireBubbleMember } from "../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const access = await requireBubbleMember(id);
  if ("error" in access) return access.error;
  const actorAlias = (access as { alias?: string | null }).alias ?? null;
  const { data, error } = await access.db.rpc("leave_buddy_bubble", { p_bubble_id: id, p_user_id: access.user.id, p_alias: actorAlias });
  if (error || data !== "left") return safeJson({ error: "leave_unavailable" }, { status: 409 });
  return safeJson({ left: true });
}