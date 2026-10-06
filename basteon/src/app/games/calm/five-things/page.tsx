import { Suspense } from "react";
import { StoepGame } from "@/components/StoepGame";

export default function FiveThingsPage() {
  return (
    <Suspense fallback={<div />}>
      <div style={{ padding: "16px 20px 0" }}>
        <a href="/games/calm" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 40, padding: "0.7rem 1rem", border: "1px solid #d8c5eb", borderRadius: 999, background: "rgba(255,255,255,0.78)", color: "#38224b", fontWeight: 800, textDecoration: "none" }}>← Back</a>
      </div>
      <StoepGame />
    </Suspense>
  );
}
