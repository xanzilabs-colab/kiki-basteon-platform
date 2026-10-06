"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { HeartPulse } from "lucide-react";
import type { Point } from "@/lib/sos/sosGesture";

type Props = {
  anchor: DOMRect;
  armed: boolean;
  bubbleRef: React.RefObject<HTMLDivElement | null>;
};

const SIZE = 124;
const GAP = 20;
const PAD = 90;
const POINTS = 14;

const COLOR_EDGE = "#c8103c";
const COLOR_MID = "#ff4d73";
const COLOR_LIGHT = "#ffb8c9";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function blobPath(points: Point[]) {
  const count = points.length;
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < count; index++) {
    const previous = points[(index - 1 + count) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    const afterNext = points[(index + 2) % count];
    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (afterNext.x - current.x) / 6;
    const control2Y = next.y - (afterNext.y - current.y) / 6;
    path += ` C ${control1X.toFixed(2)} ${control1Y.toFixed(2)} ${control2X.toFixed(2)} ${control2Y.toFixed(2)} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return `${path} Z`;
}

export function MedicalBubble({ anchor, armed, bubbleRef }: Props) {
  const uid = useId().replace(/:/g, "");
  const armedRef = useRef(armed);
  const gooBlob = useRef<SVGPathElement>(null);
  const body = useRef<SVGPathElement>(null);
  const rim = useRef<SVGPathElement>(null);
  const clip = useRef<SVGPathElement>(null);
  const tether = useRef<SVGLineElement>(null);
  const glow = useRef<SVGCircleElement>(null);
  const ring1 = useRef<SVGCircleElement>(null);
  const ring2 = useRef<SVGCircleElement>(null);
  const gloss = useRef<SVGGElement>(null);
  const sheen = useRef<SVGGElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const icon = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    armedRef.current = armed;
  }, [armed]);

  const geometry = useMemo(() => {
    const radius = SIZE / 2;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const fitsRight = anchor.right + GAP + SIZE + 12 <= viewportWidth;
    const left = fitsRight ? anchor.right + GAP : Math.max(12, anchor.left - GAP - SIZE);
    const top = clamp(anchor.top + (anchor.height - SIZE) / 2, 12, viewportHeight - SIZE - 12);
    const button: Point = { x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2 };
    const target: Point = { x: left + radius, y: top + radius };
    const buttonRadius = Math.min(anchor.width, anchor.height) / 2;
    const minX = Math.min(anchor.left, left) - PAD;
    const minY = Math.min(anchor.top, top) - PAD;
    const maxX = Math.max(anchor.right, left + SIZE) + PAD;
    const maxY = Math.max(anchor.bottom, top + SIZE) + PAD;
    return {
      radius,
      left,
      top,
      button,
      target,
      buttonRadius,
      box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    };
  }, [anchor.left, anchor.top, anchor.width, anchor.height, anchor.right, anchor.bottom]);

  useEffect(() => {
    const { button, target, radius } = geometry;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const directionX = target.x - button.x;
    const directionY = target.y - button.y;
    const distance = Math.hypot(directionX, directionY) || 1;
    const unitX = directionX / distance;
    const unitY = directionY / distance;

    let emergence = reduceMotion ? 1 : 0;
    let emergenceVelocity = 0;
    let armedValue = armedRef.current ? 1 : 0;
    let armedVelocity = 0;
    let animationFrame = 0;
    let previousTime = performance.now();
    const startTime = previousTime;

    const frame = (now: number) => {
      const delta = Math.min(0.032, (now - previousTime) / 1000);
      previousTime = now;
      const elapsed = (now - startTime) / 1000;
      const armedTarget = armedRef.current ? 1 : 0;

      if (reduceMotion) {
        emergence = 1;
        emergenceVelocity = 0;
        armedValue = armedTarget;
        armedVelocity = 0;
      } else {
        const substeps = 2;
        const step = delta / substeps;
        for (let index = 0; index < substeps; index++) {
          emergenceVelocity += (-170 * (emergence - 1) - 11 * emergenceVelocity) * step;
          emergence += emergenceVelocity * step;
          armedVelocity += (-230 * (armedValue - armedTarget) - 14 * armedVelocity) * step;
          armedValue += armedVelocity * step;
        }
      }

      const growth = Math.max(0, emergence);
      const currentRadius = radius * (0.1 + 0.9 * growth) * (1 + 0.09 * armedValue);
      const centerX = button.x + (target.x - button.x) * emergence;
      const centerY = button.y + (target.y - button.y) * emergence;
      const wobble = reduceMotion ? 0 : 0.028 + 0.05 * clamp(armedValue, 0, 1.2) + 0.12 * clamp(Math.abs(emergenceVelocity) * 0.05, 0, 1);
      const stretch = reduceMotion ? 0 : clamp(emergenceVelocity * 0.045, -0.3, 0.45);
      const points: Point[] = [];

      for (let index = 0; index < POINTS; index++) {
        const angle = (index / POINTS) * Math.PI * 2;
        const noise = Math.sin(2 * angle + elapsed * 1.9) * 0.5
          + Math.sin(3 * angle - elapsed * 2.6) * 0.32
          + Math.sin(5 * angle + elapsed * 3.4) * 0.18;
        const pointRadius = currentRadius * (1 + wobble * noise);
        let x = Math.cos(angle) * pointRadius;
        let y = Math.sin(angle) * pointRadius;
        const along = x * unitX + y * unitY;
        const perpendicular = -x * unitY + y * unitX;
        const stretched = along * (1 + stretch);
        const squashed = perpendicular * (1 - stretch * 0.5);
        x = stretched * unitX - squashed * unitY;
        y = stretched * unitY + squashed * unitX;
        points.push({ x: centerX + x, y: centerY + y });
      }

      const path = blobPath(points);
      gooBlob.current?.setAttribute("d", path);
      body.current?.setAttribute("d", path);
      rim.current?.setAttribute("d", path);
      clip.current?.setAttribute("d", path);

      const progress = clamp(emergence, 0, 1);
      const neckWidth = (9 + 8 * (1 - progress)) * clamp(emergence * 3, 0, 1) * (1 - clamp(armedValue * 1.5, 0, 1));
      const tetherLine = tether.current;
      if (tetherLine) {
        tetherLine.setAttribute("x1", String(button.x));
        tetherLine.setAttribute("y1", String(button.y));
        tetherLine.setAttribute("x2", centerX.toFixed(2));
        tetherLine.setAttribute("y2", centerY.toFixed(2));
        tetherLine.setAttribute("stroke-width", neckWidth.toFixed(2));
      }

      const glowCircle = glow.current;
      if (glowCircle) {
        glowCircle.setAttribute("cx", centerX.toFixed(2));
        glowCircle.setAttribute("cy", centerY.toFixed(2));
        glowCircle.setAttribute("r", (currentRadius * 1.9).toFixed(2));
        glowCircle.setAttribute("opacity", (progress * (0.28 + 0.7 * clamp(armedValue, 0, 1))).toFixed(3));
      }

      [ring1.current, ring2.current].forEach((element, index) => {
        if (!element) return;
        const phase = (elapsed * 0.85 + index * 0.5) % 1;
        element.setAttribute("cx", centerX.toFixed(2));
        element.setAttribute("cy", centerY.toFixed(2));
        element.setAttribute("r", (currentRadius * (1.02 + phase * 0.55)).toFixed(2));
        element.setAttribute("opacity", (clamp(armedValue, 0, 1) * (1 - phase) * 0.55).toFixed(3));
      });

      const scale = currentRadius / radius;
      const glossGroup = gloss.current;
      if (glossGroup) {
        const tilt = reduceMotion ? 0 : Math.sin(elapsed * 0.9) * 7;
        glossGroup.setAttribute("transform", `translate(${centerX.toFixed(2)} ${centerY.toFixed(2)}) scale(${scale.toFixed(4)}) rotate(${tilt.toFixed(2)})`);
      }
      const sheenGroup = sheen.current;
      if (sheenGroup) {
        sheenGroup.setAttribute("transform", `translate(${centerX.toFixed(2)} ${centerY.toFixed(2)}) scale(${scale.toFixed(4)}) rotate(${((elapsed * 24) % 360).toFixed(1)})`);
      }

      const contentElement = content.current;
      if (contentElement) {
        const contentScale = clamp((emergence - 0.35) / 0.55, 0, 1.18) * (1 + 0.06 * clamp(armedValue, 0, 1));
        contentElement.style.transform = `translate(${(centerX - target.x).toFixed(2)}px, ${(centerY - target.y).toFixed(2)}px) scale(${contentScale.toFixed(3)})`;
        contentElement.style.opacity = String(clamp(contentScale, 0, 1));
      }
      const iconElement = icon.current;
      if (iconElement) {
        const beat = reduceMotion ? 0 : Math.pow(Math.max(0, Math.sin(elapsed * 6.2)), 6);
        iconElement.style.transform = `scale(${(1 + 0.2 * beat * (0.35 + 0.65 * clamp(armedValue, 0, 1))).toFixed(3)})`;
      }

      animationFrame = requestAnimationFrame(frame);
    };

    animationFrame = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationFrame);
  }, [geometry]);

  if (typeof document === "undefined") return null;

  const { box, button, buttonRadius, left, top, radius } = geometry;
  const id = (name: string) => `${name}-${uid}`;

  return createPortal(
    <>
      <svg
        aria-hidden="true"
        style={{
          position: "fixed",
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          overflow: "visible",
          pointerEvents: "none",
          zIndex: 9998,
          filter: "drop-shadow(0 12px 18px rgba(200,16,60,.38))",
        }}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      >
        <defs>
          <filter id={id("goo")} filterUnits="userSpaceOnUse" x={box.x} y={box.y} width={box.width} height={box.height} colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="b" />
            <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
          </filter>
          <mask id={id("mask")} maskUnits="userSpaceOnUse" x={box.x} y={box.y} width={box.width} height={box.height}>
            <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="#fff" />
            <circle cx={button.x} cy={button.y} r={Math.max(0, buttonRadius - 1)} fill="#000" />
          </mask>
          <clipPath id={id("clip")}><path ref={clip} /></clipPath>
          <radialGradient id={id("body")} cx="36%" cy="30%" r="82%">
            <stop offset="0" stopColor={COLOR_LIGHT} />
            <stop offset="0.42" stopColor={COLOR_MID} />
            <stop offset="1" stopColor={COLOR_EDGE} />
          </radialGradient>
          <radialGradient id={id("depth")} cx="50%" cy="50%" r="50%">
            <stop offset="0.62" stopColor="#5a0018" stopOpacity="0" />
            <stop offset="1" stopColor="#5a0018" stopOpacity="0.42" />
          </radialGradient>
          <radialGradient id={id("spec")} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id("caustic")} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffd6e0" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffd6e0" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id("irid")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7df9ff" />
            <stop offset="0.5" stopColor="#ff7ad9" />
            <stop offset="1" stopColor="#ffe27a" />
          </linearGradient>
          <linearGradient id={id("rim")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.06" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.5" />
          </linearGradient>
          <radialGradient id={id("glow")} cx="50%" cy="50%" r="50%">
            <stop offset="0.35" stopColor={COLOR_MID} stopOpacity="0.55" />
            <stop offset="1" stopColor={COLOR_MID} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle ref={glow} fill={`url(#${id("glow")})`} opacity="0" />
        <circle ref={ring1} fill="none" stroke="#fff" strokeWidth="1.5" opacity="0" />
        <circle ref={ring2} fill="none" stroke="#fff" strokeWidth="1.5" opacity="0" />

        <g mask={`url(#${id("mask")})`}>
          <g filter={`url(#${id("goo")})`} fill={COLOR_EDGE}>
            <circle cx={button.x} cy={button.y} r={buttonRadius} />
            <line ref={tether} stroke={COLOR_EDGE} strokeLinecap="round" />
            <path ref={gooBlob} />
          </g>
        </g>

        <path ref={body} fill={`url(#${id("body")})`} />
        <g clipPath={`url(#${id("clip")})`}>
          <g ref={gloss}>
            <circle r={radius} fill={`url(#${id("depth")})`} />
            <ellipse cx={radius * 0.16} cy={radius * 0.6} rx={radius * 0.52} ry={radius * 0.22} fill={`url(#${id("caustic")})`} />
            <ellipse cx={-radius * 0.3} cy={-radius * 0.46} rx={radius * 0.4} ry={radius * 0.19} fill={`url(#${id("spec")})`} transform={`rotate(-30 ${-radius * 0.3} ${-radius * 0.46})`} />
            <circle cx={-radius * 0.55} cy={-radius * 0.1} r={radius * 0.06} fill="#fff" opacity="0.8" />
            <path d={`M ${radius * 0.62} ${radius * 0.34} A ${radius * 0.74} ${radius * 0.74} 0 0 1 ${radius * 0.2} ${radius * 0.72}`} fill="none" stroke="#fff" strokeOpacity="0.42" strokeWidth={radius * 0.05} strokeLinecap="round" />
          </g>
          <g ref={sheen} style={{ mixBlendMode: "screen" }} opacity="0.2">
            <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} fill={`url(#${id("irid")})`} />
          </g>
        </g>
        <path ref={rim} fill="none" stroke={`url(#${id("rim")})`} strokeWidth="1.8" />
      </svg>

      <div
        ref={bubbleRef}
        role="status"
        aria-live="polite"
        style={{ position: "fixed", left, top, width: SIZE, height: SIZE, zIndex: 9999, pointerEvents: "none" }}
      >
        <div
          ref={content}
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            color: "#fff",
            textAlign: "center",
            opacity: 0,
            willChange: "transform, opacity",
            textShadow: "0 1px 6px rgba(120,0,30,.55)",
          }}
        >
          <span ref={icon} style={{ display: "inline-flex", willChange: "transform" }}>
            <HeartPulse size={30} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span style={{ fontSize: armed ? 12 : 13.5, fontWeight: 700, letterSpacing: ".02em", lineHeight: 1.15, maxWidth: 82, transition: "font-size .2s ease" }}>
            {armed ? "Release to send" : "Medical"}
          </span>
        </div>
      </div>
    </>,
    document.body,
  );
}
