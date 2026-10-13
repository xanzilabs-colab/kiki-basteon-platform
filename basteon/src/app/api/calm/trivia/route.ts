import { z } from "zod";
import { admin, authenticated, fail, rateLimited, reportDatabaseFailure } from "../_shared";

const optionsSchema = z.array(z.string().min(1).max(100)).length(3);

export async function GET(request: Request) {
  const auth = await authenticated();
  if (auth.response) return auth.response;
  const limit = await rateLimited(auth.userId, "trivia", 30);
  if (limit.unavailable) return fail("rate_limit_unavailable", 503);
  if (!limit.allowed) return fail("rate_limited", 429);
  const url = new URL(request.url);
  const parsed = z.coerce.number().int().min(1).max(3).safeParse(url.searchParams.get("n") ?? "3");
  if (!parsed.success) return fail("invalid_count", 400);
  const { data, error } = await admin().from("calm_trivia")
    .select("id,question,options,answer,fact")
    .eq("review_status", "reviewed")
    .order("id", { ascending: true })
    .limit(100);
  if (error) {
    reportDatabaseFailure("trivia_read", error);
    return fail("trivia_unavailable", 500);
  }
  const safeRows = [];
  for (const row of data ?? []) {
    const options = optionsSchema.safeParse(row.options);
    if (!options.success || typeof row.question !== "string" || typeof row.fact !== "string" || !Number.isInteger(row.answer) || row.answer < 0 || row.answer > 2) {
      console.error("calm_trivia_invalid_reviewed_row", { id: row.id });
      return fail("trivia_unavailable", 500);
    }
    safeRows.push({ id: row.id, question: row.question, options: options.data, answer: row.answer, fact: row.fact });
  }
  const shuffled = safeRows.sort(() => Math.random() - 0.5).slice(0, parsed.data);
  return Response.json(shuffled, { headers: { "Cache-Control": "no-store" } });
}
