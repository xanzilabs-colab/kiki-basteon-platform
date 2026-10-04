export const BASTEON_SERVICE_UUID = "7b1c0001-4e5a-4a6d-9c1b-8f3a2d5e6b00";
export const BASTEON_INFO_UUID = "7b1c0002-4e5a-4a6d-9c1b-8f3a2d5e6b00";
export const BASTEON_TOKEN_UUID = "7b1c0003-4e5a-4a6d-9c1b-8f3a2d5e6b00";
export const BASTEON_STATUS_UUID = "7b1c0004-4e5a-4a6d-9c1b-8f3a2d5e6b00";
// Firmware v2.6+: PIN lock control and one-time challenge.
export const BASTEON_CTRL_UUID = "7b1c0005-4e5a-4a6d-9c1b-8f3a2d5e6b00";
export const BASTEON_NONCE_UUID = "7b1c0006-4e5a-4a6d-9c1b-8f3a2d5e6b00";
/** Must match PIN_PBKDF2_ITERS in the firmware; an unlocked band does not report it. */
export const BAND_PIN_PBKDF2_ITERS = 10_000;