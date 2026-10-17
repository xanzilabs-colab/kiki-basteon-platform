export function resolveGestureProfileName(name: string, edited: boolean, deviceName: string): string {
  const trimmedName = name.trim();
  if (edited) return trimmedName;
  return trimmedName || deviceName.trim() || "Bluetooth accessory";
}
