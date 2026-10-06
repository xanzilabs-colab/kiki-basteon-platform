import { GameLobby } from "@/components/GameLobby";

import Link from "next/link";

export default function PlayPage() {
  return (
    <div>
      <div style={{ padding: "20px 20px 0" }}>
        <Link href="/games" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 40, padding: "0.7rem 1rem", border: "1px solid #d8c5eb", borderRadius: 999, background: "rgba(255,255,255,0.78)", color: "#38224b", fontWeight: 800, textDecoration: "none" }}>← Back</Link>
      </div>
      <GameLobby />
    </div>
  );
}
