# Production pilot runbook

Rating App is prepared for a controlled Vercel + Firebase production pilot. This is an execution checklist, not evidence of deployment. No production environment is currently configured.

## Architecture and prerequisites

The browser loads the Node.js 22 Next.js app from Vercel and uses Firebase Authentication directly for persistent anonymous identity. Server-rendered pages and trusted endpoints use Firebase Admin with Cloud Firestore. API-Football Pro is called only by the lifecycle service. A private GitHub Actions workflow sends a credentialed request to the deployed lifecycle endpoint every 30 minutes; it performs no checkout or dependency installation.

Prepare Node.js 22, Firebase CLI 15.28.2, a production Firebase project, a Firebase Web app, a narrowly held Admin service-account key, a Vercel project, an API-Football Pro key with current quota, and repository-admin access. Use an exact production project ID that does not start with `demo-`.

## Canonical environment inventory

### Vercel browser-visible values

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

Never configure `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `GCLOUD_PROJECT`, or public emulator host/port variables in Vercel production. Hosted runtime validation rejects emulator hosts and demo projects.

### GitHub repository secrets

- `LIFECYCLE_SYNC_URL`: full production `/api/internal/match-lifecycle` URL
- `CRON_SECRET`: exactly the same value as Vercel

No Firebase or API-Football credential belongs in GitHub for this workflow.

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

Current server queries need only automatic single-field indexes; `firestore.indexes.json` intentionally contains no composites. Reassess after query changes.

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
10. Add the two GitHub secrets, manually dispatch `Match lifecycle trigger`, and require a successful workflow plus a safe lifecycle response.
11. Allow the schedule to operate only after the manual dispatch and Firestore inspection pass.
12. Share the pilot URL only after the infrastructure smoke test is complete.

## Request discipline and autonomous lifecycle

Partidos page reads remain server-only and provider-free. During an active voting window, the existing browser identity boundary makes a separate authenticated, no-store ballot-status request for each rendered actionable match; that endpoint returns only a sanitized status and never exposes a UID or ballot content. A submitted voter is not offered another rating action, status-read failures expose no action, and result visibility remains governed solely by trusted close/finalization.

Provider snapshot merging is non-destructive when a response omits its event collection: already confirmed goal events remain stored. An explicit event array replaces the snapshot after normalization, including when that array confirms no goals. Missing optional live elapsed time likewise preserves the last persisted minute; provider score fields remain canonical.

Before discovery or fixture refresh, every lifecycle trigger checks persisted matches for an expired `rating_ready` window. That pending aggregation outranks later live or scheduled fixtures until finalization succeeds, uses only persisted participants, coach assignment, and ballots, and makes zero API-Football requests. A failed aggregation stays `rating_ready` with its original voting timestamps and is retried first on the next trigger; successful finalization atomically creates the deterministic summary and closes the match without reopening or extending the window.

When no relevant future match is known, discovery is attempted at most every 12 hours. A known fixture beyond 24 hours makes no provider request; within 24 hours it refreshes at most every six hours, within two hours every 15 minutes, and live/preparing matches on each external trigger. Participant/head-coach readiness uses one focused fixture request. Active voting, finalization, and finalized results do not cause aggressive provider polling. After a result, discovery eventually imports the next fixture; active voting, live, preparing, and scheduled matches outrank historical results on Home.

The Partidos archive reads the fixture window already persisted by discovery and makes no additional API-Football requests on page views. Confirmed goal events and optional live elapsed minutes are refreshed only through the existing bounded fixture discovery/focused lifecycle calls. Historical archive entries do not enter the active lifecycle polling loop.

Network/provider validation, missing lineup/coach, Firebase write, and aggregation integrity failures remain retryable. They cannot open voting early, extend timestamps, replace ballots, publish partial results, or regress finalized state. Cancelled/abandoned matches never open or finalize ratings; postponed/suspended matches retry conservatively.

## Infrastructure smoke test

- App shell loads in Spanish and English with no raw error details.
- Anonymous Auth creates and reuses an identity; no UID is visible.
- Authenticated health returns `ready`; missing/wrong secret returns 401.
- Firestore Team read succeeds through Admin; browser writes and protected reads fail.
- Authenticated lifecycle returns a bounded operational response; wrong secret returns 401 and missing API key returns a sanitized 503.
- Vercel logs show only safe action, match ID, and provider-request count. GitHub logs do not echo secrets.
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

Never log, commit, paste into issues, or expose these values to browser variables.

## Known pilot limitations

- Anonymous Auth identifies a browser profile, not a person; it is not strict one-person-one-vote.
- App Check and broader abuse controls are not enabled yet.
- Player histories and season leaderboards are deferred; Partidos V1 provides persisted fixture history but not advanced archive filtering.
- Final aggregation reads all ballots once and assumes small-community volume.
- The GitHub schedule is approximate and consumes private-repository Actions minutes.

## Dependency audit disposition

`npm audit` currently reports eight moderate findings for `uuid` below 11.1.1 through Firebase Admin's `@google-cloud/firestore`/storage transport chain. The advisory concerns caller-supplied buffers in UUID v3/v5/v6; Rating App neither imports that transitive package nor calls those UUID APIs. npm offers no compatible remediation and `--force` would downgrade Firebase Admin to 10.3.0, so the forced fix is rejected. This is acceptable for the controlled pilot, not a production blocker; monitor Firebase Admin releases and apply the first compatible upstream resolution.
