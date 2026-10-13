export type MotionState = "still" | "walking" | "vehicle" | "unknown";
export type MotionSource = "gps" | "imu" | "gps+imu" | "none";

export type HeartbeatPayload = {
  status: "device_heartbeat";
  ctr: number;
  battery: number | null;
  wifiRssi: number | null;
  lock: boolean | null;
  gpsOk: boolean | null;
  fix: boolean | null;
  imuOk: boolean | null;
  fw: string | null;
  motionState: MotionState | null;
  moving: boolean | null;
  motionSource: MotionSource | null;
  speedKmh: number | null;
  headingDeg: number | null;
  sats: number | null;
  hdop: number | null;
};

type OptionalValue<T> = { valid: true; value: T | null } | { valid: false; value: null };

function optionalNumber(
  payload: Record<string, unknown>,
  key: string,
  isValid: (value: number) => boolean,
): OptionalValue<number> {
  const value = payload[key];
  if (value === undefined) return { valid: true, value: null };
  if (typeof value !== "number" || !isValid(value)) return { valid: false, value: null };
  return { valid: true, value };
}

function optionalFlag(payload: Record<string, unknown>, key: string): OptionalValue<boolean> {
  const value = payload[key];
  if (value === undefined) return { valid: true, value: null };
  if (value !== 0 && value !== 1) return { valid: false, value: null };
  return { valid: true, value: value === 1 };
}

function isMotionState(value: unknown): value is MotionState {
  return value === "still" || value === "walking" || value === "vehicle" || value === "unknown";
}

function isMotionSource(value: unknown): value is MotionSource {
  return value === "gps" || value === "imu" || value === "gps+imu" || value === "none";
}

export function parseHeartbeatPayload(value: unknown): HeartbeatPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const ctr = payload.ctr;
  if (payload.status !== "device_heartbeat" || typeof ctr !== "number" || !Number.isSafeInteger(ctr) || ctr <= 0) return null;

  const battery = optionalNumber(payload, "bat", (number) => Number.isInteger(number) && number >= 0 && number <= 100);
  const wifiRssi = optionalNumber(payload, "rssi", (number) => Number.isInteger(number) && number >= -127 && number <= 0);
  const lock = optionalFlag(payload, "lock");
  const gpsOk = optionalFlag(payload, "gps_ok");
  const fix = optionalFlag(payload, "fix");
  const imuOk = optionalFlag(payload, "imu_ok");
  const moving = optionalFlag(payload, "moving");
  const speedKmh = optionalNumber(payload, "spd", (number) => Number.isFinite(number) && number >= 0 && number <= 400);
  const headingDeg = optionalNumber(payload, "hdg", (number) => Number.isInteger(number) && number >= 0 && number <= 359);
  const sats = optionalNumber(payload, "sats", (number) => Number.isInteger(number) && number >= 0 && number <= 99);
  const hdop = optionalNumber(payload, "hdop", (number) => Number.isFinite(number) && number >= 0 && number <= 99);
  if (
    !battery.valid || !wifiRssi.valid || !lock.valid || !gpsOk.valid || !fix.valid || !imuOk.valid ||
    !moving.valid || !speedKmh.valid || !headingDeg.valid || !sats.valid || !hdop.valid
  ) return null;

  const fw = payload.fw;
  if (fw !== undefined && (typeof fw !== "string" || fw.length > 40)) return null;
  const rawMotionState = payload.mot;
  if (rawMotionState !== undefined && !isMotionState(rawMotionState)) return null;
  const rawMotionSource = payload.msrc;
  if (rawMotionSource !== undefined && !isMotionSource(rawMotionSource)) return null;

  return {
    status: "device_heartbeat",
    ctr,
    battery: battery.value,
    wifiRssi: wifiRssi.value,
    lock: lock.value,
    gpsOk: gpsOk.value,
    fix: fix.value,
    imuOk: imuOk.value,
    fw: typeof fw === "string" ? fw : null,
    motionState: rawMotionState === undefined ? null : rawMotionState,
    moving: moving.value,
    motionSource: rawMotionSource === undefined ? null : rawMotionSource,
    speedKmh: speedKmh.value,
    headingDeg: headingDeg.value,
    sats: sats.value,
    hdop: hdop.value,
  };
}
