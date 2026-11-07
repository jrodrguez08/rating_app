import { randomBytes, scryptSync } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { parseWrappedLedger } from "@/application/wrapped-ledger";
import { wrappedEditionId } from "@/application/wrapped-snapshot";
import type { ClubSlug } from "@/config/club";
import {
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import { AdminWrappedService } from "@/lib/firebase/admin-wrapped";
import {
  AdminFootballSyncStore,
  AdminVotingWindowService,
} from "@/lib/firebase/server";
import {
  invalidateWrappedForMatch,
  readWrappedProjection,
} from "@/lib/firebase/wrapped-publication";
import type { AdminWrappedAction } from "@/lib/server/admin-wrapped-action";

import {
  competition,
  ledgerInput,
  season,
  wrappedFixture,
  wrappedMatch,
  wrappedSummary,
  wrappedTeam,
} from "../wrapped-fixtures";
import { measureReads } from "./read-counts";

const app = initializeApp(
  { projectId: "demo-wrapped-snapshots" },
  "wrapped-snapshots",
);
const database = getFirestore(app);
const service = new AdminWrappedService(database);
const security = new AdminSecurityStore(database);
const passphrase = "synthetic wrapped passphrase";

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Firestore emulator required.");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "local");
  vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "demo-wrapped-snapshots");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "demo-wrapped-snapshots");
  vi.stubEnv("SAPRISSA_PUBLIC_ENABLED", "false");
  const salt = randomBytes(16);
  const digest = scryptSync(passphrase, salt, 32, { N: 16_384, r: 8, p: 1 });
  vi.stubEnv(
    "ADMIN_PASSPHRASE_SCRYPT",
    `scrypt$v1$16384$8$1$${salt.toString("base64")}$${digest.toString("base64")}`,
  );
  const batch = database.batch();
  batch.set(database.doc(`competitions/${competition.id}`), competition);
  batch.set(database.doc(`seasons/${season.id}`), season);
  batch.set(database.doc("players/player"), {
    displayName: "Canonical player",
  });
  batch.set(database.doc("coaches/coach"), { displayName: "Canonical coach" });
  for (const club of ["herediano", "saprissa"] as const) {
    const team = wrappedTeam(club);
    batch.set(database.doc(`teams/${team.id}`), team);
  }
  await batch.commit();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await deleteApp(app);
});

async function seed(
  club: ClubSlug,
  prefix: string,
  edition: "apertura" | "clausura" = "clausura",
) {
  const matches = Array.from({ length: 3 }, (_, i) =>
    wrappedMatch(club, prefix + i),
  );
  const batch = database.batch();
  for (const match of matches) {
    const base = `matches/${match.id}`;
    batch.set(database.doc(base), match);
    batch.set(database.doc(`${base}/results/summary`), wrappedSummary(match));
    batch.set(database.doc(`${base}/participants/player`), {
      matchId: match.id,
      teamId: match.trackedTeamId,
      externalProviderTeamId: match.trackedTeamExternalProviderId,
      playerId: "player",
      playerName: "Player",
      starter: true,
      squadRole: "starter",
      participated: true,
      participationStatus: "confirmed_starter",
      participationProvenance: "provider",
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
    });
    batch.set(database.doc(`${base}/coachAssignments/head-coach`), {
      matchId: match.id,
      teamId: match.trackedTeamId,
      externalProviderTeamId: match.trackedTeamExternalProviderId,
      coachId: "coach",
      coachName: "Coach",
      role: "head-coach",
      provenance: "provider",
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
    });
    for (let i = 0; i < 12; i++) {
      const voterId = `synthetic-voter-${i}`;
      batch.set(database.doc(`${base}/ballots/${voterId}`), {
        voterId,
        matchId: match.id,
        teamId: match.trackedTeamId,
        playerRatings: { player: 8 },
        coachRating: { coachId: "coach", rating: 7 },
        submittedAt: match.votingOpensAt,
      });
    }
  }
  await batch.commit();
  const ledger = ledgerInput(club, matches.map(wrappedFixture), { edition });
  const scope = {
    wrappedOperation: "approve",
    trackedTeamId: ledger.teamId,
    tournamentKey: parseWrappedLedger(ledger).tournaments[0].key,
  } as const;
  return {
    ledger,
    scope,
    matches,
    id: wrappedEditionId(scope.trackedTeamId, scope.tournamentKey),
  };
}

async function authorize(
  action: AdminWrappedAction,
  operatorUid = "synthetic-owner",
  secret = passphrase,
) {
  const preview = await security.issuePreview(operatorUid, action);
  return (
    await security.authorizeAction({
      operatorUid,
      action,
      passphrase: secret,
      previewToken: preview.token,
    })
  ).token;
}

it("previews without writes, binds authorization to the exact candidate, and preserves immutable independently scoped versions", async () => {
  const home = await seed("herediano", "shared");
  const away = await seed("saprissa", "shared");
  const measured = await measureReads(() =>
    service.preview(home.scope, home.ledger),
  );
  const homePreview = measured.value;
  expect(measured.paths.every((path) => !path.includes("/ballots/"))).toBe(
    true,
  );
  expect(measured.queries).toBe(3);
  expect((await database.collection("wrappedPublications").get()).empty).toBe(
    true,
  );
  expect((await database.collection("adminAudit").get()).empty).toBe(true);
  expect((await database.collection("adminActionChallenges").get()).empty).toBe(
    true,
  );
  expect(
    (await database.collection("wrappedMatchDependencies").get()).empty,
  ).toBe(true);
  expect(home.matches[0].id).not.toBe(away.matches[0].id);
  const homeScope = new Set([home.id]);
  expect(
    (
      await measureReads(() =>
        readWrappedProjection(
          database,
          "herediano",
          home.scope.tournamentKey,
          new Set(),
        ),
      )
    ).documents,
  ).toBe(0);
  expect(
    (
      await measureReads(() =>
        readWrappedProjection(
          database,
          "herediano",
          home.scope.tournamentKey,
          homeScope,
        ),
      )
    ).documents,
  ).toBe(1);
  await expect(service.preview(home.scope, away.ledger)).rejects.toMatchObject({
    code: "invalid_input",
  });

  const shuffled = structuredClone(home.ledger);
  shuffled.tournaments[0].fixtures.reverse();
  expect((await service.preview(home.scope, shuffled)).action.digest).toBe(
    homePreview.action.digest,
  );
  await expect(
    authorize(homePreview.action, "wrong-passphrase-owner", "bad"),
  ).rejects.toMatchObject({ code: "invalid_passphrase" });
  const token = await authorize(homePreview.action);
  await expect(
    service.applyAuthorized(
      homePreview.action,
      "different-owner",
      token,
      home.ledger,
    ),
  ).rejects.toMatchObject({ code: "invalid_challenge" });
  await expect(
    service.applyAuthorized(
      { ...homePreview.action, digest: "0".repeat(64) },
      "synthetic-owner",
      token,
      home.ledger,
    ),
  ).rejects.toMatchObject({ code: "invalid_challenge" });
  const modified = structuredClone(home.ledger);
  modified.tournaments[0].review.source = "Different review evidence";
  await expect(
    service.applyAuthorized(
      homePreview.action,
      "synthetic-owner",
      token,
      modified,
    ),
  ).rejects.toMatchObject({ code: "stale_candidate" });

  const calls = await Promise.all(
    [0, 1].map(() =>
      service.applyAuthorized(
        homePreview.action,
        "synthetic-owner",
        token,
        home.ledger,
      ),
    ),
  );
  expect(calls.map(({ disposition }) => disposition).sort()).toEqual([
    "committed",
    "idempotent_retry",
  ]);
  expect(calls[0].receipt).toEqual(calls[1].receipt);
  const awayPreview = await service.preview(away.scope, away.ledger);
  expect(awayPreview.action.digest).not.toBe(homePreview.action.digest);
  await service.applyAuthorized(
    awayPreview.action,
    "synthetic-owner",
    await authorize(awayPreview.action),
    away.ledger,
  );
  const read = await measureReads(() =>
    readWrappedProjection(
      database,
      "herediano",
      home.scope.tournamentKey,
      homeScope,
    ),
  );
  expect(read.documents).toBe(2);
  expect(read.queries).toBe(0);
  expect(read.value).toMatchObject({
    version: 1,
    projection: { clubSlug: "herediano", overview: { validBallots: 36 } },
  });
  expect(JSON.stringify(read.value)).not.toMatch(
    /Synthetic schedule evidence|synthetic-owner|voter-|generatedAt|auditId|manifest|digest/,
  );
  expect(
    await readWrappedProjection(
      database,
      "saprissa",
      away.scope.tournamentKey,
      new Set([away.id]),
    ),
  ).toBeNull();
  vi.stubEnv("SAPRISSA_PUBLIC_ENABLED", "true");
  await expect(
    readWrappedProjection(
      database,
      "saprissa",
      away.scope.tournamentKey,
      new Set([away.id]),
    ),
  ).resolves.toMatchObject({
    version: 1,
    projection: { clubSlug: "saprissa" },
  });

  const withdrawal = await service.preview({
    ...home.scope,
    wrappedOperation: "withdraw",
  });
  await service.applyAuthorized(
    withdrawal.action,
    "synthetic-owner",
    await authorize(withdrawal.action),
  );
  expect(
    await readWrappedProjection(
      database,
      "herediano",
      home.scope.tournamentKey,
      homeScope,
    ),
  ).toBeNull();
  expect(
    (await database.doc(`wrappedPublications/${away.id}`).get()).data()?.active
      .version,
  ).toBe(1);
  expect(
    (await database.collection(`wrappedPublications/${home.id}/versions`).get())
      .size,
  ).toBe(1);
  expect(
    (
      await database
        .collection(`wrappedPublications/${home.id}/projections`)
        .get()
    ).size,
  ).toBe(1);
  expect(
    await service.applyAuthorized(
      homePreview.action,
      "synthetic-owner",
      token,
      home.ledger,
    ),
  ).toMatchObject({ disposition: "idempotent_retry" });
  const same = await service.preview(home.scope, home.ledger);
  await expect(
    service.applyAuthorized(
      same.action,
      "synthetic-owner",
      await authorize(same.action),
      home.ledger,
    ),
  ).rejects.toMatchObject({ code: "stale_candidate" });
  expect(
    await readWrappedProjection(
      database,
      "herediano",
      home.scope.tournamentKey,
      homeScope,
    ),
  ).toBeNull();
});

it("fences source revisions and concurrent reopen, then approves a regenerated version monotonically", async () => {
  const input = await seed("herediano", "race", "apertura");
  const { scope, ledger, id, matches } = input;
  const match = matches[0];
  const allow = new Set([id]);
  const read = () =>
    readWrappedProjection(database, "herediano", scope.tournamentKey, allow);
  const initial = await service.preview(scope, ledger);
  const staleToken = await authorize(initial.action);
  await database
    .doc("players/player")
    .update({ displayName: "Reviewed correction" });
  await expect(
    service.applyAuthorized(
      initial.action,
      "synthetic-owner",
      staleToken,
      ledger,
    ),
  ).rejects.toMatchObject({ code: "stale_candidate" });
  const fresh = await service.preview(scope, ledger);
  const freshToken = await authorize(fresh.action);
  await service.applyAuthorized(
    fresh.action,
    "synthetic-owner",
    freshToken,
    ledger,
  );
  await expect(read()).resolves.toMatchObject({ version: 1 });
  await expect(
    database.runTransaction(async (transaction) => {
      await invalidateWrappedForMatch(
        database,
        transaction,
        match.id,
        match.trackedTeamId,
      );
      throw new Error("synthetic rollback");
    }),
  ).rejects.toThrow("synthetic rollback");
  await expect(read()).resolves.toMatchObject({ version: 1 });

  await database.doc("coaches/coach").update({ displayName: "Reviewed coach" });
  const racing = await service.preview(scope, ledger);
  const racingToken = await authorize(racing.action);
  const window = new AdminVotingWindowService(database);
  const closesAt = new Date(Date.now() + 10 * 60 * 1000);
  const operations = await Promise.allSettled([
    service.applyAuthorized(
      racing.action,
      "synthetic-owner",
      racingToken,
      ledger,
    ),
    window.reopen(match.id, closesAt, true),
  ]);
  expect(operations[1].status).toBe("fulfilled");
  expect(await read()).toBeNull();
  await expect(service.preview(scope, ledger)).rejects.toMatchObject({
    code: "stale_candidate",
  });
  const retry = service.applyAuthorized(
    racing.action,
    "synthetic-owner",
    racingToken,
    ledger,
  );
  if (operations[0].status === "fulfilled") {
    await expect(retry).resolves.toMatchObject({
      disposition: "idempotent_retry",
    });
  } else {
    await expect(retry).rejects.toMatchObject({ code: "stale_candidate" });
  }
  const store = new AdminFootballSyncStore(database);
  await store.closeVotingWindowEarly(match.id);
  const regenerated = await service.preview(scope, ledger);
  expect(regenerated.action.digest).not.toBe(racing.action.digest);
  const committed = await service.applyAuthorized(
    regenerated.action,
    "synthetic-owner",
    await authorize(regenerated.action),
    ledger,
  );
  const expectedVersion = operations[0].status === "fulfilled" ? 3 : 2;
  expect(committed.receipt.version).toBe(expectedVersion);
  await expect(read()).resolves.toMatchObject({ version: expectedVersion });
  await expect(
    service.applyAuthorized(
      fresh.action,
      "synthetic-owner",
      freshToken,
      ledger,
    ),
  ).resolves.toMatchObject({ disposition: "idempotent_retry" });
  await expect(read()).resolves.toMatchObject({ version: expectedVersion });
  expect(
    (
      await database
        .doc(`matches/${match.id}/resultRevisions/reopen-0001`)
        .get()
    ).exists,
  ).toBe(true);
});

it("rejects conflicting canonical rows resolved through persisted aliases", async () => {
  const input = await seed("saprissa", "alias", "apertura");
  const match = input.matches[0];
  const legacy = providerEntityId("player", "api-football", "42");
  const batch = database.batch();
  batch.set(database.doc(`players/${legacy}`), {
    displayName: "Legacy player",
    externalProvider: "api-football",
    externalProviderId: "42",
  });
  batch.set(
    database.doc(
      `playerProviderAliases/${playerProviderAliasId("api-football", "42")}`,
    ),
    {
      externalProvider: "api-football",
      externalProviderPlayerId: "42",
      canonicalPlayerId: "player",
    },
  );
  const summary = wrappedSummary(match);
  summary.playerResults[legacy] = {
    ...summary.playerResults.player,
    playerId: legacy,
    order: 1,
  };
  summary.mvpPlayerIds.push(legacy);
  batch.set(database.doc(`matches/${match.id}/results/summary`), summary);
  await batch.commit();
  await expect(
    service.preview(input.scope, input.ledger),
  ).rejects.toMatchObject({ code: "duplicate_canonical_player" });
});
