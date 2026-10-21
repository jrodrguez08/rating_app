import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { coachProviderAliasId } from "@/domain/coach-identity";
import { playerProviderAliasId } from "@/domain/player-identity";
import type {
  FootballDataProvider,
  ProviderMatchObservation,
  ProviderMatchParticipant,
} from "@/domain/ports";
import type { AdminProviderCheckRejectedError } from "@/lib/firebase/admin-provider-check";
import { AdminProviderCheckService } from "@/lib/firebase/admin-provider-check";
import { ProviderError } from "@/lib/providers/api-football/errors";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `admin-provider-check-${Date.now()}`);
const database = getFirestore(app);
const teamId = "club-sport-herediano";
const now = Timestamp.fromDate(new Date("2026-10-21T12:00:00.000Z"));
let sequence = 0;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});

afterAll(() => deleteApp(app));

describe("read-only post-match provider check", () => {
  it("compares complete late evidence and preserves finalized history", async () => {
    const fixture = await seedFinalized("complete");
    const before = await protectedHistory(fixture.matchId);
    const service = new AdminProviderCheckService(
      fakeProvider(observation(fixture.externalFixtureId)),
      database,
    );

    const report = await service.check(fixture.input);

    expect(report).toMatchObject({
      status: "available",
      providerRequests: 4,
      localEvidenceSource: "operator_verified",
      local: {
        starters: expect.arrayContaining([{ name: "Player 1" }]),
        participatingSubstitutes: expect.arrayContaining([
          { name: "Player 12", enteredAtMinute: 61 },
        ]),
        coachName: "Jafet Soto",
      },
      provider: {
        coachName: "Jafet Soto",
      },
      differences: [],
      missingEvidence: [],
    });
    expect(report.local.starters).toHaveLength(11);
    expect(report.local.participatingSubstitutes).toHaveLength(5);
    expect(report.provider.starters).toHaveLength(11);
    expect(report.provider.participatingSubstitutes).toHaveLength(5);
    expect(await protectedHistory(fixture.matchId)).toEqual(before);
  });

  it("distinguishes partial, missing, and stale evidence", async () => {
    const partialFixture = await seedFinalized("partial");
    const partial = observation(partialFixture.externalFixtureId);
    partial.lineupStatus = "partial";
    partial.participants = partial.participants.slice(0, 10);
    partial.starterCount = 10;
    partial.substituteCount = 0;
    partial.playerStatisticsAvailable = false;
    partial.substitutionEventsAvailable = false;
    partial.coach = { status: "unavailable", reason: "coach-missing" };
    const partialReport = await new AdminProviderCheckService(
      fakeProvider(partial),
      database,
    ).check(partialFixture.input);
    expect(partialReport.status).toBe("partial");
    expect(partialReport.missingEvidence).toEqual(
      expect.arrayContaining([
        "complete_starting_xi",
        "substitute_participation",
        "coach",
      ]),
    );

    const missingFixture = await seedFinalized("missing");
    const missing = observation(missingFixture.externalFixtureId);
    missing.lineupStatus = "missing";
    missing.participants = [];
    missing.starterCount = 0;
    missing.substituteCount = 0;
    missing.coach = { status: "unavailable", reason: "coach-missing" };
    const missingReport = await new AdminProviderCheckService(
      fakeProvider(missing),
      database,
    ).check(missingFixture.input);
    expect(missingReport.status).toBe("missing");
    expect(missingReport.missingEvidence).toContain("lineup");

    const staleFixture = await seedFinalized("stale");
    const stale = observation(staleFixture.externalFixtureId);
    stale.fixture.status = "live";
    const staleReport = await new AdminProviderCheckService(
      fakeProvider(stale),
      database,
    ).check(staleFixture.input);
    expect(staleReport.status).toBe("stale");
    expect(staleReport.missingEvidence).toContain("provider_final_status");
  });

  it("reports conflicting players and coach without changing history", async () => {
    const fixture = await seedFinalized("conflict");
    const value = observation(fixture.externalFixtureId);
    value.participants[0] = {
      ...value.participants[0],
      externalPlayerId: "999001",
      name: "Different Player",
    };
    value.coach = {
      status: "resolved",
      value: {
        externalTeamId: "815",
        externalCoachId: "999002",
        name: "Different Coach",
      },
    };
    const before = await protectedHistory(fixture.matchId);

    const report = await new AdminProviderCheckService(
      fakeProvider(value),
      database,
    ).check(fixture.input);

    expect(report.status).toBe("differences");
    expect(report.differences).toEqual(
      expect.arrayContaining([
        { type: "missing_provider_player", name: "Player 1" },
        { type: "unexpected_provider_player", name: "Different Player" },
        { type: "coach_mismatch", name: "Different Coach" },
      ]),
    );
    expect(await protectedHistory(fixture.matchId)).toEqual(before);
  });

  it("returns a safe provider error and applies a durable cooldown", async () => {
    const fixture = await seedFinalized("provider-error");
    const provider = fakeProvider(
      new ProviderError("request-failed", "secret upstream response"),
    );
    const service = new AdminProviderCheckService(provider, database);

    const report = await service.check(fixture.input);

    expect(report).toMatchObject({
      status: "provider_error",
      providerRequests: 1,
      differences: [],
    });
    await expect(service.check(fixture.input)).rejects.toMatchObject({
      code: "rate_limited",
    } satisfies Partial<AdminProviderCheckRejectedError>);
  });

  it("rejects non-finalized and mismatched fixtures before provider work", async () => {
    const fixture = await seedFinalized("rejected");
    await database.doc(`matches/${fixture.matchId}`).update({
      ratingState: "rating_ready",
    });
    const provider = fakeProvider(observation(fixture.externalFixtureId));
    const service = new AdminProviderCheckService(provider, database);

    await expect(service.check(fixture.input)).rejects.toMatchObject({
      code: "not_finalized",
    });
    await expect(
      service.check({ ...fixture.input, externalFixtureId: "999999" }),
    ).rejects.toMatchObject({ code: "binding_conflict" });
    expect(provider.requestCount).toBe(0);
  });
});

async function seedFinalized(label: string) {
  sequence += 1;
  const matchId = `provider-check-${label}-${sequence}`;
  const externalFixtureId = String(1_551_706 + sequence);
  await database.doc(`teams/${teamId}`).set({
    displayName: "Club Sport Herediano",
    shortName: "Herediano",
    countryName: "Costa Rica",
    countryCode: "CR",
    externalProviderId: "815",
    brandingKey: "herediano",
    createdAt: now,
    updatedAt: now,
  });
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: teamId,
    trackedTeamExternalProviderId: "815",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "900", name: "Pérez Zeledón" },
    kickoffAt: Timestamp.fromDate(new Date("2026-10-18T23:00:00.000Z")),
    status: "finished",
    ratingState: "rating_closed",
    score: { home: 2, away: 1 },
    externalProvider: "api-football",
    externalProviderFixtureId: externalFixtureId,
    createdAt: now,
    updatedAt: now,
  });
  const verifiedParticipants = participants(matchId).map((participant) => ({
    playerId: participant.playerId,
    playerName: participant.playerName,
    squadRole: participant.squadRole,
    participationStatus: participant.participationStatus,
    participated: participant.participated,
    identityProvenance: "provider",
    externalProviderPlayerId: participant.externalProviderPlayerId,
    ...(participant.enteredAtMinute === undefined
      ? {}
      : { enteredAtMinute: participant.enteredAtMinute }),
    verificationSource: "https://evidence.example.test/match",
    verificationReason: "Owner reviewed the match.",
    verifiedBy: "owner",
    verifiedAt: now,
  }));
  await database.doc(`matches/${matchId}/verifiedLineups/current`).set({
    matchId,
    trackedTeamId: teamId,
    externalProvider: "api-football",
    externalFixtureId,
    participants: verifiedParticipants,
    operatorId: "owner",
    verificationSource: "https://evidence.example.test/match",
    verificationReason: "Owner reviewed the match.",
    provenance: "operator_verified",
    verifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  for (const participant of participants(matchId)) {
    await database.doc(`players/${participant.playerId}`).set({
      displayName: participant.playerName,
      identityProvenance: "provider",
      externalProvider: "api-football",
      externalProviderId: participant.externalProviderPlayerId,
      createdAt: now,
      updatedAt: now,
    });
    await database
      .doc(`matches/${matchId}/participants/${participant.playerId}`)
      .set(participant);
    await database
      .doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", participant.externalProviderPlayerId)}`,
      )
      .set({
        canonicalPlayerId: participant.playerId,
        canonicalExternalProviderPlayerId: participant.externalProviderPlayerId,
        externalProvider: "api-football",
        externalProviderPlayerId: participant.externalProviderPlayerId,
        createdAt: now,
        updatedAt: now,
      });
  }
  await database.doc("coaches/coach-jafet").set({
    displayName: "Jafet Soto",
    identityProvenance: "operator_verified",
    createdAt: now,
    updatedAt: now,
  });
  await database.doc(`matches/${matchId}/coachAssignments/head-coach`).set({
    matchId,
    coachId: "coach-jafet",
    teamId,
    externalProvider: "api-football",
    externalProviderTeamId: "815",
    coachName: "Jafet Soto",
    provenance: "operator_verified",
    createdAt: now,
    updatedAt: now,
  });
  await database
    .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
    .set({
      matchId,
      coachId: "coach-jafet",
      trackedTeamId: teamId,
      externalProvider: "api-football",
      externalFixtureId,
      coachName: "Jafet Soto",
      verificationSource: "https://evidence.example.test/match",
      verificationReason: "Owner reviewed the match.",
      operatorId: "owner",
      provenance: "operator_verified",
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  await database
    .doc(
      `coachProviderAliases/${coachProviderAliasId("api-football", "29352")}`,
    )
    .set({
      canonicalCoachId: "coach-jafet",
      externalProvider: "api-football",
      externalProviderCoachId: "29352",
      createdAt: now,
      updatedAt: now,
    });
  await database.doc(`matches/${matchId}/ballots/voter-1`).set({
    matchId,
    teamId,
    voterId: "voter-1",
    playerRatings: Object.fromEntries(
      participants(matchId)
        .filter(({ participated }) => participated)
        .map(({ playerId }) => [playerId, 8]),
    ),
    coachRating: { coachId: "coach-jafet", rating: 9 },
    submittedAt: now,
  });
  await database.doc(`matches/${matchId}/results/summary`).set({
    matchId,
    teamId,
    status: "final",
    ballotCount: 1,
    playerResults: {},
    coachResult: {
      coachId: "coach-jafet",
      coachName: "Jafet Soto",
      average: 9,
      voteCount: 1,
    },
    mvpPlayerIds: [],
    generatedAt: now,
  });
  return {
    matchId,
    externalFixtureId,
    input: {
      matchId,
      trackedTeamId: teamId,
      externalFixtureId,
      operatorId: `owner-${label}-${sequence}`,
    },
  };
}

function participants(matchId: string) {
  return Array.from({ length: 21 }, (_, index) => {
    const number = index + 1;
    const starter = number <= 11;
    const participated = starter || number <= 16;
    return {
      matchId,
      playerId: `canonical-player-${number}`,
      teamId,
      externalProvider: "api-football",
      externalProviderTeamId: "815",
      externalProviderPlayerId: String(20_000 + number),
      playerName: `Player ${number}`,
      squadRole: starter ? ("starter" as const) : ("substitute" as const),
      starter,
      participated,
      participationStatus: starter
        ? ("confirmed_starter" as const)
        : participated
          ? ("confirmed_substitute" as const)
          : ("unused_substitute" as const),
      identityProvenance: "provider" as const,
      participationProvenance: "operator_verified" as const,
      ...(starter || !participated ? {} : { enteredAtMinute: 49 + number }),
      createdAt: now,
      updatedAt: now,
    };
  });
}

function observation(externalFixtureId: string): ProviderMatchObservation {
  return {
    fixture: {
      externalFixtureId,
      externalCompetitionId: "71",
      providerSeason: 2026,
      kickoffAt: "2026-10-18T23:00:00.000Z",
      status: "finished",
      homeTeam: { externalProviderId: "815", name: "Herediano" },
      awayTeam: { externalProviderId: "900", name: "Pérez Zeledón" },
      score: { home: 2, away: 1 },
    },
    lineupStatus: "available",
    starterCount: 11,
    substituteCount: 10,
    participants: participants("provider").map(
      (participant): ProviderMatchParticipant => ({
        externalTeamId: "815",
        externalPlayerId: participant.externalProviderPlayerId,
        name: participant.playerName,
        squadRole: participant.squadRole,
        participated: participant.participated,
        ...(participant.enteredAtMinute === undefined
          ? {}
          : { enteredAtMinute: participant.enteredAtMinute }),
      }),
    ),
    playerStatisticsAvailable: true,
    substitutionEventsAvailable: true,
    coach: {
      status: "resolved",
      value: {
        externalTeamId: "815",
        externalCoachId: "29352",
        name: "Jafet Soto",
      },
    },
  };
}

function fakeProvider(
  result: ProviderMatchObservation | ProviderError,
): FootballDataProvider {
  let requests = 0;
  return {
    name: "api-football",
    get requestCount() {
      return requests;
    },
    async inspectMatchEvidence() {
      requests = result instanceof ProviderError ? 1 : 4;
      if (result instanceof ProviderError) throw result;
      return structuredClone(result);
    },
  } as unknown as FootballDataProvider;
}

async function protectedHistory(matchId: string) {
  const roster = participants(matchId);
  const [
    match,
    result,
    lineup,
    coach,
    verifiedCoach,
    ballots,
    people,
    coachIdentity,
    coachAlias,
    ...playerAndAliasSnapshots
  ] = await Promise.all([
    database.doc(`matches/${matchId}`).get(),
    database.doc(`matches/${matchId}/results/summary`).get(),
    database.doc(`matches/${matchId}/verifiedLineups/current`).get(),
    database.doc(`matches/${matchId}/coachAssignments/head-coach`).get(),
    database
      .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
      .get(),
    database.collection(`matches/${matchId}/ballots`).get(),
    database.collection(`matches/${matchId}/participants`).get(),
    database.doc("coaches/coach-jafet").get(),
    database
      .doc(
        `coachProviderAliases/${coachProviderAliasId("api-football", "29352")}`,
      )
      .get(),
    ...roster.flatMap((participant) => [
      database.doc(`players/${participant.playerId}`).get(),
      database
        .doc(
          `playerProviderAliases/${playerProviderAliasId("api-football", participant.externalProviderPlayerId)}`,
        )
        .get(),
    ]),
  ]);
  return {
    match: match.data(),
    result: result.data(),
    lineup: lineup.data(),
    coach: coach.data(),
    verifiedCoach: verifiedCoach.data(),
    coachIdentity: coachIdentity.data(),
    coachAlias: coachAlias.data(),
    ballots: ballots.docs.map((document) => [document.id, document.data()]),
    participants: people.docs.map((document) => [document.id, document.data()]),
    playerAndAliasRecords: playerAndAliasSnapshots.map((snapshot) => [
      snapshot.id,
      snapshot.data(),
    ]),
  };
}
