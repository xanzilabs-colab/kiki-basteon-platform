import type { CSSProperties } from "react";

export const BASTEON_BRAND_PRIMARY = "#13A58F";
export const BRAND_HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DARK_SURFACE = "#08090A";
const EMERGENCY_RED_HUE = 0;
const RED_HUE_WARNING_DEGREES = 20;

export type OrganisationBranding = {
  id: string;
  name: string;
  display_name: string | null;
  logo_url: string | null;
  brand_primary_color: string | null;
  brand_accent_color: string | null;
  organisation_type?: string | null;
  category?: string | null;
  institution_kind?: string | null;
  business_category?: string | null;
  responder_category?: string | null;
};

export type BrandColorResolution = {
  primary: string;
  accent: string;
  primaryAdjusted: boolean;
  primaryText: "#000000" | "#FFFFFF";
  primaryHover: string;
  primaryNearEmergencyRed: boolean;
};

export type BrandCssProperties = CSSProperties & {
  [key: `--${string}`]: string;
};

function rgb(hex: string) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex: string) {
  const [red, green, blue] = rgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function mixWithWhite(hex: string, amount: number) {
  const channels = rgb(hex).map((value) => Math.round(value + (255 - value) * amount));
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function hueAndSaturation(hex: string) {
  const [red, green, blue] = rgb(hex).map((value) => value / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  hue = (hue + 360) % 360;
  return { hue, saturation: max === 0 ? 0 : delta / max };
}

function nearEmergencyRed(hex: string) {
  const { hue, saturation } = hueAndSaturation(hex);
  const distance = Math.min(Math.abs(hue - EMERGENCY_RED_HUE), 360 - Math.abs(hue - EMERGENCY_RED_HUE));
  return saturation > 0.35 && distance <= RED_HUE_WARNING_DEGREES;
}

export function resolveBrandColors(primaryInput: string | null | undefined, accentInput: string | null | undefined): BrandColorResolution {
  const input = primaryInput || BASTEON_BRAND_PRIMARY;
  if (!BRAND_HEX_PATTERN.test(input)) throw new Error("Primary brand colour must use #RRGGBB format.");
  if (accentInput && !BRAND_HEX_PATTERN.test(accentInput)) throw new Error("Accent brand colour must use #RRGGBB format.");

  const normalizedPrimary = input.toUpperCase();
  let primary = normalizedPrimary;
  if (contrastRatio(primary, DARK_SURFACE) < 3) {
    for (let amount = 0.01; amount <= 1; amount += 0.01) {
      primary = mixWithWhite(normalizedPrimary, amount);
      if (contrastRatio(primary, DARK_SURFACE) >= 3) break;
    }
  }
  const blackContrast = contrastRatio(primary, "#000000");
  const whiteContrast = contrastRatio(primary, "#FFFFFF");
  return {
    primary,
    accent: (accentInput || primary).toUpperCase(),
    primaryAdjusted: primary !== normalizedPrimary,
    primaryText: blackContrast >= whiteContrast ? "#000000" : "#FFFFFF",
    primaryHover: mixWithWhite(primary, 0.1),
    primaryNearEmergencyRed: nearEmergencyRed(normalizedPrimary),
  };
}

export function brandCssProperties(primary: string | null | undefined, accent: string | null | undefined): BrandCssProperties {
  const colors = resolveBrandColors(primary, accent);
  return {
    "--brand-primary": colors.primary,
    "--brand-primary-hover": colors.primaryHover,
    "--brand-accent": colors.accent,
    "--on-primary": colors.primaryText,
    "--accent": colors.primary,
    "--accent-ink": colors.primaryText,
    "--accent-bg": `color-mix(in srgb, ${colors.primary} 14%, transparent)`,
  } as BrandCssProperties;
}
