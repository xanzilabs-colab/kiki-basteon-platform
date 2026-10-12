import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTripUser } from "../_shared";
import { searchAddresses } from "@/lib/geocoding";

const querySchema = z.object({ query: z.string().trim().min(3).max(160) });

export async function POST(request: Request) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const input = querySchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    return NextResponse.json(await searchAddresses(input.data.query));
  } catch {
    return NextResponse.json({ error: "geocoding_unavailable" }, { status: 502 });
  }
}