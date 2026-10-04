import "server-only";

import type { FaceProvider } from "../provider";
import { SIMULATION_OUTCOMES, type FacePurpose, type SimulationOutcome } from "../config";

export class SimulatedFaceProvider implements FaceProvider {
  constructor(private readonly outcome: SimulationOutcome) {}

  async startFaceCheck(_userId: string, _purpose: FacePurpose, nonce: string) {
    return {
      providerSessionId: `simulation:${this.outcome}:${nonce}`,
      clientConfig: { simulation: true, outcomes: SIMULATION_OUTCOMES },
    };
  }

  async getFaceCheckResult(providerSessionId: string) {
    const [, outcome] = providerSessionId.split(":");
    switch (outcome as SimulationOutcome) {
      case "pass": return { status: "passed" as const, livenessPassed: true, matchScore: 0.99, providerRef: providerSessionId };
      case "liveness_fail": return { status: "failed" as const, livenessPassed: false, matchScore: 0.99, providerRef: providerSessionId };
      case "face_mismatch": return { status: "failed" as const, livenessPassed: true, matchScore: 0.1, providerRef: providerSessionId };
      case "timeout": return { status: "pending" as const, livenessPassed: false, matchScore: 0, providerRef: providerSessionId };
      default: return { status: "error" as const, livenessPassed: false, matchScore: 0, providerRef: providerSessionId };
    }
  }
}