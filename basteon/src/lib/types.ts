export type AlertStatus = "new" | "acknowledged" | "enroute" | "on_scene" | "resolved" | "false_alarm";
export type LocationSource = "gps" | "stale" | "cached" | "dev" | null;
export interface ProfileContact { full_name: string | null; phone?: string | null; home_address?: string | null; emergency_contact_name?: string | null; emergency_contact_phone?: string | null; email?: string | null; }

export interface Alert {
  id: string; device_id: string; ctr: number; status: AlertStatus; lat: number | null; lng: number | null;
  loc_source: LocationSource; fix_age_s: number | null; battery: number | null; assigned_to: string | null;
  triggered_at: string; acknowledged_at: string | null; enroute_at: string | null; on_scene_at: string | null;
  resolved_at: string | null; updated_at: string; last_location_at: string | null; last_loc_ctr: number; update_count: number;
  device?: { device_name: string; user_id: string | null; owner?: ProfileContact | null } | null;
  assignee?: { full_name: string | null } | null;
}
export interface AlertLocation {
  id: number; alert_id: string; device_id: string; lat: number | null; lng: number | null;
  loc_source: LocationSource; fix_age_s: number | null; battery: number | null; ctr: number; recorded_at: string;
}
export interface AlertEvent { id: string; alert_id: string; actor_id: string | null; from_status: AlertStatus | null; to_status: AlertStatus; note: string | null; created_at: string; actor?: { full_name: string | null } | null; }
export interface DeviceOwner { id: string; full_name: string | null; phone: string | null; email: string | null; }
export interface Profile extends ProfileContact { id: string; consented_at?: string | null; ringtone_path?: string | null; role: "admin" | "responder" | "user"; created_at: string; linked_device_count?: number; devices?: Device[]; }
export interface Device { id: string; device_id: string; device_name: string; user_id: string | null; active: boolean; last_ctr: number; last_seen_at: string | null; linked_at?: string | null; created_at: string; owner?: DeviceOwner | null; }