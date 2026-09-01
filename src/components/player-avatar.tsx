"use client";

import Image from "next/image";
import { useState } from "react";

import { isPlayerPhotoUrl } from "@/config/player-photos";

export function PlayerAvatar({
  name,
  photoUrl,
  size = "compact",
  label,
}: {
  name: string;
  photoUrl?: string;
  size?: "compact" | "profile";
  label: string;
}) {
  const [failed, setFailed] = useState(false);
  const pixels = size === "profile" ? 80 : 48;
  const classes =
    size === "profile" ? "h-20 w-20 text-2xl" : "h-12 w-12 text-base";
  const showPhoto =
    photoUrl !== undefined && isPlayerPhotoUrl(photoUrl) && !failed;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden border-2 border-border bg-brand font-extrabold text-white ${classes}`}
      aria-label={label}
      role="img"
    >
      {showPhoto ? (
        <Image
          src={photoUrl}
          alt=""
          fill
          sizes={`${pixels}px`}
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const selected = parts.length === 1 ? parts : [parts[0], parts.at(-1)!];
  return selected.map((part) => [...part][0]?.toUpperCase() ?? "").join("");
}
