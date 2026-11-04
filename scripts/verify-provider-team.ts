import { pathToFileURL } from "node:url";

import { clubs, type ClubSlug } from "../src/config/club";
import { ApiFootballAdapter } from "../src/lib/providers/api-football/adapter";

export async function verifyProviderTeam(slug: ClubSlug, apiKey: string) {
  const club = clubs[slug];
  const provider = new ApiFootballAdapter(apiKey);
  const identity = await provider.resolveTeam({
    displayName: club.displayName,
    shortName: club.shortName,
    countryName: "Costa Rica",
  });
  return { slug, ...identity, providerRequests: provider.requestCount };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const slug = process.argv[2];
  if (slug !== "herediano" && slug !== "saprissa") {
    console.error(
      "Usage: npm run verify:provider-team -- <herediano|saprissa>",
    );
    process.exitCode = 1;
  } else {
    void verifyProviderTeam(slug, process.env.API_FOOTBALL_KEY ?? "")
      .then((result) => console.log(JSON.stringify(result)))
      .catch(() => {
        console.error("Provider Team verification failed.");
        process.exitCode = 1;
      });
  }
}
