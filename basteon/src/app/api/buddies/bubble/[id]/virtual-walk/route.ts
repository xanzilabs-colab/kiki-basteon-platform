import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/verification/http";

export const dynamic = "force-dynamic";
const schema = z.union([
	z.object({ action: z.literal("start") }).strict(),
	z.object({ action: z.enum(["answer", "end", "heartbeat"]), walkId: z.string().uuid() }).strict(),
]);
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
	const { id } = await params;
	const input = schema.safeParse(await request.json().catch(() => null));
	if (!z.string().uuid().safeParse(id).success || !input.success) return NextResponse.json({ error: "invalid_action" }, { status: 400, headers });
	const client = await createClient();
	const { data: { user } } = await client.auth.getUser();
	if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
	const action = input.data;
	const { data, error } = await client.rpc(`${action.action}_buddy_virtual_walk`, {
		p_bubble_id: id, ...(action.action === "start" ? {} : { p_walk_id: action.walkId }),
	});
	if (error) {
		const forbidden = /not_bubble_member|forbidden|unauthenticated/.test(error.message);
		return NextResponse.json({ error: forbidden ? "forbidden" : "virtual_walk_unavailable" }, { status: forbidden ? 403 : 503, headers });
	}
	return NextResponse.json(data, { status: data?.error ? 409 : 200, headers });
}