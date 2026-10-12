import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/20261111000600_trigger_gateway_bluetooth.sql", import.meta.url)),
  "utf8",
);
const integrationSql = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/20261112000100_trigger_virtual_endpoints_and_user_cancel.sql", import.meta.url)),
  "utf8",
);

describe("Bluetooth trigger gateway migration", () => {
  it("stores only token hashes and restricts gateway RPCs to the service role", () => {
    expect(sql).toContain("token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).toContain("revoke all on function public.trigger_fire(text,jsonb) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.trigger_fire(text,jsonb) to service_role");
    expect(sql).toContain("for select to authenticated using (user_id = (select auth.uid()))");
    expect(sql).not.toContain("token_secret");
  });

  it("enforces fire throttling, practice mode, cancellation ownership, and due promotion", () => {
    const fire = sql.split("function public.trigger_fire(")[1]?.split("create or replace function")[0];
    const cancel = sql.split("function public.trigger_cancel(")[1]?.split("create or replace function")[0];
    const promote = sql.split("function public.trigger_promote_due(")[1]?.split("create or replace function")[0];
    expect(fire).toContain("values (t.id, t.user_id, 'test')");
    expect(fire).toContain("interval '10 minutes'");
    expect(fire).toContain("v_recent >= 5");
    expect(fire).toContain("interval '60 seconds'");
    expect(cancel).toContain("token_id = t.id and user_id = t.user_id");
    expect(promote).toContain("activates_at <= now()");
    expect(promote).toContain("promoted_alert_id is null");
    expect(promote).toContain("trigger_source, trigger_pattern, device_hint, duress");
    expect(promote).toContain("p.source");
    expect(fire).toContain("when v_source = 'bt_media' then 'Bluetooth media key'");
    expect(fire).toContain("when v_source = 'bt_ble' then 'Bluetooth LE'");
    expect(fire).toContain("and not d.is_virtual");
    expect(fire).toContain("from public.trigger_virtual_endpoints e");
    expect(fire).toContain("if v_type = 'medical' and not t.allow_medical then");
    expect(sql).toContain("countdown_s between 1 and 60");
    expect(sql).toContain("if p_countdown_s is null or p_countdown_s not between 1 and 60 then");
    expect(sql).toContain("check (kind in ('earbuds','wired','car','speaker','watch','ring','other'))");
    expect(sql).toContain("'Phone safety trigger'");
    expect(sql).toContain("if p_kind <> 'android_shell' and not exists");
    expect(sql).toContain("values (v_id, v_device_id, p_user_id)");
  });

  it("isolates virtual phone endpoints from clip listings and scopes user cancellation", () => {
    expect(integrationSql).toContain("(not is_virtual and user_id = auth.uid())");
    expect(integrationSql).toContain("create or replace function public.trigger_pending_cancel_user");
    expect(integrationSql).toContain("where id = p_pending_id and user_id = p_user_id");
    expect(integrationSql).toContain("for update");
    expect(integrationSql).toContain("p.cancelled_at is not null");
    expect(integrationSql).toContain("grant execute on function public.trigger_pending_cancel_user(uuid,uuid) to service_role");
  });

  it("bounds diagnostics and retains shell status and device metadata", () => {
    expect(sql).toContain("limit least(20, v_remaining)");
    expect(sql).toContain("500 - v_recent");
    expect(sql).toContain("interval '30 days'");
    expect(sql).toContain("create table if not exists public.shell_status");
    expect(sql).toContain("create table if not exists public.trigger_devices");
    expect(sql).toContain("create table if not exists public.trigger_diagnostics");
  });
});
