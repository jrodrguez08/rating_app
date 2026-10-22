"use client";

import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { getAdminBrowserAuth } from "@/lib/firebase/admin-browser";
import type {
  AdminMatchOperation,
  AdminOverview,
} from "@/lib/firebase/admin-console";

type AdminMessages = Messages["admin"];

export function AdminLogin({ messages }: { messages: AdminMessages }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const auth = await getAdminBrowserAuth();
      const credential = await signInWithEmailAndPassword(
        auth,
        String(form.get("email")),
        String(form.get("password")),
      );
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken: await credential.user.getIdToken(true),
        }),
      });
      await signOut(auth);
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      setError(messages.credentialsError);
      setBusy(false);
      submitting.current = false;
    }
  }

  return (
    <form className="card mx-auto grid max-w-md gap-4 p-6" onSubmit={submit}>
      <label className="grid gap-2">
        <span>{messages.email}</span>
        <input
          className="game-inset min-h-11 px-3"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
      </label>
      <label className="grid gap-2">
        <span>{messages.password}</span>
        <input
          className="game-inset min-h-11 px-3"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      {busy ? (
        <p
          className="game-inset flex min-h-11 items-center gap-3 px-3 text-sm"
          role="status"
          aria-live="polite"
        >
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--game-muted)] border-t-[var(--club-secondary)] motion-reduce:animate-none"
            aria-hidden="true"
          />
          {messages.signingInStatus}
        </p>
      ) : null}
      <button
        className="min-h-11 bg-brand px-4 font-bold"
        disabled={busy}
        type="submit"
      >
        {busy ? messages.signingIn : messages.signIn}
      </button>
    </form>
  );
}

export function AdminConsole({
  overview,
  messages,
}: {
  overview: AdminOverview;
  messages: AdminMessages;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [signingOut, setSigningOut] = useState(false);
  const toolbarBusy = refreshing || signingOut;
  const openMatches = overview.votingCompletedMatches.filter(
    (match) => match.votingPresentation === "open",
  );
  const closedMatches = overview.votingCompletedMatches.filter((match) =>
    ["expired", "published"].includes(match.votingPresentation),
  );
  const reviewMatches = overview.attentionMatches.filter(
    (match) => match.votingPresentation === "invalid",
  );
  const preparationMatches = [
    ...overview.upcomingLiveMatches,
    ...overview.attentionMatches.filter(
      (match) => match.votingPresentation === "preparation",
    ),
  ];

  function refresh() {
    startRefresh(() => router.refresh());
  }

  async function logout() {
    setSigningOut(true);
    const csrf = document.cookie
      .split("; ")
      .find((item) => item.startsWith("rating_admin_csrf="))
      ?.split("=")[1];
    try {
      await fetch("/api/admin/session/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-CSRF": csrf ?? "",
        },
        body: "{}",
      });
    } finally {
      router.refresh();
      setSigningOut(false);
    }
  }

  return (
    <div className="grid gap-6">
      <nav
        className="flex flex-wrap items-center justify-end gap-3"
        aria-label={messages.adminActions}
      >
        <Link
          className="button-secondary inline-flex min-h-11 items-center px-4"
          href="/admin/player-identities"
        >
          {messages.identityReconciliation}
        </Link>
        <button
          className="button-utility min-h-11 px-4"
          disabled={toolbarBusy}
          onClick={refresh}
          type="button"
        >
          {refreshing ? messages.refreshing : messages.refresh}
        </button>
        <button
          className="button-utility min-h-11 px-4"
          disabled={toolbarBusy}
          onClick={logout}
          type="button"
        >
          {signingOut ? messages.signingOut : messages.signOut}
        </button>
      </nav>
      {toolbarBusy ? (
        <p className="sr-only" role="status" aria-live="polite">
          {refreshing ? messages.refreshing : messages.signingOut}
        </p>
      ) : null}
      <AdminMatchSection
        title={messages.openVotingSection}
        matches={openMatches}
        messages={messages}
      />
      <AdminMatchSection
        title={messages.preparationSection}
        matches={preparationMatches}
        messages={messages}
      />
      {reviewMatches.length > 0 ? (
        <AdminMatchSection
          title={messages.reviewSection}
          matches={reviewMatches}
          messages={messages}
        />
      ) : null}
      <AdminMatchSection
        title={messages.closedVotingSection}
        matches={closedMatches}
        messages={messages}
      />
    </div>
  );
}

function AdminMatchSection({
  title,
  matches,
  messages,
}: {
  title: string;
  matches: AdminMatchOperation[];
  messages: AdminMessages;
}) {
  const headingId = `admin-section-${title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()}`;
  return (
    <section className="card grid gap-4 p-5" aria-labelledby={headingId}>
      <h2 id={headingId} className="score-font text-xl">
        {title}
      </h2>
      {matches.length === 0 ? (
        <p className="text-muted text-sm">{messages.sectionEmpty}</p>
      ) : (
        <ul className="grid gap-3">
          {matches.map((match) => (
            <AdminMatchCard key={match.id} match={match} messages={messages} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AdminMatchCard({
  match,
  messages,
}: {
  match: AdminMatchOperation;
  messages: AdminMessages;
}) {
  const action = matchAction(match, messages);
  const showParticipants =
    match.lineupProvenance !== "unavailable" ||
    match.confirmedStarterCount > 0 ||
    match.confirmedSubstituteCount > 0;
  const status =
    match.votingPresentation === "preparation"
      ? match.status === "finished" && match.ratingState === "preparing_rating"
        ? messages.preparingState
        : messages.statuses[match.status]
      : messages.votingPresentation[match.votingPresentation];

  return (
    <li className="game-inset grid min-w-0 gap-3 p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <strong className="min-w-0 break-words">
          {match.homeTeamName} {messages.versus} {match.awayTeamName}
        </strong>
        <span className="status-badge shrink-0">{status}</span>
      </div>
      <time className="text-muted text-sm" dateTime={match.kickoffAt}>
        {formatDate(match.kickoffAt, "es", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </time>
      {showParticipants ? (
        <span className="text-sm">
          {messages.confirmedStarters}: {match.confirmedStarterCount}/11
          {" · "}
          {messages.confirmedSubstitutes}: {match.confirmedSubstituteCount}
        </span>
      ) : null}
      {match.assignment ? (
        <span className="min-w-0 break-words text-sm">
          {messages.coach}: {match.assignment.coachName}
        </span>
      ) : match.verification ? (
        <span className="text-sm">
          {messages.coach}: {messages.coachReady}
        </span>
      ) : null}
      <Link
        className="button-secondary inline-flex min-h-11 w-full items-center justify-center px-4 sm:w-fit"
        href={action.href}
      >
        {action.label}
      </Link>
      {match.votingPresentation === "published" ? (
        <Link
          className="button-utility inline-flex min-h-11 w-full items-center justify-center px-4 sm:w-fit"
          href={`/admin/matches/${encodeURIComponent(match.id)}`}
        >
          {messages.administerMatch}
        </Link>
      ) : null}
    </li>
  );
}

function matchAction(match: AdminMatchOperation, messages: AdminMessages) {
  switch (match.votingPresentation) {
    case "open":
      return {
        href: `/matches/${encodeURIComponent(match.id)}/rate`,
        label: messages.viewVoting,
      };
    case "published":
      return {
        href: `/matches/${encodeURIComponent(match.id)}/results`,
        label: messages.viewResults,
      };
    case "expired":
    case "invalid":
      return {
        href: `/admin/matches/${encodeURIComponent(match.id)}`,
        label: messages.inspect,
      };
    case "preparation":
      return {
        href: `/admin/matches/${encodeURIComponent(match.id)}`,
        label: messages.prepareMatch,
      };
  }
}
