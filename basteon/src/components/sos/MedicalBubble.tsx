"use client";

import { HeartPulse } from "lucide-react";
import type { Point } from "@/lib/sos/sosGesture";

type Props = { anchor: DOMRect; armed: boolean; bubbleRef: React.RefObject<HTMLDivElement | null> };

export function MedicalBubble({ anchor, armed, bubbleRef }: Props) {
  const width = 174;
  const height = 66;
  const right = anchor.right + width + 24 <= window.innerWidth;
  const left = right ? anchor.right + 16 : Math.max(12, anchor.left - width - 16);
  const top = Math.max(12, Math.min(window.innerHeight - height - 12, anchor.top + (anchor.height - height) / 2));
  const buttonCenter: Point = { x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2 };
  const bubbleCenter: Point = { x: left + width / 2, y: top + height / 2 };
  const curveX = (buttonCenter.x + bubbleCenter.x) / 2;

  return (
    <>
      <svg className="sos-medical-arc" aria-hidden="true">
        <path d={`M ${buttonCenter.x} ${buttonCenter.y} Q ${curveX} ${buttonCenter.y - 22} ${bubbleCenter.x} ${bubbleCenter.y}`} />
      </svg>
      <div
        ref={bubbleRef}
        className={`sos-medical-bubble${armed ? " is-armed" : ""}`}
        style={{ left, top, width }}
        role="status"
        aria-live="polite"
      >
        <HeartPulse size={25} aria-hidden="true" />
        <span>{armed ? "Release to send Medical" : "Medical"}</span>
      </div>
    </>
  );
}