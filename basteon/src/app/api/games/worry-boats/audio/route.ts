import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTripUser } from "@/app/api/trips/_shared";

const paths = {
  natureAmbiance: "worry-boats/audio/nature-ambiance.mp3",
  riverFlowing: "worry-boats/audio/river-flowing.mp3",
  touchWater: "worry-boats/audio/touch-water.mp3",
  paperFolding: "worry-boats/audio/paper-folding.mp3",
  paperFoldingAlternate: "worry-boats/audio/paper-folding-alternate.mp3",
} as const;

export async function GET() {
  const access = await requireTripUser();
  if ("error" in access) return access.error;

  const bucket = createAdminClient().storage.from("kiki-ringtones");
  const { data, error } = await bucket.createSignedUrls(Object.values(paths), 3_600);
  if (error) return NextResponse.json({ error: "worry_boats_audio_unavailable" }, { status: 503 });

  const urls = Object.fromEntries(Object.entries(paths).map(([name, filePath]) => {
    const signed = data.find((item) => item.path === filePath);
    return [name, signed?.signedUrl ?? null];
  }));
  if (Object.values(urls).some((url) => !url)) {
    return NextResponse.json({ error: "worry_boats_audio_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ urls }, { headers: { "Cache-Control": "private, max-age=300" } });
}
