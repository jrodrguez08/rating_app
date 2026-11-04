"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { adminPath, type Club } from "@/config/club";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import type { AdminCatalogImportPlan } from "@/lib/firebase/admin-catalog-import";
import type { AdminCatalogImportAction } from "@/lib/server/admin-catalog-action";

type Copy = Messages["admin"]["catalogImport"];

export function AdminCatalogImport({
  club,
  messages,
  positionNames,
}: {
  club: Club;
  messages: Copy;
  positionNames: Messages["players"]["positions"];
}) {
  const [preview, setPreview] = useState<{
    action: AdminCatalogImportAction;
    plan: AdminCatalogImportPlan;
    previewToken: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");

  async function post(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const csrf =
      document.cookie
        .split("; ")
        .find((part) => part.startsWith("rating_admin_csrf="))
        ?.split("=")[1] ?? "";
    const response = await fetch(
      `/api/admin/catalog-import/${path}?club=${encodeURIComponent(club.slug)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-CSRF": csrf },
        body: JSON.stringify(body),
      },
    );
    const value: unknown = await response.json();
    if (!response.ok || typeof value !== "object" || value === null) {
      const message =
        typeof value === "object" &&
        value !== null &&
        "error" in value &&
        typeof value.error === "string"
          ? value.error
          : messages.error;
      throw new Error(message);
    }
    return value as Record<string, unknown>;
  }

  async function loadPreview() {
    setBusy(true);
    setError("");
    setPreview(null);
    setReceipt("");
    try {
      const result = await post("preview", { trackedTeamId: club.teamId });
      if (
        !result.action ||
        !result.plan ||
        typeof result.previewToken !== "string"
      )
        throw new Error(messages.error);
      setPreview(
        result as {
          action: AdminCatalogImportAction;
          plan: AdminCatalogImportPlan;
          previewToken: string;
        },
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.error);
    } finally {
      setBusy(false);
    }
  }

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || !preview.plan.canApply || busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get("confirmed") !== "yes") return;
    setBusy(true);
    setError("");
    try {
      await post("authorize", {
        action: preview.action,
        previewToken: preview.previewToken,
        passphrase: String(data.get("passphrase")),
      });
      const result = await post("apply", {
        action: preview.action,
        confirmed: true,
      });
      setReceipt(String(result.auditId));
      setPreview(null);
      form.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">{club.displayName}</p>
        <h1 className="score-font mt-2 text-3xl">{messages.title}</h1>
        <p className="text-muted mt-3 max-w-2xl">{messages.description}</p>
        <Link
          className="button-utility mt-4 inline-flex min-h-11 items-center px-4"
          href={adminPath(club)}
        >
          {messages.back}
        </Link>
      </header>
      <section className="card grid gap-4 p-5" aria-label={messages.title}>
        <button
          className="button-secondary min-h-11 w-fit px-4"
          type="button"
          disabled={busy}
          onClick={() => void loadPreview()}
        >
          {busy && !preview ? messages.loading : messages.preview}
        </button>
        {preview ? (
          <div className="grid gap-4">
            <p className="text-muted">
              {messages.observedAt}:{" "}
              <time dateTime={preview.plan.observedAt}>
                {formatDate(preview.plan.observedAt, "es", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </p>
            <section className="game-inset p-4">
              <h2 className="font-bold">{messages.fixtures}</h2>
              {preview.plan.fixtures.length ? (
                <ul className="mt-2 grid gap-2">
                  {preview.plan.fixtures.map((fixture) => (
                    <li key={fixture.id}>
                      <time dateTime={fixture.kickoffAt}>
                        {formatDate(fixture.kickoffAt, "es", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                      {" · "}
                      {fixture.competitionName}
                      {" · "}
                      {messages[fixture.lineupStatus]}
                      {fixture.coachStatus !== "resolved"
                        ? ` · ${fixture.coachStatus === "ambiguous-coach" ? messages.coachAmbiguous : messages.coachMissing}`
                        : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2">{messages.noFixtures}</p>
              )}
            </section>
            <dl className="game-inset grid gap-2 p-4 sm:grid-cols-2">
              {(
                [
                  [messages.players, preview.plan.playerCount],
                  [messages.coaches, preview.plan.coachCount],
                  [messages.newPlayers, preview.plan.newPlayers],
                  [messages.existingPlayers, preview.plan.existingPlayers],
                  [messages.newCoaches, preview.plan.newCoaches],
                  [messages.existingCoaches, preview.plan.existingCoaches],
                  [messages.memberships, preview.plan.membershipChanges],
                  [
                    messages.coachAssociations,
                    preview.plan.coachAssociationChanges,
                  ],
                  [messages.metadata, preview.plan.metadataChanges],
                  [messages.squadPlayers, preview.plan.squadPlayers],
                  [messages.positionFills, preview.plan.positionFills],
                  [messages.positionGaps, preview.plan.positionGaps],
                  [messages.excluded, preview.plan.excludedPlayers],
                  [messages.unresolvedCoaches, preview.plan.unresolvedCoaches],
                  [messages.requests, preview.plan.providerRequests],
                  [messages.reads, preview.plan.previewDocumentReads],
                  [messages.writes, preview.plan.proposedWrites],
                ] as const
              ).map(([label, count]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt>{label}</dt>
                  <dd className="score-font">{count}</dd>
                </div>
              ))}
            </dl>
            {(
              [
                [messages.players, preview.plan.players],
                [messages.coaches, preview.plan.coaches],
              ] as const
            ).map(([label, identities]) => (
              <section className="game-inset p-4" key={label}>
                <h2 className="font-bold">{label}</h2>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {identities.map((identity, index) => (
                    <li
                      className="border border-current/20 p-2"
                      key={`${identity.name}-${index}`}
                    >
                      <strong>{identity.name}</strong>
                      <span className="text-muted block">
                        {identity.status === "new"
                          ? messages.identityNew
                          : messages.identityExisting}
                        {" · "}
                        {messages.sourceFixtures}:{" "}
                        {identity.sourceFixtureIds.join(", ")}
                      </span>
                      {"currentPosition" in identity &&
                      identity.currentPosition ? (
                        <span className="block">
                          {messages.existingPosition.replace(
                            "{position}",
                            positionNames[identity.currentPosition],
                          )}
                        </span>
                      ) : null}
                      {"proposedPosition" in identity &&
                      identity.proposedPosition &&
                      identity.positionSource ? (
                        <span className="block">
                          {messages.proposedPosition
                            .replace(
                              "{position}",
                              positionNames[identity.proposedPosition],
                            )
                            .replace(
                              "{source}",
                              messages.positionSources[identity.positionSource],
                            )}
                        </span>
                      ) : null}
                      {"positionConflict" in identity &&
                      identity.positionConflict ? (
                        <span className="text-muted block">
                          {messages.positionConflict}
                        </span>
                      ) : null}
                      {"positionGap" in identity &&
                      identity.positionGap === "missing" ? (
                        <span className="text-muted block">
                          {messages.positionMissing}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {preview.plan.canApply ? (
              <form
                className="game-inset grid gap-4 p-4"
                onSubmit={(event) => void apply(event)}
              >
                <h2 className="font-bold">{messages.authorization}</h2>
                <label className="grid gap-2">
                  <span>{messages.passphrase}</span>
                  <input
                    className="game-inset min-h-11 px-3"
                    type="password"
                    name="passphrase"
                    autoComplete="off"
                    required
                  />
                </label>
                <label className="flex min-h-11 items-start gap-3">
                  <input
                    className="mt-1 h-5 w-5"
                    type="checkbox"
                    name="confirmed"
                    value="yes"
                    required
                  />
                  <span>{messages.confirm}</span>
                </label>
                <button
                  className="button-primary min-h-11 w-fit px-4"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? messages.applying : messages.apply}
                </button>
              </form>
            ) : (
              <p role="status">{messages.empty}</p>
            )}
          </div>
        ) : null}
        {error ? (
          <p className="text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {receipt ? (
          <p role="status" className="game-inset p-4">
            {messages.success} {messages.audit}: {receipt}
          </p>
        ) : null}
      </section>
    </div>
  );
}
