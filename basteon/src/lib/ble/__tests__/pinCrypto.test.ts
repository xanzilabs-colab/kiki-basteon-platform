import { createHmac, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bandUnlockProof,
  bytesToHex,
  deriveBandVerifier,
  hexToBytes,
  parseBandInfo,
  randomSaltHex,
  setPinCommand,
  unlockCommand,
} from "../pinCrypto";

const SALT = "00112233445566778899aabbccddeeff";
const NONCE = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

describe("band PIN crypto (firmware v2.6 protocol)", () => {
  it("derives the same PBKDF2-SHA256 verifier as an independent implementation", async () => {
    const verifier = await deriveBandVerifier("482915", SALT, 10_000);
    const expected = pbkdf2Sync("482915", Buffer.from(SALT, "hex"), 10_000, 32, "sha256");
    expect(bytesToHex(verifier)).toBe(expected.toString("hex"));
  });

  it("computes the unlock proof as HMAC-SHA256(verifier, ASCII nonce hex)", async () => {
    const verifier = await deriveBandVerifier("482915", SALT, 10_000);
    const proof = await bandUnlockProof(verifier, NONCE);
    const expected = createHmac("sha256", Buffer.from(verifier)).update(NONCE, "ascii").digest("hex");
    expect(proof).toBe(expected);
    expect(unlockCommand(proof)).toBe(`UNLOCK:${expected}`);
  });

  it("gives a different proof for a different PIN or nonce", async () => {
    const right = await bandUnlockProof(await deriveBandVerifier("482915", SALT, 10_000), NONCE);
    const wrongPin = await bandUnlockProof(await deriveBandVerifier("482916", SALT, 10_000), NONCE);
    const otherNonce = await bandUnlockProof(await deriveBandVerifier("482915", SALT, 10_000), NONCE.replace("0f", "ff"));
    expect(new Set([right, wrongPin, otherNonce]).size).toBe(3);
  });

  it("builds SETPIN commands the firmware accepts (<= 160 chars, hex only)", async () => {
    const salt = randomSaltHex();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    const command = setPinCommand(salt, await deriveBandVerifier("482915", salt, 10_000));
    expect(command).toMatch(/^SETPIN:[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(command.length).toBeLessThanOrEqual(160);
    expect(command).not.toContain("482915");
  });

  it("parses INFO for unlocked and locked bands", () => {
    expect(parseBandInfo('{"id":"A1B2C3D4E5F6","fw":"2.6","locked":0}')).toEqual({ id: "A1B2C3D4E5F6", fw: "2.6", locked: false, salt: null, iters: null, wait: 0 });
    expect(parseBandInfo(`{"id":"A1B2C3D4E5F6","fw":"2.6","locked":1,"salt":"${SALT.toUpperCase()}","iters":10000,"wait":42}`)).toEqual({ id: "A1B2C3D4E5F6", fw: "2.6", locked: true, salt: SALT, iters: 10000, wait: 42 });
    expect(parseBandInfo('{"id":"A1B2C3D4E5F6"}').locked).toBe(false);
  });

  it("rejects malformed or hostile INFO", () => {
    expect(() => parseBandInfo("not json")).toThrow();
    expect(() => parseBandInfo('{"id":"bad id!"}')).toThrow();
    expect(() => parseBandInfo('{"id":"A1","locked":1,"salt":"zz","iters":10000}')).toThrow();
    expect(() => parseBandInfo(`{"id":"A1","locked":1,"salt":"${SALT}","iters":999999999}`)).toThrow();
  });

  it("validates hex and proof inputs", async () => {
    expect(() => hexToBytes("abc")).toThrow();
    expect(Array.from(hexToBytes("00ff"))).toEqual([0, 255]);
    await expect(bandUnlockProof(new Uint8Array(32), "short")).rejects.toThrow();
    expect(() => unlockCommand("1234")).toThrow();
  });
});
