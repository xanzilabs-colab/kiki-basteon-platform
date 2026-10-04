import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulatedFaceProvider } from "../providers/simulated";

describe("simulated face provider", () => {
  it("returns only server-derived outcomes", async () => {
    const passed = await new SimulatedFaceProvider("pass").getFaceCheckResult("simulation:pass:nonce");
    const livenessFailure = await new SimulatedFaceProvider("liveness_fail").getFaceCheckResult("simulation:liveness_fail:nonce");
    const mismatch = await new SimulatedFaceProvider("face_mismatch").getFaceCheckResult("simulation:face_mismatch:nonce");
    expect(passed).toMatchObject({ status: "passed", livenessPassed: true });
    expect(livenessFailure).toMatchObject({ status: "failed", livenessPassed: false });
    expect(mismatch).toMatchObject({ status: "failed", livenessPassed: true, matchScore: 0.1 });
  });
});

describe("verification runtime", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("rejects simulation mode in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERIFICATION_MODE", "simulation");
    const { assertVerificationRuntime } = await import("../config");
    expect(assertVerificationRuntime).toThrow("forbidden in production");
  });
});