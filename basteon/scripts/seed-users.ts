import dotenv from "dotenv";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function seed(email: string | undefined, password: string | undefined, role: "admin" | "responder") { if (!email || !password) throw new Error(`Missing ${role} demo credentials`); const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Demo ${role}` } }); if (error && !error.message.includes("already")) throw error; const userId = data.user?.id ?? (await supabase.auth.admin.listUsers()).data.users.find((user) => user.email === email)?.id; if (!userId) throw new Error(`Could not find ${email}`); const { error: profileError } = await supabase.from("profiles").update({ role }).eq("id", userId); if (profileError) throw profileError; console.log(`${role}: ${email}`); }
async function main() { await seed(process.env.DEMO_ADMIN_EMAIL, process.env.DEMO_ADMIN_PASSWORD, "admin"); await seed(process.env.DEMO_RESPONDER_EMAIL, process.env.DEMO_RESPONDER_PASSWORD, "responder"); }
void main();