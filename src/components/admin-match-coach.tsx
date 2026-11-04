"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { adminClubForTeam } from "@/config/club";
import type { Messages } from "@/i18n/messages";
import type {
  AdminCoachOption,
  AdminMatchDetail,
} from "@/lib/firebase/admin-console";
import type {
  CoachSearchPage,
  CoachSearchScope,
} from "@/lib/firebase/coach-search-index";
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
  const club = adminClubForTeam(teamId);
  const router = useRouter();
  const [coach, setCoach] = useState<AdminCoachOption | null>(
    detail.currentCoach ?? null,
  );
  const [scope, setScope] = useState<CoachSearchScope>("team");
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [candidates, setCandidates] = useState<AdminCoachOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeSearch = useRef<AbortController | null>(null);

  const load = useCallback(
    async (
      searchScope: CoachSearchScope,
      searchQuery: string,
      cursor?: string,
    ) => {
      activeSearch.current?.abort();
      const controller = new AbortController();
      activeSearch.current = controller;
      setSearching(true);
      setSearchError("");
      if (!cursor) {
        setCandidates([]);
        setNextCursor(undefined);
      }
      try {
        const parameters = new URLSearchParams({
          club: club.slug,
          matchId: detail.match.id,
          fixtureId: detail.match.externalFixtureId,
          scope: searchScope,
          query: searchQuery,
        });
        if (cursor) parameters.set("cursor", cursor);
        const response = await fetch(`/api/admin/coaches?${parameters}`, {
          signal: controller.signal,
        });
        const result: unknown = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof result === "object" &&
              result !== null &&
              "error" in result &&
              typeof result.error === "string"
              ? result.error
              : messages.assignmentCoachSearchError,
          );
        }
        if (controller.signal.aborted) return;
        const page = result as CoachSearchPage;
        setCandidates((existing) => {
          const unique = new Map(
            (cursor ? existing : []).map((candidate) => [
              candidate.id,
              candidate,
            ]),
          );
          page.coaches.forEach((candidate) =>
            unique.set(candidate.id, candidate),
          );
          return [...unique.values()];
        });
        setNextCursor(page.nextCursor);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setSearchError(
            caught instanceof Error
              ? caught.message
              : messages.assignmentCoachSearchError,
          );
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    },
    [
      club.slug,
      detail.match.externalFixtureId,
      detail.match.id,
      messages.assignmentCoachSearchError,
    ],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load("team", ""), 0);
    return () => {
      window.clearTimeout(timer);
      activeSearch.current?.abort();
    };
  }, [load]);

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
    const response = await fetch(`${path}?club=${club.slug}`, {
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

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (scope === "unassociated" && value.length < 2) return;
    setSearchedQuery(value);
    void load(scope, value);
  }

  return (
    <section id="coach-assignment" className="card grid gap-4 p-5">
      <div>
        <p className="eyebrow">3 / 4</p>
        <h2 className="score-font mt-2 text-xl">{messages.coach}</h2>
        <p className="text-muted mt-2">
          {club.displayName}: {detail.match.homeTeamName} –{" "}
          {detail.match.awayTeamName}
        </p>
      </div>
      <form className="grid gap-3" onSubmit={search}>
        <p className="text-muted">{messages.coachSearchHelp}</p>
        <label className="grid gap-2">
          <span>{messages.coachScope}</span>
          <select
            className="game-inset min-h-11 px-3"
            value={scope}
            disabled={busy}
            onChange={(event) => {
              const selected = event.target.value as CoachSearchScope;
              activeSearch.current?.abort();
              setSearching(false);
              setScope(selected);
              setCandidates([]);
              setNextCursor(undefined);
              setSearchError("");
              setSearchedQuery("");
              if (selected === "team") void load("team", "");
            }}
          >
            <option value="team">{messages.coachScopeTeam}</option>
            <option value="unassociated">
              {messages.coachScopeUnassociated}
            </option>
          </select>
        </label>
        {scope === "unassociated" ? (
          <p className="text-muted">{messages.coachUnassociatedHelp}</p>
        ) : null}
        <label className="grid gap-2">
          <span>{messages.coachSearch}</span>
          <input
            className="game-inset min-h-11 px-3"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
            disabled={busy}
          />
        </label>
        <button
          type="submit"
          className="button-secondary min-h-11 px-4"
          disabled={
            searching ||
            busy ||
            (scope === "unassociated" && query.trim().length < 2)
          }
        >
          {messages.coachSearchButton}
        </button>
      </form>
      {searching ? <p role="status">{messages.coachSearching}</p> : null}
      {searchError ? (
        <p role="alert" className="text-danger">
          {searchError}
        </p>
      ) : null}
      {!searching &&
      !searchError &&
      candidates.length === 0 &&
      (scope === "team" || searchedQuery) ? (
        <p className="text-muted">{messages.coachNoResults}</p>
      ) : null}
      {candidates.length > 0 ? (
        <fieldset className="grid gap-2" disabled={busy}>
          <legend>{messages.existingCoach}</legend>
          {candidates.map((candidate) => (
            <label
              key={candidate.id}
              className="game-inset flex min-h-11 items-center gap-3 px-3 py-2"
            >
              <input
                type="radio"
                name="selected-coach"
                value={candidate.id}
                checked={coach?.id === candidate.id}
                onChange={() => {
                  setCoach(candidate);
                  setError("");
                }}
              />
              <span className="grid">
                <span>{candidate.name}</span>
                <span className="text-muted text-sm">
                  {candidate.provenance === "provider"
                    ? messages.coachCandidateProvider
                    : messages.coachCandidateManual}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {nextCursor ? (
        <button
          type="button"
          className="button-utility min-h-11 px-4"
          disabled={searching || busy}
          onClick={() => void load(scope, searchedQuery, nextCursor)}
        >
          {messages.coachLoadMore}
        </button>
      ) : null}
      {coach ? (
        <p className="game-inset p-3" role="status">
          {messages.coachSelected}: <strong>{coach.name}</strong>
        </p>
      ) : null}
      <form className="grid gap-4" onSubmit={confirmCoach}>
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
