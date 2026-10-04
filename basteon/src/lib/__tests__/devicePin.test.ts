import { describe, expect, it } from "vitest";
import { newPinSchema, pinErrorMessage, pinProblem } from "@/lib/devicePin";
import { checkDevicePin, hashDevicePin, verifyDevicePinHash } from "@/lib/devicePin.server";
import { fakeSupabase } from "@/test/fakeSupabase";

describe("device PIN policy", () => {
  it("accepts 4-8 digit PINs that aren't trivial", () => {
    expect(pinProblem("4829")).toBeNull();
    expect(pinProblem("48291537")).toBeNull();
    expect(newPinSchema.safeParse("482915").success).toBe(true);
  });

  it("rejects bad shapes, repeats and sequences", () => {
    for (const pin of ["123", "123456789", "12a4", "0000", "1234", "987654", "7890"]) expect(pinProblem(pin)).not.toBeNull();
    expect(newPinSchema.safeParse("1111").success).toBe(false);
  });

  it("maps API errors to user text without echoing input", () => {
    expect(pinErrorMessage({ error: "bad_pin", attempts_left: 2 })).toContain("2 attempts");
    expect(pinErrorMessage({ error: "pin_locked_out", retry_after: 600 })).toContain("10 minutes");
    expect(pinErrorMessage({ error: "unknown" })).toBeNull();
  });
});

describe("device PIN hashing", () => {
  it("hashes with scrypt and verifies with a timing-safe comparison", async () => {
    const encoded = await hashDevicePin("482915");
    expect(encoded).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(encoded).not.toContain("482915");
    expect(await verifyDevicePinHash("482915", encoded)).toBe(true);
    expect(await verifyDevicePinHash("482916", encoded)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashDevicePin("482915")).not.toBe(await hashDevicePin("482915"));
  });

  it("fails closed on malformed or abusive hash strings", async () => {
    expect(await verifyDevicePinHash("482915", "plain")).toBe(false);
    expect(await verifyDevicePinHash("482915", "scrypt$3$8$1$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA==")).toBe(false);
    expect(await verifyDevicePinHash("482915", "scrypt$1048576$8$1$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA==")).toBe(false);
  });
});

describe("checkDevicePin (atomic database lockout)", () => {
  it("reports no PIN", async () => {
    const db = fakeSupabase(() => ({}), () => ({ data: [{ result: "no_pin", pin_hash: null, attempts_left: null, retry_after: null }] }));
    expect(await checkDevicePin(db.client as never, "DEV1", "482915", "u1")).toEqual({ ok: false, error: "no_pin" });
  });

  it("refuses during a lockout without checking the hash", async () => {
    const db = fakeSupabase(() => ({}), () => ({ data: [{ result: "locked_out", pin_hash: null, attempts_left: 0, retry_after: 420 }] }));
    expect(await checkDevicePin(db.client as never, "DEV1", "482915", "u1")).toEqual({ ok: false, error: "pin_locked_out", retryAfter: 420 });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("resets the counter only after a correct PIN", async () => {
    const pinHash = await hashDevicePin("482915");
    const db = fakeSupabase(() => ({}), (name) => (name === "device_pin_begin_attempt" ? { data: [{ result: "ok", pin_hash: pinHash, attempts_left: 4, retry_after: null }] } : { data: null }));
    expect(await checkDevicePin(db.client as never, "DEV1", "482915", "u1")).toEqual({ ok: true });
    expect(db.rpc).toHaveBeenCalledWith("device_pin_attempt_succeeded", { p_device_id: "DEV1" });
  });

  it("keeps the reserved failure and audits a wrong PIN without logging it", async () => {
    const pinHash = await hashDevicePin("482915");
    const db = fakeSupabase(() => ({}), () => ({ data: [{ result: "ok", pin_hash: pinHash, attempts_left: 0, retry_after: null }] }));
    expect(await checkDevicePin(db.client as never, "DEV1", "000001", "u1")).toEqual({ ok: false, error: "bad_pin", attemptsLeft: 0 });
    expect(db.rpc).not.toHaveBeenCalledWith("device_pin_attempt_succeeded", expect.anything());
    const audit = db.calls.find((call) => call.table === "device_security_events");
    expect(audit?.payload).toMatchObject({ event: "pin_locked_out", device_id: "DEV1" });
    expect(JSON.stringify(audit?.payload)).not.toContain("000001");
    expect(JSON.stringify(audit?.payload)).not.toContain(pinHash);
  });

  it("fails closed when the database is unavailable", async () => {
    const db = fakeSupabase(() => ({}), () => ({ error: { message: "down" } }));
    expect(await checkDevicePin(db.client as never, "DEV1", "482915", "u1")).toEqual({ ok: false, error: "pin_unavailable" });
  });
});
