export type CommunityRiskReport = {
  lat: number;
  lng: number;
  kind: "unsafe_area" | "poor_lighting" | "harassment" | "road_hazard";
  created_at: string;
  expires_at: string;
  reporter_id: string | null;
  upvotes: number;
};
export type ApprovedSafePlace = {
  lat: number;
  lng: number;
  active: boolean;
  review_status: string;
  reverify_by: string | null;
  open_24h: boolean;
};
export type SafetyHint = {
  hintType: "avoid_time" | "alternative_route" | "stay_visible" | "safe_spot_nearby";
  message: string;
  severity: "info" | "caution";
  confidence: number;
  reason: { reportCount: number; periodDays: number; distinctReporters: number; safeSpotsNearby: number };
};
export type RiskCellSummary = {
  cellId: string;
  reportCount: number;
  distinctReporters: number;
  weightedScore: number;
  safeSpotDensity: number;
};

const KIND_WEIGHT: Record<CommunityRiskReport["kind"], number> = {
  unsafe_area: 1.2,
  poor_lighting: 0.8,
  harassment: 1.1,
  road_hazard: 0.7,
};

export function coarseCell(point: { lat: number; lng: number }) {
  return `${Math.round(point.lat * 100)}:${Math.round(point.lng * 100)}`;
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(value));
}

export function scoreRouteHints(input: {
  points: Array<{ lat: number; lng: number }>;
  reports: CommunityRiskReport[];
  safePlaces: ApprovedSafePlace[];
  now?: Date;
  radiusMeters?: number;
  minEvidence?: number;
}): SafetyHint[] {
  const now = input.now ?? new Date();
  const radius = input.radiusMeters ?? 700;
  const minEvidence = input.minEvidence ?? 3;
  const recentCutoff = now.getTime() - 30 * 24 * 60 * 60_000;
  const points = input.points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (!points.length) return [];

  const nearbyReports = input.reports.filter((report) =>
    new Date(report.expires_at).getTime() > now.getTime()
    && new Date(report.created_at).getTime() >= recentCutoff
    && points.some((point) => distanceMeters(point, report) <= radius),
  );
  const reporterScores = new Map<string, number>();
  for (const report of nearbyReports) {
    const reporter = report.reporter_id ?? `unknown:${coarseCell(report)}`;
    const ageDays = Math.max(0, (now.getTime() - new Date(report.created_at).getTime()) / 86_400_000);
    const decay = Math.pow(0.5, ageDays / 45);
    const score = KIND_WEIGHT[report.kind] * decay * (1 + Math.min(3, Math.max(0, report.upvotes)) * 0.1);
    reporterScores.set(reporter, Math.min(2.5, (reporterScores.get(reporter) ?? 0) + score));
  }
  const distinctReporters = new Set(nearbyReports.map((report) => report.reporter_id).filter((id): id is string => Boolean(id))).size;
  const cappedScore = [...reporterScores.values()].reduce((sum, score) => sum + score, 0);
  const liveSafePlaces = input.safePlaces.filter((place) =>
    place.active
    && place.review_status === "approved"
    && (!place.reverify_by || place.reverify_by >= now.toISOString().slice(0, 10))
    && points.some((point) => distanceMeters(point, place) <= radius),
  );
  const hints: SafetyHint[] = [];
  if (nearbyReports.length >= minEvidence && distinctReporters >= minEvidence && cappedScore >= minEvidence * 0.7) {
    const confidence = Math.min(0.9, 0.35 + distinctReporters * 0.08 + Math.min(10, cappedScore) * 0.025);
    hints.push({
      hintType: "avoid_time",
      message: `Several recent community reports are near this route. Consider travelling with someone or choosing a different time.`,
      severity: "caution",
      confidence,
      reason: {
        reportCount: nearbyReports.length,
        periodDays: 30,
        distinctReporters,
        safeSpotsNearby: liveSafePlaces.length,
      },
    });
  }
  if (liveSafePlaces.length > 0) {
    hints.push({
      hintType: "safe_spot_nearby",
      message: `${liveSafePlaces.length} verified public safe ${liveSafePlaces.length === 1 ? "spot is" : "spots are"} near this route.`,
      severity: "info",
      confidence: 0.8,
      reason: { reportCount: 0, periodDays: 30, distinctReporters: 0, safeSpotsNearby: liveSafePlaces.length },
    });
  }
  return hints;
}

export function summarizeRiskCells(input: {
  points: Array<{ lat: number; lng: number }>;
  reports: CommunityRiskReport[];
  safePlaces: ApprovedSafePlace[];
  now?: Date;
}): RiskCellSummary[] {
  const now = input.now ?? new Date();
  const cells = [...new Map(input.points.map((point) => [coarseCell(point), {
    cellId: coarseCell(point),
    lat: Math.round(point.lat * 100) / 100,
    lng: Math.round(point.lng * 100) / 100,
  }])).values()];
  return cells.map((cell) => {
    const reports = input.reports.filter((report) => distanceMeters(cell, report) <= 700);
    const perReporter = new Map<string, number>();
    for (const report of reports) {
      const reporter = report.reporter_id ?? `unknown:${coarseCell(report)}`;
      const ageDays = Math.max(0, (now.getTime() - new Date(report.created_at).getTime()) / 86_400_000);
      const decay = Math.pow(0.5, ageDays / 45);
      const itemScore = KIND_WEIGHT[report.kind] * decay * (1 + Math.min(3, report.upvotes) * 0.1);
      perReporter.set(reporter, Math.min(2.5, (perReporter.get(reporter) ?? 0) + itemScore));
    }
    const distinctReporters = new Set(reports.map((report) => report.reporter_id).filter((id): id is string => Boolean(id))).size;
    const safeSpotDensity = input.safePlaces.filter((place) =>
      place.active && place.review_status === "approved"
      && (!place.reverify_by || place.reverify_by >= now.toISOString().slice(0, 10))
      && distanceMeters(cell, place) <= 700,
    ).length;
    return {
      cellId: cell.cellId,
      reportCount: reports.length,
      distinctReporters,
      weightedScore: Math.round([...perReporter.values()].reduce((sum, score) => sum + score, 0) * 1_000) / 1_000,
      safeSpotDensity,
    };
  });
}

export function preferRoute<T extends { durationS: number; points: Array<{ lat: number; lng: number }> }>(
  routes: T[],
  reports: CommunityRiskReport[],
  safePlaces: ApprovedSafePlace[],
  now = new Date(),
) {
  const scored = routes.map((route) => {
    const hints = scoreRouteHints({ points: route.points, reports, safePlaces, now });
    const riskScore = hints.reduce((score, hint) => score + (hint.severity === "caution" ? hint.confidence * 100 : 0), 0);
    return { route, hints, riskScore };
  });
  if (scored.length < 2) return { preferredIndex: 0, alternatives: scored };
  const fastestDuration = Math.min(...scored.map((item) => item.route.durationS));
  const eligible = scored
    .map((item, index) => ({ ...item, index }))
    .filter((item) => item.route.durationS <= fastestDuration * 1.15);
  eligible.sort((a, b) => a.riskScore - b.riskScore || a.route.durationS - b.route.durationS);
  return { preferredIndex: eligible[0]?.index ?? 0, alternatives: scored };
}
