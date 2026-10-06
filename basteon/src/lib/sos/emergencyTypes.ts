export type EmergencyType = {
  code: string;
  label: string;
  short_label: string;
  icon: string;
  tone: "danger" | "medical" | "warning" | "info";
  life_threat: boolean;
  sort_order: number;
  active: boolean;
};

export const BUILT_IN_EMERGENCY_TYPES: EmergencyType[] = [
  { code: "sos", label: "SOS: I'm in danger", short_label: "SOS", icon: "siren", tone: "danger", life_threat: true, sort_order: 0, active: true },
  { code: "medical", label: "Medical emergency", short_label: "Medical", icon: "heart-pulse", tone: "medical", life_threat: true, sort_order: 1, active: true },
];