"use client";

import {
  BAND_PIN_PBKDF2_ITERS,
  BASTEON_CTRL_UUID,
  BASTEON_INFO_UUID,
  BASTEON_NONCE_UUID,
  BASTEON_SERVICE_UUID,
  BASTEON_STATUS_UUID,
  BASTEON_TOKEN_UUID,
} from "./constants";
import {
  CLEAR_PIN_COMMAND,
  bandUnlockProof,
  deriveBandVerifier,
  parseBandInfo,
  randomSaltHex,
  setPinCommand,
  unlockCommand,
  type BandInfo,
} from "./pinCrypto";

export type { BandInfo } from "./pinCrypto";

export type BasteonBleDevice = {
  id: string;
  name: string;
  /** INFO as read when connecting; call readInfo() for a fresh copy. */
  info: BandInfo;
  /** False on pre-v2.6 firmware without the PIN characteristics. */
  pinSupported: boolean;
  readInfo(): Promise<BandInfo>;
  writeToken(token: string): Promise<void>;
  /** Proves the PIN to the band for this connection. No-op on an unlocked band. */
  unlock(pin: string): Promise<void>;
  /** Stores a new PIN verifier on the band (band must be unlocked, or unlocked for this connection). */
  setPin(pin: string, saltHex?: string): Promise<void>;
  clearPin(): Promise<void>;
  disconnect(): void;
  onStatus(listener: (status: string) => void): () => void;
};

export class BandPinError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
  }
}

const PIN_STATUS_TEXT: Record<string, string> = {
  bad_pin: "The band rejected that PIN.",
  locked_out: "The band is locked after too many wrong PINs. Try again in 15 minutes.",
  not_unlocked: "Unlock the band with its current PIN first.",
  format: "The band couldn't read the PIN data. Please try again.",
  bad_command: "This band's firmware doesn't support that PIN action.",
};

const PIN_STATUS_TIMEOUT_MS = 10_000;

export type ConnectOptions = {
  /** Show every nearby Bluetooth device in Chrome's chooser instead of only Kiki bands. */
  showAll?: boolean;
};

type Stage = "choose" | "connect" | "discover" | "read";

type BluetoothCharacteristic = {
  value?: DataView;
  readValue(): Promise<DataView>;
  startNotifications(): Promise<BluetoothCharacteristic>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  addEventListener(type: "characteristicvaluechanged", listener: (event: Event) => void): void;
  removeEventListener(type: "characteristicvaluechanged", listener: (event: Event) => void): void;
};

type BluetoothService = {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristic>;
};

type BluetoothServer = {
  getPrimaryService(uuid: string): Promise<BluetoothService>;
};

type BluetoothDevice = {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<BluetoothServer>;
    disconnect(): void;
  };
};

type BluetoothApi = {
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
};

type RequestDeviceOptions = {
  acceptAllDevices?: boolean;
  filters?: Array<{ services?: string[]; namePrefix?: string }>;
  optionalServices?: string[];
};

const CONNECT_TIMEOUT_MS = 20_000;

// Web Bluetooth rejects UUIDs that contain uppercase letters.
const SERVICE_UUID = BASTEON_SERVICE_UUID.toLowerCase();
const INFO_UUID = BASTEON_INFO_UUID.toLowerCase();
const TOKEN_UUID = BASTEON_TOKEN_UUID.toLowerCase();
const STATUS_UUID = BASTEON_STATUS_UUID.toLowerCase();
const CTRL_UUID = BASTEON_CTRL_UUID.toLowerCase();
const NONCE_UUID = BASTEON_NONCE_UUID.toLowerCase();

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function friendlyError(error: unknown, stage: Stage): string {
  if (error instanceof DOMException) {
    if (error.name === "NotFoundError") {
      return stage === "choose"
        ? "No band was found or selected. Make sure the light is double-blinking, close any other Bluetooth app, then try again. If it still doesn't appear, use “Show all Bluetooth devices”."
        : "This device doesn't look like a Kiki band in link mode. Hold the button for 5 seconds and try again.";
    }
    if (error.name === "NetworkError") return "Could not connect to the band. Keep it close and in link mode.";
    if (error.name === "SecurityError") return "Bluetooth is blocked. Use the secure (https) site and allow Bluetooth access.";
    if (error.name === "NotAllowedError") return "Bluetooth permission was denied. Allow it and try again.";
    if (error.name === "NotSupportedError") return "This device doesn't support the required Bluetooth features.";
  }
  if (error instanceof TypeError) {
    return "The Bluetooth service ID is invalid. Check the UUIDs in lib/ble/constants.ts.";
  }
  return error instanceof Error ? error.message : "Bluetooth connection failed.";
}

export async function connectBasteonDevice(opts: ConnectOptions = {}): Promise<BasteonBleDevice> {
  const bluetooth = typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth;
  if (!bluetooth) {
    throw new Error("Web Bluetooth is not supported by this browser.");
  }

  let stage: Stage = "choose";
  let device: BluetoothDevice | null = null;

  try {
    // Filters are OR'd: match by service UUID, or by name.
    // Kiki is the customer-facing name; "Basteon" is accepted for units flashed with older firmware.
    device = await bluetooth.requestDevice(
      opts.showAll
        ? { acceptAllDevices: true, optionalServices: [SERVICE_UUID] }
        : {
            filters: [
              { services: [SERVICE_UUID] },
              { namePrefix: "Kiki" },
              { namePrefix: "Basteon" },
            ],
            optionalServices: [SERVICE_UUID],
          },
    );

    stage = "connect";
    const server = await withTimeout(
      device.gatt!.connect(),
      CONNECT_TIMEOUT_MS,
      "Timed out connecting to the band. Keep it close and in link mode.",
    );

    stage = "discover";
    const service = await server.getPrimaryService(SERVICE_UUID);
    const [info, token, status] = await Promise.all([
      service.getCharacteristic(INFO_UUID),
      service.getCharacteristic(TOKEN_UUID),
      service.getCharacteristic(STATUS_UUID),
    ]);

    stage = "read";
    const readInfo = async () => parseBandInfo(new TextDecoder().decode(await info.readValue()));
    const details = await readInfo();
    const [ctrl, nonce] = await Promise.all([
      service.getCharacteristic(CTRL_UUID).catch(() => null),
      service.getCharacteristic(NONCE_UUID).catch(() => null),
    ]);
    await status.startNotifications();

    const decode = (value: DataView | undefined) => (value ? new TextDecoder().decode(value) : "");
    const listen = (listener: (value: string) => void) => {
      const handler = (event: Event) => listener(decode((event.target as BluetoothCharacteristic | null)?.value));
      status.addEventListener("characteristicvaluechanged", handler);
      return () => status.removeEventListener("characteristicvaluechanged", handler);
    };

    // Writes a CTRL command and resolves on the band's reply (`success`) or rejects on `failed:*`.
    const command = (value: string, success: string) => {
      if (!ctrl) return Promise.reject(new BandPinError("unsupported", "Update the band firmware to use PIN lock."));
      return new Promise<void>((resolve, reject) => {
        let stop = () => {};
        const timer = setTimeout(() => { stop(); reject(new BandPinError("timeout", "The band didn't answer. Keep it close and in link mode.")); }, PIN_STATUS_TIMEOUT_MS);
        stop = listen((reply) => {
          if (reply !== success && !reply.startsWith("failed:")) return;
          clearTimeout(timer);
          stop();
          if (reply === success) return resolve();
          const reason = reply.slice(7);
          reject(new BandPinError(reason, PIN_STATUS_TEXT[reason] ?? `The band refused: ${reason.replaceAll("_", " ")}.`));
        });
        ctrl.writeValueWithResponse(new TextEncoder().encode(value)).catch((error: unknown) => {
          clearTimeout(timer);
          stop();
          reject(error);
        });
      });
    };

    const connected = device;
    const session: BasteonBleDevice = {
      id: details.id,
      name: connected.name ?? "Kiki band",
      info: details,
      pinSupported: Boolean(ctrl && nonce),
      readInfo: async () => {
        const next = await readInfo();
        session.info = next;
        return next;
      },
      writeToken: async (value) => {
        await token.writeValueWithResponse(new TextEncoder().encode(value));
      },
      unlock: async (pin) => {
        const current = await session.readInfo();
        if (!current.locked) return;
        if (!nonce) throw new BandPinError("unsupported", "Update the band firmware to use PIN lock.");
        if (current.wait > 0) throw new BandPinError("locked_out", PIN_STATUS_TEXT.locked_out);
        const verifier = await deriveBandVerifier(pin, current.salt!, current.iters!);
        const challenge = new TextDecoder().decode(await nonce.readValue()).trim();
        await command(unlockCommand(await bandUnlockProof(verifier, challenge)), "unlocked");
      },
      setPin: async (pin, saltHex) => {
        const salt = saltHex ?? randomSaltHex();
        const verifier = await deriveBandVerifier(pin, salt, session.info.iters ?? BAND_PIN_PBKDF2_ITERS);
        await command(setPinCommand(salt, verifier), "pin_set");
        await session.readInfo().catch(() => undefined);
      },
      clearPin: async () => {
        await command(CLEAR_PIN_COMMAND, "pin_cleared");
        await session.readInfo().catch(() => undefined);
      },
      onStatus: (listener) => listen((value) => { if (value) listener(value); }),
      disconnect: () => {
        if (connected.gatt?.connected) connected.gatt.disconnect();
      },
    };
    return session;
  } catch (error) {
    if (device?.gatt?.connected) device.gatt.disconnect();
    throw new Error(friendlyError(error, stage));
  }
}