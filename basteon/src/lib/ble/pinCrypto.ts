// Band PIN protocol (firmware v2.6). The band never sees the PIN:
//   verifier = PBKDF2-HMAC-SHA256(PIN, salt, iters, 32 bytes)      -> stored on the band via SETPIN
//   proof    = HMAC-SHA256(key = verifier, msg = ASCII nonce hex)    -> sent as UNLOCK:<proof>
// Uses Web Crypto only, so it runs in browsers and in Node tests.

export type BandInfo = {
  id: string;
  fw: string | null;
  locked: boolean;
  salt: string | null;
  iters: number | null;
  /** Seconds left on the band's own wrong-PIN lockout. */
  wait: number;
};

const HEX = /^[0-9a-f]*$/i;
export const MIN_BAND_ITERS = 1_000;
export const MAX_BAND_ITERS = 200_000;

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !HEX.test(hex)) throw new Error("Invalid hex string.");
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index++) out[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
}

function subtle(): SubtleCrypto {
  const value = globalThis.crypto?.subtle;
  if (!value) throw new Error("Secure crypto is unavailable. Use the https site.");
  return value;
}

export function randomSaltHex(): string {
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

/** Parses the INFO characteristic, rejecting anything a well-behaved band would never send. */
export function parseBandInfo(raw: string): BandInfo {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("The band sent invalid identity information.");
  }
  if (!value || typeof value !== "object") throw new Error("The band sent invalid identity information.");
  const info = value as Record<string, unknown>;
  if (typeof info.id !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(info.id)) throw new Error("The band sent invalid identity information.");
  const locked = info.locked === 1 || info.locked === true;
  let salt: string | null = null;
  let iters: number | null = null;
  if (locked) {
    if (typeof info.salt !== "string" || info.salt.length !== 32 || !HEX.test(info.salt)) throw new Error("The band sent an invalid PIN challenge.");
    if (typeof info.iters !== "number" || !Number.isInteger(info.iters) || info.iters < MIN_BAND_ITERS || info.iters > MAX_BAND_ITERS) {
      throw new Error("The band sent an invalid PIN challenge.");
    }
    salt = info.salt.toLowerCase();
    iters = info.iters;
  }
  const wait = typeof info.wait === "number" && Number.isFinite(info.wait) && info.wait > 0 ? Math.ceil(info.wait) : 0;
  return { id: info.id, fw: typeof info.fw === "string" ? info.fw : null, locked, salt, iters, wait };
}

export async function deriveBandVerifier(pin: string, saltHex: string, iters: number): Promise<Uint8Array> {
  if (saltHex.length !== 32) throw new Error("Invalid PIN salt.");
  if (!Number.isInteger(iters) || iters < MIN_BAND_ITERS || iters > MAX_BAND_ITERS) throw new Error("Invalid PIN iterations.");
  const key = await subtle().importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: iters }, key, 256);
  return new Uint8Array(bits);
}

export async function bandUnlockProof(verifier: Uint8Array, nonceHex: string): Promise<string> {
  if (verifier.length !== 32) throw new Error("Invalid PIN verifier.");
  if (!/^[0-9a-f]{32}$/i.test(nonceHex)) throw new Error("The band sent an invalid PIN challenge.");
  const key = await subtle().importKey("raw", new Uint8Array(verifier), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await subtle().sign("HMAC", key, new TextEncoder().encode(nonceHex));
  return bytesToHex(new Uint8Array(mac));
}

export function unlockCommand(proofHex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(proofHex)) throw new Error("Invalid unlock proof.");
  return `UNLOCK:${proofHex}`;
}

export function setPinCommand(saltHex: string, verifier: Uint8Array): string {
  if (!/^[0-9a-f]{32}$/i.test(saltHex) || verifier.length !== 32) throw new Error("Invalid PIN material.");
  return `SETPIN:${saltHex}:${bytesToHex(verifier)}`;
}

export const CLEAR_PIN_COMMAND = "CLEARPIN";
