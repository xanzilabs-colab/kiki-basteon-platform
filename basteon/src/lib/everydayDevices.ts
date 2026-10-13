export const EVERYDAY_DEVICE_KINDS = [
  "earbuds",
  "wired",
  "car",
  "speaker",
  "helmet",
  "glasses",
  "ring",
  "pedal",
  "keyboard",
  "watch",
  "other",
] as const;

export type EverydayDeviceKind = (typeof EVERYDAY_DEVICE_KINDS)[number];

export interface EverydayDeviceGuide {
  label: string;
  pairing: "system" | "plug" | "manual";
  connect: string;
  press: string;
  practice: string;
  reconnect: string[];
}

export const EVERYDAY_DEVICE_GUIDES: Record<EverydayDeviceKind, EverydayDeviceGuide> = {
  earbuds: {
    label: "Earbuds / headphones",
    pairing: "system",
    connect: "Pair in Android Bluetooth settings, then connect media audio.",
    press: "Use the play/pause or next-track media control.",
    practice: "Try five quick presses while audio is paused.",
    reconnect: ["Open the case or power the headset on.", "Keep it close to the phone and reconnect it in Bluetooth settings."],
  },
  wired: {
    label: "Wired earphones",
    pairing: "plug",
    connect: "Plug in earphones with an inline media button.",
    press: "Use the inline play/pause button.",
    practice: "Try five quick presses; volume-only controls are not media buttons.",
    reconnect: ["Check the plug or USB adapter is seated.", "Reconnect the headset, then retry its practice check."],
  },
  car: {
    label: "Car controls",
    pairing: "system",
    connect: "Pair the car with Android and select Bluetooth media as its source.",
    press: "Use a play/pause or next-track steering-wheel control.",
    practice: "Practice only while parked.",
    reconnect: ["Reconnect the phone from the car's Bluetooth menu.", "Select Bluetooth media as the audio source."],
  },
  speaker: {
    label: "Bluetooth speaker",
    pairing: "system",
    connect: "Pair and connect the speaker for media audio.",
    press: "Use its play/pause or next-track button.",
    practice: "Try five quick media-button presses.",
    reconnect: ["Power-cycle the speaker.", "Reconnect it in Bluetooth settings and retry practice."],
  },
  helmet: {
    label: "Helmet / intercom",
    pairing: "system",
    connect: "Pair the intercom with the phone (not only with another intercom).",
    press: "Use its play/pause or next-track media control.",
    practice: "Practice while stationary and not riding.",
    reconnect: ["Power-cycle the intercom.", "Reconnect the phone using the intercom's pairing procedure."],
  },
  glasses: {
    label: "Smart glasses",
    pairing: "system",
    connect: "Pair the glasses with Android and connect media audio if available.",
    press: "Use the glasses' play/pause or next-track media gesture.",
    practice: "Try five quick gestures and confirm they arrive in Trigger Lab.",
    reconnect: ["Fold/unfold or power-cycle the glasses.", "Reconnect them in Bluetooth settings."],
  },
  ring: {
    label: "Ring / clicker",
    pairing: "manual",
    connect: "Pair it in Android settings; add manually if it is not listed.",
    press: "Only play/pause and next-track media controls can reach Kiki.",
    practice: "Arrow, page-turn, volume, and camera-shutter buttons are not supported media keys.",
    reconnect: ["Power-cycle the ring or clicker.", "Reconnect it in Android settings and confirm its media mode."],
  },
  pedal: {
    label: "Foot pedal",
    pairing: "manual",
    connect: "Pair it in Android settings; add manually if it is not listed.",
    press: "It must emit play/pause or next-track media keys.",
    practice: "Page-up/down, arrow-key, and keyboard pedals do not reach a media session.",
    reconnect: ["Check the pedal is charged and in media mode.", "Reconnect it from Android Bluetooth settings."],
  },
  keyboard: {
    label: "Keyboard / remote",
    pairing: "manual",
    connect: "Pair it in Android settings; add manually if it is not listed.",
    press: "Use only dedicated play/pause or next-track media keys.",
    practice: "Enter, volume, camera, or navigation keys are not supported trigger inputs.",
    reconnect: ["Check the remote is on and paired.", "Reconnect it from Android Bluetooth settings."],
  },
  watch: {
    label: "Smartwatch",
    pairing: "manual",
    connect: "Some watches do not appear in Android's paired-device list; add manually.",
    press: "The watch must send a standard play/pause or next-track media event to the phone.",
    practice: "Compatibility varies by watch and companion app; verify the event before relying on it.",
    reconnect: ["Check the watch's media controls and phone connection.", "Reopen the watch media controls and run Practice again."],
  },
  other: {
    label: "Other media control",
    pairing: "manual",
    connect: "Connect the accessory and confirm it sends standard Android media-button events.",
    press: "Capture the button or control that sends a media event.",
    practice: "Verify every gesture in Practice before considering live mode.",
    reconnect: ["Reconnect the accessory in Android settings.", "Confirm its media controls reach the phone."],
  },
};
