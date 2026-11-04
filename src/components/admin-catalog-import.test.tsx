import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clubs } from "@/config/club";
import { getMessages } from "@/i18n/messages";

import { AdminCatalogImport } from "./admin-catalog-import";

const messages = getMessages("es").admin.catalogImport;
const plan = {
  clubName: "Deportivo Saprissa",
  fixtures: [
    {
      id: "1551714",
      kickoffAt: "2026-11-01T22:00:00.000Z",
      competitionName: "Primera División",
      lineupStatus: "partial",
      excludedPlayerCount: 1,
      coachStatus: "coach-missing",
    },
  ],
  playerCount: 12,
  coachCount: 0,
  newPlayers: 11,
  existingPlayers: 1,
  newCoaches: 0,
  existingCoaches: 0,
  players: [
    {
      name: "Historical Player",
      status: "existing",
      sourceFixtureIds: ["1551714"],
    },
  ],
  coaches: [],
  membershipChanges: 12,
  coachAssociationChanges: 0,
  metadataChanges: 0,
  excludedPlayers: 1,
  unresolvedCoaches: 1,
  proposedWrites: 26,
  providerRequests: 2,
  previewDocumentReads: 41,
  observedAt: "2026-11-04T12:00:00.000Z",
  canApply: true,
};
const action = {
  trackedTeamId: clubs.saprissa.teamId,
  externalTeamId: "816",
  fixtures: [],
  players: [],
  coaches: [],
  stateHash: "a".repeat(64),
};
function json(value: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => value };
}

describe("owner catalog import", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("previews source gaps then authorizes one explicit preparation-only import", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ action, plan, previewToken: "preview" }))
      .mockResolvedValueOnce(json({ authorized: true }))
      .mockResolvedValueOnce(json({ auditId: "catalog-audit" }));
    vi.stubGlobal("fetch", fetcher);
    document.cookie = `rating_admin_csrf=${"c".repeat(43)}`;
    render(<AdminCatalogImport club={clubs.saprissa} messages={messages} />);
    expect(fetcher).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: messages.preview }),
    );
    expect(
      await screen.findByText("Primera División", { exact: false }),
    ).toBeVisible();
    expect(
      screen.getByText(messages.coachMissing, { exact: false }),
    ).toBeVisible();
    expect(screen.getByText(messages.excluded)).toBeVisible();
    expect(screen.getByText("Historical Player")).toBeVisible();
    await userEvent.type(
      screen.getByLabelText(messages.passphrase),
      "test-passphrase",
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: messages.confirm }),
    );
    await userEvent.click(screen.getByRole("button", { name: messages.apply }));
    expect(
      await screen.findByText(messages.success, { exact: false }),
    ).toBeVisible();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/catalog-import/preview?club=saprissa",
      "/api/admin/catalog-import/authorize?club=saprissa",
      "/api/admin/catalog-import/apply?club=saprissa",
    ]);
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({
      confirmed: true,
      action,
    });
  });

  it("keeps the failed preview recoverable without showing a success or authorization form", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(json({ error: "API-Football no respondió." }, 503)),
    );
    render(<AdminCatalogImport club={clubs.herediano} messages={messages} />);
    await userEvent.click(
      screen.getByRole("button", { name: messages.preview }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "API-Football no respondió.",
    );
    expect(
      screen.queryByRole("button", { name: messages.apply }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(messages.success)).not.toBeInTheDocument();
  });
});
