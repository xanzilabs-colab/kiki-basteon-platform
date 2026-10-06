import { Suspense } from "react";
import { StoepGame } from "@/components/StoepGame";

export default function FiveThingsPage() {
  return (
    <Suspense fallback={<div />}>
      <StoepGame />
    </Suspense>
  );
}
