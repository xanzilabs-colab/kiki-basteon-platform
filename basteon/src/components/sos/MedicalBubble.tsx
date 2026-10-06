"use client";

import { useEffect, useState } from "react";
import { HeartPulse } from "lucide-react";
import type { Point } from "@/lib/sos/sosGesture";

type Props = {
  anchor: DOMRect;
  armed: boolean;
  bubbleRef: React.RefObject<HTMLDivElement | null>;
};

export function MedicalBubble({ anchor, armed, bubbleRef }: Props) {
  const width = 160;
  const height = 160; // Circular bubble footprint for genuine sphere look

  // The Medical bubble always opens to the right of the SOS button.
  const left = anchor.right + 20;
  const top = Math.max(
    16,
    Math.min(window.innerHeight - height - 16, anchor.top + (anchor.height - height) / 2)
  );

  const buttonCenter: Point = {
    x: anchor.left + anchor.width / 2,
    y: anchor.top + anchor.height / 2,
  };
  const bubbleCenter: Point = {
    x: left + width / 2,
    y: top + height / 2,
  };

  // Organic Bezier curve calculations for dynamic metaball liquid tether
  const midX = (buttonCenter.x + bubbleCenter.x) / 2;
  const controlY1 = buttonCenter.y - 18;
  const controlY2 = bubbleCenter.y + 18;

  const pathD = `M ${buttonCenter.x} ${buttonCenter.y} C ${midX} ${controlY1}, ${midX} ${controlY2}, ${bubbleCenter.x} ${bubbleCenter.y}`;

  return (
    <>
      {/* Dynamic Fluid Liquid Tether / Arc */}
      <svg
        className="fixed inset-0 pointer-events-none z-40 w-full h-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="liquid-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(225, 29, 72, 0.3)" />
            <stop offset="50%" stopColor={armed ? "rgba(239, 68, 68, 0.9)" : "rgba(225, 29, 72, 0.7)"} />
            <stop offset="100%" stopColor={armed ? "rgba(239, 68, 68, 1)" : "rgba(225, 29, 72, 0.85)"} />
          </linearGradient>

          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Outer Glow Path */}
        <path
          d={pathD}
          fill="none"
          stroke="url(#liquid-gradient)"
          strokeWidth={armed ? "10" : "6"}
          strokeLinecap="round"
          filter="url(#glow)"
          className="transition-all duration-300 ease-out opacity-80"
        />

        {/* Inner Fluid Core */}
        <path
          d={pathD}
          fill="none"
          stroke="#ffffff"
          strokeWidth={armed ? "3" : "2"}
          strokeLinecap="round"
          className="opacity-60"
        />

        {/* Animated Particle Stream along the fluid tether */}
        {armed && (
          <path
            d={pathD}
            fill="none"
            stroke="rgba(255, 255, 255, 0.9)"
            strokeWidth="4"
            strokeLinecap="round"
            className="sos-tether-particle"
          />
        )}
      </svg>

      {/* Realistic Organic Spherical Bubble */}
      <div
        ref={bubbleRef}
        className={`fixed z-50 rounded-full flex flex-col items-center justify-center text-white cursor-pointer select-none sos-fluid-bubble ${
          armed ? "is-armed" : ""
        }`}
        style={{
          left,
          top,
          width,
          height,
        }}
        role="status"
        aria-live="polite"
      >
        {/* Surface Highlight Specular Ring */}
        <div className="absolute top-2 left-4 w-12 h-6 rounded-full bg-gradient-to-b from-white/60 to-transparent transform -rotate-45 pointer-events-none blur-[1px]" />

        {/* Content Container */}
        <div className="relative z-10 flex flex-col items-center justify-center text-center p-3">
          <div className={`p-2.5 rounded-full bg-white/10 backdrop-blur-md mb-1.5 transition-transform duration-300 ${armed ? "scale-125 bg-white/20" : ""}`}>
            <HeartPulse
              size={28}
              className={`text-white transition-all duration-300 ${
                armed ? "animate-ping text-red-100" : "animate-pulse"
              }`}
              aria-hidden="true"
            />
          </div>
          <span className="text-xs font-bold tracking-wide uppercase drop-shadow-md px-1">
            {armed ? "Release to Send" : "Medical"}
          </span>
          <span className="text-[10px] text-white/80 font-medium tracking-tight">
            {armed ? "Emergency Alert" : "Hold & Drag"}
          </span>
        </div>
      </div>
    </>
  );
}