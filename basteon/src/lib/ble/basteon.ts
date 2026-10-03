"use client";

import {
  BASTEON_INFO_UUID,
  BASTEON_SERVICE_UUID,
  BASTEON_STATUS_UUID,
  BASTEON_TOKEN_UUID,
} from "./constants";

export type BasteonBleDevice = {
  id: string;
  name: string;
  writeToken(token: string): Promise<void>;
  disconnect(): void;
  onStatus(listener: (status: string) => void): () => void;
};

export type ConnectOptions = {
  /** Show every nearby Bluetooth device in Chrome's chooser instead of only Kiki bands. */
  showAll?: boolean;
};

type Stage = "choose" | "connect" | "discover" | "read";

const CONNECT_TIMEOUT_MS = 20_000;

// Web Bluetooth rejects UUIDs that contain uppercase letters.
const SERVICE_UUID = BASTEON_SERVICE_UUID.toLowerCase();
const INFO_UUID = BASTEON_INFO_UUID.toLowerCase();
const TOKEN_UUID = BASTEON_TOKEN_UUID.toLowerCase();
const STATUS_UUID = BASTEON_STATUS_UUID.toLowerCase();

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
  if (typeof navigator === "undefined" || !("bluetooth" in navigator)) {
    throw new Error("Web Bluetooth is not supported by this browser.");
  }

  let stage: Stage = "choose";
  let device: BluetoothDevice | null = null;

  try {
    // Filters are OR'd: match by service UUID, or by name.
    // Kiki is the customer-facing name; "Basteon" is accepted for units flashed with older firmware.
    device = await navigator.bluetooth.requestDevice(
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
    const infoValue = await info.readValue();
    const details = JSON.parse(new TextDecoder().decode(infoValue)) as { id?: string };
    if (!details.id || typeof details.id !== "string") {
      throw new Error("The band sent invalid identity information.");
    }
    await status.startNotifications();

    const connected = device;
    return {
      id: details.id,
      name: connected.name ?? "Kiki band",
      writeToken: async (value) => {
        await token.writeValueWithResponse(new TextEncoder().encode(value));
      },
      onStatus: (listener) => {
        const handler = (event: Event) => {
          const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
          if (value) listener(new TextDecoder().decode(value));
        };
        status.addEventListener("characteristicvaluechanged", handler);
        return () => status.removeEventListener("characteristicvaluechanged", handler);
      },
      disconnect: () => {
        if (connected.gatt?.connected) connected.gatt.disconnect();
      },
    };
  } catch (error) {
    if (device?.gatt?.connected) device.gatt.disconnect();
    throw new Error(friendlyError(error, stage));
  }
}