import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { routeAlertAndNotify } from "@/lib/alertRouting";

export async function POST(request: Request) {
	const client = await createClient();
	const { data: { user } } = await client.auth.getUser();
	const { data: profile } = user ? await client.from("profiles").select("role").eq("id", user.id).single() : { data: null };
	if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

	const input = z.object({ device_id: z.string().min(1), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).safeParse(await request.json());
	if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });

	const db = createAdminClient();
	const { data: device } = await db.from("devices").select("last_ctr,device_name,user_id").eq("device_id", input.data.device_id).single();
	if (!device) return NextResponse.json({ error: "device_not_found" }, { status: 404 });

	const ctr = Number(device.last_ctr) + 1;
	const { data: alert, error } = await db.from("alerts").insert({ ...input.data, ctr, loc_source: "dev", type_code: "general", type_source: "device", type_updated_at: new Date().toISOString() }).select("id").single();
	if (error) return NextResponse.json({ error: error.message }, { status: 400 });

	await db.from("devices").update({ last_ctr: ctr, last_seen_at: new Date().toISOString() }).eq("device_id", input.data.device_id);
	await routeAlertAndNotify(alert.id);

	return NextResponse.json({ ok: true }, { status: 201 });
}