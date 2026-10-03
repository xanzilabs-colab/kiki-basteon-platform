import Image from "next/image";

export function KikiMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  const height = Math.round((size * 375) / 666);

  return (
    <Image
      src="/assets/kiki-icon.png"
      alt="Kiki"
      width={size}
      height={height}
      className={`kiki-mark ${className}`}
    />
  );
}