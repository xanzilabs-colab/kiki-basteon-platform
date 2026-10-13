import { describe, expect, it } from "vitest";
import { parseHeartbeatPayload } from "./payload";

describe("parseHeartbeatPayload", () => {
  it("parses the motion and device-quality fields sent by current band firmware", () => {
    expect(parseHeartbeatPayload({
      status: "device_heartbeat",
      ctr: 42,
      bat: 87,
      rssi: -61,
      lock: 1,
      gps_ok: 1,
      fix: 1,
      imu_ok: 1,
      fw: "2.7",
      mot: "walking",
      moving: 1,
      msrc: "gps+imu",
      spd: 4.8,
      hdg: 123,
      sats: 9,
      hdop: 1.2,
    })).toEqual({
      status: "device_heartbeat",
      ctr: 42,
      battery: 87,
      wifiRssi: -61,
      lock: true,
      gpsOk: true,
      fix: true,
      imuOk: true,
      fw: "2.7",
      motionState: "walking",
      moving: true,
      motionSource: "gps+imu",
      speedKmh: 4.8,
      headingDeg: 123,
      sats: 9,
      hdop: 1.2,
    });
  });

  it("continues accepting heartbeats from earlier firmware without optional metrics", () => {
    expect(parseHeartbeatPayload({ status: "device_heartbeat", ctr: 7 })).toEqual({
      status: "device_heartbeat",
      ctr: 7,
      battery: null,
      wifiRssi: null,
      lock: null,
      gpsOk: null,
      fix: null,
      imuOk: null,
      fw: null,
      motionState: null,
      moving: null,
      motionSource: null,
      speedKmh: null,
      headingDeg: null,
      sats: null,
      hdop: null,
    });
  });

  it.each([
    { spd: 401 },
    { hdg: 360 },
    { sats: 100 },
    { hdop: -0.1 },
    { moving: 2 },
    { mot: "running" },
    { msrc: "phone" },
  ])("rejects out-of-contract motion field %#", (fields) => {
    expect(parseHeartbeatPayload({ status: "device_heartbeat", ctr: 9, ...fields })).toBeNull();
  });

  it("rejects unsafe counters and malformed base telemetry", () => {
    expect(parseHeartbeatPayload({ status: "device_heartbeat", ctr: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
    expect(parseHeartbeatPayload({ status: "device_heartbeat", ctr: 9, bat: 101 })).toBeNull();
  });
});
