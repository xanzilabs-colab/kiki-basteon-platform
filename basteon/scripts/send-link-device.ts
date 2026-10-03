import { createCipheriv, randomBytes } from "crypto";

const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const deviceId = required("DEVICE_ID");
const key = Buffer.from(required("DEVICE_KEY_B64"), "base64");
const token = required("LINK_TOKEN");
const counter = Number(required("LINK_CTR"));
const endpoint = required("FUNCTION_URL");
if (key.length !== 32 || !/^[a-fA-F0-9]{32}$/.test(token) || !Number.isSafeInteger(counter)) throw new Error("Invalid key, token, or counter");

const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
cipher.setAAD(Buffer.from(deviceId));
const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ status: "link_device", ctr: counter, token })), cipher.final()]);
const body = { device_id: deviceId, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
console.log(response.status, await response.text());