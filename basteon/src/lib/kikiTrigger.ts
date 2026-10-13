import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { EverydayDeviceKind } from "@/lib/everydayDevices";
export type { EverydayDeviceKind } from "@/lib/everydayDevices";

export type EverydayDeviceStatus =
  | "connected"
  | "disconnected"
  | "unpaired"
  | "bluetooth_off"
  | "permission_needed"
  | "untracked";

export interface KikiStatus {
  armed: boolean;
  practice: boolean;
  practiceExpiresAt?: number;
  wantArmed: boolean;
  hasToken: boolean;
  tokenId: string | null;
  test: boolean;
  batteryUnrestricted: boolean;
  fineLocation: boolean;
  bgLocation: boolean;
  notifications: boolean;
  bluetooth: boolean;
  notifyDrop: boolean;
}

export interface EverydayDevice {
  ref: string;
  kind: EverydayDeviceKind;
  name: string;
  btName: string;
  status: EverydayDeviceStatus;
  verifiedAt: string | null;
  addedAt: string;
  lastConnectedAt: string | null;
  battery?: number | null;
}

export interface PairedBluetoothDevice {
  address: string;
  btName: string;
  kind: EverydayDeviceKind;
  connected: boolean;
}

export interface TriggerEvent {
  type: "press" | "sequence";
  n?: number;
  presses?: number;
  origin?: string;
  sequence?: string;
  pattern?: "sos" | "medical" | "duress" | "cancel" | null;
}

export interface UniversalTriggerConfig {
  enabled: boolean;
  sos: number | null;
  medical: number | null;
  duress: number | null;
  cancel: number | null;
}

interface KikiTriggerPlugin {
  arm(options: { baseUrl: string; token?: string; tokenId?: string; test: boolean }): Promise<void>;
  disarm(): Promise<void>;
  forgetToken(): Promise<{ tokenId: string | null }>;
  status(): Promise<KikiStatus>;
  setPractice(options: { on: boolean }): Promise<void>;
  getTriggerConfig(): Promise<UniversalTriggerConfig>;
  setTriggerConfig(config: UniversalTriggerConfig): Promise<void>;
  getLog(): Promise<{ lines: string[] }>;
  requestBluetooth(): Promise<{ granted: boolean }>;
  audioDevices(): Promise<{ devices: Array<{ name: string; type: number }> }>;
  pairedDevices(): Promise<{ devices: PairedBluetoothDevice[] }>;
  devices(): Promise<{ devices: EverydayDevice[] }>;
  registerDevice(options: {
    ref: string;
    kind: EverydayDeviceKind;
    name: string;
    address?: string;
    btName?: string;
  }): Promise<void>;
  removeDevice(options: { ref: string }): Promise<void>;
  renameDevice(options: { ref: string; name: string }): Promise<void>;
  markVerified(options: { ref: string }): Promise<void>;
  setNotifyDrop(options: { on: boolean }): Promise<void>;
  openBluetoothSettings(): Promise<void>;
  requestBatteryExemption(): Promise<void>;
  openAppSettings(): Promise<void>;
  addListener(eventName: "event", listener: (event: TriggerEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "devices", listener: (event: { devices: EverydayDevice[] }) => void): Promise<PluginListenerHandle>;
}

export const KikiTrigger = registerPlugin<KikiTriggerPlugin>("KikiTrigger");
