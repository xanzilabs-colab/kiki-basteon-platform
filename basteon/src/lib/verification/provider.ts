import "server-only";

import type { FacePurpose } from "./config";

export type FaceCheckResult = {
  status: "passed" | "failed" | "pending" | "error";
  livenessPassed: boolean;
  matchScore: number;
  providerRef?: string;
};

export interface FaceProvider {
  startFaceCheck(userId: string, purpose: FacePurpose, nonce: string): Promise<{ providerSessionId: string; clientConfig: Record<string, unknown> }>;
  getFaceCheckResult(providerSessionId: string): Promise<FaceCheckResult>;
}

// Real adapters belong in ./providers. They must use provider SDK capture, verify signed
// webhooks or fetch server-side results, defend against injection attacks, and use ISO 30107-3 PAD.