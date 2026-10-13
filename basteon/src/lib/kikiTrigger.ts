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
  liveGestureReady: boolean;
  androidSdk: number;
  appVersion: string | null;
  phoneModel?: string | null;
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
  type: "press" | "sequence" | "raw";
  atMs?: number;
  src?: "key" | "session" | "volume" | string;
  tok?: string;
  action?: string | null;
  repeat?: number;
  heldMs?: number | null;
  deviceId?: number | null;
  deviceName?: string | null;
  vendorId?: number | null;
  productId?: number | null;
  signature?: string;
  gapsMs?: number[];
  profileId?: string | null;
  matchStatus?: "hit" | "ambiguous" | "unverified" | "unmatched";
  matchActions?: string[];
  n?: number;
  presses?: number;
  origin?: string;
  keyCode?: string;
  clickWeight?: number;
  sequence?: string;
  keyCodes?: string[];
  pattern?: "sos" | "medical" | "duress" | "cancel" | null;
}

export interface GestureSample {
  prompted: number;
  sig: string;
  presses: number;
  gaps: number[];
}

export interface GestureProfile {
  id: string;
  name: string;
  kind: "earbuds" | "wired" | "car" | "speaker" | "watch" | "ring" | "other";
  deviceRef: string | null;
  gapMs: number;
  settleMs: number;
  mapping: Partial<Record<string, "sos" | "medical" | "duress" | "cancel">>;
  library: GestureSample[];
  verifiedAt: number | null;
  appVersion?: string | null;
  androidSdk?: number | null;
}

export interface TriggerTraceEntry {
  at: string;
  layer: "INPUT" | "GESTURE" | "MATCH" | "SERVER" | "DELIVERY" | string;
  status: string;
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
  startCapture(options?: { gapMs?: number; settleMs?: number; verification?: boolean }): Promise<{ capturing: boolean }>;
  stopCapture(): Promise<{ capturing: boolean }>;
  getProfiles(): Promise<{ profiles: GestureProfile[]; mode: string }>;
  saveProfile(options: { profile: GestureProfile }): Promise<{ profile: GestureProfile }>;
  deleteProfile(options: { id: string }): Promise<void>;
  setActiveMode(options: { mode: "auto" | string }): Promise<void>;
  importProfiles(options: { json: string }): Promise<{ profiles: GestureProfile[]; mode: string }>;
  exportProfiles(): Promise<{ json: string }>;
  getTrace(): Promise<{ entries: TriggerTraceEntry[]; export: string }>;
  connectedAccessories(): Promise<{ devices: Array<{ ref: string; label: string; kind: string }> }>;
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
