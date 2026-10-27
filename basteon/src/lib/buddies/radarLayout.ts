const MAX_RADIAL_PERCENT = 24;

export function radarMarkerPosition(angleDeg: number, radialPct: number) {
  const angle = Number.isFinite(angleDeg) ? angleDeg : 0;
  const normalizedRadius = Number.isFinite(radialPct) ? Math.min(1, Math.max(0, radialPct)) : 0;
  const radius = 12 + normalizedRadius * (MAX_RADIAL_PERCENT - 12);
  const radians = (angle * Math.PI) / 180;

  return {
    left: 50 + Math.sin(radians) * radius,
    top: 50 - Math.cos(radians) * radius,
  };
}
