import { describe, expect, it } from "vitest";
import { alertDeviceLabel, alertOwnerName } from "./alertDisplay";

describe("alert display labels", () => {
  it("prefers the user's device nickname and falls back to the device ID", () => {
    expect(alertDeviceLabel({ device_id: "BAND-42", device: { device_name: "Mum's band", user_id: "user-1" } })).toBe("Mum's band");
    expect(alertDeviceLabel({ device_id: "BAND-42", device: { device_name: "  ", user_id: "user-1" } })).toBe("BAND-42");
    expect(alertDeviceLabel({ device_id: "BAND-42", device: null })).toBe("BAND-42");
  });

  it("returns the owner's full name when available", () => {
    expect(alertOwnerName({ device: { device_name: "Home band", user_id: "user-1", owner: { full_name: "  Sam Ndlovu  " } } })).toBe("Sam Ndlovu");
    expect(alertOwnerName({ device: { device_name: "Home band", user_id: null } })).toBeNull();
  });
});
