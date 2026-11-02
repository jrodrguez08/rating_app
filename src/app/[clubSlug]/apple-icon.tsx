import { requireClub } from "@/config/club-server";

import { clubIcon } from "./club-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon({
  params,
}: {
  params: Promise<{ clubSlug: string }>;
}) {
  const { clubSlug } = await params;
  return clubIcon(requireClub(clubSlug), size.width);
}
