# Production pilot runbook

Rating App is available on its current Vercel production URL and prepared for a controlled Firebase production pilot. This remains the execution and validation checklist; a public shell deployment alone is not evidence that every Firebase pilot operation is enabled.

## Architecture and prerequisites

The browser loads the Node.js 22 Next.js app from Vercel and uses Firebase Authentication directly for persistent anonymous identity. Server-rendered pages and trusted endpoints use Firebase Admin with Cloud Firestore. API-Football Pro is called only by trusted synchronization services, never by page rendering. Private GitHub Actions workflows call the lifecycle endpoint every 30 minutes and the standings endpoint daily; they perform no checkout or dependency installation.

Prepare Node.js 22, Firebase CLI 15.28.2, a production Firebase project, a Firebase Web app, a narrowly held Admin service-account key, a Vercel project, an API-Football Pro key with current quota, and repository-admin access. Use an exact production project ID that does not start with `demo-`.

## Canonical environment inventory

### Vercel browser-visible values

- `NEXT_PUBLIC_SITE_URL=https://rating-app-amber.vercel.app`
- `NEXT_PUBLIC_FIREBASE_ENVIRONMENT=production`
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

### Vercel server-only values

- `API_FOOTBALL_KEY`
- `CRON_SECRET`
- `FIREBASE_ADMIN_PROJECT_ID` (must equal the public project ID)
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY` (escaped `\n` newlines)
- `RESEND_API_KEY`
- `VOTING_WINDOW_OPERATOR_EMAIL`
- `VOTING_WINDOW_FROM_EMAIL` (for example, `Rating App <notifications@example.com>`)

Never configure `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `GCLOUD_PROJECT`, or public emulator host/port variables in Vercel production. Hosted runtime validation rejects emulator hosts and demo projects.

### GitHub repository secrets

- `LIFECYCLE_SYNC_URL`: full production `/api/internal/match-lifecycle` URL
- `STANDINGS_SYNC_URL`: full production `/api/internal/standings-sync` URL
- `CRON_SECRET`: exactly the same value as Vercel

No Firebase or API-Football credential belongs in GitHub for this workflow.

### Voting-window operator credential

Exceptional voting-window recovery is a local production CLI operation. Generate one high-entropy secret in the operator's password manager. Keep the raw value out of the repository, `.env.local`, Vercel, GitHub, shell history, logs, and command arguments. Configure its lowercase SHA-256 digest as `VOTING_WINDOW_OPERATOR_SECRET_SHA256` only in the controlled operator environment. Supply the raw value for one command process as `VOTING_WINDOW_OPERATOR_TOKEN`. Both are separate from Firebase Admin credentials; the CLI requires all of them.

Verified coach recovery reuses this credential and additionally requires `VOTING_WINDOW_OPERATOR_ID` in the controlled operator environment. Use a stable, non-secret identifier for the authorized operator, such as the organization's operator account label. It is written to the assignment audit record but omitted from CLI output and lifecycle logs. Do not put it in browser-prefixed variables or Vercel because the recovery command runs only from the controlled local checkout.

To rotate, generate a new high-entropy value, replace the configured digest, remove the old digest, and use only the new raw value for later invocations. Rotation does not alter matches, ballots, results, or revision documents. Never print either value during verification.

`NEXT_PUBLIC_SITE_URL` is public, non-sensitive canonical metadata configuration. It must be one HTTPS origin with no path, query, fragment, or credentials. The build has the same explicit Vercel production origin as a safe fallback, never derives canonical links from `VERCEL_URL` or an incoming request host, and therefore cannot silently canonize a Preview deployment.

### Voting-window operator email

Resend is the server-only delivery provider. Create a narrowly held production API key and [add a sending domain](https://resend.com/docs/dashboard/domains/introduction) in the Resend dashboard. Publish the exact SPF and DKIM records Resend supplies, wait for the domain to show as verified, and configure `VOTING_WINDOW_FROM_EMAIL` with an address on that domain. Configure the single monitored destination in `VOTING_WINDOW_OPERATOR_EMAIL`. Keep all three values out of browser-prefixed variables, GitHub, command output, and repository files. A missing or incomplete set leaves delivery disabled and produces a sanitized `voting.notification` `not_configured` outcome; it does not block voting.

Before enabling lifecycle scheduling, use Resend's dashboard test for the verified sender and operator destination. Confirm inbox delivery, sender identity, spam placement, and that replies/bounces are handled as intended. Repository tests mock `fetch` and never send real mail. After deployment, use the next controlled eligible match opening as the application-path smoke test: require one message with the two team names, final score, match ID, open/close times, and canonical rating link; then invoke lifecycle again and require `already_sent` with no second message. Do not create or edit a production Match solely to test email.

The lifecycle and successful reopen command emit `voting.notification` entries with match ID, window sequence, and a safe status: `attempted`, `sent`, `already_sent`, `in_flight`, `not_configured`, `failed`, or `manual_review`. They never include the operator address, API key, provider response, voter, ballot, or aggregate. Delivery failure remains `pending` for a later active-window lifecycle retry. `manual_review` means the first attempt is at least 23 hours old and an automatic retry can no longer rely on Resend's 24-hour idempotency retention; inspect the provider dashboard and Firestore receipt fields before taking any action.

At pilot volume, one message per opened window should stay well below Resend's free allowance. Check the [current Resend pricing](https://resend.com/pricing) and dashboard limits before setup and monthly thereafter because quotas and prices can change. Alert on unexpected volume, `failed`/`manual_review` outcomes, approaching daily/monthly limits, domain-verification changes, or repeated bounces. Scaling to supporter notifications requires a separate product and cost decision.

### Local-only variables and commands

`.env.example` documents browser emulator hosts plus `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, and `GCLOUD_PROJECT`. Local mode permits only a `demo-*` Admin project. `seed:firebase`, `sync:football`, `sync:match-participants`, and `sync:lifecycle` remain emulator-only and must never be used for production.

## Firebase production checklist

1. Create Cloud Firestore in the intended production region.
2. Enable Firebase Anonymous Authentication.
3. Add the Vercel production domain and any custom domain to Firebase Authentication authorized domains.
4. Register the production Web app and capture its public configuration.
5. Create a dedicated Admin service-account key; store its fields only in Vercel secrets.
6. From a clean reviewed commit, deploy with an explicit target: `firebase deploy --only firestore:rules,firestore:indexes --project <exact-production-project-id>`. Never rely on `.firebaserc`, whose default remains the safe demo project.
7. Verify rules: only `teams/{teamId}` is public-readable; all client writes and all other reads, including ballots and results, are denied.

Jugadores V1 adds the tracked-Team/kickoff match-history composite index and participant collection-group single-field index declared in `firestore.indexes.json`. Indexed public history also requires the declared `results.teamId` collection-group single-field index. Lifecycle readiness additionally requires the collection-scoped `participants(participated, teamId)` composite index used by `countRateableParticipants()`. Deploy all declared indexes with the explicit `firestore:indexes` command before relying on player pages, membership-backed admin search, or post-FT voting readiness in production.

## Safe deployment and bootstrap order

1. Complete the Firebase checklist.
2. Configure all Vercel public and server-only variables for Production only.
3. Confirm Vercel uses Node.js 22, then deploy the reviewed commit.
4. Confirm the public shell loads and Anonymous Auth succeeds; do not submit a ballot.
5. Call `GET /api/internal/health` with `Authorization: Bearer <CRON_SECRET>`. Before Team bootstrap, `not_ready` with reason `team_missing` is expected; `configuration` identifies invalid deployment configuration, and `firebase_admin` identifies Admin initialization or Firestore connectivity failure. Unauthorized calls must return 401 without a reason.
6. From a controlled operator environment with the production variables loaded, confirm the API-Football provider Team ID independently, then run:

   `npm run bootstrap:production-team -- --project-id <exact-production-project-id> --provider-team-id <confirmed-id> --confirm bootstrap-production-team`

   The command rejects local/development mode, emulator hosts, demo projects, project mismatches, missing confirmation, and malformed credentials. It creates only `teams/club-sport-herediano`, or adds the explicit provider mapping when the canonical identity already matches. Repetition is idempotent; conflicting existing identity aborts.

7. Repeat the authenticated health request and require `{"status":"ready"}`.
8. Manually call the authenticated lifecycle endpoint once. It uses current-season discovery to persist competitions, seasons, and relevant Herediano fixtures; no production sync script or fixture ID is needed.
9. Inspect Firestore and Home for the next fixture. Confirm home/away identity, competition, season, kickoff, and `not_ready` state.
10. Add the GitHub endpoint secrets and shared cron secret, manually dispatch `Match lifecycle trigger`, and require a successful workflow plus a safe lifecycle response.
11. Manually dispatch `Daily standings trigger`. Confirm exactly one provider request, a valid `standings/{trackedTeamId}` snapshot, the `/standings` route, and a sanitized response.
12. Allow both schedules to operate only after their manual dispatch and Firestore inspection pass.
13. Share the pilot URL only after the infrastructure smoke test is complete.

## Public identity and domain operations

After deployment, hard-refresh the production root and confirm the browser tab uses the Rating App icon. Add the page to a bookmark and, where available, a mobile home screen to verify the scalable icon and 180×180 Apple touch icon. Inspect the HTML for `/`, `/matches`, `/players`, and representative dynamic match/result/player routes with browser developer tools or `curl`. Require each canonical link and `og:url` to identify its own production pathname, while `og:title`, `og:description`, `og:image`, `twitter:card`, and `twitter:image` retain the shared public identity and resolve against `https://rating-app-amber.vercel.app` rather than a Preview hostname.

Open `/social-card` directly without authentication and require HTTP 200, `image/png`, and 1200×630 output. Test the production URL with Facebook Sharing Debugger, LinkedIn Post Inspector, available X card tooling, and a private WhatsApp test chat as appropriate. These services cache previews; request a refresh or wait for their cache rather than treating a stale card as an application failure.

To migrate later, point the custom domain at Vercel, add it to Firebase Authentication authorized domains, set the Production `NEXT_PUBLIC_SITE_URL` to the new HTTPS origin, redeploy, and repeat canonical/OG/image validation. Then refresh external social caches. No metadata or identity asset needs regeneration, and Preview deployments must retain either the configured production origin or the documented fallback.

## Request discipline and autonomous lifecycle

The separate standings workflow runs at `09:00 UTC` (`03:00 America/Costa_Rica`) and calls only the authenticated standings endpoint. It resolves the current league/season from persisted provider-linked football data, makes one bounded `/standings` request, and atomically publishes only a fully validated non-empty table. Empty, malformed, and network-failed responses return a failed workflow outcome while preserving the last valid snapshot. The response/log trace contains stable IDs, row counts, request count, and safe reason codes only. `/standings` reads the persisted snapshot server-side and makes no provider request; Firestore client access remains denied. No additional index is required.

Partidos page reads remain server-only and provider-free. During an active voting window, the existing browser identity boundary makes a separate authenticated, no-store ballot-status request for each rendered actionable match; that endpoint returns only a sanitized status and never exposes a UID or ballot content. A submitted voter is not offered another rating action, status-read failures expose no action, and result visibility remains governed solely by trusted close/finalization.

Provider snapshot merging is non-destructive when a response omits its event collection: already confirmed goal events remain stored. An explicit event array replaces the snapshot after normalization, including when that array confirms no goals. Missing optional live elapsed time likewise preserves the last persisted minute; provider score fields remain canonical.

Before discovery or fixture refresh, every lifecycle trigger checks persisted matches for an expired `rating_ready` window. That pending aggregation outranks later live or scheduled fixtures until finalization succeeds, uses only persisted participants, coach assignment, and ballots, and makes zero API-Football requests. A failed aggregation stays `rating_ready` with its original voting timestamps and is retried first on the next trigger; successful finalization atomically creates the deterministic summary and closes the match without reopening or extending the window.

When no relevant future match is known, discovery is attempted at most every 12 hours. A known fixture beyond 24 hours makes no provider request; within 24 hours it refreshes at most every six hours, within two hours every 15 minutes, and live/preparing matches on each external trigger. From approximately T-60m through kickoff, a scheduled match adds one focused lineup request only while a complete snapshot is missing; the 30-minute scheduler is approximate, no exact observation time is guaranteed. If the match becomes live without that snapshot, lifecycle permits at most four live lineup attempts, at least 15 minutes apart, and only after the normal fixture refresh with no other provider work in that execution. A live attempt therefore uses two provider calls for a lineup with a usable coach identity, or at most three when the existing narrow Team-coach identity recovery is required. Persisted Match attempt counts, last attempt time, and outcome enforce the cooldown and ceiling across GitHub Actions runs. A complete snapshot or fixture-bound verified operator lineup stops automatic capture. Final readiness remains independent and normally adds three focused requests (lineups, players, events) after the normal fixture refresh, even after the live ceiling. Coach identity recovery can add at most one targeted `/coachs?team=...` request: exact same-Team normalized-name matching when the lineup name is present, or exactly one tracked-Team career interval covering the persisted fixture kickoff date when both lineup ID and name are unusable. Active voting, finalization, and finalized results make no context requests. After a result, discovery eventually imports the next fixture; active voting, live, preparing, and scheduled matches outrank historical results on Home.

The 30-minute workflow remains an approximate fallback and may also experience GitHub queue delay. Do not shorten it under an assumption that GitHub scheduled workflows reliably run every five minutes. When a prompt readiness check is needed for the canonical live or recently finished unopened match, use the owner-console operation below. Scheduled and owner requests share a Firestore execution lease, so overlap returns without provider work and leaves a recoverable `skipped_busy` owner receipt. Inspect `footballSyncMetadata/{teamId}`, the durable `adminLifecycleRequests/{auditId}` receipt, or the match detail for the observed attempt, last trigger source, start/completion, outcome, selected match, and bounded provider request count.

API-Football has confirmed that fixture lineup publication can be followed by a cache interval in which the focused endpoint returns either an empty collection or Team/coach entries that omit `startXI` or `substitutes`. Treat both shapes as “currently no usable lineup observed,” not permanent absence or malformed data; they remain retryable. An explicitly present player field with a non-array value is structurally malformed and still fails closed. A trusted persisted snapshot and its fixture-specific coach survive unavailable or smaller later responses; malformed/incomplete evidence writes nothing. A coach published without both player arrays is not persisted independently because participant and coach context is validated and written atomically. The fixture lineup remains authoritative that the match has a coach slot. When that coach object has a valid name but no usable numeric ID, `/coachs?team=...` may recover only an exact normalized-name match for the same tracked Team. When both lineup ID and name are unusable, the team-coach response may recover identity only through exactly one tracked-Team career interval covering the persisted fixture kickoff date. Do not use the most recently persisted or currently known coach by itself; recent coaching changes make that unsafe for historical fixtures. No match, overlapping candidates, wrong-Team careers, malformed IDs/dates, or provider errors fail closed and remain retryable. At `FT`, only stable-ID substitution events or positive player minutes can add bench participation, and missing coach or insufficient participant evidence remains safely `preparing_rating` for a later scheduler retry.

Every authenticated lifecycle response includes an ordered `logs` trace that the GitHub Actions `curl` invocation prints, including for HTTP failures through `--fail-with-body`. The same compact JSON entries appear in server logs. Use them to follow match/status selection, fixture score and elapsed-minute refresh, lifecycle phase, focused lineup/player/event structure, aggregate reconciliation, readiness and its blocking reason, voting/finalization, final action, and bounded provider request count. These entries intentionally omit raw provider payloads, individual player details, credentials, authorization headers, Firebase configuration, voters, ballots, and account data; logging is best-effort and does not add provider calls or alter lifecycle behavior.

When voting opens, the response can also include the safe notification outcome. Delivery occurs only after the window is durable. Notification failure therefore requires investigation and a later lifecycle retry, never a window rollback or timestamp edit. A successful operator reopen command applies the transaction first and then reports its notification outcome in the same JSON output.

Normal additional context cost is one successful pre-match lineup request when evidence is available, up to four focused live retries when it is not, and three final reconciliation requests. Every live retry shares the execution with the required fixture refresh and consumes two calls normally or three only for narrow fixture-coach ID recovery. Empty, partial, malformed, conflicting, and failed attempts never set `lineupSnapshotAt`; inspect the structured `lifecycle.lineup_capture` attempt, outcome, skip reason, count, cooldown, and request-budget fields. If no live snapshot is captured, final reconciliation can still establish it when focused lineups are available. A lineup coach with an unusable numeric ID adds at most one `/coachs?team=...` lookup to the final context attempt; valid lineup coach IDs add none. With an approximately 30-minute scheduler, the pre-match window adds at most about three lineup requests while empty; a persistently incomplete finished match normally uses four total provider requests per retry (fixture + three context endpoints), or five only when coach-ID recovery is required, for the existing eight-hour relevance horizon. Monitor provider quota and investigate a reached live ceiling or persistent `preparing_rating` rather than adding in-process sleeps or unbounded retries.

The Partidos archive reads the fixture window already persisted by discovery and makes no additional API-Football requests on page views. Confirmed goal events and optional live elapsed minutes are refreshed only through the existing bounded fixture discovery/focused lifecycle calls. Historical archive entries do not enter the active lifecycle polling loop.

After the corrected release is deployed and the membership repair is complete, Jugadores pages use server-only, provider-free read-time derivation over the maintained Team membership index and final Team result summaries. They batch-read only the corresponding parent Matches and never scan MatchParticipants, drafts, verified lineups, unrelated Matches, or ballots. Admin search reads at most 21 membership documents per request before bounded identity lookups. A missing completeness marker, missing result identity, or failed page fails the request instead of returning a silently partial catalog. Monitor reads proportional to indexed Players plus published rated Matches and route latency; introduce a reviewed trusted result projection only when measured volume requires it.

Refresh current Jugadores squad presentation metadata manually after deployment, after meaningful roster changes, or at most once daily. From a controlled operator environment with the production Firebase Admin variables and `API_FOOTBALL_KEY` loaded, run `npm run sync:player-squad -- --project-id rating-app-prod-8b7df --confirm sync-player-squad`. The command targets only the configured internal Team and its persisted provider Team mapping, makes one `GET /players/squads` request, never logs the key, and is safe to rerun: it resolves explicit provider aliases before upserting canonical Players, preserves omitted optional metadata, and never deletes players or history. No new Firestore index is required.

### Player identity reconciliation

API-Football reminders such as name, shirt number, age, birth details, nationality, height, weight, position, or photo are not trusted as automatic identity keys. A provider ID change is reconciled only through a reviewed entry in `src/config/player-identity-reconciliations.ts`. The migration creates auditable `playerProviderAliases/{aliasId}` mappings and may fill a missing canonical position/photo; it retains legacy Player, participant, ballot, and result documents. It never rewrites submitted ratings or immutable summaries. Its apply transaction re-reads every planned alias and the canonical Player: absent aliases are created, matching mappings are no-ops, only the reviewed self-alias transition is allowed, and any other concurrent mapping aborts the transaction. Canonical metadata enrichment fills only fields that remain missing at apply time, so concurrent usable position/photo data is not overwritten or degraded.

After deploying the reviewed identity-aware release, use a controlled checkout of that same commit with the production Firebase Admin variables loaded and no emulator variables present:

1. Preview the exact plan: `npx tsx scripts/reconcile-player-identities.ts --project-id rating-app-prod-8b7df`.
2. Review every configured identity against its known migration state. Already-migrated reconciliations must propose zero writes. For the newly reviewed J. Henestrosa mapping (`593270` → `92547`), expect only missing aliases plus any safe missing canonical metadata enrichment. Review any pending older mappings separately; stop on a conflict or unexpected path.
3. Apply once: `npx tsx scripts/reconcile-player-identities.ts --project-id rating-app-prod-8b7df --apply true --confirm reconcile-player-identities`.
4. Repeat the dry run from step 1 and require zero alias or canonical metadata writes across every configured reconciliation.
5. Inspect `/players` and each legacy/canonical profile URL pair. Require one canonical entry per reconciled player with the correct published history; the nonparticipating legacy J. Henestrosa entry must not gain a rating. Do not edit Firestore manually.

The command rejects development/local mode, emulator hosts, demo projects, project mismatches, missing production Admin credentials, and an inexact apply confirmation. CI never runs it. Adding a future reconciliation requires confirming the real player identity independently, reviewing the canonical metadata choice and historical references, adding focused tests, deploying the code, and then following this dry-run/apply/dry-run sequence. Name-only or shirt-only merging is prohibited.

Network/provider validation, lineup-not-observed/cache-empty, incomplete lineup, missing fixture coach, participant-evidence, Firebase write, and aggregation integrity failures remain retryable. They cannot open voting early, erase a trusted snapshot, extend timestamps, replace ballots, publish partial results, or regress finalized state. Cancelled/abandoned matches never open or finalize ratings; postponed/suspended matches retry conservatively.

## Verified head-coach recovery

This feature is available for production use only after the reviewed release is deployed and the same commit is checked out in the controlled operator environment. It handles the narrow case where lifecycle logs report `ambiguous-coach` while tracked-Team lineup and participation evidence remains valid. It does not recover a missing coach slot, malformed or missing lineup, participant error, provider outage, wrong Team, or wrong fixture. Each affected fixture requires its own verified assignment.

The command uses production Firebase Admin credentials, the exact project argument, `VOTING_WINDOW_OPERATOR_SECRET_SHA256`, the invocation-only `VOTING_WINDOW_OPERATOR_TOKEN`, and `VOTING_WINDOW_OPERATOR_ID`. It rejects emulator hosts, `demo-*` projects, mismatched projects, unauthorized execution, non-finished or already-open/finalized matches, ballots, results, malformed evidence, conflicting identities, and inexact confirmation. Dry-run is the default and makes zero writes. Apply creates only the missing Coach identity and deterministic `matches/<matchId>/verifiedCoachAssignments/head-coach` audit record; it never changes `ratingState`, participants, the effective head-coach assignment, ballots, or results. The next normal lifecycle run performs those context and readiness changes atomically.

### Evidence and identity review

1. Keep lifecycle scheduling disabled for the affected match while reviewing the incident. Record the sanitized `provider.coach_identity`, `coach.manual_assignment`, `participants.reconciliation`, and readiness log entries.
2. Confirm the historical fixture's head coach from an independent, fixture-specific HTTPS source. Check its date, teams, competition, and fixture details. A current roster or latest coach page alone is insufficient.
3. Read the exact Match and existing `coaches` documents through the Firebase console. Confirm the internal Match ID, configured tracked Team, provider fixture ID, `finished` status, and `not_ready` or `preparing_rating` state. Confirm that no ballots or result summary exist.
4. Select an existing Coach only when the record is the same person and its display name and real provider identity, if present, agree with the evidence. Otherwise choose a new stable internal Coach ID that does not imply a provider ID. Add `--provider-coach-id` only when that numeric API-Football identity was independently verified; when supplied, use the repository's deterministic provider Coach document ID already shown by a matching existing Coach record. Never derive or merge identities by similar names.

For the issue #74 incident, the values under review are Match `match-b88ee2d600491ca670bbe00c`, API-Football fixture `1551697`, and expected coach Jafet Soto. Treat the name as a claim to verify, not as authority. No application code contains an exception for these values.

### Dry-run, apply, and lifecycle verification

Set placeholders in the controlled PowerShell process without echoing secret values:

```powershell
$projectId = "rating-app-prod-8b7df"
$matchId = "<exact-match-id>"
$fixtureId = "<exact-provider-fixture-id>"
$coachId = "<reviewed-existing-or-new-internal-coach-id>"
$coachName = "<verified-display-name>"
$evidenceUrl = "<independent-https-evidence-url>"
$reason = "<fixture-specific-verification-reason>"
$env:VOTING_WINDOW_OPERATOR_SECRET_SHA256 = "<configured-64-character-sha256-digest>"
$env:VOTING_WINDOW_OPERATOR_TOKEN = "<raw-high-entropy-operator-secret>"
$env:VOTING_WINDOW_OPERATOR_ID = "<stable-authorized-operator-id>"
```

1. Inspect and validate the proposed operation without writes:

   ```powershell
   npm run manage:coach-assignment -- --project-id $projectId --match-id $matchId --fixture-id $fixtureId --coach-id $coachId --coach-name $coachName --source $evidenceUrl --reason $reason
   ```

   If a real provider coach ID was independently verified, add `--provider-coach-id <numeric-id>`. Review the returned Match/Team/fixture binding, `current` coach and verified-assignment state, proposed identity and evidence, and the `coachCreated`/`assignmentCreated` actions. Stop on any unexpected identity or existing assignment.

2. Apply with the exact match-specific confirmation:

   ```powershell
   npm run manage:coach-assignment -- --project-id $projectId --match-id $matchId --fixture-id $fixtureId --coach-id $coachId --coach-name $coachName --source $evidenceUrl --reason $reason --apply true --confirm "assign-verified-coach:$matchId"
   ```

   Repeat the dry-run and require `coachCreated: false` and `assignmentCreated: false`. This verifies idempotency without changing the audit timestamps.

3. Invoke the normal authenticated `/api/internal/match-lifecycle` endpoint once through the established production procedure. Do not use local emulator-only sync commands and do not edit `ratingState`.
4. Inspect the sanitized lifecycle trace. Require `coach.manual_assignment` accepted for the exact Match and `participants.reconciliation` with the expected aggregate counts. Require provider reads to remain within the documented context bound.
5. Read Firestore through the console. Confirm only tracked-Team participants exist, exactly the starters and substitutes with confirmed participation are rateable, unused substitutes remain false, and `coachAssignments/head-coach` refers to the verified Coach with `operator_verified` provenance. Confirm the audit record still matches the reviewed Team, fixture, evidence, reason, and operator context.
6. Confirm lifecycle readiness. If all canonical checks pass, the standard lifecycle establishes the original voting timestamps and opens voting; then confirm the normal operator email and rating route. If readiness remains blocked, preserve the documents and use the sanitized blocker to investigate participant evidence or another prerequisite.

An operator may submit exactly 11 verified starters with no substitutes. If final API-Football lineup, player-statistics, and event evidence remains unavailable, the next normal lifecycle run uses that complete snapshot only when the same fixture also has a valid verified head-coach assignment. Confirm the lifecycle log records unavailable provider lineup evidence, accepted manual participant evidence, accepted verified coach recovery, and readiness completion. The run must create no provider aliases for internal-only Players. A missing verified coach, a provider request/rate-limit/malformed-response error, or conflicting later provider identities or roles keeps the match in `preparing_rating` for investigation and retry.

Automatic provider reconciliation preserves the verified assignment. If a later provider response resolves the same real identity, synchronization may proceed without changing provenance. A different provider identity is a conflict and writes nothing. Do not delete or rewrite the audit record to silence a conflict.

### Rollback and conflicts

Before lifecycle consumes an applied assignment, an incorrect assignment still requires a reviewed corrective operation; this CLI intentionally has no force, replace, or delete mode. Disable lifecycle scheduling, preserve the audit data, document the evidence error, and ship a narrowly reviewed correction rather than editing Firestore manually. After participants or voting state exist, preserve the assignment, ballots, timestamps, results, and revisions and handle the incident as an integrity review. If apply outcome is uncertain, rerun dry-run: identical existing data reports no proposed creates, while any mismatch fails closed. Remove `VOTING_WINDOW_OPERATOR_TOKEN` from the process environment when finished.

No Firestore rule or index deployment is required. The existing recursive deny rule protects Coach, head-coach assignment, and verified-assignment documents from every browser client.

## Exceptional voting-window recovery

Use `npm run manage:voting-window` only from a clean checkout of the reviewed production commit. Load the production Firebase Web/Admin variables, the configured operator digest, and the invocation-only raw operator token into the current controlled process. Confirm no emulator variables are present. The command rejects non-production and `demo-*` projects, project mismatches, missing or wrong operator authorization, malformed arguments, and incompatible persisted state. It never calls API-Football.

The raw operator token is read only from `VOTING_WINDOW_OPERATOR_TOKEN`; never pass it as an argument. Dry-run is the default. Apply additionally requires `--apply true` and the exact match-specific confirmation. Reopen close time is explicit UTC and must be from five minutes through 24 hours after Firestore's trusted read time.

Set the examples' placeholders in the controlled shell without echoing their values:

```powershell
$matchId = "<exact-match-id>"
$projectId = "rating-app-prod-8b7df"
$reopenCloseUtc = "<YYYY-MM-DDTHH:mm:ss.sssZ>"
$env:VOTING_WINDOW_OPERATOR_SECRET_SHA256 = "<configured-64-character-sha256-digest>"
$env:VOTING_WINDOW_OPERATOR_TOKEN = "<raw-high-entropy-operator-secret>"
```

### Reopen procedure

1. Run the non-mutating plan:

   ```powershell
   npm run manage:voting-window -- reopen --project-id $projectId --match-id $matchId --close-at $reopenCloseUtc
   ```

   Review the closed match state, immutable original timestamps, current result `generatedAt`, ballot count, proposed trusted reopen/effective close timestamps, `matches/<match>/resultRevisions/reopen-<sequence>` path, and exact create/delete/update actions. Stop on any unexpected value.

2. Apply once with the exact confirmation:

   ```powershell
   npm run manage:voting-window -- reopen --project-id $projectId --match-id $matchId --close-at $reopenCloseUtc --apply true --confirm "reopen-voting-window:$matchId"
   ```

   The transaction preserves all ballots and original window timestamps, copies the complete current summary into the deterministic revision, deletes only the current `results/summary`, writes reopen metadata/effective bounds, and returns the match to `rating_ready`.

3. Verify the reopened state with a close dry-run:

   ```powershell
   npm run manage:voting-window -- close --project-id $projectId --match-id $matchId
   ```

   Require `reopened: true`, the expected reopen count/effective bounds, no current summary, the expected ballot count, and `finalizesImmediately: true`. Check the public result route is locked and the rating route accepts only voters without an existing ballot. Inspect the deterministic revision read-only through the Firebase console and confirm its result data and original `generatedAt`; never edit it.

If no early close is needed, allow the normal lifecycle trigger after the effective close. It prioritizes the expired reopened window, uses zero provider requests, validates every persisted ballot through the normal aggregation path, publishes one new `results/summary`, and transitions to `rating_closed`.

### Early-close procedure

1. Immediately before closing, rerun the non-mutating close plan:

   ```powershell
   npm run manage:voting-window -- close --project-id $projectId --match-id $matchId
   ```

2. Apply once with the exact confirmation:

   ```powershell
   npm run manage:voting-window -- close --project-id $projectId --match-id $matchId --apply true --confirm "close-voting-window:$matchId"
   ```

   The final transaction takes its authoritative time from Firestore, reads the match, current-summary absence, participants, head coach, and ballots together, runs the canonical aggregation, creates exactly one current summary, records `votingClosedEarlyAt`, and changes `ratingState` to `rating_closed`. A concurrent ballot is either committed before the transaction and included or retries against the closed state and is rejected.

3. Verify finalization with a non-mutating reopen plan using a newly reviewed future close timestamp:

   ```powershell
   npm run manage:voting-window -- reopen --project-id $projectId --match-id $matchId --close-at "<new-future-UTC-close-used-only-for-verification>"
   ```

   Require `rating_closed`, a current summary with the expected new `generatedAt` and ballot count, the preserved reopen count/original timestamps, and the next collision-free revision path. Do not add `--apply`. Confirm the public result and personal comparison are available and that the prior revision remains unchanged. A repeated close command must fail without mutation.

If reopen fails after a dry-run, fix the reported prerequisite and rerun dry-run; never repair lifecycle documents manually. If apply outcome is uncertain, rerun the appropriate dry-run before doing anything else. Firestore transactions prevent a partial archive/delete/update or close/result transition. Do not delete revision documents during rollback. Remove `VOTING_WINDOW_OPERATOR_TOKEN` from the process environment when finished.

No new Firestore index or rule deployment is required. The existing recursive deny rule keeps result revisions and operator metadata unavailable to all browser clients.

## Infrastructure smoke test

For a published match, the result page may make one authenticated, private no-store comparison request for the current anonymous voter. The trusted endpoint reads only that voter's deterministic ballot after the existing result publication guard; absent ballots return a neutral status. Confirm an open or pending match returns no comparison, a voter without a ballot sees no fabricated ratings, and a submitted voter sees their own player and coach values. Firestore rules and indexes are unchanged; client ballot reads remain denied.

- App shell loads in Spanish and English with no raw error details.
- Anonymous Auth creates and reuses an identity; no UID is visible.
- Authenticated health returns `ready`; missing/wrong secret returns 401.
- Firestore Team read succeeds through Admin; browser writes and protected reads fail.
- Authenticated lifecycle returns a bounded operational response; wrong secret returns 401 and missing API key returns a sanitized 503.
- Vercel and GitHub lifecycle logs show the sanitized ordered trace and never echo secrets or raw provider payloads.
- API-Football shows a valid Pro key, current quota, and expected bounded calls.

## Controlled functional test

Perform only when a real match is intentionally selected for the pilot. Confirm scheduled → live → preparing → rating-ready, exact tracked-Team participants/head coach, a controlled ballot, duplicate rejection, pre-close result lock, trusted close, immutable aggregate, and public result. Do not create junk production ballots merely to test infrastructure.

## Scheduler operations and cost

The workflow uses `curl` only, a 10-second connect timeout, 45-second request timeout, and one bounded retry. Missing secrets skip safely; an HTTP/network failure fails the workflow. Private-repository Actions minutes and Vercel/API/Firebase quotas must be monitored, but the pilot adds no separately paid scheduler, worker, queue, or external cron service.

## Rollback

1. Disable `.github/workflows/match-lifecycle.yml` or remove `LIFECYCLE_SYNC_URL`/`CRON_SECRET` to stop lifecycle triggers.
2. If lifecycle health is uncertain, keep the scheduler disabled; established voting timestamps and immutable ballots/results remain stored.
3. Redeploy the last known-good Vercel deployment for an application regression.
4. Do not delete ballots or finalized result summaries during rollback.
5. Investigate with Vercel logs, GitHub workflow status, Firestore state, and API-Football quota history before re-enabling.

## Secret rotation

- Rotate `CRON_SECRET` in Vercel and GitHub together; keep the scheduler disabled until both match and a manual dispatch succeeds.
- Rotate `API_FOOTBALL_KEY` in Vercel independently, then invoke lifecycle manually and verify quota/request behavior.
- Rotate Firebase Admin by adding the new client email/private key in Vercel, verifying health, and revoking the old service-account key afterward.
- Rotate `RESEND_API_KEY` by creating a replacement restricted key, updating Vercel and the controlled operator environment, confirming a dashboard test and the next application-path outcome, then revoking the old key. Reverify SPF/DKIM and update `VOTING_WINDOW_FROM_EMAIL` before removing an old sending domain. Update `VOTING_WINDOW_OPERATOR_EMAIL` directly when operator responsibility changes, then run the dashboard delivery test.

Never log, commit, paste into issues, or expose these values to browser variables.

## Known pilot limitations

- Anonymous Auth identifies a browser profile, not a person; it is not strict one-person-one-vote.
- App Check and broader abuse controls are not enabled yet.
- Jugadores V1 provides bounded Rating App history and team ranking; season filters, advanced player metrics, and broader leaderboards remain deferred.
- Final aggregation reads all ballots once and assumes small-community volume.
- The GitHub schedule is approximate and consumes private-repository Actions minutes.

## Dependency audit disposition

`npm audit` currently reports eight moderate findings for `uuid` below 11.1.1 through Firebase Admin's `@google-cloud/firestore`/storage transport chain. The advisory concerns caller-supplied buffers in UUID v3/v5/v6; Rating App neither imports that transitive package nor calls those UUID APIs. npm offers no compatible remediation and `--force` would downgrade Firebase Admin to 10.3.0, so the forced fix is rejected. This is acceptable for the controlled pilot, not a production blocker; monitor Firebase Admin releases and apply the first compatible upstream resolution.

## Owner console setup and recovery

The owner console is dormant until all three server-only values are configured: `ADMIN_OWNER_UID`, `ADMIN_ALLOWED_ORIGIN`, and `ADMIN_PASSPHRASE_SCRYPT`. In the production Firebase project, enable Email/Password and provision exactly one owner account outside this application. Verify its email, copy its immutable Firebase UID into `ADMIN_OWNER_UID`, and do not add registration UI. Set `ADMIN_ALLOWED_ORIGIN` to the exact HTTPS deployment origin with no path. Never prefix these values with `NEXT_PUBLIC_`.

Generate a unique passphrase of at least 20 random characters in an approved password manager, independently from the Firebase password and CLI token. Derive a fresh 16-byte-or-longer salt and a 32-byte scrypt result offline with N=16384, r=8, p=1, then store `scrypt$v1$16384$8$1$<salt-base64>$<result-base64>` as `ADMIN_PASSPHRASE_SCRYPT`. Store the plaintext only in the owner's password manager. Test login and dry-run against emulators or an explicit development project before enabling production. Never test apply against production merely to validate configuration.

To rotate the passphrase, generate a new salt and digest, replace the deployment secret, redeploy, and verify a dry-run plus authorization without applying. Existing two-minute challenges may remain valid until expiry; for urgent invalidation, delete `adminActionChallenges`, revoke the owner user's refresh tokens, and rotate the digest. To rotate the owner, provision and verify the replacement first, update the exact UID, redeploy, then revoke and disable the old Firebase user. A lost passphrase is recovered only through secret rotation; it cannot be derived from the digest.

Monitor rejected admin audits, lockouts, unexpected owner token revocations, and write/read quota. Normal use adds bounded Firestore reads plus challenge, throttle, and audit documents and requires no new paid service. A web success audit has a deterministic ID derived from the hashed challenge and commits in the same transaction as challenge consumption and the assignment. If the browser loses the response and the original action cookie is still available, retry the exact action. The server validates the consumed challenge and immutable success audit, then returns the original receipt without reading or changing later Match, participant, ballot, or result state. The stored receipt remains valid when its exact challenge is supplied after voting opens or results publish and after the consumed challenge's stored expiry; the browser action cookie itself remains short-lived, and an expired unused challenge remains invalid. Do not infer failure from an indeterminate response or create a manual failure audit. For an incident, disable the owner Firebase account, revoke refresh tokens, rotate the Firebase password and admin passphrase, preserve `adminAudit` and verified assignment evidence, review deployment access logs for sanitized outcomes, and use the independently authorized `npm run manage:coach-assignment` CLI only when web recovery is unavailable. The CLI token and web passphrase must remain separate.

Before deployment confirm: the exact production project in Web and Admin configuration; no emulator hosts or `demo-*` IDs; Email/Password enabled; owner email verified; exact UID and origin configured; scrypt digest present; HTTPS active; Firestore rules still recursively deny admin collections; `npm run verify` and `npm run test:firebase` pass; and no raw password, passphrase, ID token, cookie, Admin key, or voter data appears in logs or source. Deployment activates the route but performs no data mutation. Each actual assignment still requires preview, passphrase, exact typed target, and a fresh server transaction that also consumes the challenge and creates the success audit. Review that deterministic `adminAudit` record afterward.

In a non-production smoke test, exercise lifecycle, verified lineup, coach assignment, and Player identity authorization with delayed network responses. Require one request while the authorization button is disabled, a visible Spanish success status and empty passphrase field after success, and the exact-confirmation control before apply. Reject an incorrect passphrase and require a visible error with the submit control restored. Inspect the response body, application logs, `adminSecurity`, `adminActionChallenges`, and `adminAudit`; none may contain the plaintext passphrase. Do not repeat this wiring test against production data.

## Verified lineup preparation operation

The visual preload, roster search, and drag-and-drop workflow described here is available only after its reviewed release is deployed through the normal pipeline. Do not treat this runbook text or a Preview deployment as evidence that production has changed.

The lineup workflow uses the same owner UID, exact origin, and CSRF protections for all writes. Saving an owner-bound working draft requires no evidence, passphrase, or exact fixture confirmation and cannot modify participant evidence or lifecycle state. Verified confirmation continues to use the passphrase digest, lockout, short-lived challenge, exact confirmation, and deterministic audit infrastructure from coach recovery. It adds no environment value, Firestore composite index, provider request, scheduled job, queue, or paid service. Deploying the reviewed application activates the UI and server routes but performs no Firestore mutation. The existing recursive deny rule keeps Team player membership, drafts, reconciliation receipts, verified lineup snapshots, participant documents, challenges, and audits unavailable to browser clients.

The historical catalog maintains additive `teams/{teamId}/playerMemberships/{playerId}` documents as its online read model. New squad and participant synchronization and verified lineup apply maintain memberships automatically through the shared affiliation and canonical identity policy. The exhaustive discovery service is used only by this explicit repair command and makes no football-provider request. It traverses saved memberships, reviewed aliases, current-Team Players, tracked-Team Matches, every participant document under those Matches, and fixture-bound verified lineup snapshots in bounded 100-document or 100-reference reads. It preserves every existing membership, skips opponent evidence, reports unresolved canonical records, and writes only changed or missing canonical memberships in batches of at most 400. After every batch succeeds, apply writes `teams/{teamId}/playerMembershipIndex/state`; online public/admin reads fail closed until that current schema marker exists. It never edits Players, MatchParticipants, aliases, verified snapshots, Match lifecycle state, ballots, or results. The corrected backfill is available only after its reviewed release is approved, merged, declared indexes are deployed, and the application is deployed through the normal pipeline. Follow this exact order from the same reviewed commit and controlled production environment:

1. Review and approve the corrected pull request, merge it, deploy the declared Firestore indexes with the exact production project, and verify the normal Vercel deployment. Deployment alone performs no backfill write. Wait for the `results.teamId` collection-group index to become ready before the application rollout.
2. Run the read-only plan: `npm run backfill:team-player-memberships -- --project-id rating-app-prod-8b7df`. Confirm `mode` is `dry-run`, `writes` and `indexWrites` are zero, `indexWritePlanned` accurately detects the missing or stale marker, the exact project and configured Team are correct, and `existingMemberships` is at least the previously observed 31. Review Players, Matches, participants, verified lineups, aliases, page counts, new/updated/unchanged memberships, unresolved identities, grouped skip reasons, final unique membership count, and every `plannedChanges` entry.
3. Inspect unexpected candidates, unresolved canonical Players, invalid bindings, or skips through trusted read-only tooling. Stop and correct the reviewed code or source evidence if the command fails a page, reports the wrong Team/project, loses an existing membership, includes an opponent, or produces an unexplained count. A failed page aborts explicitly; do not treat partial telemetry as a complete plan.
4. Request explicit production authorization for the reviewed project, Team, planned create/update counts, and candidate list. Do not proceed from a prior general approval or from the dry run alone.
5. After that authorization, apply once with the exact confirmation: `npm run backfill:team-player-memberships -- --project-id rating-app-prod-8b7df --apply true --confirm backfill-team-player-memberships:club-sport-herediano`.
6. Repeat the read-only command. Require zero planned creates/updates, zero writes, `indexStatusBefore: complete`, `indexWritePlanned: false`, the same final unique count, and all prior memberships still present. The operation is additive and idempotent; it never deletes membership.
7. In `/admin`, search without typing and with accented/case-varied terms, progressively load multiple pages, and verify known current, historical, transferred, alias-resolved, and operator-verified Herediano Players are reachable once. Confirm an opponent-only Player remains absent and available names, positions, shirt numbers, and photos render correctly. Reconfirm a Match's lifecycle fields and voting eligibility are unchanged.

For an upcoming, live, or just-finished fixture whose voting state is still `not_ready` or `preparing_rating`:

1. Open the bounded `/admin` dashboard and sign in. Require the visible “Iniciando sesión…” state to cover password authentication, token exchange, server session creation, and console refresh without clearing the entered values. Select the exact fixture and confirm teams, kickoff, provider fixture ID, current evidence, coach assignment, and preparation status.
2. Confirm the workspace restores the owner's saved draft when present; otherwise it preloads verified evidence before provider evidence. Confirm available/unused substitutes, confirmed entrants, and unconfirmed participation remain separate. Search without typing and with an accented/case-varied name. Verify a known historical or transferred Herediano Player appears through documented Team evidence, aliases resolve to one canonical identity, opponent-only Players stay absent, and available name/position/shirt/photo metadata renders without placeholders being invented.
3. Prepare fewer than 11 starters and select **Guardar borrador**. Confirm visible saving then saved status. Reload and reopen the Match; require the exact arrangement and participation states to return. Confirm no evidence URL, reason, passphrase, or fixture phrase was requested. Inspect the Match through trusted tooling and confirm MatchParticipants, VerifiedLineupSnapshot, `ratingState`, voting timestamps, ballots, and results did not change. Create a second browser session only in a non-production validation environment to confirm a stale version is rejected instead of overwriting a newer draft.
4. Complete exactly 11 starters, add substitutes as needed, and repeat one arrangement using drag-and-drop and labeled click/keyboard controls. Confirm the starter cap, duplicate prevention, responsive wrapping, status announcement, and restore-saved-preparation action. Mark a bench Player as entered only with independent fixture evidence; leave unused and uncertain Players non-rateable. Use **Nuevo jugador** only when independent evidence identifies a Player with no usable provider identity. Confirm there is no internal-ID field, possible canonical matches remain visible while entering the name, and the allocated identity survives save and reload. Never invent a provider ID or merge by name or shirt number.
5. Open **Confirmar alineación verificada**. Confirm it names the exact Match and external fixture and summarizes starters, substitutes, and entrants. Add the independent HTTPS evidence URL and specific reason. Run preview and review every create, update, delete, and internal Player creation; preview writes nothing.
6. Enter the independent passphrase, type the exact fixture confirmation shown by the UI, and apply once. Review the deterministic audit ID and confirm the saved draft was removed by the same transaction. If the response is lost or ambiguous, retry the exact unchanged action while its action cookie remains available; do not construct a second correction. A committed receipt is recoverable after later lifecycle transitions.
7. Inspect the detail page read-only and wait for the normal lifecycle. Manual preparation does not set `ratingState`, confirm `FT`, assign a missing coach, or open/extend a window. The lifecycle must still validate final match status, at least 11 eligible tracked-Team participants, and one valid fixture head coach. Confirm the readiness action remains visible while scheduled, voting-open, finalized, or otherwise ineligible and that its disabled explanation matches the persisted state.

Production smoke testing must use a real intentionally selected fixture and independently verified evidence. Confirm an unused or unconfirmed substitute is absent from the rateable set, a confirmed entering substitute is present, opponent Players are absent, and the verified snapshot and success audit carry the exact Match, fixture, Team, evidence, owner, and trusted timestamps. Then invoke the normal lifecycle through its authenticated endpoint and confirm it remains unopened before `FT` or when coach/readiness evidence is incomplete. Do not create a production lineup solely to test route wiring.

Automatic provider reconciliation treats the verified snapshot as the stronger fixture baseline. It resolves reviewed provider aliases first, then compares canonical identities, starter/substitute roles, and participation facts. `matched` requires complete agreement; no usable lineup is `provider_missing`; missing identities, unresolved internal-only identities, and unknown participation are `provider_partial`; extra or different identities, duplicate canonical identities, role disagreement, alias disagreement, or contradictory confirmed participation are `conflict`. Bench membership alone never confirms entry. Missing and partial retries preserve an earlier matched or conflict receipt; later complete evidence may establish a new conclusive result. Conflicts fail the whole participant/coach context transaction and leave the verified materialization and coach assignment unchanged. The detail page exposes the durable receipt from `matches/{matchId}/lineupReconciliations/provider`; compare it with sanitized lifecycle logs and investigate the source evidence instead of editing either document directly. This behavior is available only after the reviewed release is deployed.

Before voting begins, an incorrect applied lineup requires a reviewed corrective lineup through the same preview and authorization flow. Preserve prior audits. If lifecycle or evidence integrity is uncertain, disable the lifecycle workflow before correction. Once voting, ballots, results, or result revisions exist, lineup mutation is prohibited: preserve the snapshot, participants, ballots, timestamps, results, and revisions and handle the event as an integrity incident. Application rollback is a redeploy of the last known-good build; it must not delete verified snapshots or audits. Revoking the owner and rotating the admin passphrase follows the owner-console incident procedure above.

## Manual voting opening after an attested final whistle

Use this recovery only when the match has actually ended and API-Football has not yet supplied timely final status or complete evidence. It performs no provider request. In `/admin`, open the exact Match and complete the verified lineup and fixture-specific verified coach workflows first. Confirm the readiness checklist shows exactly 11 starters, only known entering substitutes as participating, no unresolved reconciliation conflict, and the expected Team and provider fixture.

Select the two-hour default close or enter an exact future Costa Rica local date and time. Supply an independent HTTPS final-whistle source and a specific reason, check the explicit final-whistle attestation, and review the zero-write preview. Confirm its observed provider status, trusted proposed opening, UTC-converted close, effective duration, eligible counts, and coach. Authorize with the separate admin passphrase, then type `open-voting:<matchId>` exactly. Apply revalidates the close against trusted server time and commits the attestation, immutable original window, pending notification state, consumed challenge, and deterministic success audit atomically.

After success, inspect `matches/{matchId}`, `finalWhistleAttestations/manual`, and the matching `adminAudit` receipt. Confirm `votingOpeningMode` is `manual`, the window opened at trusted apply time, default duration is exactly two hours when selected, unused and unconfirmed substitutes remain ineligible, the supporter ballot contains only the verified tracked-Team participants and coach, and aggregates remain hidden until close. Repeat the exact request only to recover an indeterminate response; it must return the same receipt. A later provider sync may update status and score but must preserve the attestation, participants, opening provenance, and timestamps.

For a non-production smoke test, cover scheduled and live provider states, default and custom close choices, delayed authorization, exact confirmation, notification failure, and an exact retry. Verify missing coach, incomplete lineup, wrong fixture or Team binding, draft-only data, canonical identity gaps, material conflicts, expired custom close, existing ballots/results/revisions, and prior attestation all fail without writes. Roll back application code through the normal deployment pipeline and preserve every attestation, audit, ballot, result, and lifecycle timestamp for investigation. Never edit these documents manually.

## Player identity reconciliation operation

This owner-only workflow is dormant until the reviewed application and the declared `participants.playerId` and `lineupDrafts.ownerId` collection-group indexes are deployed and ready. Deployment performs no identity mutation and makes no API-Football request.

1. Open `/admin` and select **Reconciliar identidades de jugadores**. Search for and select the operator-verified Player. Enter the genuine numeric API-Football Player ID, an independent HTTPS evidence URL, and a specific review reason. Do not decide from name, shirt, position, or photo similarity.
2. Choose **Son la misma persona** or **No son la misma persona**. Review both identity cards, Team and Match evidence, warnings, protected-history counts, prior decision, and every proposed write. Preview must create no alias, review, Player, membership, draft, challenge, or audit.
3. Stop if the service reports conflicting aliases, both identities in one Match, ambiguous provider evidence, ballots, voting state, or provider-ID published results. Preserve history and investigate through trusted read-only tooling; never edit participant, ballot, result, alias, or audit documents directly.
4. Enter the independent passphrase and exact `reconcile-player:<canonicalPlayerId>` confirmation. Apply once and retain the deterministic audit ID. An exact retry with the original challenge returns the same receipt without repeating writes.
5. For a same-person decision, confirm the provider alias targets the operator-created canonical Player; its verified display name and provenance remain intact; the provider Player document, applied lineups, MatchParticipants, ballots, and results remain unchanged; Team membership includes provider search evidence; and any safe owner draft now references the canonical survivor. Run the normal provider sync only through its existing trusted path and confirm the reviewed alias remains authoritative.
6. For a nonmatch decision, confirm an active `playerIdentityReviews` record exists and no alias changed. A later reviewed same-person decision may mark that record corrected in the same authorized transaction.

Production smoke testing should use an actual unresolved operator-created Player only when a later provider identity and independent evidence exist. For route and UI validation without such a case, use the emulator or an explicit development project. Roll back by redeploying the previous application; preserve aliases, reviews, audits, Players, memberships, drafts, and all Match history for investigation.

## Prompt lifecycle readiness operation

This owner-only action uses the existing Firebase owner session, exact origin and CSRF checks, independent passphrase, lockout, short-lived one-use challenge, and deterministic audit receipt. It adds no environment variable, paid scheduler, worker, or queue. It is available only for the canonical live or recently finished Match while `ratingState` is `not_ready` or `preparing_rating`, and accepted requests are limited to one per Match per minute.

1. Open `/admin`, select the current fixture, and inspect its match detail. Confirm the provider fixture ID, 11 confirmed starters or the known gap, entering substitute status, unused or unconfirmed count, head-coach readiness, and provider or operator evidence provenance.
2. Review the last provider sync and lifecycle execution fields. `finishedObservedAt` means the server first observed normalized provider `FT`; it is not the exact final whistle. When present, compare it with participant reconciliation and voting-open times to measure the application delay. Do not infer provider publication delay when its publication timestamp is unavailable.
3. Select **Verificar preparación y solicitar sincronización**, review the fixture-bound preview, enter the independent passphrase, and type `request-lifecycle:<matchId>` exactly. Apply once.
4. Review the deterministic audit ID and the explicit execution state: `requested`, `running`, `skipped_busy`, `completed`, `failed`, or `voting_open`. Use **Consultar estado** manually; the console does not poll. `voting_open` is authoritative only when the persisted Match has an active window.
5. For `skipped_busy`, inspect the recorded shared attempt and use **Consultar estado** after that run finishes. The request adopts completion only when the same attempt reports the same Match. For a retryable `failed` receipt, wait for the server backoff and use **Reintentar ejecución** with the unchanged action. Recovery expires ten minutes after the original commit and is bounded to five request claims and three provider executions. It creates no second authorization audit.
6. Confirm pre-`FT` runs remain unopened. After `FT`, require at least 11 tracked-Team confirmed participants and the fixture-specific head coach before `ratingReadyAt` and the original two-hour voting window appear. Missing evidence and provider outages must remain retryable `preparing_rating` outcomes.

If a new request is rate limited, wait at least one minute and refresh before deciding whether another provider check is necessary. Do not start a new authorization to recover a committed request: exact challenge replays return and advance its durable receipt under the retry bounds. If a request remains `running` beyond its request lease or its observed shared lease disappears without a matching completion, status reconciliation records a retryable `failed` outcome. Never use this action to compensate for an unrelated historical fixture, edit lifecycle fields manually, or bypass a readiness blocker. Disable the existing workflow during an integrity incident using the standard rollback procedure; preserving the Match, audit, execution metadata, ballots, and results takes priority over another trigger.
