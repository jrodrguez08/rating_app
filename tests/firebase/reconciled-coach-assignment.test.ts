import { randomBytes, scryptSync } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  coachWithSearchIndex,
  COACH_SEARCH_INDEX_VERSION,
} from "@/application/coach-search";
import { trackedMatchId } from "@/application/match-identity";
import { clubs } from "@/config/club";
import { proposedCoachProviderAlias } from "@/domain/coach-identity";
import { providerEntityId } from "@/domain/player-identity";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import { searchIndexedCoaches } from "@/lib/firebase/coach-search-index";
import {
  AdminVerifiedCoachService,
  type VerifiedCoachAssignmentInput,
} from "@/lib/firebase/server";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";

const app = initializeApp(
  { projectId: `demo-reconciled-coach-${Date.now()}` },
  `reconciled-coach-${Date.now()}`,
);
const database = getFirestore(app);
const service = new AdminVerifiedCoachService(database);
const security = new AdminSecurityStore(database);
const oldDigest = process.env.ADMIN_PASSPHRASE_SCRYPT;
const passphrase = "synthetic coach passphrase 174";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:"))
    throw new Error("Local emulator required.");
  const salt = randomBytes(16);
  const digest = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
  process.env.ADMIN_PASSPHRASE_SCRYPT = `scrypt$v1$16384$8$1$${salt.toString("base64")}$${digest.toString("base64")}`;
});
afterAll(async () => {
  if (oldDigest === undefined) delete process.env.ADMIN_PASSPHRASE_SCRYPT;
  else process.env.ADMIN_PASSPHRASE_SCRYPT = oldDigest;
  await deleteApp(app);
});

describe("reconciled canonical Coach assignment", () => {
  it.each([
    [{ verificationSource: "http://example.test" }, "COACH_INVALID_SOURCE"],
    [{ verificationReason: "short" }, "COACH_INVALID_REASON"],
    [{ coachId: "invalid/path" }, "COACH_INVALID_IDENTITY"],
    [{ externalProviderCoachId: "0" }, "COACH_PROVIDER_MISMATCH"],
    [{ externalFixtureId: "wrong-fixture" }, "COACH_INVALID_BINDING"],
  ])(
    "categorizes rejected assignment input %# without writing evidence",
    async (change, code) => {
      const input = await seed(`invalid-${code}`, `91742${code.length}`);
      await expect(
        service.assign({ ...input, ...change }, true),
      ).rejects.toMatchObject({ code });
      expect(
        (
          await database
            .doc(`matches/${input.matchId}/verifiedCoachAssignments/head-coach`)
            .get()
        ).exists,
      ).toBe(false);
    },
  );
  it("rejects a same-Coach effective assignment bound to another Team or Match", async () => {
    const input = await seed("wrong-existing-binding", "9174007");
    await database
      .doc(`matches/${input.matchId}/coachAssignments/head-coach`)
      .set({
        coachId: input.coachId,
        matchId: "wrong-match",
        teamId: clubs.saprissa.teamId,
        externalProviderTeamId: "816",
        role: "head-coach",
      });
    await expect(service.assign(input, true)).rejects.toMatchObject({
      code: "COACH_ASSIGNMENT_CONFLICT",
    });
  });
  it("searches, previews, authorizes and applies one global identity to independent Herediano and Saprissa Matches", async () => {
    const primary = await seed("shared", "9174001");
    await database.doc("coachSearchIndex/state").set({
      status: "complete",
      schemaVersion: COACH_SEARCH_INDEX_VERSION,
      blockingIssueCount: 0,
      auditedAt: Timestamp.now(),
    });
    const matchBefore = (
      await database.doc(`matches/${primary.matchId}`).get()
    ).data();
    const choices = await searchIndexedCoaches(
      database,
      primary.trackedTeamId,
      "team",
      "",
    );
    expect(
      choices.coaches.filter((c) => c.id === primary.coachId),
    ).toHaveLength(1);
    const bound = await preview(primary);
    const challenge = await authorize(bound);
    const results = await Promise.all([
      service.assignAuthorized(bound, challenge.token),
      service.assignAuthorized(bound, challenge.token),
    ]);
    expect(results.map((r) => r.disposition).sort()).toEqual([
      "committed",
      "idempotent_retry",
    ]);
    expect(
      (await database.doc(`matches/${primary.matchId}`).get()).data(),
    ).toEqual(matchBefore);
    const secondId = trackedMatchId(
      "api-football",
      primary.externalFixtureId,
      clubs.saprissa.teamId,
    );
    await seedMatch(secondId, clubs.saprissa.teamId, primary.externalFixtureId);
    expect(secondId).not.toBe(primary.matchId);
    await expect(
      service.assign(
        { ...primary, trackedTeamId: clubs.saprissa.teamId },
        false,
      ),
    ).rejects.toMatchObject({ code: "COACH_INVALID_BINDING" });
    expect(
      (
        await database
          .doc(`matches/${secondId}/coachAssignments/head-coach`)
          .get()
      ).exists,
    ).toBe(false);
    const secondary = await preview({
      ...primary,
      matchId: secondId,
      trackedTeamId: clubs.saprissa.teamId,
      operatorId: "owner-shared-saprissa",
    });
    const otherChallenge = await authorize(secondary);
    await service.assignAuthorized(secondary, otherChallenge.token);
    for (const input of [primary, secondary]) {
      expect(
        (
          await database
            .doc(`matches/${input.matchId}/verifiedCoachAssignments/head-coach`)
            .get()
        ).data(),
      ).toMatchObject({
        coachId: primary.coachId,
        trackedTeamId: input.trackedTeamId,
        externalFixtureId: primary.externalFixtureId,
      });
      expect(
        (
          await database
            .doc(`matches/${input.matchId}/coachAssignments/head-coach`)
            .get()
        ).data(),
      ).toMatchObject({
        coachId: primary.coachId,
        teamId: input.trackedTeamId,
        provenance: "operator_verified",
      });
    }
    expect(
      (
        await database
          .collection("coaches")
          .where("externalProviderId", "==", primary.externalProviderCoachId)
          .get()
      ).size,
    ).toBe(2); // Retained provider duplicate and canonical survivor only.
    // A committed retry recovers its immutable receipt even after later reconciliation changes.
    await aliasRef(primary).update({ updatedAt: "2040-01-01T00:00:00.000Z" });
    await expect(
      service.assignAuthorized(bound, challenge.token),
    ).resolves.toMatchObject({ disposition: "idempotent_retry" });
  });

  it.each(["before authorization", "after authorization"])(
    "rejects a changed alias %s without consuming the challenge or writing evidence",
    async (phase) => {
      const input = await seed(
        phase.replaceAll(" ", "-"),
        phase === "before authorization" ? "9174002" : "9174003",
      );
      const bound = await preview(input);
      let challenge;
      if (phase === "after authorization") challenge = await authorize(bound);
      await aliasRef(input).update({ updatedAt: "2040-01-01T00:00:00.000Z" });
      challenge ??= await authorize(bound);
      await expect(
        service.assignAuthorized(bound, challenge.token),
      ).rejects.toMatchObject({ code: "COACH_RECONCILIATION_STALE" });
      expect(
        (
          await database
            .doc(
              `adminActionChallenges/${adminChallengeDocumentId(challenge.token)}`,
            )
            .get()
        ).data(),
      ).not.toHaveProperty("consumedAt");
      expect(
        (
          await database
            .doc(`matches/${input.matchId}/verifiedCoachAssignments/head-coach`)
            .get()
        ).exists,
      ).toBe(false);
    },
  );

  it.each([
    ["missing", "COACH_ALIAS_MISSING"],
    ["target", "COACH_ALIAS_CONFLICT"],
    ["provider", "COACH_ALIAS_CONFLICT"],
    ["external", "COACH_ALIAS_CONFLICT"],
    ["missing-coach", "COACH_INVALID_IDENTITY"],
    ["incompatible-coach", "COACH_PROVIDER_MISMATCH"],
  ])("rejects %s identity evidence", async (kind, code) => {
    const input = await seed(kind, `91741${kind.length}`);
    if (kind === "missing") await aliasRef(input).delete();
    if (kind === "target")
      await aliasRef(input).update({ canonicalCoachId: "other-coach" });
    if (kind === "provider")
      await aliasRef(input).update({ externalProvider: "other-provider" });
    if (kind === "external")
      await aliasRef(input).update({ externalProviderCoachId: "999" });
    if (kind === "missing-coach")
      await database.doc(`coaches/${input.coachId}`).delete();
    if (kind === "incompatible-coach")
      await database
        .doc(`coaches/${input.coachId}`)
        .update({ externalProviderId: "999" });
    await expect(service.assign(input, true)).rejects.toMatchObject({ code });
    expect(
      (
        await database
          .doc(`matches/${input.matchId}/coachAssignments/head-coach`)
          .get()
      ).exists,
    ).toBe(false);
  });

  it("keeps original provider identity and manual identity paths, and never invents an alias", async () => {
    const input = await seed("original", "9174004");
    await aliasRef(input).delete();
    const original = {
      ...input,
      coachId: providerEntityId("coach", "api-football", "9174004"),
    };
    await expect(service.assign(original, false)).resolves.toMatchObject({
      coachId: original.coachId,
      coachCreated: false,
    });
    const bound = await preview(original);
    const challenge = await authorize(bound);
    await service.assignAuthorized(bound, challenge.token);
    expect((await aliasRef(input).get()).exists).toBe(false);
    const manual = await seed("manual", "9174005");
    await aliasRef(manual).delete();
    // Explicit internal-only Coach, with no provider fields.
    await database.doc(`coaches/${manual.coachId}`).set({
      displayName: manual.coachName,
      identityProvenance: "operator_verified",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    delete manual.externalProviderCoachId;
    const manualBound = await preview(manual);
    const manualChallenge = await authorize(manualBound);
    await expect(
      service.assignAuthorized(manualBound, manualChallenge.token),
    ).resolves.toMatchObject({ disposition: "committed" });
  });

  it("serializes incompatible concurrent assignment attempts", async () => {
    const input = await seed("competing", "9174006");
    const alternative = {
      ...input,
      coachId: "manual-alternative",
      externalProviderCoachId: undefined,
      operatorId: "owner-alternative",
    };
    const first = await preview(input);
    const second = await preview(alternative);
    const [a, b] = await Promise.all([authorize(first), authorize(second)]);
    const results = await Promise.allSettled([
      service.assignAuthorized(first, a.token),
      service.assignAuthorized(second, b.token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "COACH_ASSIGNMENT_CONFLICT" },
    });
  });
});

async function preview(input: VerifiedCoachAssignmentInput) {
  const plan = await service.assign(input, false);
  return { ...input, coachIdentityVersion: plan.coachIdentityVersion };
}
async function authorize(input: VerifiedCoachAssignmentInput) {
  const token = await security.issuePreview(input.operatorId, input);
  return security.authorizeAction({
    operatorUid: input.operatorId,
    action: input,
    previewToken: token.token,
    passphrase,
  });
}
function aliasRef(input: VerifiedCoachAssignmentInput) {
  const alias = proposedCoachProviderAlias(
    "api-football",
    input.externalProviderCoachId!,
    "",
  );
  return database.doc(`coachProviderAliases/${alias.id}`);
}
async function seed(
  suffix: string,
  externalId: string,
): Promise<VerifiedCoachAssignmentInput> {
  const fixtureId = `fixture-${suffix}`;
  const matchId = trackedMatchId(
    "api-football",
    fixtureId,
    clubs.herediano.teamId,
  );
  await seedMatch(matchId, clubs.herediano.teamId, fixtureId);
  const coachId = `manual-${suffix}`;
  const now = new Date().toISOString();
  const coach = {
    id: coachId,
    displayName: "Director Sintético",
    externalProvider: "api-football",
    externalProviderId: externalId,
    identityProvenance: "operator_verified" as const,
    createdAt: now,
    updatedAt: now,
  };
  await database
    .doc(`coaches/${coachId}`)
    .set(coachWithSearchIndex(coach, [clubs.herediano.teamId]));
  const providerId = providerEntityId("coach", "api-football", externalId);
  await database
    .doc(`coaches/${providerId}`)
    .set({ ...coach, id: providerId, identityProvenance: "provider" });
  const alias = proposedCoachProviderAlias(
    "api-football",
    externalId,
    now,
    coachId,
  );
  await database.doc(`coachProviderAliases/${alias.id}`).set(alias);
  return {
    matchId,
    trackedTeamId: clubs.herediano.teamId,
    externalFixtureId: fixtureId,
    coachId,
    coachName: coach.displayName,
    externalProviderCoachId: externalId,
    verificationSource: "authenticated-owner",
    verificationReason: "Independent synthetic fixture verification.",
    operatorId: `owner-${suffix}`,
  };
}
async function seedMatch(matchId: string, teamId: string, fixtureId: string) {
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: teamId,
    trackedTeamExternalProviderId:
      teamId === clubs.herediano.teamId ? "815" : "816",
    externalProvider: "api-football",
    externalProviderFixtureId: fixtureId,
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "816", name: "Saprissa" },
    status: "live",
    ratingState: "preparing_rating",
    kickoffAt: Timestamp.now(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}
