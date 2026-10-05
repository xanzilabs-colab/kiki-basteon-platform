import type { SkyPhase } from "./sky";
export const SKY: Record<SkyPhase, { top: string; bottom: string; far: string; mid: string; ground: string }> = {
  dawn: { top: "#8C7AD6", bottom: "#FFC2B0", far: "#B79ED8", mid: "#8F8FC4", ground: "#6E9C8E" },
  day: { top: "#8EC5FF", bottom: "#E9F2FF", far: "#A9C9E8", mid: "#86B9A6", ground: "#5FA58A" },
  golden: { top: "#F2A8C3", bottom: "#FFD3A1", far: "#C79AC9", mid: "#9A8FB5", ground: "#6B9279" },
  dusk: { top: "#3D2B7A", bottom: "#E58AB0", far: "#6A4C94", mid: "#4F3F82", ground: "#3C5A66" },
  night: { top: "#0F0B2A", bottom: "#2A2060", far: "#241C55", mid: "#1C1745", ground: "#1A3340" },
};