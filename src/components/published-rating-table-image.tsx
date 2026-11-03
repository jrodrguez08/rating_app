import type { PublishedResultPodium } from "@/application/published-result-podium";
import type { PublishedRatingStoryPage } from "@/application/published-rating-story";
import type { Club } from "@/config/club";
import { getTeamBadgePresentation } from "@/config/team-badges";
import { siteIdentity } from "@/config/site";
import { formatDate, formatRating } from "@/i18n/format";

export function PublishedRatingTableImage({
  club,
  podium,
  storyPage,
  siteHost,
}: {
  club: Club;
  podium: PublishedResultPodium;
  storyPage: PublishedRatingStoryPage;
  siteHost: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        padding: "92px 64px 104px",
        background: siteIdentity.backgroundColor,
        color: "#f7f2e8",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                color: club.theme.accent,
                fontSize: 27,
                fontWeight: 800,
                letterSpacing: 3,
              }}
            >
              RATING APP
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 12,
                fontSize: 43,
                fontWeight: 900,
              }}
            >
              Calificaciones del partido
            </div>
          </div>
          <div
            style={{
              display: "flex",
              border: `3px solid ${club.theme.accent}`,
              color: club.theme.accent,
              padding: "10px 16px",
              fontSize: 25,
              fontWeight: 900,
            }}
          >
            {storyPage.page} / {storyPage.pageCount}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 12,
            fontSize: 26,
            fontWeight: 800,
          }}
        >
          {club.displayName}
        </div>
        <MatchHeader podium={podium} club={club} />
      </header>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "relative",
          marginTop: 34,
          border: "3px solid #4a4e55",
          background: "#15171a",
        }}
      >
        <div
          style={{
            height: 50,
            display: "flex",
            alignItems: "center",
            borderBottom: `3px solid ${club.theme.primary}`,
            background: "#202328",
            color: "#c9cdd3",
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 1,
          }}
        >
          <span
            style={{ width: 74, display: "flex", justifyContent: "center" }}
          >
            #
          </span>
          <span style={{ display: "flex", flex: 1 }}>JUGADOR</span>
          <span
            style={{ width: 150, display: "flex", justifyContent: "center" }}
          >
            NOTA
          </span>
        </div>
        {storyPage.players.map((player, index) => (
          <div
            key={player.playerId}
            style={{
              height: 66,
              display: "flex",
              flexShrink: 0,
              alignItems: "center",
              borderBottom:
                index === storyPage.players.length - 1
                  ? "0px"
                  : "2px solid #34383e",
              background: index % 2 === 0 ? "#17191d" : "#1d2025",
            }}
          >
            <span
              style={{
                width: 74,
                display: "flex",
                justifyContent: "center",
                color: "#aeb3ba",
                fontSize: 29,
                fontWeight: 800,
              }}
            >
              {player.rank}
            </span>
            <span
              style={{
                minWidth: 0,
                display: "flex",
                flex: 1,
                alignItems: "center",
                padding: "8px 10px 8px 0",
                fontSize: player.displayName.length > 34 ? 25 : 29,
                fontWeight: 800,
                lineHeight: 1.12,
              }}
            >
              {player.displayName}
              {player.isMvp ? (
                <span
                  style={{
                    display: "flex",
                    flexShrink: 0,
                    marginLeft: 14,
                    border: `2px solid ${club.theme.accent}`,
                    color: club.theme.accent,
                    padding: "4px 8px",
                    fontSize: 18,
                    fontWeight: 900,
                  }}
                >
                  MVP
                </span>
              ) : null}
            </span>
            <span
              style={{
                width: 150,
                display: "flex",
                justifyContent: "center",
                color: club.theme.accent,
                fontSize: 39,
                fontWeight: 900,
              }}
            >
              {formatRating(player.average, "es")}
            </span>
          </div>
        ))}
      </div>
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          marginTop: "auto",
          borderTop: `3px solid ${club.theme.primary}`,
          paddingTop: 22,
          fontSize: 23,
          fontWeight: 800,
        }}
      >
        <span>Calificaciones de la afición</span>
        <span style={{ color: club.theme.accent }}>{siteHost}</span>
      </footer>
    </div>
  );
}

function MatchHeader({
  podium,
  club,
}: {
  podium: PublishedResultPodium;
  club: Club;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginTop: 30,
        border: `4px solid ${club.theme.primary}`,
        boxShadow: "10px 10px 0 #050506",
        background: "#191b1f",
        padding: "19px 24px",
      }}
    >
      <Team team={podium.homeTeam} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          margin: "0 26px",
        }}
      >
        <span
          style={{
            display: "flex",
            color: club.theme.accent,
            fontSize: 66,
            fontWeight: 900,
            whiteSpace: "nowrap",
          }}
        >
          {podium.score.home} - {podium.score.away}
        </span>
        <span
          style={{
            display: "flex",
            marginTop: 5,
            color: "#b8bcc2",
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          {formatDate(podium.publishedMatchDate, "es", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      </div>
      <Team team={podium.awayTeam} />
    </div>
  );
}

function Team({ team }: { team: PublishedResultPodium["homeTeam"] }) {
  const badge = getTeamBadgePresentation(team);
  return (
    <div
      style={{
        width: 270,
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 62,
          height: 62,
          display: "flex",
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          border: `4px solid ${badge.primary}`,
          background: badge.secondary,
          color: "#101113",
          fontSize: 22,
          fontWeight: 900,
        }}
      >
        {badge.abbreviation}
      </div>
      <span
        style={{
          display: "flex",
          marginLeft: 15,
          fontSize: team.name.length > 22 ? 21 : 24,
          fontWeight: 800,
          lineHeight: 1.1,
        }}
      >
        {team.name}
      </span>
    </div>
  );
}
