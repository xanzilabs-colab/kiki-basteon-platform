import dotenv from "dotenv";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const configuredEmail = process.env.BUDDY_DEV_VERIFIED_EMAIL;
if (!configuredEmail) throw new Error("Set BUDDY_DEV_VERIFIED_EMAIL in .env.local before running this development seed.");
const email: string = configuredEmail;
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("This development-only verification seed cannot run in production.");
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) throw usersError;
  const user = users.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No user exists for ${email}.`);
  const now = new Date().toISOString();
  const { error } = await supabase.from("profiles").update({ verification_status: "verified", face_locked_until: null }).eq("id", user.id);
  if (error) throw error;
  const { error: enrolmentError } = await supabase.from("user_enrolment").upsert({ user_id: user.id, provider_reference: "simulation", provider_subject_id: `simulation:${user.id}`, status: "verified", enrolled_at: now, updated_at: now });
  if (enrolmentError) throw enrolmentError;
  console.log(`Verified Buddies enrolment seeded for ${email}.`);
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });