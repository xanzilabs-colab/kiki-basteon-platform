import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sameOrigin } from "@/lib/verification/http";

const bucket = "kiki-profile-images";
const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

async function currentUser() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  return user;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const db = createAdminClient();
  const { data: profile, error } = await db.from("profiles").select("avatar_path").eq("id", user.id).single();
  if (error) return NextResponse.json({ error: "avatar_unavailable" }, { status: 500 });
  if (!profile?.avatar_path) return NextResponse.json({ url: null });
  const { data, error: signError } = await db.storage.from(bucket).createSignedUrl(profile.avatar_path, 3_600);
  if (signError || !data?.signedUrl) return NextResponse.json({ error: "avatar_unavailable" }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !(file.type in extensions) || file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: "invalid_image" }, { status: 400 });
  }

  const path = `${user.id}/avatar-${crypto.randomUUID()}.${extensions[file.type as keyof typeof extensions]}`;
  const db = createAdminClient();
  const { error: uploadError } = await db.storage.from(bucket).upload(path, file, { contentType: file.type });
  if (uploadError) return NextResponse.json({ error: "avatar_upload_failed" }, { status: 500 });
  const { data: profile, error: profileError } = await db.from("profiles").update({ avatar_path: path }).eq("id", user.id).select("avatar_path").single();
  if (profileError || profile?.avatar_path !== path) return NextResponse.json({ error: "avatar_save_failed" }, { status: 500 });
  const { data, error: signError } = await db.storage.from(bucket).createSignedUrl(path, 3_600);
  if (signError || !data?.signedUrl) return NextResponse.json({ error: "avatar_unavailable" }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl }, { status: 201 });
}