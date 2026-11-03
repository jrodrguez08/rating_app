/* eslint-disable @next/next/no-img-element -- ImageResponse cannot render next/image. */

import type {
  PublishedPodiumPlayer,
  PublishedResultPodium,
} from "@/application/published-result-podium";
import type { Club } from "@/config/club";
import { getTeamBadgePresentation } from "@/config/team-badges";
import { siteIdentity } from "@/config/site";
import type { Locale } from "@/i18n/config";
import { formatRating } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

export const OPEN_GRAPH_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const STORY_IMAGE_SIZE = { width: 1080, height: 1920 } as const;

export function PublishedPodiumImage({
  club,
  podium,
  variant,
  photoDataUrls,
  siteHost,
  locale,
  messages,
}: {
  club: Club;
  podium: PublishedResultPodium;
  variant: "open-graph" | "story";
  photoDataUrls: ReadonlyMap<string, string>;
  siteHost: string;
  locale: Locale;
  messages: Messages["results"]["image"];
}) {
  const story = variant === "story";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        padding: story ? "74px 66px 62px" : "38px 58px 34px",
        background: siteIdentity.backgroundColor,
        color: "#f7f2e8",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          flexDirection: story ? "column" : "row",
          alignItems: story ? "center" : "flex-start",
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: story ? "center" : "flex-start",
          }}
        >
          <div
            style={{
              color: club.theme.accent,
              fontSize: story ? 31 : 23,
              fontWeight: 800,
              letterSpacing: story ? 4 : 3,
            }}
          >
            {story ? messages.podiumHeading : messages.openGraphHeading}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: story ? 22 : 10,
              fontSize: story ? 42 : 28,
              fontWeight: 900,
              textAlign: story ? "center" : "left",
            }}
          >
            Rating App
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 8,
              fontSize: story ? 28 : 18,
              fontWeight: 800,
            }}
          >
            {club.displayName}
          </div>
        </div>
        <MatchScore podium={podium} story={story} club={club} />
      </header>
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "flex-end",
          justifyContent: "center",
          position: "relative",
          marginTop: story ? 70 : 18,
          paddingBottom: story ? 90 : 0,
        }}
      >
        {[podium.topThree[1], podium.topThree[0], podium.topThree[2]].map(
          (player, index) => (
            <div
              key={player?.playerId ?? `empty-${index}`}
              style={{
                width: story
                  ? index === 1
                    ? 356
                    : 286
                  : index === 1
                    ? 286
                    : 242,
                height: story
                  ? index === 1
                    ? 970
                    : 800
                  : index === 1
                    ? 330
                    : 290,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                margin: story ? "0 3px" : "0 8px",
              }}
            >
              {player ? (
                <PlayerPodium
                  player={player}
                  club={club}
                  story={story}
                  locale={locale}
                  photoDataUrl={photoDataUrls.get(player.playerId)}
                />
              ) : null}
            </div>
          ),
        )}
      </div>
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          marginTop: story ? 54 : 18,
          borderTop: `3px solid ${club.theme.primary}`,
          paddingTop: story ? 28 : 14,
          fontSize: story ? 28 : 20,
          fontWeight: 800,
        }}
      >
        <span>{story ? siteHost : messages.viewResults}</span>
        <span style={{ color: club.theme.accent }}>RATING APP</span>
      </footer>
    </div>
  );
}

function MatchScore({
  podium,
  story,
  club,
}: {
  podium: PublishedResultPodium;
  story: boolean;
  club: Club;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginTop: story ? 58 : 0,
        border: `4px solid ${club.theme.primary}`,
        boxShadow: story ? "12px 12px 0 #050506" : "8px 8px 0 #050506",
        background: "#191b1f",
        padding: story ? "30px 34px" : "15px 20px",
      }}
    >
      <Team team={podium.homeTeam} story={story} />
      <div
        style={{
          display: "flex",
          margin: story ? "0 28px" : "0 20px",
          color: club.theme.accent,
          fontSize: story ? 86 : 55,
          fontWeight: 900,
          whiteSpace: "nowrap",
        }}
      >
        {podium.score.home} - {podium.score.away}
      </div>
      <Team team={podium.awayTeam} story={story} />
    </div>
  );
}

function Team({
  team,
  story,
}: {
  team: PublishedResultPodium["homeTeam"];
  story: boolean;
}) {
  const badge = getTeamBadgePresentation(team);
  return (
    <div
      style={{
        width: story ? 250 : 205,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: story ? 76 : 48,
          height: story ? 76 : 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `5px solid ${badge.primary}`,
          background: badge.secondary,
          color: "#101113",
          fontSize: story ? 27 : 18,
          fontWeight: 900,
        }}
      >
        {badge.abbreviation}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: story ? 14 : 7,
          fontSize: story ? 28 : 17,
          fontWeight: 800,
          lineHeight: 1.1,
          textAlign: "center",
        }}
      >
        {team.name}
      </div>
    </div>
  );
}

function PlayerPodium({
  player,
  story,
  photoDataUrl,
  club,
  locale,
}: {
  player: PublishedPodiumPlayer;
  story: boolean;
  photoDataUrl?: string;
  club: Club;
  locale: Locale;
}) {
  const first = player.rank === 1;
  const medal = first ? "#f5c518" : player.rank === 2 ? "#c9cdd3" : "#c57b43";
  const width = story ? (first ? 340 : 270) : first ? 278 : 232;
  const portraitHeight = story ? (first ? 430 : 330) : first ? 145 : 120;
  return (
    <div
      style={{
        width,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {player.isMvp && story ? (
        <div
          style={{
            display: "flex",
            marginBottom: story ? 18 : 8,
            border: `3px solid ${club.theme.accent}`,
            background: "#101113",
            color: club.theme.accent,
            padding: story ? "9px 16px" : "5px 10px",
            fontSize: story ? 24 : 16,
            fontWeight: 900,
          }}
        >
          MVP
        </div>
      ) : null}
      <div
        style={{
          width,
          height: portraitHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
          border: `6px solid ${medal}`,
          background: "#272a30",
          boxShadow: story ? "10px 10px 0 #050506" : "6px 6px 0 #050506",
        }}
      >
        {photoDataUrl ? (
          <img
            alt=""
            src={photoDataUrl}
            width={width}
            height={portraitHeight}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: medal,
              fontSize: story ? (first ? 110 : 86) : first ? 74 : 60,
              fontWeight: 900,
            }}
          >
            {initials(player.displayName)}
          </div>
        )}
        {player.isMvp && !story ? (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              display: "flex",
              border: `3px solid ${club.theme.accent}`,
              background: "#101113",
              color: club.theme.accent,
              padding: "5px 10px",
              fontSize: 16,
              fontWeight: 900,
            }}
          >
            MVP
          </div>
        ) : null}
      </div>
      <div
        style={{
          width,
          minHeight: story ? 158 : first ? 80 : 72,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          marginTop: story ? 20 : 10,
          border: `4px solid ${medal}`,
          background: first ? club.theme.primary : "#202328",
          padding: story ? "18px 13px" : "10px 9px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: story
              ? nameSize(player.displayName, first)
              : first
                ? 25
                : 21,
            fontWeight: 900,
            lineHeight: 1.1,
            textAlign: "center",
          }}
        >
          {player.displayName}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: story ? 15 : 7,
            color: first ? "#ffffff" : medal,
            fontSize: story ? (first ? 59 : 48) : first ? 38 : 31,
            fontWeight: 900,
          }}
        >
          {formatRating(player.average, locale)}
        </div>
      </div>
      <div
        style={{
          width: story ? (first ? 315 : 250) : first ? 255 : 210,
          height: story ? (first ? 160 : 115) : first ? 58 : 46,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `5px solid ${medal}`,
          borderTop: "0px",
          background: "#15171a",
          color: medal,
          fontSize: story ? (first ? 78 : 58) : first ? 46 : 34,
          fontWeight: 900,
        }}
      >
        {player.rank}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function nameSize(name: string, first: boolean): number {
  if (name.length > 28) return first ? 29 : 26;
  if (name.length > 20) return first ? 34 : 30;
  return first ? 39 : 34;
}
