export type AccountMenuFeatures = {
  stoepEnabled: boolean;
  calmEnabled: boolean;
};

function isEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function getAccountMenuFeatures(
  env: Record<string, string | undefined> = process.env,
): AccountMenuFeatures {
  return {
    stoepEnabled: isEnabled(env.STOEP_ENABLED),
    calmEnabled: isEnabled(env.CALM_ENABLED),
  };
}
