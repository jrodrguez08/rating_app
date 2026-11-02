import { requireClub } from "@/config/club-server";

import { clubIcon } from "./club-icon";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon({
  params,
}: {
  params: Promise<{ clubSlug: string }>;
}) {
  const { clubSlug } = await params;
  return clubIcon(requireClub(clubSlug), size.width);
}
