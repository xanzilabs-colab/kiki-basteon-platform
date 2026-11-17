import { describe, expect, it } from "vitest";
import { DEFAULT_PHONE_COUNTRY, getLocalizedPhoneCountries, PHONE_COUNTRIES, toE164PhoneNumber } from "./phone";

describe("international phone numbers", () => {
  it("uses South Africa as the initial country and exposes country flags and calling codes", () => {
    expect(DEFAULT_PHONE_COUNTRY).toBe("ZA");
    expect(getLocalizedPhoneCountries().find(({ country }) => country === "ZA")).toMatchObject({
      name: "South Africa",
      callingCode: "27",
      flag: expect.any(String),
    });
  });

  it("normalizes national numbers with the selected country's calling code", () => {
    expect(toE164PhoneNumber("082 123 4567", "ZA")).toBe("+27821234567");
    expect(toE164PhoneNumber("415 555 2671", "US")).toBe("+14155552671");
  });

  it("rejects numbers that are invalid for the selected country", () => {
    expect(toE164PhoneNumber("123", "ZA")).toBeNull();
  });
});
