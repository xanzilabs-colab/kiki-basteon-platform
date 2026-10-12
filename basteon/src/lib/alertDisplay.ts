import type { Alert } from "@/lib/types";

export function alertDeviceLabel(alert: Pick<Alert, "device_id" | "device">) {
  return alert.device?.device_name?.trim() || alert.device_id;
}

export function alertOwnerName(alert: Pick<Alert, "device">) {
  return alert.device?.owner?.full_name?.trim() || null;
}
