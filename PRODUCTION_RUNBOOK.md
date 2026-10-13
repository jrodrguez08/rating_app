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

Jugadores V1 adds the tracked-Team/kickoff match-history composite index and participant collection-group single-field index declared in `firestore.indexes.json`. Lifecycle readiness additionally requires the collection-scoped `participants(participated, teamId)` composite index used by `countRateableParticipants()`. Deploy all declared indexes with the explicit `firestore:indexes` command before relying on player pages or post-FT voting readiness in production.

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

When no relevant future match is known, discovery is attempted at most every 12 hours. A known fixture beyond 24 hours makes no provider request; within 24 hours it refreshes at most every six hours, within two hours every 15 minutes, and live/preparing matches on each external trigger. From approximately T-60m through kickoff, a scheduled match adds one focused lineup request only while a complete snapshot is missing; the 30-minute scheduler is approximate, no exact observation time is guaranteed, and a successful snapshot stops lineup polling. Final readiness adds three focused requests (lineups, players, events) after the normal fixture refresh. Active voting, finalization, and finalized results make no context requests. After a result, discovery eventually imports the next fixture; active voting, live, preparing, and scheduled matches outrank historical results on Home.

API-Football has confirmed that fixture lineup publication can be followed by a cache interval in which the focused endpoint returns either an empty collection or Team/coach entries that omit `startXI` or `substitutes`. Treat both shapes as “currently no usable lineup observed,” not permanent absence or malformed data; they remain retryable. An explicitly present player field with a non-array value is structurally malformed and still fails closed. A trusted persisted snapshot and its fixture-specific coach survive unavailable or smaller later responses; malformed/incomplete evidence writes nothing. A coach published without both player arrays is not persisted independently because participant and coach context is validated and written atomically. Do not substitute `/coachs?team=...`, current roster membership, names, or bench presence for fixture evidence. At `FT`, only stable-ID substitution events or positive player minutes can add bench participation, and missing coach or insufficient participant evidence remains safely `preparing_rating` for a later scheduler retry.

Every authenticated lifecycle response includes an ordered `logs` trace that the GitHub Actions `curl` invocation prints, including for HTTP failures through `--fail-with-body`. The same compact JSON entries appear in server logs. Use them to follow match/status selection, fixture score and elapsed-minute refresh, lifecycle phase, focused lineup/player/event structure, aggregate reconciliation, readiness and its blocking reason, voting/finalization, final action, and bounded provider request count. These entries intentionally omit raw provider payloads, individual player details, credentials, authorization headers, Firebase configuration, voters, ballots, and account data; logging is best-effort and does not add provider calls or alter lifecycle behavior.

When voting opens, the response can also include the safe notification outcome. Delivery occurs only after the window is durable. Notification failure therefore requires investigation and a later lifecycle retry, never a window rollback or timestamp edit. A successful operator reopen command applies the transaction first and then reports its notification outcome in the same JSON output.

Normal additional context cost is one pre-match lineup request and three final reconciliation requests. If no pre-match snapshot is captured, final reconciliation can establish it when focused lineups are available. With an approximately 30-minute scheduler, the pre-match window adds at most about three lineup requests while empty; a persistently incomplete finished match can use four total provider requests per retry (fixture + three context endpoints) for the existing eight-hour relevance horizon, up to roughly 64 requests in the conservative worst case. Monitor provider quota and investigate persistent `preparing_rating` rather than adding in-process sleeps or unbounded retries.

The Partidos archive reads the fixture window already persisted by discovery and makes no additional API-Football requests on page views. Confirmed goal events and optional live elapsed minutes are refreshed only through the existing bounded fixture discovery/focused lifecycle calls. Historical archive entries do not enter the active lifecycle polling loop.

Jugadores pages use server-only, provider-free read-time derivation over at most 100 newest persisted tracked-Team matches, their immutable result summaries, and known participant/Player identities. They never read ballots and require no projection or production backfill; existing closed pilot results appear automatically. If the bound becomes insufficient, measure production volume/read cost before introducing an explicit trusted projection or migration.

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
