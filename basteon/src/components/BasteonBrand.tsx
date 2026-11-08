import Image from "next/image";

type BasteonBrandProps = {
  variant?: "light" | "dark";
  markOnly?: boolean;
  wordmarkOnly?: boolean;
};

export function BasteonBrand({ variant = "dark", markOnly = false, wordmarkOnly = false }: BasteonBrandProps) {
  if (markOnly) {
    return (
      <span className="basteon-brand-mark" aria-hidden="true">
        <Image src="/assets/Basteon-icon-orange.png" alt="" width={5464} height={3072} priority />
      </span>
    );
  }

  const wordmark = (
    <span className={`basteon-wordmark-frame basteon-wordmark-${variant}`}>
      <Image
        src={variant === "light" ? "/assets/Basteon-logo-name-black.png.png" : "/assets/Artboard 44@4x.png"}
        alt="Basteon"
        width={5464}
        height={3072}
        priority
      />
    </span>
  );

  if (wordmarkOnly) return wordmark;
  return (
    <span className={`basteon-brand basteon-brand-${variant}`} aria-label="Basteon">
      {wordmark}
      <span className="basteon-brand-compact">
        <Image src="/assets/Basteon-icon-orange.png" alt="" width={5464} height={3072} priority />
      </span>
    </span>
  );
}
