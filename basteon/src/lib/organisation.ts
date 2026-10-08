import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type OrganisationRole = "owner" | "admin" | "manager" | "dispatcher" | "responder" | "viewer" | "member";

export function slugifyOrganisation(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

export async function currentUserId() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

export async function requireOrganisationAccess(minRoles: OrganisationRole[] = ["owner", "admin", "manager", "dispatcher", "responder", "viewer"]) {
  const userId = await currentUserId();
  if (!userId) return { userId: null, memberships: [] as any[] };
  const db = createAdminClient();
  const { data } = await db
    .from("organisation_memberships")
    .select("id,organisation_id,branch_id,role,membership_type,status,organisations(id,name,slug,organisation_type,status)")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", minRoles);
  return { userId, memberships: data ?? [] };
}

export function randomPassword(length = 14) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : "";
}
