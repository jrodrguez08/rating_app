import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { StandingsViewModel } from "@/application/standings";
import { getMessages } from "@/i18n/messages";

import { StandingsTable } from "./standings-table";

const standings: StandingsViewModel = {
  competitionName: "Primera Divisi\u00f3n",
  seasonName: "2026",
  providerSyncedAt: "2026-09-07T09:00:00.000Z",
  rows: [
    {
      rank: 1,
      externalTeamId: "815",
      teamName: "A deliberately renamed and very long tracked team name",
      played: 10,
      won: 7,
      drawn: 2,
      lost: 1,
      goalsFor: 20,
      goalsAgainst: 8,
      goalDifference: 12,
      points: 23,
      trackedTeam: true,
    },
  ],
};

describe("StandingsTable", () => {
  it("renders a compact localized table and identifies the tracked team accessibly", () => {
    render(
      <StandingsTable
        standings={standings}
        locale="es"
        messages={getMessages("es").standings}
      />,
    );
    expect(screen.getByRole("table")).toHaveClass("table-fixed");
    expect(
      screen.getByText(/actualizaci\u00f3n peri\u00f3dica/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/equipo seguido/i)).toBeInTheDocument();
    expect(screen.getByRole("rowheader")).toHaveClass("truncate");
    expect(screen.getByTitle("Ganados").closest("th")).toHaveClass("hidden");
  });

  it("renders a safe empty state", () => {
    render(
      <StandingsTable
        standings={null}
        locale="en"
        messages={getMessages("en").standings}
      />,
    );
    expect(
      screen.getByText("Standings are temporarily unavailable."),
    ).toBeInTheDocument();
  });
});
