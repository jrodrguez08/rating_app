import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { getMessages } from "@/i18n/messages";
import type { AdminMatchDetail } from "@/lib/firebase/admin-console";

import { AdminLineupEditor } from "./admin-lineup-editor";

const messages = getMessages("es").admin;

describe("admin lineup editor", () => {
  it("renders Spanish preparation controls with explicit participant states", async () => {
    const user = userEvent.setup();
    render(
      <AdminLineupEditor
        detail={detail("preparing_rating")}
        messages={messages}
        teamId="club-sport-herediano"
      />,
    );

    expect(
      screen.getByRole("heading", { name: /Titulares confirmados \(11\/11\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Suplentes \(1\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(messages.searchPlayers)).toBeVisible();
    expect(screen.getByText(messages.lifecycleOwnsVoting)).toBeVisible();
    expect(
      screen.getByRole("button", { name: messages.preview }),
    ).toBeEnabled();

    await user.selectOptions(
      screen.getByLabelText(messages.participation),
      "confirmed_substitute",
    );
    expect(screen.getByLabelText(messages.entryMinute)).toHaveAttribute(
      "type",
      "number",
    );
  });

  it("keeps voting and completed matches read-only", () => {
    render(
      <AdminLineupEditor
        detail={detail("rating_ready")}
        messages={messages}
        teamId="club-sport-herediano"
      />,
    );
    expect(screen.getByText(messages.historicalReadOnly)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: messages.preview }),
    ).not.toBeInTheDocument();
  });

  it("allows preview with eleven verified starters and no substitutes", () => {
    const matchDetail = detail("preparing_rating");
    matchDetail.participants = matchDetail.participants.slice(0, 11);
    matchDetail.players = matchDetail.players.slice(0, 11);
    render(
      <AdminLineupEditor
        detail={matchDetail}
        messages={messages}
        teamId="club-sport-herediano"
      />,
    );

    expect(
      screen.getByRole("button", { name: messages.preview }),
    ).toBeEnabled();
  });
});

function detail(
  ratingState: AdminMatchDetail["match"]["ratingState"],
): AdminMatchDetail {
  const participants = Array.from({ length: 12 }, (_, index) => ({
    playerId: `player-${index + 1}`,
    playerName: `Jugador ${index + 1}`,
    squadRole: index < 11 ? ("starter" as const) : ("substitute" as const),
    participated: index < 11,
    participationStatus:
      index < 11
        ? ("confirmed_starter" as const)
        : ("unused_substitute" as const),
    identityProvenance: "provider" as const,
  }));
  return {
    match: {
      id: "match-1",
      externalFixtureId: "fixture-1",
      kickoffAt: "2026-10-18T20:00:00.000Z",
      homeTeamName: "Herediano",
      awayTeamName: "Visitante",
      status: "finished",
      ratingState,
      participantCount: 12,
      rateableParticipantCount: 11,
    },
    participants,
    players: participants.map((participant) => ({
      id: participant.playerId,
      name: participant.playerName,
      identityProvenance: "provider",
    })),
  };
}
