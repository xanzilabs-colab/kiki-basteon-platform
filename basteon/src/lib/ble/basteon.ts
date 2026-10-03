"use client";

import { BASTEON_INFO_UUID, BASTEON_SERVICE_UUID, BASTEON_STATUS_UUID, BASTEON_TOKEN_UUID } from "./constants";

export type BasteonBleDevice = { id: string; name: string; writeToken(token: string): Promise<void>; disconnect(): void; onStatus(listener: (status: string) => void): () => void };

function friendlyError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotFoundError") return "Device chooser was cancelled.";
  if (error instanceof DOMException && error.name === "NetworkError") return "Could not connect to the device. Keep it nearby and in link mode.";
  return error instanceof Error ? error.message : "Bluetooth connection failed.";
}

export async function connectBasteonDevice(): Promise<BasteonBleDevice> {
  if (!("bluetooth" in navigator)) throw new Error("Web Bluetooth is not supported by this browser.");
  try {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "Basteon" }], optionalServices: [BASTEON_SERVICE_UUID] });
    const server = await device.gatt?.connect();
    if (!server) throw new Error("GATT connection failed.");
    const service = await server.getPrimaryService(BASTEON_SERVICE_UUID);
    const [info, token, status] = await Promise.all([service.getCharacteristic(BASTEON_INFO_UUID), service.getCharacteristic(BASTEON_TOKEN_UUID), service.getCharacteristic(BASTEON_STATUS_UUID)]);
    const infoValue = await info.readValue();
    const details = JSON.parse(new TextDecoder().decode(infoValue)) as { id?: string };
    if (!details.id || typeof details.id !== "string") throw new Error("Device sent invalid identity information.");
    await status.startNotifications();
    return {
      id: details.id,
      name: device.name ?? "Basteon device",
      writeToken: async (value) => { await token.writeValueWithResponse(new TextEncoder().encode(value)); },
      onStatus: (listener) => { const handler = (event: Event) => listener(new TextDecoder().decode((event.target as BluetoothRemoteGATTCharacteristic).value)); status.addEventListener("characteristicvaluechanged", handler); return () => status.removeEventListener("characteristicvaluechanged", handler); },
      disconnect: () => { if (device.gatt?.connected) device.gatt.disconnect(); },
    };
  } catch (error) { throw new Error(friendlyError(error)); }
}