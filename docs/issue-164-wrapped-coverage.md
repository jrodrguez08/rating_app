# FutRate Wrapped · Phase 2A coverage preview

[Issue #164](https://github.com/jrodrguez08/rating_app/issues/164) implements a local preparation command for the [Wrapped design](issue-111-wrapped-feasibility.md). It evaluates a supplied Team ledger against synthetic Firestore data. The input is an operator review record, and its evidence references are asserted by the person preparing it. The tool checks the bindings and result consistency. It cannot establish that the operator's source is authoritative or that the file lists every real tournament fixture.

## Ledger contract

Supply UTF-8 JSON, version 1, with one registered `clubSlug`, its exact `teamId`, and a `tournaments` array of the known reviewed editions for that Team. Use separate files for Herediano and Saprissa. Include all relevant known editions when checking for overlaps. The tool detects conflicts within the supplied inventory. A future authoritative registry must enforce uniqueness across files and concurrent revisions.

Each edition provides the internal `competitionId` and `seasonId`, `provider`, `providerCompetitionId`, numeric `providerSeason`, `seasonStartYear` and `seasonEndYear`, `editionYear`, `edition` (`apertura` or `clausura`), and included `stages`. The stable key is `competitionId:editionYear:edition`. The provider season can be shared by both editions. Dates, standings and provider seasons never decide membership. The review requires a `source`, `reviewedBy` and UTC `reviewedAt`. Add `completion` with a source and UTC `completedAt` once there is reviewed completion evidence. Its absence blocks coverage. A completed in-scope Match kicking off after that date conflicts with the completion evidence.

An example using synthetic IDs and dates follows. It does not identify a real approved edition.

```json
{
  "version": 1,
  "clubSlug": "herediano",
  "teamId": "club-sport-herediano",
  "tournaments": [
    {
      "competitionId": "demo-league",
      "seasonId": "demo-season",
      "provider": "api-football",
      "providerCompetitionId": "999999",
      "providerSeason": 2025,
      "seasonStartYear": 2025,
      "seasonEndYear": 2025,
      "edition": "clausura",
      "editionYear": 2025,
      "stages": ["regular"],
      "review": {
        "source": "Synthetic competition schedule",
        "reviewedBy": "demo-operator",
        "reviewedAt": "2025-06-30T00:00:00.000Z"
      },
      "completion": {
        "source": "Synthetic completion record",
        "completedAt": "2025-06-29T00:00:00.000Z"
      },
      "fixtures": [
        {
          "matchId": "match-37a433b97b84b1b67c0baaaf",
          "providerFixtureId": "990002",
          "stage": "regular",
          "evidence": "Synthetic schedule row for fixture 990002",
          "disposition": "expected"
        }
      ]
    }
  ]
}
```

For Saprissa, use `clubSlug: saprissa`, `teamId: deportivo-saprissa`, a separately reviewed coverage record and `match-df5455d7e7072ef05f0d52be` for the same synthetic provider fixture. The command uses the existing tracked Match ID convention, including retained Herediano IDs. Provider fixture IDs are optional in the file. When omitted, an existing Match still must have a compatible persisted provider fixture identity. Fixture stages must be explicitly included. The input rejects duplicate definitions, provider season binding conflicts and reused Match or provider fixture identities across the supplied editions for one Team.

### Disposition and coverage

| Ledger disposition | Observation and review action                                                                                                                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expected`         | Count only a compatible current finalized summary. Distinguish rated, finalized zero votes, missing Match, unfinished Match, postponed or cancelled pending review, active or reopened window, pending finalization, missing summary and incompatible evidence.                                                               |
| `excluded`         | Require an explicit outside-collection rationale and membership evidence. An imported record with evidence of voting or a closed result conflicts with exclusion.                                                                                                                                                             |
| `cancelled`        | Require reviewed rationale. An existing Match must be cancelled and unrated. A reviewed cancellation can be recorded before an internal document exists.                                                                                                                                                                      |
| `replaced`         | Require rationale and `replacementMatchId` pointing to a unique expected entry in the same stage and edition. Imported source fixtures must be postponed, cancelled or abandoned and unrated. Reject chains, cycles and multiple originals pointing to one replacement. Only the replacement enters the coverage denominator. |

The JSON distinguishes the declared disposition and evidence from `matchPresence` and the computed `observation`. Stable status codes can be translated by a future consumer through ES/EN messages. The CLI emits structured data and technical diagnostics. Keep credentials, voter identities and private notes out of evidence strings.

Coverage counts expected entries after explicit exclusions, cancellations and replacements. Rated coverage is rated divided by **observed completed in-scope** Matches, with zero-vote and unresolved completed Matches in the denominator. Missing and unfinished Matches still block completion even if the observed percentage is 100%. The percentage is null when there are no observed completed Matches. A consistent zero-vote result is final but contributes zero ballots and no rated Match. Total valid ballots comes from current summary counts and represents submissions per Match. No distinct supporter count is derived.

Current summaries must pass the shared published-result compatibility rules plus the preview's closure checks, including trusted early-close evidence, effective reopen time, generation after close and no future result relative to `--as-of`. A prior archived generation is ineligible. Only canonical positive or zero rating evidence consistent with the summary status is counted. The observation time constrains checks against the **current emulator snapshot**. It cannot reconstruct older Firestore history.

## Run on a local emulator

Use a loopback emulator with an explicit `demo-*` project. Seed synthetic Team, Competition, Season and Match records plus current summaries for the chosen test case. The [Firebase test](../tests/firebase/wrapped-preview.test.ts) contains working two-club fixture examples. For an already running local emulator, set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` using the appropriate shell syntax.

```text
npm run preview:wrapped -- --input <local-ledger.json> --tournament demo-league:2025:clausura --project-id demo-rating-app-local --as-of 2025-07-01T00:00:00.000Z
```

The command skips dotenv, requires explicit demo project/loopback configuration and rejects conflicting project settings and ambient Firebase credentials or provider key. Review `blockers` and `fixtureBlockers` first, compare the fixture roster with the reviewed calendar, and resolve missing records or evidence in the synthetic dataset before rerunning. Exit 0 indicates resolved coverage for this input, exit 2 indicates blockers with a JSON report, and exit 1 indicates invalid input, target or execution error. No pilot award threshold or publication decision is applied.

## Read limits and remaining work

Each preview uses one read-only transaction. It first performs three point lookups (Team, Competition and Season). If the binding is valid, it reads `M` ledger Match refs and `C` current summary refs for compatible closed Matches. Every batch contains at most 50 refs. The tool processes all batches in order. There is no cursor, query, index entry scan, private ballot read, provider request or write. Missing point lookups count toward the read estimate. Each edition is capped at 512 ledger entries, for at most 1,027 requested document reads and 23 batch calls before any transport retries. An oversized file or edition fails explicitly. There is no schema, index, migration or backfill in this phase.

The owner must separately approve the first target edition, stages and authoritative fixture roster, completion and coverage evidence, and pre-launch exclusions for each club. Phase 2B still needs canonical Player/Coach reconciliation and award thresholds. Durable ledger storage, cross-file uniqueness, versioned snapshots, audited publication, invalidation on source changes, public routes and presentation remain later work.
