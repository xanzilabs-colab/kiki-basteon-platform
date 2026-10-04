"use client";

import { useState } from "react";

export type FacePurpose = "visibility" | "nearby" | "ping" | "bubble";
export type FaceState = "idle" | "preparing" | "checking" | "passed" | "failed" | "locked";

export function useFaceCheck() {
  const [state, setState] = useState<FaceState>("idle");
  const [message, setMessage] = useState("");
  const [simulationOutcome, setSimulationOutcome] = useState("pass");

  async function run(purpose: FacePurpose) {
    setState("preparing"); setMessage("");
    const started = await fetch("/api/verification/face/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose, simulationOutcome }) });
    const startData = await started.json().catch(() => ({}));
    if (!started.ok) { setState(startData.error === "locked" ? "locked" : "failed"); setMessage(startData.error ?? "Face check could not start."); return false; }
    setState("checking");
    const completed = await fetch("/api/verification/face/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: startData.sessionId }) });
    const completeData = await completed.json().catch(() => ({}));
    if (!completed.ok || !completeData.valid) { setState(completeData.error === "FACE_CHECK_LOCKED" ? "locked" : "failed"); setMessage(completeData.error ?? "Face check was not accepted."); return false; }
    setState("passed"); setMessage("Face check complete."); return true;
  }

  return { state, message, simulationOutcome, setSimulationOutcome, run, reset: () => { setState("idle"); setMessage(""); } };
}