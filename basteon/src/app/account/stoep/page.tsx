import { Suspense } from "react";
import { StoepGame } from "@/components/StoepGame";

export default function StoepPage() {
  return (
    <Suspense fallback={<div />}>
      <StoepGame />
    </Suspense>
  );
}