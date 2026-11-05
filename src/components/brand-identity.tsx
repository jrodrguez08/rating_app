import Image from "next/image";

export function BrandIdentity({ prominent = false }: { prominent?: boolean }) {
  const size = prominent ? 48 : 32;

  return (
    <>
      <Image
        src="/icon.svg"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        unoptimized
        className={prominent ? "size-12 shrink-0" : "size-8 shrink-0"}
      />
      <span
        className={`score-font text-foreground ${prominent ? "text-2xl sm:text-3xl" : "text-base sm:text-lg"}`}
      >
        FutRate CR
      </span>
    </>
  );
}
