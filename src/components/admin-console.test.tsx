import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getMessages } from "@/i18n/messages";

import { AdminConsole, AdminLogin } from "./admin-console";

const messages = getMessages("es").admin;

describe("admin console", () => {
  it("renders an accessible Spanish login without registration", () => {
    render(<AdminLogin messages={messages} />);
    expect(
      screen.getByRole("textbox", { name: messages.email }),
    ).toBeRequired();
    expect(screen.getByLabelText(messages.password)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByRole("button", { name: messages.signIn })).toBeEnabled();
    expect(screen.queryByText(/registr/i)).not.toBeInTheDocument();
  });

  it("requires an explicit coach selection and shows persisted diagnostics", () => {
    render(
      <AdminConsole
        messages={messages}
        teamId="club-sport-herediano"
        overview={{
          matches: [
            {
              id: "match-1",
              externalFixtureId: "fixture-1",
              kickoffAt: "2026-10-18T20:00:00.000Z",
              homeTeamName: "Equipo local",
              awayTeamName: "Equipo visitante",
              diagnostic: "ambiguous_coach",
              participantCount: 22,
              rateableParticipantCount: 11,
            },
          ],
          coaches: [
            {
              id: "coach-1",
              name: "Director verificado",
              provenance: "operator_verified",
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByText(/Identidad del director ambigua/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(messages.manualCoachId)).toHaveValue("");
    expect(
      screen.getByRole("button", { name: messages.preview }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: messages.signOut }),
    ).toBeEnabled();
  });
});
