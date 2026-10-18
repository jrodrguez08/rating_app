import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AdminLineupDraftParticipant } from "@/domain/models";
import { AdminConsoleService } from "@/lib/firebase/admin-console";
import { AdminLineupDraftService } from "@/lib/firebase/admin-lineup-draft";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `lineup-draft-${Date.now()}`);
const database = getFirestore(app);
const service = new AdminLineupDraftService(database);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});
afterAll(() => deleteApp(app));

describe("admin lineup draft persistence", () => {
  it("saves and reloads an incomplete non-authoritative draft", async () => {
    const input = await seed("draft-incomplete", 5);

    const result = await service.save(input);
    const detail = await new AdminConsoleService(database).detail(
      input.matchId,
      input.ownerId,
    );

    expect(result).toMatchObject({ version: 1, disposition: "committed" });
    expect(detail?.draft?.participants).toHaveLength(5);
    expect(
      await database.collection(`matches/${input.matchId}/participants`).get(),
    ).toMatchObject({ empty: true });
    const match = (await database.doc(`matches/${input.matchId}`).get()).data();
    expect(match?.ratingState).toBe("not_ready");
    expect(match).not.toHaveProperty("lineupSnapshotAt");
  });

  it("persists substitute participation states and supports safe resaves", async () => {
    const input = await seed("draft-resave", 12);
    input.participants[11] = {
      ...input.participants[11],
      participationStatus: "confirmed_substitute",
      enteredAtMinute: 67,
    };

    const first = await service.save(input);
    const retry = await service.save(input);
    const second = await service.save({
      ...input,
      baseVersion: first.version,
      participants: input.participants.slice(0, 11),
    });

    expect(retry).toMatchObject({
      version: 1,
      disposition: "idempotent_retry",
    });
    expect(second).toMatchObject({ version: 2, disposition: "committed" });
    await expect(
      service.save({ ...input, participants: input.participants.slice(0, 10) }),
    ).rejects.toThrow(/stale lineup draft version/i);
  });

  it("rejects duplicates, wrong-Team players, and immutable matches", async () => {
    const duplicate = await seed("draft-duplicate", 2);
    duplicate.participants[1] = { ...duplicate.participants[0] };
    await expect(service.save(duplicate)).rejects.toThrow(/invalid/i);

    const wrongTeam = await seed("draft-wrong-team", 1);
    await database.doc(`players/${wrongTeam.participants[0].playerId}`).update({
      currentTeamId: "opponent-team",
    });
    await expect(service.save(wrongTeam)).rejects.toThrow(/does not belong/i);

    const immutable = await seed("draft-immutable", 1);
    await database.doc(`matches/${immutable.matchId}`).update({
      ratingState: "rating_ready",
    });
    await expect(service.save(immutable)).rejects.toThrow(/not permitted/i);
  });

  it("accepts a transferred player only through durable Team membership", async () => {
    const input = await seed("draft-transferred", 1);
    const participant = input.participants[0];
    await database.doc(`players/${participant.playerId}`).update({
      currentTeamId: "new-team",
    });
    await database
      .doc(
        `teams/${input.trackedTeamId}/playerMemberships/${participant.playerId}`,
      )
      .set({
        playerId: participant.playerId,
        teamId: input.trackedTeamId,
        displayName: participant.playerName,
        searchName: "jugador 1",
        searchPrefixes: ["j", "ju", "jug"],
        source: "match_participant",
        sourceMatchId: "historical-match",
        firstObservedAt: Timestamp.now(),
        lastObservedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

    await expect(service.save(input)).resolves.toMatchObject({ version: 1 });
  });
});

async function seed(matchId: string, count: number) {
  const teamId = "club-sport-herediano";
  const ownerId = "owner-draft";
  const now = Timestamp.now();
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: teamId,
    externalProvider: "api-football",
    externalProviderFixtureId: `fixture-${matchId}`,
    kickoffAt: now,
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "900", name: "Rival" },
    status: "scheduled",
    ratingState: "not_ready",
    score: { home: null, away: null },
    createdAt: now,
    updatedAt: now,
  });
  const participants: AdminLineupDraftParticipant[] = Array.from(
    { length: count },
    (_, index) => ({
      playerId: `${matchId}-player-${index + 1}`,
      playerName: `Jugador ${index + 1}`,
      createInternalIdentity: false,
      squadRole: index < 11 ? "starter" : "substitute",
      participationStatus:
        index < 11 ? "confirmed_starter" : "unused_substitute",
    }),
  );
  const batch = database.batch();
  for (const participant of participants) {
    batch.set(database.doc(`players/${participant.playerId}`), {
      displayName: participant.playerName,
      currentTeamId: teamId,
      identityProvenance: "provider",
      createdAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
  return {
    matchId,
    trackedTeamId: teamId,
    externalFixtureId: `fixture-${matchId}`,
    ownerId,
    baseVersion: 0,
    participants,
  };
}
