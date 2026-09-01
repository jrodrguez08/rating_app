import { preserveMonotonicMatchStatus } from "@/domain/match-status";
import type { Match, RatingState, Team } from "@/domain/models";
import type {
  FootballDataProvider,
  MatchLifecycleStore,
  ProviderFixture,
} from "@/domain/ports";

const HOUR = 60 * 60 * 1000;
const VOTING_WINDOW_MS = 2 * HOUR;
const DISCOVERY_INTERVAL_MS = 12 * HOUR;
const LINEUP_CAPTURE_WINDOW_MS = HOUR;
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
  ) => Promise<void>;
}

export async function runMatchLifecycle({
  teamId,
  provider,
  store,
  now,
  discoverFixtures,
  syncParticipants,
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
    return {
      action: discovered ? "discovered" : "idle",
      providerRequests: provider.requestCount,
      reason: "No relevant tracked-Team match is persisted.",
    };
  }

  if (isExpiredRatingWindow(match, currentTime)) {
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
    return {
      action: "idle",
      matchId: match.id,
      providerRequests: provider.requestCount,
      reason: "The rating window is already established.",
    };
  }

  if (!shouldRefreshMatch(match, currentTime)) {
    return {
      action: discovered ? "discovered" : "idle",
      matchId: match.id,
      providerRequests: provider.requestCount,
      reason: "The relevant match is outside its polling interval.",
    };
  }

  let refreshed: Match;
  try {
    const fixture = await provider.getFixture(match.externalProviderFixtureId);
    validateTrackedTeam(
      fixture,
      match.externalProviderFixtureId,
      team.externalProviderId,
    );
    refreshed = mergeFixture(match, fixture, currentTime);
    await store.updateMatchLifecycle(refreshed);
  } catch (error) {
    return retryable(provider, match.id, error);
  }

  if (shouldCaptureLineup(refreshed, currentTime)) {
    try {
      await syncParticipants(refreshed.id, currentTime, "lineup");
      refreshed = {
        ...refreshed,
        lineupSnapshotAt: currentTime.toISOString(),
        updatedAt: currentTime.toISOString(),
      };
      await store.updateMatchLifecycle(refreshed);
    } catch (error) {
      return retryable(provider, refreshed.id, error, "refreshed");
    }
  }

  if (refreshed.status !== "finished") {
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

  try {
    await syncParticipants(match.id, currentTime, "final");
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
    await store.updateMatchLifecycle({
      ...synced,
      ratingState: "rating_ready",
      ratingReadyAt: synced.ratingReadyAt ?? currentTime.toISOString(),
      votingOpensAt: opensAt,
      votingClosesAt: closesAt,
      updatedAt: currentTime.toISOString(),
    });
    return {
      action: "rating_ready",
      matchId: match.id,
      providerRequests: provider.requestCount,
    };
  } catch (error) {
    return retryable(provider, match.id, error, "preparing_rating");
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
    byKickoff.find(
      (match) =>
        match.ratingState === "rating_ready" &&
        match.votingClosesAt !== undefined &&
        now < new Date(match.votingClosesAt),
    ) ??
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
  return (
    match.ratingState === "rating_ready" &&
    match.votingClosesAt !== undefined &&
    now >= new Date(match.votingClosesAt)
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

function shouldCaptureLineup(match: Match, now: Date): boolean {
  const untilKickoff = new Date(match.kickoffAt).getTime() - now.getTime();
  return (
    match.status === "scheduled" &&
    match.lineupSnapshotAt === undefined &&
    untilKickoff <= LINEUP_CAPTURE_WINDOW_MS &&
    untilKickoff >= 0
  );
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
