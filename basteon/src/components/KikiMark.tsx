import Image from "next/image";

export function KikiMark({ size = 32, zoom = 1, className = "" }: { size?: number; zoom?: number; className?: string }) {
  return (
    <span className={`kiki-mark ${className}`} style={{ width: size, height: size }}>
      <Image src="/assets/kiki-icon.png" alt="Kiki" fill sizes={`${size}px`} style={{ objectFit: "contain", transform: `scale(${zoom})` }} />
    </span>
  );
}