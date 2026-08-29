# Rating App

Mobile-first supporter ratings for football matches. The first community is Club Sport Herediano, while the domain remains club-neutral.

## Foundation status

The repository now includes Spanish/English localization, tracked-Team football persistence, match-aware lifecycle synchronization, a lifecycle-aware Home scoreboard, persistent low-friction voter identity through Firebase Anonymous Authentication, and the match rating ballot. A trusted server route accepts exactly one complete, participant-only ballot per Firebase UID during the stable server-controlled voting window. Results and aggregates are not implemented.

## Localization

Spanish (`es`) is the default and fallback product locale; English (`en`) is equally supported. The language switcher writes a validated `rating-app-locale` cookie and refreshes the current route so Server Components, metadata, and `<html lang>` agree without hydration mismatch. Routes remain locale-neutral—there are no `/es` or `/en` route trees.

Typed, build-time message resources live in `src/i18n/messages`. Every visible product string must be present in both resources. `src/i18n/format.ts` centralizes product date and number formatting with native `Intl`, using `es-CR` and `en-US`; persisted timestamps remain UTC. Club, competition, player, and coach proper nouns remain untranslated provider/domain data.

## Developer workflow

Requirements: Node.js 22 and npm. CI uses the same Node major version.

```bash
npm ci
copy .env.example .env.local
npm run dev
```

The page works without Firebase values and will not contact a Firebase project. `.env.example` is committed, `.env.local` is ignored and developer-owned, and CI variables must be supplied by CI configuration when a future test needs them.

Common commands:

```bash
npm run dev           # local Next.js server
npm run format        # write Prettier formatting
npm run format:check  # check formatting only
npm run lint          # ESLint
npm run typecheck     # strict TypeScript check
npm test              # all Vitest tests once
npm run test:watch    # Vitest watch mode
npm run test:firebase # Auth/Firestore emulator integration and security-rule tests
npm run sync:football # import bounded API-Football data into the emulator
npm run sync:match-participants -- <match-id> # import one match's squad, participants, and coach
npm run sync:lifecycle # run match-aware lifecycle logic against the emulator
npm run build         # production build
npm run verify        # canonical complete local/CI quality gate
```

## Firebase setup

Firebase environments are explicit:

- `local` always uses the Auth and Firestore emulators and defaults to the safe `demo-rating-app-local` project ID.
- `development` requires a complete Firebase Web configuration for a separate cloud development project.
- `production` requires a complete production Web configuration and must never be used for local seeding or tests.

For local persistence work, install Java and Firebase CLI 15.28.2 separately, copy `.env.example` to `.env.local`, and run:

```bash
npm run firebase:emulators
```

Auth runs on 9099, Firestore on 8080, and the Emulator UI on 4000. In another terminal, explicitly bootstrap the deterministic initial Team:

```bash
npm run seed:firebase
```

The bootstrap targets Firestore at `127.0.0.1:8080` by default, accepts only a local host and `demo-*` project ID, creates `teams/club-sport-herediano` only when absent, and never runs during app startup. Browser Auth uses `127.0.0.1:9099` in local mode. Run `npm run test:firebase` to start isolated Auth and Firestore emulators, verify identity, persistence, and rules, then stop them.

## Voter identity

The browser quietly ensures a Firebase anonymous user on first visit. Firebase UID is the canonical `voterId`, Firebase's native persistence reuses it on normal reloads, and no `voters/{uid}` document, login screen, logout/reset control, or raw UID display is created. Concurrent initialization calls share one sign-in attempt. In local mode Auth must use the emulator; malformed hosted configuration fails instead of falling back to cloud behavior.

Anonymous authentication identifies a browser profile, not a person. Clearing storage, incognito, another browser/device, or another anonymous account can produce a different UID. Rating App does not use fingerprinting. Future provider linking may upgrade the same Firebase account while preserving its UID where Firebase supports it; automatic anonymous-account cleanup is not assumed.

Authentication does not grant general database access. Current rules deny authenticated clients access to matches, lifecycle data, participants, coaches, and ballots. The browser sends its Firebase ID token to the trusted `GET`/`POST /api/matches/{matchId}/ballot` boundary; the server verifies the token and derives `voterId` rather than accepting identity from the payload. Inside a Firestore transaction it reloads the authoritative match, exact tracked-Team participants, head coach, and deterministic `matches/{matchId}/ballots/{voterId}` path. It validates the server-controlled window, exact participant keys, coach identity, and integer ratings from 1 through 10 before a create-only write with a server timestamp. Repeated or concurrent submissions cannot edit the first ballot. Individual ballots are never readable through the client SDK.

To exercise the real provider manually, set the server-only `API_FOOTBALL_KEY` in `.env.local`, keep the emulator running, seed the Team, then run `npm run sync:football`. The command resolves an exact Team name-and-country match once, fetches a bounded 120-day history and 60-day future window, and upserts only fixtures involving that Team. It makes one metadata request and one fixture request per distinct provider season overlapping the window; the initial unmapped run adds one Team lookup. It reports created, updated, and unchanged counts. Never prefix this key with `NEXT_PUBLIC_` or expose it to browser code.

After fixture sync, choose a persisted internal match ID and run `npm run sync:match-participants -- <match-id>`. The command loads that Match and its tracked Team, makes one combined fixture-detail request, and upserts only that Team's `players`, match-scoped `participants`, `coaches`, and deterministic `head-coach` assignment. Stable provider Team IDs—not home/away position or response order—scope the import. Starters are confirmed participants. Bench players become participants only through a stable-ID substitution event or positive provider minutes; unused or unconfirmed substitutes remain non-rateable. Future eligibility requires both the persisted tracked Team ID and `participated: true`, so opponent players and coaches cannot enter the MVP rating set. Repeated runs preserve identities and `createdAt`, while later provider data may safely improve participation and minute snapshots. Missing lineups, tracked-Team data, or coach data fail without inventing eligibility.

`teams/{teamId}` is public-readable and denies all browser writes. Synced `competitions`, `seasons`, `matches`, `players`, `coaches`, participants, and coach assignments remain browser deny-all until a product surface requires carefully scoped reads. The Firebase CLI is intentionally not a project dependency because its large dependency tree is unnecessary for application builds. CI installs a pinned CLI version separately and runs the emulator suite after `npm run verify`.

## Scheduled lifecycle setup

The internal `POST /api/internal/match-lifecycle` route reuses the same lifecycle service as `npm run sync:lifecycle`. It requires these server-only Vercel variables:

- `CRON_SECRET`
- `API_FOOTBALL_KEY`
- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY` with newlines escaped as `\\n`

Do not use `NEXT_PUBLIC_` for any of them and do not commit a service-account file. Configure Firebase Admin credentials for an explicit development project before a production project. The route is stateless and Vercel-compatible; emulator tests use test doubles/local REST and never cloud credentials.

The `Match lifecycle trigger` GitHub workflow is manually dispatchable and scheduled every 30 minutes. Add repository secrets `LIFECYCLE_SYNC_URL` (the full deployed endpoint URL) and `CRON_SECRET` (the same value configured on Vercel) only after the endpoint is deployed. Until both exist, the workflow skips successfully, avoiding recurring calls to a nonexistent deployment. Each configured run is a lightweight HTTP trigger; persisted match state performs most idle early exits without an API-Football request. Fixture discovery runs at most twice daily when no upcoming match is known, focused polling increases near/live matches, and frequent polling stops once the rating window exists. This avoids new paid scheduler infrastructure but GitHub/Vercel plan usage should be monitored rather than treated as an unconditional billing guarantee.

Rating App stores provider fixture `status` separately from product `ratingState`. `FT` first enters `preparing_rating`; only a successful final sync with at least 11 rateable tracked-Team participants and its head coach creates `ratingReadyAt`, `votingOpensAt`, and an immutable `votingClosesAt` two hours later. Postponed, cancelled, abandoned, failed, and stale historical fixtures do not open a window.

To use a cloud development project later, register a Web app, set `NEXT_PUBLIC_FIREBASE_ENVIRONMENT=development`, and provide every public Firebase value in `.env.local`. Do not reuse production values. No production credentials, Admin SDK, or deployed Firebase resources are required for this milestone.

## Repository guardrails

Prettier owns formatting, ESLint owns code-quality checks, and strict TypeScript owns static correctness. Optional repository-level VS Code settings align format-on-save with these tools. Pull requests and pushes to `master` run `npm ci` followed by `npm run verify`; CI does not deploy or require Firebase credentials.

There is no pre-commit framework yet. At this repository size, the canonical local gate and CI provide sufficient protection without adding hook lifecycle dependencies. Reconsider lint-staged and Husky only if commit-time feedback becomes a demonstrated need.

## Source map

- `src/app`: App Router UI
- `src/components`: reusable presentation components
- `src/config`: initial community/club presentation configuration
- `src/domain`: provider-neutral entities and ports
- `src/lib/firebase`: browser and future privileged-server boundaries
- `src/lib/providers`: provider adapters behind domain ports
- `src/application`: provider-neutral synchronization orchestration
- `src/i18n`: locale config, typed messages, cookie resolution, and formatters
- `scripts`: explicit emulator bootstrap and sync entry points
- `firestore.rules`, `firebase.json`: secure default and local emulator shape

Read [PRODUCT.md](PRODUCT.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), and [AGENTS.md](AGENTS.md) before product changes.
