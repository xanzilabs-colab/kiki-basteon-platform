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

type Stage = "choose" | "connect" | "discover" | "read";

const CONNECT_TIMEOUT_MS = 20_000;

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
        ? "No band was selected. Make sure the band is in link mode, then try again."
        : "This device doesn't look like a Kiki band in link mode. Hold the button for 5 seconds and try again.";
    }
    if (error.name === "NetworkError") return "Could not connect to the band. Keep it close and in link mode.";
    if (error.name === "SecurityError") return "Bluetooth is blocked. Use the secure (https) site and allow Bluetooth access.";
    if (error.name === "NotAllowedError") return "Bluetooth permission was denied. Allow it and try again.";
    if (error.name === "NotSupportedError") return "This device doesn't support the required Bluetooth features.";
  }
  return error instanceof Error ? error.message : "Bluetooth connection failed.";
}

export async function connectBasteonDevice(): Promise<BasteonBleDevice> {
  if (typeof navigator === "undefined" || !("bluetooth" in navigator)) {
    throw new Error("Web Bluetooth is not supported by this browser.");
  }

  let stage: Stage = "choose";
  let device: BluetoothDevice | null = null;

  try {
    // Kiki is the customer-facing name; "Basteon" is accepted for units flashed with older firmware.
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "Kiki" }, { namePrefix: "Basteon" }],
      optionalServices: [BASTEON_SERVICE_UUID],
    });

    stage = "connect";
    const server = await withTimeout(
      device.gatt!.connect(),
      CONNECT_TIMEOUT_MS,
      "Timed out connecting to the band. Keep it close and in link mode.",
    );

    stage = "discover";
    const service = await server.getPrimaryService(BASTEON_SERVICE_UUID);
    const [info, token, status] = await Promise.all([
      service.getCharacteristic(BASTEON_INFO_UUID),
      service.getCharacteristic(BASTEON_TOKEN_UUID),
      service.getCharacteristic(BASTEON_STATUS_UUID),
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