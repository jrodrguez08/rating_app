import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";

import {
  coachWithSearchIndex,
  COACH_SEARCH_INDEX_VERSION,
} from "@/application/coach-search";
import { mergeTeamPlayerMembership } from "@/application/team-player-membership";
import { coachProviderAliasId } from "@/domain/coach-identity";
import type {
  Coach,
  CoachProviderAlias,
  Player,
  PlayerProviderAlias,
  Team,
  TeamPlayerMembership,
} from "@/domain/models";
import {
  mergePlayerForProviderSync,
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";
import {
  normalizePlayerSearch,
  playerSearchPrefixes,
} from "@/domain/player-search";
import type {
  FootballDataProvider,
  ProviderFixtureCatalog,
  ProviderSquadPlayer,
} from "@/domain/ports";
import {
  adminCatalogAuditId,
  hashAdminCatalogAction,
  type AdminCatalogImportAction,
} from "@/lib/server/admin-catalog-action";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";

import { getServerFirestore } from "./server";

const PREVIEW_COOLDOWN_MS = 60_000;
const MAX_ACTION_AGE_MS = 7 * 60_000;
const MAX_WRITES = 250;

export class AdminCatalogImportRejectedError extends Error {
  constructor(
    public readonly code:
      | "invalid_input"
      | "index_incomplete"
      | "rate_limited"
      | "provider_unavailable"
      | "empty"
      | "stale"
      | "conflict"
      | "write_limit"
      | "authorization",
    message: string,
  ) {
    super(message);
    this.name = "AdminCatalogImportRejectedError";
  }
}

export interface AdminCatalogImportPlan {
  clubName: string;
  fixtures: AdminCatalogImportAction["fixtures"];
  playerCount: number;
  coachCount: number;
  newPlayers: number;
  existingPlayers: number;
  newCoaches: number;
  existingCoaches: number;
  players: Array<{
    name: string;
    status: "new" | "existing";
    sourceFixtureIds: string[];
    currentPosition?: Player["position"];
    proposedPosition?: Player["position"];
    positionSource?: "lineup" | "squad";
    positionGap?: "missing" | "conflict";
    positionConflict: boolean;
  }>;
  coaches: Array<{
    name: string;
    status: "new" | "existing";
    sourceFixtureIds: string[];
  }>;
  membershipChanges: number;
  coachAssociationChanges: number;
  metadataChanges: number;
  positionFills: number;
  positionGaps: number;
  squadPlayers: number;
  excludedPlayers: number;
  unresolvedCoaches: number;
  proposedWrites: number;
  providerRequests: number;
  previewDocumentReads: number;
  observedAt: string;
  canApply: boolean;
}

interface PlannedWrite {
  reference: DocumentReference;
  value: object;
}

interface ReadState {
  references: DocumentReference[];
  snapshots: DocumentSnapshot[];
  byPath: Map<string, DocumentSnapshot>;
  hash: string;
}

export class AdminCatalogImportService {
  constructor(private readonly database: Firestore = getServerFirestore()) {}

  async preview(
    teamId: string,
    operatorUid: string,
    provider: FootballDataProvider,
  ): Promise<{
    action: AdminCatalogImportAction;
    plan: AdminCatalogImportPlan;
  }> {
    const team = await this.loadTeam(teamId);
    await this.requireIndexes(teamId);
    await this.claimPreview(operatorUid, teamId);
    if (!provider.getRecentFixtureCatalog || provider.name !== "api-football") {
      throw new AdminCatalogImportRejectedError(
        "provider_unavailable",
        "El proveedor no permite consultar este catálogo.",
      );
    }
    const observedAt = new Date().toISOString();
    const fixtures = await provider.getRecentFixtureCatalog(
      team.externalProviderId!,
      observedAt,
    );
    if (provider.requestCount > 7)
      throw new AdminCatalogImportRejectedError(
        "provider_unavailable",
        "La consulta superó el límite de solicitudes al proveedor.",
      );
    const squad = fixtures.some((fixture) => fixture.players.length)
      ? await provider.getSquad(team.externalProviderId!, "catalog")
      : [];
    if (squad.length > 100)
      throw new AdminCatalogImportRejectedError(
        "provider_unavailable",
        "El plantel supera el límite seguro de consulta.",
      );
    if (provider.requestCount > 8) {
      throw new AdminCatalogImportRejectedError(
        "provider_unavailable",
        "La consulta superó el límite de solicitudes al proveedor.",
      );
    }
    const candidates = await this.canonicalize(fixtures, squad);
    const actionWithoutHash = {
      trackedTeamId: teamId,
      externalTeamId: team.externalProviderId!,
      observedAt,
      providerRequests: provider.requestCount,
      fixtures: fixtures.map(
        ({
          fixture,
          competitionName,
          lineupStatus,
          excludedPlayerCount,
          coach,
        }) => ({
          id: fixture.externalFixtureId,
          kickoffAt: fixture.kickoffAt,
          competitionName,
          lineupStatus,
          excludedPlayerCount,
          coachStatus:
            coach.status === "resolved" ? ("resolved" as const) : coach.reason,
        }),
      ),
      players: candidates.players,
      coaches: candidates.coaches,
      squadPlayers: squad.length,
    };
    if (
      actionWithoutHash.players.length > 100 ||
      actionWithoutHash.coaches.length > 10
    ) {
      throw new AdminCatalogImportRejectedError(
        "write_limit",
        "El catálogo supera el límite seguro de importación.",
      );
    }
    const provisional: AdminCatalogImportAction = {
      ...actionWithoutHash,
      stateHash: "0".repeat(64),
    };
    const state = await this.readState(provisional);
    const action = { ...provisional, stateHash: state.hash };
    const { plan } = this.plan(action, state, team);
    return { action, plan };
  }

  async applyAuthorized(
    action: AdminCatalogImportAction,
    operatorUid: string,
    challengeToken: string | undefined,
  ): Promise<{
    auditId: string;
    plan: AdminCatalogImportPlan;
    disposition: "applied" | "idempotent_retry";
  }> {
    if (!challengeToken || challengeToken.length > 256) {
      throw new AdminCatalogImportRejectedError(
        "authorization",
        "La autorización de importación no es válida.",
      );
    }
    const challengeId = adminChallengeDocumentId(challengeToken);
    const auditId = adminCatalogAuditId(challengeId);
    const challengeRef = this.database.doc(
      `adminActionChallenges/${challengeId}`,
    );
    const auditRef = this.database.doc(`adminAudit/${auditId}`);
    return this.database.runTransaction(async (transaction) => {
      const challengeSnapshot = await transaction.get(challengeRef);
      const challenge = challengeSnapshot.data();
      if (
        !challengeSnapshot.exists ||
        challenge?.operatorUid !== operatorUid ||
        challenge.resourceId !== action.trackedTeamId ||
        challenge.actionHash !== hashAdminCatalogAction(action) ||
        !(challenge.expiresAt instanceof Timestamp)
      ) {
        throw new AdminCatalogImportRejectedError(
          "authorization",
          "La autorización de importación no es válida.",
        );
      }
      if (challenge.consumedAt !== undefined) {
        const receipt = await transaction.get(auditRef);
        const data = receipt.data();
        if (
          challenge.committedAuditId !== auditId ||
          !receipt.exists ||
          data?.operatorUid !== operatorUid ||
          data.action !== "catalog_import_apply" ||
          data.actionHash !== hashAdminCatalogAction(action) ||
          data.outcome !== "success" ||
          !data.plan
        ) {
          throw new AdminCatalogImportRejectedError(
            "authorization",
            "El recibo de importación no es válido.",
          );
        }
        return {
          auditId,
          plan: data.plan as AdminCatalogImportPlan,
          disposition: "idempotent_retry" as const,
        };
      }
      if (
        challenge.expiresAt.toMillis() <=
          challengeSnapshot.readTime.toMillis() ||
        challenge.committedAuditId !== undefined
      ) {
        throw new AdminCatalogImportRejectedError(
          "authorization",
          "La autorización de importación venció.",
        );
      }
      const now = challengeSnapshot.readTime.toDate();
      if (
        now.getTime() - Date.parse(action.observedAt) > MAX_ACTION_AGE_MS ||
        Date.parse(action.observedAt) > now.getTime() + 30_000
      ) {
        throw new AdminCatalogImportRejectedError(
          "stale",
          "La vista previa venció. Consulte de nuevo el catálogo.",
        );
      }
      const state = await this.readState(action, transaction);
      if (state.hash !== action.stateHash) {
        throw new AdminCatalogImportRejectedError(
          "stale",
          "Las identidades cambiaron. Consulte de nuevo el catálogo.",
        );
      }
      const team = this.teamFromState(state, action);
      this.validateIndexesFromState(state, action.trackedTeamId);
      const { plan, writes } = this.plan(action, state, team);
      if (!plan.canApply)
        throw new AdminCatalogImportRejectedError(
          "empty",
          "No hay identidades para importar.",
        );
      if (writes.length + 2 > MAX_WRITES) {
        throw new AdminCatalogImportRejectedError(
          "write_limit",
          "El catálogo supera el límite seguro de escrituras.",
        );
      }
      for (const write of writes)
        transaction.set(write.reference, toDocument(write.value));
      transaction.update(challengeRef, {
        consumedAt: Timestamp.fromDate(now),
        committedAuditId: auditId,
      });
      transaction.create(auditRef, {
        operatorUid,
        action: "catalog_import_apply",
        resourceId: action.trackedTeamId,
        actionHash: hashAdminCatalogAction(action),
        outcome: "success",
        plan,
        createdAt: Timestamp.fromDate(now),
      });
      return { auditId, plan, disposition: "applied" as const };
    });
  }

  private async loadTeam(teamId: string): Promise<Team> {
    const snapshot = await this.database.doc(`teams/${teamId}`).get();
    const team = snapshot.exists ? fromSnapshot<Team>(snapshot) : undefined;
    if (!team?.externalProviderId || !/^\d+$/.test(team.externalProviderId)) {
      throw new AdminCatalogImportRejectedError(
        "invalid_input",
        "El club no tiene una identidad válida de API-Football.",
      );
    }
    return team;
  }

  private async requireIndexes(teamId: string): Promise<void> {
    const [player, coach] = await Promise.all([
      this.database.doc(`teams/${teamId}/playerMembershipIndex/state`).get(),
      this.database.doc("coachSearchIndex/state").get(),
    ]);
    if (
      player.data()?.status !== "complete" ||
      player.data()?.teamId !== teamId ||
      player.data()?.schemaVersion !== 1 ||
      player.data()?.blockingIssueCount !== 0 ||
      coach.data()?.status !== "complete" ||
      coach.data()?.schemaVersion !== COACH_SEARCH_INDEX_VERSION ||
      coach.data()?.blockingIssueCount !== 0
    ) {
      throw new AdminCatalogImportRejectedError(
        "index_incomplete",
        "Complete los índices de jugadores y directores técnicos antes de importar.",
      );
    }
  }

  private async claimPreview(
    operatorUid: string,
    teamId: string,
  ): Promise<void> {
    const reference = this.database.doc(`adminSecurity/${operatorUid}`);
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const now = snapshot.readTime.toMillis();
      const prior = snapshot.data()?.catalogPreviewAt;
      const priorTeam = snapshot.data()?.catalogPreviewTeamId;
      if (
        prior instanceof Timestamp &&
        priorTeam === teamId &&
        now - prior.toMillis() < PREVIEW_COOLDOWN_MS
      ) {
        throw new AdminCatalogImportRejectedError(
          "rate_limited",
          "Espere un minuto antes de consultar el catálogo otra vez.",
        );
      }
      transaction.set(
        reference,
        {
          catalogPreviewAt: Timestamp.fromMillis(now),
          catalogPreviewTeamId: teamId,
        },
        { merge: true },
      );
    });
  }

  private async canonicalize(
    fixtures: ProviderFixtureCatalog[],
    squad: ProviderSquadPlayer[],
  ): Promise<Pick<AdminCatalogImportAction, "players" | "coaches">> {
    const playerObservations = new Map<
      string,
      {
        name: string;
        positions: Set<NonNullable<Player["position"]>>;
        fixtures: Set<string>;
      }
    >();
    const coachObservations = new Map<
      string,
      { name: string; photoUrl?: string; fixtures: Set<string> }
    >();
    for (const source of fixtures) {
      for (const player of source.players) {
        const entry = playerObservations.get(player.externalPlayerId);
        if (entry) {
          entry.fixtures.add(source.fixture.externalFixtureId);
          if (player.name.localeCompare(entry.name) < 0)
            entry.name = player.name;
          if (player.position) entry.positions.add(player.position);
        } else
          playerObservations.set(player.externalPlayerId, {
            name: player.name,
            positions: new Set(player.position ? [player.position] : []),
            fixtures: new Set([source.fixture.externalFixtureId]),
          });
      }
      if (source.coach.status === "resolved") {
        const coach = source.coach.value;
        const entry = coachObservations.get(coach.externalCoachId);
        if (entry) entry.fixtures.add(source.fixture.externalFixtureId);
        else
          coachObservations.set(coach.externalCoachId, {
            name: coach.name,
            photoUrl: coach.photoUrl,
            fixtures: new Set([source.fixture.externalFixtureId]),
          });
      }
    }
    const playerIds = [...playerObservations.keys()];
    const squadIds = [
      ...new Set(squad.map((player) => player.externalPlayerId)),
    ].sort();
    const coachIds = [...coachObservations.keys()];
    const aliasReferences = [
      ...playerIds.map((id) =>
        this.database.doc(
          `playerProviderAliases/${playerProviderAliasId("api-football", id)}`,
        ),
      ),
      ...squadIds.map((id) =>
        this.database.doc(
          `playerProviderAliases/${playerProviderAliasId("api-football", id)}`,
        ),
      ),
      ...coachIds.map((id) =>
        this.database.doc(
          `coachProviderAliases/${coachProviderAliasId("api-football", id)}`,
        ),
      ),
    ];
    const aliases = aliasReferences.length
      ? await this.database.getAll(...aliasReferences)
      : [];
    const players = new Map<
      string,
      AdminCatalogImportAction["players"][number]
    >();
    const lineupPositions = new Map<
      string,
      Set<NonNullable<Player["position"]>>
    >();
    const squadPositions = new Map<
      string,
      Set<NonNullable<Player["position"]>>
    >();
    playerIds.forEach((externalId, index) => {
      const alias = aliases[index].exists
        ? fromSnapshot<PlayerProviderAlias>(aliases[index])
        : undefined;
      if (
        alias &&
        (alias.externalProvider !== "api-football" ||
          alias.externalProviderPlayerId !== externalId ||
          !validCatalogId(alias.canonicalPlayerId) ||
          !validProviderPlayerId(alias.canonicalExternalProviderPlayerId))
      ) {
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "Una identidad de jugador tiene una asociación incompatible.",
        );
      }
      const id =
        alias?.canonicalPlayerId ??
        providerEntityId("player", "api-football", externalId);
      const canonicalExternalId =
        alias?.canonicalExternalProviderPlayerId ?? externalId;
      const observed = playerObservations.get(externalId)!;
      const previous = players.get(id);
      const lineup = lineupPositions.get(id) ?? new Set();
      for (const position of observed.positions) lineup.add(position);
      lineupPositions.set(id, lineup);
      if (previous && previous.canonicalExternalId !== canonicalExternalId) {
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "Las asociaciones revisadas del jugador discrepan sobre su identidad canónica.",
        );
      }
      const preferredObservation =
        previous && previous.observedExternalIds[0] < externalId
          ? previous
          : observed;
      players.set(id, {
        id,
        canonicalExternalId,
        observedExternalIds: [
          ...new Set([...(previous?.observedExternalIds ?? []), externalId]),
        ].sort(),
        name: preferredObservation.name,
        squadExternalIds: previous?.squadExternalIds ?? [],
        positionConflict: false,
        sourceFixtureIds: [
          ...new Set([
            ...(previous?.sourceFixtureIds ?? []),
            ...observed.fixtures,
          ]),
        ].sort(),
      });
    });
    squad.forEach((source) => {
      const aliasSnapshot =
        aliases[playerIds.length + squadIds.indexOf(source.externalPlayerId)];
      const alias = aliasSnapshot.exists
        ? fromSnapshot<PlayerProviderAlias>(aliasSnapshot)
        : undefined;
      const id =
        alias?.canonicalPlayerId ??
        providerEntityId("player", "api-football", source.externalPlayerId);
      const candidate = players.get(id);
      if (!candidate) return;
      if (
        alias &&
        (alias.externalProvider !== "api-football" ||
          alias.externalProviderPlayerId !== source.externalPlayerId ||
          !validCatalogId(alias.canonicalPlayerId) ||
          !validProviderPlayerId(alias.canonicalExternalProviderPlayerId))
      )
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "Una identidad del plantel tiene una asociación incompatible.",
        );
      if (
        alias?.canonicalExternalProviderPlayerId &&
        alias.canonicalExternalProviderPlayerId !==
          candidate.canonicalExternalId
      )
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "El plantel discrepa sobre la identidad canónica del jugador.",
        );
      candidate.squadExternalIds.push(source.externalPlayerId);
      if (source.position) {
        const positions = squadPositions.get(id) ?? new Set();
        positions.add(source.position);
        squadPositions.set(id, positions);
      }
    });
    for (const [id, candidate] of players) {
      candidate.squadExternalIds.sort();
      const lineup = lineupPositions.get(id) ?? new Set();
      const squadValue = squadPositions.get(id) ?? new Set();
      if (
        lineup.size > 1 ||
        squadValue.size > 1 ||
        (lineup.size === 1 &&
          squadValue.size === 1 &&
          [...lineup][0] !== [...squadValue][0])
      ) {
        candidate.positionConflict = true;
      } else if (lineup.size === 1) {
        candidate.position = [...lineup][0];
        candidate.positionSource = "lineup";
      } else if (squadValue.size === 1) {
        candidate.position = [...squadValue][0];
        candidate.positionSource = "squad";
      }
    }
    const coaches = new Map<
      string,
      AdminCatalogImportAction["coaches"][number]
    >();
    coachIds.forEach((externalId, index) => {
      const alias = aliases[playerIds.length + squadIds.length + index].exists
        ? fromSnapshot<CoachProviderAlias>(
            aliases[playerIds.length + squadIds.length + index],
          )
        : undefined;
      if (
        alias &&
        (alias.externalProvider !== "api-football" ||
          alias.externalProviderCoachId !== externalId)
      ) {
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "Una identidad de director técnico tiene una asociación incompatible.",
        );
      }
      const id =
        alias?.canonicalCoachId ??
        providerEntityId("coach", "api-football", externalId);
      const observed = coachObservations.get(externalId)!;
      const previous = coaches.get(id);
      coaches.set(id, {
        id,
        externalId: previous?.externalId ?? externalId,
        observedExternalIds: [
          ...new Set([...(previous?.observedExternalIds ?? []), externalId]),
        ].sort(),
        name: previous?.name ?? observed.name,
        ...((previous?.photoUrl ?? observed.photoUrl)
          ? { photoUrl: previous?.photoUrl ?? observed.photoUrl }
          : {}),
        sourceFixtureIds: [
          ...new Set([
            ...(previous?.sourceFixtureIds ?? []),
            ...observed.fixtures,
          ]),
        ].sort(),
      });
    });
    return {
      players: [...players.values()].sort((first, second) =>
        first.id.localeCompare(second.id),
      ),
      coaches: [...coaches.values()],
    };
  }

  private stateReferences(
    action: AdminCatalogImportAction,
  ): DocumentReference[] {
    const references = [
      this.database.doc(`teams/${action.trackedTeamId}`),
      this.database.doc(
        `teams/${action.trackedTeamId}/playerMembershipIndex/state`,
      ),
      this.database.doc("coachSearchIndex/state"),
      ...action.players.flatMap(
        ({ id, observedExternalIds, squadExternalIds }) => [
          ...[...new Set([...observedExternalIds, ...squadExternalIds])].map(
            (externalId) =>
              this.database.doc(
                `playerProviderAliases/${playerProviderAliasId("api-football", externalId)}`,
              ),
          ),
          this.database.doc(`players/${id}`),
          this.database.doc(
            `teams/${action.trackedTeamId}/playerMemberships/${id}`,
          ),
        ],
      ),
      ...action.coaches.flatMap(({ id, observedExternalIds }) => [
        ...observedExternalIds.map((externalId) =>
          this.database.doc(
            `coachProviderAliases/${coachProviderAliasId("api-football", externalId)}`,
          ),
        ),
        this.database.doc(`coaches/${id}`),
      ]),
    ];
    for (const player of action.players) {
      references.push(
        this.database.doc(
          `playerProviderAliases/${playerProviderAliasId("api-football", player.canonicalExternalId)}`,
        ),
      );
    }
    return [
      ...new Map(
        references.map((reference) => [reference.path, reference]),
      ).values(),
    ];
  }

  private async readState(
    action: AdminCatalogImportAction,
    transaction?: Transaction,
  ): Promise<ReadState> {
    const references = this.stateReferences(action);
    const snapshots = transaction
      ? await transaction.getAll(...references)
      : await this.database.getAll(...references);
    const hash = createHash("sha256")
      .update(
        JSON.stringify(
          snapshots.map((snapshot) => [
            snapshot.ref.path,
            snapshot.data() ?? null,
          ]),
        ),
      )
      .digest("hex");
    return {
      references,
      snapshots,
      hash,
      byPath: new Map(
        snapshots.map((snapshot) => [snapshot.ref.path, snapshot]),
      ),
    };
  }

  private teamFromState(
    state: ReadState,
    action: AdminCatalogImportAction,
  ): Team {
    const snapshot = state.byPath.get(`teams/${action.trackedTeamId}`);
    if (!snapshot?.exists)
      throw new AdminCatalogImportRejectedError(
        "stale",
        "El club ya no está disponible.",
      );
    const team = fromSnapshot<Team>(snapshot);
    if (team.externalProviderId !== action.externalTeamId) {
      throw new AdminCatalogImportRejectedError(
        "conflict",
        "La identidad del club cambió.",
      );
    }
    return team;
  }

  private validateIndexesFromState(state: ReadState, teamId: string): void {
    const player = state.byPath
      .get(`teams/${teamId}/playerMembershipIndex/state`)
      ?.data();
    const coach = state.byPath.get("coachSearchIndex/state")?.data();
    if (
      player?.status !== "complete" ||
      player.teamId !== teamId ||
      player.schemaVersion !== 1 ||
      player.blockingIssueCount !== 0 ||
      coach?.status !== "complete" ||
      coach.schemaVersion !== COACH_SEARCH_INDEX_VERSION ||
      coach.blockingIssueCount !== 0
    ) {
      throw new AdminCatalogImportRejectedError(
        "index_incomplete",
        "Los índices de búsqueda ya no están completos.",
      );
    }
  }

  private plan(
    action: AdminCatalogImportAction,
    state: ReadState,
    team: Team,
  ): { plan: AdminCatalogImportPlan; writes: PlannedWrite[] } {
    this.teamFromState(state, action);
    this.validateIndexesFromState(state, action.trackedTeamId);
    const writes: PlannedWrite[] = [];
    let newPlayers = 0,
      newCoaches = 0,
      membershipChanges = 0,
      coachAssociationChanges = 0,
      metadataChanges = 0,
      positionFills = 0,
      positionGaps = 0;
    const players: AdminCatalogImportPlan["players"] = [];
    const coaches: AdminCatalogImportPlan["coaches"] = [];
    for (const candidate of action.players) {
      const aliases = candidate.observedExternalIds.map((externalId) =>
        state.byPath.get(
          `playerProviderAliases/${playerProviderAliasId("api-football", externalId)}`,
        ),
      );
      if (
        aliases.some((snapshot, index) =>
          snapshot?.exists
            ? !matchesPlayerCatalogAlias(
                fromSnapshot<PlayerProviderAlias>(snapshot),
                candidate.observedExternalIds[index],
                candidate.id,
                candidate.canonicalExternalId,
              )
            : providerEntityId(
                "player",
                "api-football",
                candidate.observedExternalIds[index],
              ) !== candidate.id ||
              candidate.observedExternalIds[index] !==
                candidate.canonicalExternalId,
        )
      ) {
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "Una identidad de jugador cambió de asociación.",
        );
      }
      for (const externalId of candidate.squadExternalIds) {
        const snapshot = state.byPath.get(
          `playerProviderAliases/${playerProviderAliasId("api-football", externalId)}`,
        );
        if (
          snapshot?.exists
            ? !matchesPlayerCatalogAlias(
                fromSnapshot<PlayerProviderAlias>(snapshot),
                externalId,
                candidate.id,
                candidate.canonicalExternalId,
              )
            : providerEntityId("player", "api-football", externalId) !==
                candidate.id || externalId !== candidate.canonicalExternalId
        )
          throw new AdminCatalogImportRejectedError(
            "conflict",
            "La asociación del plantel cambió.",
          );
      }
      const playerRef = this.database.doc(`players/${candidate.id}`);
      const membershipRef = this.database.doc(
        `teams/${action.trackedTeamId}/playerMemberships/${candidate.id}`,
      );
      const existing = state.byPath.get(playerRef.path);
      const existingPlayer = existing?.exists
        ? fromSnapshot<Player>(existing)
        : undefined;
      const proposedPosition = existingPlayer?.position
        ? undefined
        : candidate.position;
      if (proposedPosition) positionFills += 1;
      else if (!existingPlayer?.position) positionGaps += 1;
      players.push({
        name: existingPlayer?.displayName ?? candidate.name,
        status: existingPlayer ? "existing" : "new",
        sourceFixtureIds: candidate.sourceFixtureIds,
        ...(existingPlayer?.position
          ? { currentPosition: existingPlayer.position }
          : {}),
        positionConflict: candidate.positionConflict,
        ...(proposedPosition
          ? { proposedPosition, positionSource: candidate.positionSource }
          : {}),
        ...(!existingPlayer?.position && !proposedPosition
          ? {
              positionGap: candidate.positionConflict
                ? ("conflict" as const)
                : ("missing" as const),
            }
          : {}),
      });
      if (aliases.some((alias) => alias?.exists) && !existingPlayer)
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "Falta el jugador canónico de una asociación revisada.",
        );
      const canonicalAlias = state.byPath.get(
        `playerProviderAliases/${playerProviderAliasId("api-football", candidate.canonicalExternalId)}`,
      );
      if (
        canonicalAlias?.exists &&
        !matchesPlayerCatalogAlias(
          fromSnapshot<PlayerProviderAlias>(canonicalAlias),
          candidate.canonicalExternalId,
          candidate.id,
          candidate.canonicalExternalId,
        )
      ) {
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "La identidad canónica del jugador tiene una asociación posterior incompatible.",
        );
      }
      if (
        existingPlayer &&
        ((existingPlayer.externalProvider &&
          existingPlayer.externalProvider !== "api-football") ||
          (existingPlayer.externalProviderId &&
            existingPlayer.externalProviderId !==
              candidate.canonicalExternalId))
      ) {
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "La identidad de proveedor del jugador canónico no coincide con la asociación revisada.",
        );
      }
      const incoming: Player = {
        id: candidate.id,
        displayName: candidate.name,
        identityProvenance: "provider",
        externalProvider: "api-football",
        externalProviderId: candidate.canonicalExternalId,
        ...(candidate.position ? { position: candidate.position } : {}),
        createdAt: action.observedAt,
        updatedAt: action.observedAt,
      };
      const player =
        existingPlayer?.identityProvenance === "operator_verified"
          ? proposedPosition
            ? {
                ...existingPlayer,
                position: proposedPosition,
                updatedAt: action.observedAt,
              }
            : existingPlayer
          : mergePlayerForProviderSync(existingPlayer, {
              ...incoming,
              ...(existingPlayer?.displayName
                ? { displayName: existingPlayer.displayName }
                : {}),
              ...(existingPlayer?.currentTeamId
                ? { currentTeamId: existingPlayer.currentTeamId }
                : {}),
              ...(existingPlayer?.position
                ? { position: existingPlayer.position }
                : {}),
              ...(existingPlayer?.photoUrl
                ? { photoUrl: existingPlayer.photoUrl }
                : {}),
            });
      if (!existingPlayer) newPlayers += 1;
      if (!existingPlayer || !sameIgnoringUpdate(existingPlayer, player)) {
        writes.push({ reference: playerRef, value: player });
        if (existingPlayer) metadataChanges += 1;
      }
      const membershipSnapshot = state.byPath.get(membershipRef.path);
      const existingMembership = membershipSnapshot?.exists
        ? fromSnapshot<TeamPlayerMembership>(membershipSnapshot)
        : undefined;
      const incomingMembership: TeamPlayerMembership = {
        playerId: candidate.id,
        teamId: action.trackedTeamId,
        displayName: player.displayName,
        searchName: normalizePlayerSearch(player.displayName),
        searchPrefixes: playerSearchPrefixes(player.displayName),
        source: "fixture_catalog",
        sourceFixtureIds: candidate.sourceFixtureIds,
        firstObservedAt: action.observedAt,
        lastObservedAt: action.observedAt,
        createdAt: action.observedAt,
        updatedAt: action.observedAt,
      };
      const membership = mergeTeamPlayerMembership(
        existingMembership,
        incomingMembership,
      );
      if (
        !existingMembership ||
        !sameIgnoringUpdate(existingMembership, membership)
      ) {
        writes.push({ reference: membershipRef, value: membership });
        membershipChanges += 1;
      }
    }
    for (const candidate of action.coaches) {
      const aliases = candidate.observedExternalIds.map((externalId) =>
        state.byPath.get(
          `coachProviderAliases/${coachProviderAliasId("api-football", externalId)}`,
        ),
      );
      if (
        aliases.some((snapshot, index) =>
          snapshot?.exists
            ? fromSnapshot<CoachProviderAlias>(snapshot).canonicalCoachId !==
              candidate.id
            : providerEntityId(
                "coach",
                "api-football",
                candidate.observedExternalIds[index],
              ) !== candidate.id,
        )
      ) {
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "Una identidad de director técnico cambió de asociación.",
        );
      }
      const reference = this.database.doc(`coaches/${candidate.id}`);
      const snapshot = state.byPath.get(reference.path);
      const existing = snapshot?.exists
        ? fromSnapshot<Coach>(snapshot)
        : undefined;
      coaches.push({
        name: existing?.displayName ?? candidate.name,
        status: existing ? "existing" : "new",
        sourceFixtureIds: candidate.sourceFixtureIds,
      });
      if (aliases.some((alias) => alias?.exists) && !existing)
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "Falta el director técnico canónico de una asociación revisada.",
        );
      if (existing?.searchHiddenByAlias)
        throw new AdminCatalogImportRejectedError(
          "conflict",
          "Una identidad canónica está oculta por otra asociación.",
        );
      const incoming: Coach = {
        id: candidate.id,
        displayName: candidate.name,
        identityProvenance: "provider",
        externalProvider: "api-football",
        externalProviderId: candidate.externalId,
        ...(candidate.photoUrl ? { photoUrl: candidate.photoUrl } : {}),
        createdAt: action.observedAt,
        updatedAt: action.observedAt,
      };
      const base: Coach = existing
        ? {
            ...existing,
            ...(existing.identityProvenance === "provider"
              ? {
                  photoUrl: existing.photoUrl ?? incoming.photoUrl,
                }
              : {}),
          }
        : incoming;
      const coach = coachWithSearchIndex(
        {
          ...base,
          catalogFixtureIds: [
            ...new Set([
              ...(existing?.catalogFixtureIds ?? []),
              ...candidate.sourceFixtureIds,
            ]),
          ]
            .sort()
            .slice(-5),
          catalogObservedAt:
            existing?.catalogFixtureIds?.every((id) =>
              candidate.sourceFixtureIds.includes(id),
            ) &&
            candidate.sourceFixtureIds.every((id) =>
              existing.catalogFixtureIds?.includes(id),
            )
              ? (existing.catalogObservedAt ?? action.observedAt)
              : action.observedAt,
          updatedAt: action.observedAt,
        },
        [...(existing?.associatedTeamIds ?? []), action.trackedTeamId],
        false,
      );
      if (!existing) newCoaches += 1;
      if (!existing || !sameIgnoringUpdate(existing, coach)) {
        writes.push({ reference, value: coach });
        if (existing) {
          if (!existing.associatedTeamIds?.includes(action.trackedTeamId))
            coachAssociationChanges += 1;
          else metadataChanges += 1;
        } else coachAssociationChanges += 1;
      }
    }
    const plan: AdminCatalogImportPlan = {
      clubName: team.displayName,
      fixtures: action.fixtures,
      playerCount: action.players.length,
      coachCount: action.coaches.length,
      newPlayers,
      existingPlayers: action.players.length - newPlayers,
      newCoaches,
      existingCoaches: action.coaches.length - newCoaches,
      players,
      coaches,
      membershipChanges,
      coachAssociationChanges,
      metadataChanges,
      positionFills,
      positionGaps,
      squadPlayers: action.squadPlayers,
      excludedPlayers: action.fixtures.reduce(
        (total, fixture) => total + fixture.excludedPlayerCount,
        0,
      ),
      unresolvedCoaches: action.fixtures.filter(
        (fixture) => fixture.coachStatus !== "resolved",
      ).length,
      proposedWrites: writes.length + 2,
      providerRequests: action.providerRequests,
      previewDocumentReads:
        4 +
        action.players.reduce(
          (count, player) => count + player.observedExternalIds.length,
          0,
        ) +
        action.coaches.reduce(
          (count, coach) => count + coach.observedExternalIds.length,
          0,
        ) +
        action.squadPlayers +
        state.references.length,
      observedAt: action.observedAt,
      canApply:
        action.players.length + action.coaches.length > 0 &&
        writes.length + 2 <= MAX_WRITES,
    };
    return { plan, writes };
  }
}

function fromSnapshot<T>(snapshot: DocumentSnapshot): T {
  return {
    ...Object.fromEntries(
      Object.entries(snapshot.data() ?? {}).map(([key, value]) => [
        key,
        value instanceof Timestamp ? value.toDate().toISOString() : value,
      ]),
    ),
    id: snapshot.id,
  } as T;
}

function toDocument(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, field]) => key !== "id" && field !== undefined)
      .map(([key, field]) => [
        key,
        ["createdAt", "updatedAt"].includes(key) && typeof field === "string"
          ? Timestamp.fromDate(new Date(field))
          : field,
      ]),
  );
}

function sameIgnoringUpdate(first: object, second: object): boolean {
  const left = { ...first } as Record<string, unknown>;
  const right = { ...second } as Record<string, unknown>;
  delete left.updatedAt;
  delete right.updatedAt;
  delete left.lastObservedAt;
  delete right.lastObservedAt;
  return isDeepStrictEqual(left, right);
}

function validCatalogId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validProviderPlayerId(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d{1,12}$/.test(value) && Number(value) > 0
  );
}

function matchesPlayerCatalogAlias(
  alias: PlayerProviderAlias,
  observedExternalId: string,
  canonicalPlayerId: string,
  canonicalExternalId: string,
): boolean {
  return (
    alias.externalProvider === "api-football" &&
    alias.externalProviderPlayerId === observedExternalId &&
    alias.canonicalPlayerId === canonicalPlayerId &&
    alias.canonicalExternalProviderPlayerId === canonicalExternalId
  );
}
