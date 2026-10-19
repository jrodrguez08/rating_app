"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import type { Messages } from "@/i18n/messages";
import type { AdminMatchDetail } from "@/lib/firebase/admin-console";
import type { AdminCoachAction } from "@/lib/server/admin-coach-action";

type AdminMessages = Messages["admin"];

export function AdminMatchCoachPanel({
  detail,
  messages,
  teamId,
}: {
  detail: AdminMatchDetail;
  messages: AdminMessages;
  teamId: string;
}) {
  const router = useRouter();
  const coaches = detail.coaches ?? [];
  const [coachId, setCoachId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const coach = coaches.find((candidate) => candidate.id === coachId);
  const action = useMemo<AdminCoachAction | null>(
    () =>
      coach
        ? {
            matchId: detail.match.id,
            trackedTeamId: teamId,
            externalFixtureId: detail.match.externalFixtureId,
            coachId: coach.id,
            coachName: coach.name,
            ...(coach.externalProviderId
              ? { externalProviderCoachId: coach.externalProviderId }
              : {}),
            verificationSource: "authenticated-owner",
            verificationReason:
              "Director técnico confirmado por el propietario autenticado.",
          }
        : null,
    [coach, detail.match.externalFixtureId, detail.match.id, teamId],
  );

  async function post(path: string, body: unknown) {
    const csrf = document.cookie
      .split("; ")
      .find((item) => item.startsWith("rating_admin_csrf="))
      ?.split("=")[1];
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrf ?? "",
      },
      body: JSON.stringify(body),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      throw new Error(
        typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
          ? result.error
          : messages.genericError,
      );
    }
    return result as Record<string, unknown>;
  }

  async function confirmCoach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    try {
      const preview = await post("/api/admin/coach-assignment/preview", action);
      await post("/api/admin/coach-assignment/authorize", {
        action,
        previewToken: preview.previewToken,
        passphrase: String(new FormData(form).get("passphrase")),
      });
      await post("/api/admin/coach-assignment/apply", {
        action,
        confirmation: `assign-verified-coach:${detail.match.id}`,
      });
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="coach-assignment" className="card grid gap-4 p-5">
      <div>
        <p className="eyebrow">3 / 4</p>
        <h2 className="score-font mt-2 text-xl">{messages.coach}</h2>
      </div>
      <form className="grid gap-4" onSubmit={confirmCoach}>
        <label className="grid gap-2">
          <span>{messages.existingCoach}</span>
          <select
            className="game-inset min-h-11 px-3"
            value={coachId}
            onChange={(event) => setCoachId(event.target.value)}
            required
          >
            <option value="">{messages.none}</option>
            {coaches.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2">
          <span>{messages.passphrase}</span>
          <input
            className="game-inset min-h-11 px-3"
            name="passphrase"
            type="password"
            autoComplete="off"
            required
          />
        </label>
        <button
          className="button-primary min-h-11 px-4"
          disabled={busy || !action}
        >
          {busy ? messages.loading : messages.apply}
        </button>
      </form>
      {error ? (
        <p className="text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
