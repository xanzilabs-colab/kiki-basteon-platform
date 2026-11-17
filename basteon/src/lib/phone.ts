import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export type PhoneCountry = {
  country: CountryCode;
  name: string;
  callingCode: string;
  flag: string;
};

export const DEFAULT_PHONE_COUNTRY: CountryCode = "ZA";

export const PHONE_COUNTRIES: PhoneCountry[] = getCountries()
  .map((country) => ({
    country,
    name: country,
    callingCode: getCountryCallingCode(country),
    flag: String.fromCodePoint(
      ...country.split("").map((letter) => 127397 + letter.charCodeAt(0)),
    ),
  }))
  .sort((left, right) => left.country.localeCompare(right.country));

export function getLocalizedPhoneCountries(): PhoneCountry[] {
  const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
  return PHONE_COUNTRIES
    .map((country) => ({ ...country, name: countryNames.of(country.country) ?? country.country }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

export function toE164PhoneNumber(value: string, country: CountryCode): string | null {
  const phoneNumber = parsePhoneNumberFromString(value.trim(), country);
  return phoneNumber?.isValid() ? phoneNumber.number : null;
}
