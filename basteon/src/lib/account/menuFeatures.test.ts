import { describe, expect, it } from "vitest";
import { getAccountMenuFeatures } from "./menuFeatures";

describe("account menu feature flags", () => {
  it("disables Stoep and Calm when unset", () => {
    expect(getAccountMenuFeatures({})).toEqual({
      stoepEnabled: false,
      calmEnabled: false,
    });
  });

  it("enables a feature only when its value is true", () => {
    expect(getAccountMenuFeatures({ STOEP_ENABLED: " TRUE ", CALM_ENABLED: "1" })).toEqual({
      stoepEnabled: true,
      calmEnabled: false,
    });
  });
});
