import { preserveMonotonicMatchStatus } from "@/domain/match-status";
import type {
  LineupCaptureOutcome,
  Match,
  RatingState,
  Team,
} from "@/domain/models";
import type {
  FootballDataProvider,
  MatchLifecycleStore,
  ProviderFixture,
} from "@/domain/ports";
import { getEffectiveVotingClosesAt } from "@/domain/voting-window";
import {
  emitOperationalLog,
  type OperationalLogger,
} from "@/lib/operational-log";

const HOUR = 60 * 60 * 1000;
const VOTING_WINDOW_MS = 2 * HOUR;
const DISCOVERY_INTERVAL_MS = 12 * HOUR;
const LINEUP_CAPTURE_WINDOW_MS = HOUR;
const LIVE_LINEUP_CAPTURE_COOLDOWN_MS = 15 * 60 * 1000;
const LIVE_LINEUP_CAPTURE_MAX_ATTEMPTS = 4;
const LIVE_LINEUP_PROVIDER_REQUEST_BUDGET = 3;
const LIVE_LINEUP_CAPTURE_REQUIRED_REQUEST_COUNT = 1;
const MINIMUM_RATEABLE_PARTICIPANTS = 11;

export type LifecycleAction =
  | "idle"
  | "discovered"
  | "refreshed"
  | "preparing_rating"
  | "rating_ready"
  | "rating_closed"
  | "retryable_error";

export interface LifecycleResult {
  action: LifecycleAction;
  matchId?: string;
  providerRequests: number;
  reason?: string;
}

export interface LifecycleDependencies {
  teamId: string;
  provider: FootballDataProvider;
  store: MatchLifecycleStore;
  now: () => Date;
  discoverFixtures: (team: Team, now: Date) => Promise<void>;
  syncParticipants: (
    matchId: string,
    now: Date,
    phase: "lineup" | "final",
  ) => Promise<{
    starters: number;
    substitutes: number;
    participated: number;
  } | void>;
  log?: OperationalLogger;
}

export async function runMatchLifecycle({
  teamId,
  provider,
  store,
  now,
  discoverFixtures,
  syncParticipants,
  log = () => undefined,
}: LifecycleDependencies): Promise<LifecycleResult> {
  const result = await executeMatchLifecycle({
    teamId,
    provider,
    store,
    now,
    discoverFixtures,
    syncParticipants,
    log,
  });
  emitOperationalLog(log, "lifecycle.outcome", {
    action: result.action,
    matchId: result.matchId ?? "none",
    providerRequests: result.providerRequests,
  });
  return result;
}

async function executeMatchLifecycle({
  teamId,
  provider,
  store,
  now,
  discoverFixtures,
  syncParticipants,
  log = () => undefined,
}: LifecycleDependencies): Promise<LifecycleResult> {
  const currentTime = now();
  const team = await store.getTeam(teamId);
  if (team.externalProviderId === undefined) {
    return {
      action: "retryable_error",
      providerRequests: provider.requestCount,
      reason: `Tracked Team ${teamId} has no provider mapping.`,
    };
  }
  let matches = await store.listMatches(teamId);
  const pendingFinalization = selectLifecycleMatch(matches, currentTime);
  if (
    pendingFinalization !== undefined &&
    isExpiredRatingWindow(pendingFinalization, currentTime)
  ) {
    await requireLifecycleExecutionOwnership(
      store,
      teamId,
      pendingFinalization.id,
    );
    emitOperationalLog(log, "lifecycle.phase", {
      phase: "close_finalization",
      matchId: pendingFinalization.id,
      status: pendingFinalization.status,
      ratingState: pendingFinalization.ratingState,
    });
    try {
      await store.finalizeMatchResult(pendingFinalization.id, currentTime);
      return {
        action: "rating_closed",
        matchId: pendingFinalization.id,
        providerRequests: provider.requestCount,
      };
    } catch (error) {
      return retryable(provider, pendingFinalization.id, error);
    }
  }
  const metadata = await store.getSyncMetadata(teamId);
  const discoveryDue = isDiscoveryDue(
    matches,
    metadata?.lastFixtureDiscoveryAt,
    currentTime,
  );
  let discovered = false;

  if (discoveryDue) {
    try {
      await discoverFixtures(team, currentTime);
      await store.setSyncMetadata({
        teamId,
        lastFixtureDiscoveryAt: currentTime.toISOString(),
        updatedAt: currentTime.toISOString(),
      });
      matches = await store.listMatches(teamId);
      discovered = true;
    } catch (error) {
      return retryable(provider, undefined, error);
    }
  }

  const match = selectLifecycleMatch(matches, currentTime);
  if (match === undefined) {
    emitOperationalLog(log, "lifecycle.decision", {
      phase: "no_relevant_match",
      action: discovered ? "discovered" : "idle",
    });
    return {
      action: discovered ? "discovered" : "idle",
      providerRequests: provider.requestCount,
      reason: "No relevant tracked-Team match is persisted.",
    };
  }

  emitOperationalLog(log, "lifecycle.match", {
    matchId: match.id,
    status: match.status,
    ratingState: match.ratingState,
  });
  await requireLifecycleExecutionOwnership(store, teamId, match.id);

  if (isExpiredRatingWindow(match, currentTime)) {
    emitOperationalLog(log, "lifecycle.phase", {
      phase: "close_finalization",
      matchId: match.id,
      status: match.status,
      ratingState: match.ratingState,
    });
    try {
      await store.finalizeMatchResult(match.id, currentTime);
      return {
        action: "rating_closed",
        matchId: match.id,
        providerRequests: provider.requestCount,
      };
    } catch (error) {
      return retryable(provider, match.id, error);
    }
  }

  if (
    match.ratingState === "rating_ready" ||
    match.ratingState === "rating_closed"
  ) {
    emitOperationalLog(log, "lifecycle.decision", {
      phase: "no_op",
      matchId: match.id,
      reason: "rating-window-established",
    });
    return {
      action: "idle",
      matchId: match.id,
      providerRequests: provider.requestCount,
      reason: "The rating window is already established.",
    };
  }

  if (!shouldRefreshMatch(match, currentTime)) {
    emitOperationalLog(log, "lifecycle.decision", {
      phase: match.status === "scheduled" ? "scheduled_no_op" : "no_op",
      matchId: match.id,
      reason: "outside-polling-interval",
    });
    return {
      action: discovered ? "discovered" : "idle",
      matchId: match.id,
      providerRequests: provider.requestCount,
      reason: "The relevant match is outside its polling interval.",
    };
  }

  let refreshed: Match;
  try {
    emitOperationalLog(log, "lifecycle.fixture_refresh", {
      phase: "started",
      matchId: match.id,
      fixtureId: match.externalProviderFixtureId,
    });
    const fixture = await provider.getFixture(match.externalProviderFixtureId);
    validateTrackedTeam(
      fixture,
      match.externalProviderFixtureId,
      team.externalProviderId,
    );
    refreshed = mergeFixture(match, fixture, currentTime);
    emitOperationalLog(log, "lifecycle.fixture_refresh", {
      phase: "completed",
      matchId: match.id,
      providerStatus: fixture.status,
      scoreHome: fixture.score.home,
      scoreAway: fixture.score.away,
      elapsedMinute: fixture.elapsedMinute ?? null,
      normalizedStatus: refreshed.status,
    });
    await store.updateMatchLifecycle(refreshed);
  } catch (error) {
    return retryable(provider, match.id, error);
  }

  let lineupCapture: LineupCaptureDecision;
  try {
    lineupCapture = await decideLineupCapture(
      refreshed,
      currentTime,
      provider.requestCount,
      store,
    );
  } catch (error) {
    emitOperationalLog(log, "lifecycle.lineup_capture", {
      phase: "skipped",
      matchId: refreshed.id,
      reason: "verified-lineup-invalid",
      providerRequests: provider.requestCount,
    });
    return retryable(provider, refreshed.id, error, "refreshed");
  }
  if (lineupCapture.action === "skip") {
    const providerRequestBudget = lineupCaptureProviderRequestBudget(
      lineupCapture.mode,
      provider.requestCount,
    );
    emitOperationalLog(log, "lifecycle.lineup_capture", {
      phase: "skipped",
      matchId: refreshed.id,
      mode: lineupCapture.mode,
      reason: lineupCapture.reason,
      liveAttempts: refreshed.liveLineupCaptureAttempts ?? 0,
      attemptCeiling: LIVE_LINEUP_CAPTURE_MAX_ATTEMPTS,
      providerRequestBudget,
      providerRequests: provider.requestCount,
      remainingProviderRequests: Math.max(
        0,
        providerRequestBudget - provider.requestCount,
      ),
      ...(lineupCapture.nextEligibleAt === undefined
        ? {}
        : { nextEligibleAt: lineupCapture.nextEligibleAt }),
    });
  }
  if (lineupCapture.action === "attempt") {
    const providerRequestBudget = lineupCaptureProviderRequestBudget(
      lineupCapture.mode,
      provider.requestCount,
    );
    const attempt = (refreshed.lineupCaptureAttempts ?? 0) + 1;
    const liveAttempt =
      (refreshed.liveLineupCaptureAttempts ?? 0) +
      (lineupCapture.mode === "live_retry" ? 1 : 0);
    const attempted: Match = {
      ...refreshed,
      lineupCaptureAttempts: attempt,
      liveLineupCaptureAttempts: liveAttempt,
      lineupCaptureLastAttemptAt: currentTime.toISOString(),
      lineupCaptureLastOutcome: "attempting",
      updatedAt: currentTime.toISOString(),
    };
    await store.updateMatchLifecycle(attempted);
    refreshed = attempted;
    emitOperationalLog(log, "lifecycle.lineup_capture", {
      phase: "attempted",
      matchId: refreshed.id,
      mode: lineupCapture.mode,
      attempt,
      liveAttempt,
      attemptCeiling: LIVE_LINEUP_CAPTURE_MAX_ATTEMPTS,
      providerRequestBudget,
      providerRequests: provider.requestCount,
      remainingProviderRequests: Math.max(
        0,
        providerRequestBudget - provider.requestCount,
      ),
    });
    try {
      const summary = await syncParticipants(
        refreshed.id,
        currentTime,
        "lineup",
      );
      if (
        summary === undefined ||
        summary.starters !== 11 ||
        summary.substitutes <= 0
      ) {
        refreshed = await persistLineupCaptureOutcome(
          store,
          refreshed,
          "incomplete",
          currentTime,
        );
        emitOperationalLog(log, "lifecycle.lineup_capture", {
          phase: "completed",
          matchId: refreshed.id,
          mode: lineupCapture.mode,
          outcome: "incomplete",
          starters: summary?.starters ?? "unavailable",
          substitutes: summary?.substitutes ?? "unavailable",
          providerRequestBudget,
          providerRequests: provider.requestCount,
          remainingProviderRequests: Math.max(
            0,
            providerRequestBudget - provider.requestCount,
          ),
        });
        return {
          action: "refreshed",
          matchId: refreshed.id,
          providerRequests: provider.requestCount,
          reason: "Lineup capture returned incomplete evidence.",
        };
      }
      refreshed = {
        ...refreshed,
        lineupSnapshotAt: currentTime.toISOString(),
        lineupCaptureLastOutcome: "complete",
        updatedAt: currentTime.toISOString(),
      };
      await store.updateMatchLifecycle(refreshed);
      emitOperationalLog(log, "lifecycle.lineup_capture", {
        phase: "completed",
        matchId: refreshed.id,
        mode: lineupCapture.mode,
        outcome: "complete",
        starters: summary.starters,
        substitutes: summary.substitutes,
        participated: summary.participated,
        providerRequestBudget,
        providerRequests: provider.requestCount,
        remainingProviderRequests: Math.max(
          0,
          providerRequestBudget - provider.requestCount,
        ),
      });
    } catch (error) {
      const outcome = captureFailureOutcome(error);
      refreshed = await persistLineupCaptureOutcome(
        store,
        refreshed,
        outcome,
        currentTime,
      );
      emitOperationalLog(log, "lifecycle.lineup_capture", {
        phase: "completed",
        matchId: refreshed.id,
        mode: lineupCapture.mode,
        outcome,
        reason: operationalErrorReason(error),
        providerRequestBudget,
        providerRequests: provider.requestCount,
        remainingProviderRequests: Math.max(
          0,
          providerRequestBudget - provider.requestCount,
        ),
      });
      return retryable(provider, refreshed.id, error, "refreshed");
    }
  }

  if (refreshed.status !== "finished") {
    emitOperationalLog(log, "lifecycle.decision", {
      phase: refreshed.status === "live" ? "live_refresh" : "scheduled_refresh",
      matchId: refreshed.id,
      action: "refreshed",
    });
    return {
      action: "refreshed",
      matchId: refreshed.id,
      providerRequests: provider.requestCount,
    };
  }

  const preparing = {
    ...refreshed,
    ratingState: "preparing_rating" as const,
    updatedAt: currentTime.toISOString(),
  };
  await store.updateMatchLifecycle(preparing);
  emitOperationalLog(log, "lifecycle.phase", {
    phase: "post_ft_reconciliation",
    matchId: preparing.id,
    status: preparing.status,
    ratingState: preparing.ratingState,
  });

  try {
    const syncSummary = await syncParticipants(match.id, currentTime, "final");
    const synced = {
      ...preparing,
      participantSyncedAt: currentTime.toISOString(),
      updatedAt: currentTime.toISOString(),
    };
    await store.updateMatchLifecycle(synced);
    const [participantCount, hasCoach] = await Promise.all([
      store.countRateableParticipants(match.id, match.trackedTeamId),
      store.hasTrackedTeamHeadCoach(match.id, match.trackedTeamId),
    ]);
    if (participantCount < MINIMUM_RATEABLE_PARTICIPANTS || !hasCoach) {
      const blockingReason =
        participantCount < MINIMUM_RATEABLE_PARTICIPANTS
          ? "insufficient-rateable-participants"
          : "coach-missing";
      emitOperationalLog(log, "lifecycle.readiness", {
        matchId: match.id,
        ready: false,
        participantCount:
          syncSummary === undefined
            ? participantCount
            : syncSummary.starters + syncSummary.substitutes,
        rateableParticipantCount: participantCount,
        fixtureCoachPresent: hasCoach,
        reason: blockingReason,
      });
      await store.updateMatchLifecycle({
        ...synced,
        ratingBlockReason:
          participantCount < MINIMUM_RATEABLE_PARTICIPANTS
            ? "missing_participant_evidence"
            : "missing_coach_evidence",
        ratingBlockObservedAt: currentTime.toISOString(),
        updatedAt: currentTime.toISOString(),
      });
      return {
        action: "preparing_rating",
        matchId: match.id,
        providerRequests: provider.requestCount,
        reason: `Readiness incomplete: ${participantCount} rateable participants; head coach ${hasCoach ? "present" : "missing"}.`,
      };
    }

    const opensAt = preparing.votingOpensAt ?? currentTime.toISOString();
    const closesAt =
      preparing.votingClosesAt ??
      new Date(new Date(opensAt).getTime() + VOTING_WINDOW_MS).toISOString();
    emitOperationalLog(log, "lifecycle.readiness", {
      matchId: match.id,
      ready: true,
      participantCount:
        syncSummary === undefined
          ? participantCount
          : syncSummary.starters + syncSummary.substitutes,
      rateableParticipantCount: participantCount,
      fixtureCoachPresent: hasCoach,
      reason: "ready",
    });
    await store.updateMatchLifecycle({
      ...synced,
      ratingBlockReason: undefined,
      ratingBlockObservedAt: undefined,
      ratingState: "rating_ready",
      ratingReadyAt: synced.ratingReadyAt ?? currentTime.toISOString(),
      votingOpensAt: opensAt,
      votingClosesAt: closesAt,
      votingOpenNotificationWindow: 0,
      votingOpenNotificationStatus: "pending",
      updatedAt: currentTime.toISOString(),
    });
    emitOperationalLog(log, "lifecycle.voting_window", {
      action: "opened",
      matchId: match.id,
      ratingState: "rating_ready",
      opensAt,
      closesAt,
    });
    return {
      action: "rating_ready",
      matchId: match.id,
      providerRequests: provider.requestCount,
    };
  } catch (error) {
    const readiness = await observePersistedReadiness(store, match);
    emitOperationalLog(log, "lifecycle.readiness", {
      matchId: match.id,
      ready: false,
      participantCount: "unavailable",
      rateableParticipantCount: readiness.rateableParticipantCount,
      fixtureCoachPresent: readiness.fixtureCoachPresent,
      reason: operationalErrorReason(error),
    });
    await persistRatingBlock(store, preparing, error, currentTime, log);
    return retryable(provider, match.id, error, "preparing_rating");
  }
}

async function persistRatingBlock(
  store: MatchLifecycleStore,
  match: Match,
  error: unknown,
  now: Date,
  log: OperationalLogger,
): Promise<void> {
  try {
    await store.updateMatchLifecycle({
      ...match,
      ratingBlockReason: ratingBlockReason(error),
      ratingBlockObservedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  } catch (persistenceError) {
    emitOperationalLog(log, "lifecycle.diagnostic", {
      action: "persistence_failed",
      matchId: match.id,
      reason: operationalErrorReason(persistenceError),
    });
  }
}

function ratingBlockReason(error: unknown): Match["ratingBlockReason"] {
  const reason = operationalErrorReason(error);
  if (reason.includes("ambiguous") && reason.includes("coach")) {
    return "ambiguous_coach";
  }
  if (reason.includes("coach")) return "missing_coach_evidence";
  if (
    reason.includes("request") ||
    reason.includes("rate-limit") ||
    reason.includes("api-key")
  ) {
    return "provider_failure";
  }
  if (reason.includes("lineup") || reason.includes("participant")) {
    return "missing_participant_evidence";
  }
  return "unknown";
}

async function observePersistedReadiness(
  store: MatchLifecycleStore,
  match: Match,
): Promise<{
  rateableParticipantCount: number | "unavailable";
  fixtureCoachPresent: boolean | "unknown";
}> {
  try {
    const [rateableParticipantCount, fixtureCoachPresent] = await Promise.all([
      store.countRateableParticipants(match.id, match.trackedTeamId),
      store.hasTrackedTeamHeadCoach(match.id, match.trackedTeamId),
    ]);
    return { rateableParticipantCount, fixtureCoachPresent };
  } catch {
    return {
      rateableParticipantCount: "unavailable",
      fixtureCoachPresent: "unknown",
    };
  }
}

function operationalErrorReason(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("lineup") &&
    error.message.toLowerCase().includes("unavailable")
  ) {
    return "lineup-unavailable";
  }
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("no usable lineup")
  ) {
    return "lineup-unavailable";
  }
  return "participant-sync-failed";
}

async function requireLifecycleExecutionOwnership(
  store: MatchLifecycleStore,
  teamId: string,
  matchId: string,
): Promise<void> {
  if (
    store.markLifecycleExecutionTarget &&
    !(await store.markLifecycleExecutionTarget(teamId, matchId))
  ) {
    throw new Error("Lifecycle execution lease was lost.");
  }
}

export function selectRelevantMatch(
  matches: Match[],
  now: Date,
): Match | undefined {
  const byKickoff = [...matches].sort(
    (left, right) =>
      new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime(),
  );
  return (
    byKickoff.find((match) => {
      const closesAt = getEffectiveVotingClosesAt(match);
      return (
        match.ratingState === "rating_ready" &&
        closesAt !== undefined &&
        now < new Date(closesAt)
      );
    }) ??
    byKickoff.find((match) => match.status === "live") ??
    byKickoff.find(
      (match) =>
        match.status === "finished" &&
        match.ratingState !== "rating_ready" &&
        match.ratingState !== "rating_closed" &&
        (match.ratingState === "preparing_rating" ||
          now.getTime() - new Date(match.kickoffAt).getTime() <= 8 * HOUR),
    ) ??
    byKickoff.find(
      (match) =>
        match.status === "scheduled" &&
        new Date(match.kickoffAt).getTime() >= now.getTime() - 4 * HOUR,
    ) ??
    [...byKickoff]
      .reverse()
      .find((match) => match.ratingState === "rating_closed") ??
    byKickoff.find((match) => match.ratingState === "rating_ready")
  );
}

export function selectLifecycleMatch(
  matches: Match[],
  now: Date,
): Match | undefined {
  return (
    [...matches]
      .sort(
        (left, right) =>
          new Date(left.kickoffAt).getTime() -
          new Date(right.kickoffAt).getTime(),
      )
      .find((match) => isExpiredRatingWindow(match, now)) ??
    selectRelevantMatch(matches, now)
  );
}

function isExpiredRatingWindow(match: Match, now: Date): boolean {
  const closesAt = getEffectiveVotingClosesAt(match);
  return (
    match.ratingState === "rating_ready" &&
    closesAt !== undefined &&
    now >= new Date(closesAt)
  );
}

function isDiscoveryDue(
  matches: Match[],
  lastDiscoveryAt: string | undefined,
  now: Date,
): boolean {
  const hasUpcoming = matches.some(
    (match) =>
      ["scheduled", "live"].includes(match.status) &&
      new Date(match.kickoffAt).getTime() >= now.getTime() - 4 * HOUR,
  );
  if (hasUpcoming) return false;
  if (lastDiscoveryAt === undefined) return true;
  return (
    now.getTime() - new Date(lastDiscoveryAt).getTime() >= DISCOVERY_INTERVAL_MS
  );
}

function shouldRefreshMatch(match: Match, now: Date): boolean {
  if (["live", "finished"].includes(match.status)) return true;
  if (["postponed", "suspended"].includes(match.status))
    return due(match, now, HOUR);
  if (["cancelled", "abandoned"].includes(match.status)) return false;
  const untilKickoff = new Date(match.kickoffAt).getTime() - now.getTime();
  if (untilKickoff > 24 * HOUR) return false;
  if (untilKickoff > 2 * HOUR) return due(match, now, 6 * HOUR);
  return due(match, now, 15 * 60 * 1000);
}

type LineupCaptureMode = "pre_match" | "live_retry";

type LineupCaptureDecision =
  | { action: "none" }
  | { action: "attempt"; mode: LineupCaptureMode }
  | {
      action: "skip";
      mode: LineupCaptureMode;
      reason:
        | "snapshot-complete"
        | "verified-lineup"
        | "cooldown"
        | "retry-ceiling"
        | "provider-budget";
      nextEligibleAt?: string;
    };

function lineupCaptureProviderRequestBudget(
  mode: LineupCaptureMode,
  providerRequests: number,
): number {
  return mode === "live_retry"
    ? LIVE_LINEUP_PROVIDER_REQUEST_BUDGET
    : providerRequests + 1;
}

async function decideLineupCapture(
  match: Match,
  now: Date,
  providerRequests: number,
  store: MatchLifecycleStore,
): Promise<LineupCaptureDecision> {
  if (match.status !== "scheduled" && match.status !== "live") {
    return { action: "none" };
  }
  const mode: LineupCaptureMode =
    match.status === "live" ? "live_retry" : "pre_match";
  if (match.lineupSnapshotAt !== undefined) {
    return { action: "skip", mode, reason: "snapshot-complete" };
  }
  const untilKickoff = new Date(match.kickoffAt).getTime() - now.getTime();
  if (
    match.status === "scheduled" &&
    (untilKickoff > LINEUP_CAPTURE_WINDOW_MS || untilKickoff < 0)
  ) {
    return { action: "none" };
  }
  if (await hasVerifiedLineup(match, store)) {
    return { action: "skip", mode, reason: "verified-lineup" };
  }
  if (mode === "pre_match") return { action: "attempt", mode };
  const liveAttempts = match.liveLineupCaptureAttempts ?? 0;
  if (liveAttempts >= LIVE_LINEUP_CAPTURE_MAX_ATTEMPTS) {
    return { action: "skip", mode, reason: "retry-ceiling" };
  }
  if (match.lineupCaptureLastAttemptAt !== undefined) {
    const nextEligibleAt = new Date(
      new Date(match.lineupCaptureLastAttemptAt).getTime() +
        LIVE_LINEUP_CAPTURE_COOLDOWN_MS,
    );
    if (now < nextEligibleAt) {
      return {
        action: "skip",
        mode,
        reason: "cooldown",
        nextEligibleAt: nextEligibleAt.toISOString(),
      };
    }
  }
  if (providerRequests !== LIVE_LINEUP_CAPTURE_REQUIRED_REQUEST_COUNT) {
    return { action: "skip", mode, reason: "provider-budget" };
  }
  return { action: "attempt", mode };
}

async function hasVerifiedLineup(
  match: Match,
  store: MatchLifecycleStore,
): Promise<boolean> {
  if (store.getVerifiedLineupSnapshot === undefined) return false;
  const verified = await store.getVerifiedLineupSnapshot(match.id);
  if (verified === null) return false;
  const valid =
    verified.matchId === match.id &&
    verified.trackedTeamId === match.trackedTeamId &&
    verified.externalProvider === match.externalProvider &&
    verified.externalFixtureId === match.externalProviderFixtureId &&
    verified.provenance === "operator_verified" &&
    new Set(verified.participants.map((participant) => participant.playerId))
      .size === verified.participants.length &&
    verified.participants.length >= 11 &&
    verified.participants.filter(
      (participant) => participant.squadRole === "starter",
    ).length === 11 &&
    verified.participants.every((participant) =>
      participant.squadRole === "starter"
        ? participant.participationStatus === "confirmed_starter" &&
          participant.participated
        : (participant.participationStatus === "confirmed_substitute" &&
            participant.participated) ||
          (["unused_substitute", "unconfirmed"].includes(
            participant.participationStatus,
          ) &&
            !participant.participated),
    );
  if (!valid) throw new Error("Verified lineup does not match the fixture.");
  return true;
}

async function persistLineupCaptureOutcome(
  store: MatchLifecycleStore,
  match: Match,
  outcome: LineupCaptureOutcome,
  now: Date,
): Promise<Match> {
  const updated = {
    ...match,
    lineupCaptureLastOutcome: outcome,
    updatedAt: now.toISOString(),
  };
  await store.updateMatchLifecycle(updated);
  return updated;
}

function captureFailureOutcome(error: unknown): LineupCaptureOutcome {
  const reason = operationalErrorReason(error);
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (reason === "lineup-unavailable") {
    return message.includes("incomplete") ? "incomplete" : "unavailable";
  }
  if (
    reason.includes("request") ||
    reason.includes("rate-limit") ||
    reason.includes("api-key")
  ) {
    return "provider_failure";
  }
  return "rejected";
}

function due(match: Match, now: Date, interval: number): boolean {
  return (
    match.lastProviderSyncAt === undefined ||
    now.getTime() - new Date(match.lastProviderSyncAt).getTime() >= interval
  );
}

function validateTrackedTeam(
  fixture: ProviderFixture,
  expectedFixtureId: string,
  externalTeamId: string,
) {
  if (fixture.externalFixtureId !== expectedFixtureId) {
    throw new Error(
      `Provider returned fixture ${fixture.externalFixtureId} for requested fixture ${expectedFixtureId}.`,
    );
  }
  if (
    fixture.homeTeam.externalProviderId !== externalTeamId &&
    fixture.awayTeam.externalProviderId !== externalTeamId
  ) {
    throw new Error(
      `Fixture ${fixture.externalFixtureId} Team identities changed unexpectedly.`,
    );
  }
}

function mergeFixture(
  match: Match,
  fixture: ProviderFixture,
  now: Date,
): Match {
  const status = preserveMonotonicMatchStatus(
    match.status,
    fixture.status,
    match.ratingState,
  );
  const ratingState: RatingState =
    match.ratingState === "rating_ready" ||
    match.ratingState === "rating_closed"
      ? match.ratingState
      : status === "finished"
        ? "preparing_rating"
        : "not_ready";
  return {
    ...match,
    status,
    ratingState,
    score: fixture.score,
    ...(fixture.elapsedMinute === undefined
      ? {}
      : { elapsedMinute: fixture.elapsedMinute }),
    goalEvents: fixture.goalEvents ?? match.goalEvents ?? [],
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    kickoffAt: fixture.kickoffAt,
    lastProviderSyncAt: now.toISOString(),
    ...(status === "finished"
      ? { finishedObservedAt: match.finishedObservedAt ?? now.toISOString() }
      : {}),
    updatedAt: now.toISOString(),
  };
}

function retryable(
  provider: FootballDataProvider,
  matchId: string | undefined,
  error: unknown,
  action: LifecycleAction = "retryable_error",
): LifecycleResult {
  return {
    action,
    ...(matchId === undefined ? {} : { matchId }),
    providerRequests: provider.requestCount,
    reason:
      error instanceof Error
        ? error.message
        : "Lifecycle synchronization failed.",
  };
}
