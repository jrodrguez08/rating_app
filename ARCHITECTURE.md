# Architecture

## Application shape

Next.js App Router and strict TypeScript form the web application. Pages and layouts are Server Components by default; use Client Components only for browser state or interaction. Tailwind CSS consumes semantic tokens. Domain types and ports do not import Firebase or React.

`src/config` selects the initial club presentation. `src/domain` describes stable business concepts and provider-neutral ports. `src/lib/firebase/browser.ts` lazily initializes one shared web SDK app and derives Firestore and Auth from it only when called and configured. Local mode always connects both services to their explicit emulators and never falls back to a cloud project. Development and production modes require complete Firebase Web configuration. Explicit local scripts use the emulator's REST API; the internal server route lazily initializes Firebase Admin from server-only environment credentials for trusted development/production writes. No Admin object or credential enters browser modules.

Presentation uses semantic game tokens for structure and CSS custom properties for club primary/secondary colors. `AppShell` maps the selected `TeamPresentation.theme` into those properties at the presentation boundary; generic components never depend on Herediano-named colors. Tailwind utilities consume the tokens, while a small set of global conventions supplies crisp panels, status badges, controls, and hard shadows. This changes presentation only and does not localize or duplicate domain data.

## Internationalization

Exactly `es` and `en` are defined in `src/i18n/config.ts`; `es` is the default and fallback. Server Components resolve the `rating-app-locale` cookie on each request. Missing, malformed, and unsupported values resolve to Spanish. The root layout uses the same result for localized metadata and `<html lang>`. A small Client Component renders the language switcher, persists a one-year same-site cookie, and calls `router.refresh()`; it receives its initial locale and labels from the server and does not own a competing locale default.

Routes remain stable and locale-neutral (`/`, with future `/matches` and `/players`) because the current application does not need locale-specific URLs or duplicated route trees. Message resources are bundled TypeScript objects under `src/i18n/messages`; the English resource is statically checked against the Spanish canonical shape, with a runtime alignment test. Translation lookup does not perform network requests. Product-facing dates and numbers use centralized native `Intl` helpers with `es-CR` or `en-US` and Costa Rica display time where appropriate; persisted timestamps remain UTC.

Translations cover presentation labels only. Provider/domain names—including teams, competitions, players, and coaches—remain authoritative proper nouns and are not copied into localized persistence fields. Locale selection and club theme are independent.

## Proposed Firestore model

Top-level collections use generic IDs:

```text
teams/{teamId}
competitions/{competitionId}
seasons/{seasonId}
players/{playerId}
coaches/{coachId}
matches/{matchId}
matches/{matchId}/participants/{playerId}
matches/{matchId}/coachAssignments/{coachId}
matches/{matchId}/ballots/{voterId}
matches/{matchId}/aggregates/summary
players/{playerId}/matchSummaries/{matchId}
players/{playerId}/statistics/{seasonOrCareerId}
```

The implemented `teams/{teamId}` document contains `displayName`, `shortName`, `countryName`, `countryCode`, `brandingKey`, optional `externalProviderId`, and Firestore `createdAt`/`updatedAt` timestamps. `club-sport-herediano` is the stable initial ID. The seed JSON is the canonical basic Team data; presentation configuration derives its identity and names from that record while keeping theme colors in source code. Firestore snapshots are converted and runtime-validated at the persistence boundary before becoming domain `Team` values.

An explicit emulator-only script ensures the initial document exists. It requires a local emulator host and a `demo-*` project ID, creates only when absent, and only adds a missing `countryName` to a pre-milestone record. It never runs during application rendering or startup.

A match stores tracked team, opponent, home/away IDs, competition, season, kickoff, status, score, provider fixture ID, and voting bounds. A durable Player stores provider-mapped identity and current name/position metadata in `players/{playerId}`. A match participant at `matches/{matchId}/participants/{playerId}` explicitly stores internal and provider Team IDs alongside the historical name, number, position, squad role (`starter` or `substitute`), `participated`, and optional confirmed entry/exit minutes. Global Player records never contain match participation or permanent club membership. The tracked Team's head coach has durable identity in `coaches/{coachId}` and one match-specific `matches/{matchId}/coachAssignments/head-coach` document with the same explicit Team ownership; the fixed assignment path models the single rateable coaching role without modeling a full staff. Future ballot selection must require `participant.teamId == match.trackedTeamId && participant.participated == true`. For the current configuration this selects only confirmed Club Sport Herediano participants and its head coach; opponent players and coaches remain outside MVP rating scope. A future club changes the tracked Team data, not this logic.

A completed ballot is one document containing a map of player IDs to ratings and one coach rating. Its document ID is the authenticated `voterId` inside the match's `ballots` subcollection. A Firestore transaction creates only if absent; security rules require `request.auth.uid == voterId`, immutable match/voter identity, a valid open window, and eligible rating keys. A server-controlled match state is authoritative. This deterministic path plus transaction and rules enforces `one voter + one match` without a per-score write explosion.

## Aggregation

On accepted ballot creation, a future trusted Cloud Function transaction updates `matches/{matchId}/aggregates/summary`. When voting closes, it materializes player match summaries and incrementally updates season/career statistics. Public reads target these summaries rather than scanning ballots. Ballots remain private and aggregates are rule-protected until the window closes. Idempotency/event markers are required before implementing triggers.

## Authentication and security

Firebase Anonymous Authentication now establishes low-friction voter identity in the browser. The root layout keeps server rendering intact and mounts a zero-UI Client Component that calls the focused auth boundary. That boundary waits for Firebase Auth initialization, reuses `currentUser`, shares concurrent first-load work, and signs in anonymously only when needed. Firebase's native browser persistence retains the UID across normal reloads and visits; the application does not mirror it to local storage or create a `voters/{uid}` document. Local mode connects Auth to `127.0.0.1:9099` once per app, including across Fast Refresh, while development and production never connect to the emulator.

Firebase UID is the canonical `voterId`. The future deterministic path is `matches/{matchId}/ballots/{voterId}`, with rules requiring `request.auth != null && request.auth.uid == voterId`; ballot shape, window, eligibility, rating-range, create-only, and aggregate protections remain deferred to the ballot milestone. Authentication is not authorization: current rules still grant no match, lifecycle, participant, coach, sync-metadata, or ballot access to an anonymous user. Team documents remain public-readable and client-write-denied.

Anonymous identity is device/browser storage identity, not verified person identity. Clearing storage, using incognito, another browser/device, or creating another anonymous account can bypass person-level uniqueness; fingerprinting is intentionally excluded for the initial small supporter group. Future Firebase provider linking can upgrade an anonymous account while preserving its UID where supported. Automatic anonymous-account cleanup is not assumed. App Check is a future public-launch abuse-hardening option, not part of this foundation.

Never expose Admin credentials or raw voter UIDs in normal UI. Public Firebase web configuration is not secret, but belongs in environment-specific files. Use separate development/production projects and Auth/Firestore emulators for local work. Validate App Check and abuse controls before public launch.

## Provider boundary

`FootballDataProvider` is the provider-neutral port. `ApiFootballAdapter` uses native server-side `fetch`, sends `API_FOOTBALL_KEY` only in the provider request header, validates response shapes, normalizes UTC timestamps and statuses, and converts payloads into provider-neutral values. The application sync orchestration depends only on this port and `FootballSyncStore`; UI and voting logic never consume raw provider responses.

The manual sync resolves an unmapped Team by exact normalized name and country, then stores the provider ID only after all fetched data validates. It fetches the Team's competition/season metadata, selects distinct provider seasons overlapping a bounded fixture window (120 days back and 60 days ahead), and queries those seasons sequentially to avoid request bursts. It persists only competition-season pairs represented by fixtures involving the tracked Team. Deterministic IDs derived from provider identities make repeated imports idempotent, while updates preserve document identity and `createdAt`. Match documents store home/away snapshots so opponents do not require a global Team import. Provider failures abort before writes.

For a specific persisted match, the participant sync makes one `GET /fixtures?id=...` request. Stable provider Team identity selects the tracked-Team lineup regardless of home/away position or response order; that lineup establishes starters, bench membership, and head coach. Stable-ID substitution events confirm entering substitutes and entry/exit minutes, while positive player-stat minutes provide corroborating participation when that block is populated. Starters participate by definition. A bench player without either substitution or positive-minute evidence remains `participated: false`; missing data is never guessed. Duplicate events reconcile by provider player ID. Only tracked-Team Players and MatchParticipants are persisted, and only its coach can populate the deterministic head-coach assignment. The full response validates before writes, and deterministic provider-mapped IDs make Player, participant, Coach, and assignment upserts idempotent while preserving `createdAt`. Re-running after provider finalization may update snapshots and change a previously unconfirmed substitute to participating before voting lifecycle code consumes the records.

Local sync persistence remains restricted to a local Firestore host and `demo-*` project. Trusted hosted lifecycle invocations use Firebase Admin with explicit server credentials. Browser rules continue to allow public Team reads and deny all client access to matches, lifecycle fields, participants, coaches, and sync metadata; Home reads lifecycle context on the server. Ballot data remains deferred.

Live Pro verification on 2026-08-29 used API-Football fixture `1551668` (CS Herediano vs Sporting San José, Primera División, 2026-08-23 UTC). The combined fixture response supplied 11 starters, 10 substitutes, five tracked-Team substitution events, and head coach Jafet Soto. It normalized to 16 confirmed participants and five unused substitutes in one match-context request. The embedded Costa Rican player-stat entries did not expose positive minutes for this fixture, so substitution events are required rather than treating statistics as the sole participation source.

## Match lifecycle and scheduling

Provider-neutral fixture `status` and the Rating App `ratingState` (`not_ready`, `preparing_rating`, `rating_ready`, or `rating_closed`) are separate Match facts. Focused refresh time, successful participant/readiness time, and voting bounds are compact server-controlled lifecycle fields.

The lifecycle service first reads persisted matches and `footballSyncMetadata/{teamId}`. Active rating windows take priority, then live matches, recently finished/preparing matches, and the earliest future scheduled match. Historical finished fixtures are never backfilled into new voting windows. Fixture discovery is separate from focused lifecycle refresh: when no upcoming match is known it runs at most every 12 hours, while a known fixture uses one `GET /fixtures?id=...` request. Matches beyond 24 hours early-exit; within 24 hours they refresh no more than every six hours, within two hours no more than every 15 minutes, and live/preparing matches refresh whenever the external trigger runs. Postponed/suspended fixtures retry conservatively; cancelled/abandoned fixtures never create a window.

Provider final status alone never opens voting. A finished fixture moves to `preparing_rating`; final participant/head-coach synchronization must succeed, at least 11 tracked-Team participants must be rateable, and the deterministic tracked-Team head-coach assignment must exist. Only then does the service set `ratingReadyAt`, `votingOpensAt`, and `votingClosesAt` two hours later. Existing timestamps always win on repeated runs. Failures leave the match retryable and unopened; terminal rating states do not regress on transient provider status.

A private GitHub Actions workflow runs every 30 minutes and performs only an authenticated `POST` to `/api/internal/match-lifecycle`; it does not check out or install the repository. Missing deployment secrets make scheduled runs exit successfully without calling anything. This uses existing GitHub/Vercel capacity and adds no separately billed scheduler, worker, queue, or always-on service under the current usage assumption; actual plan consumption must still be monitored. `CRON_SECRET` protects the endpoint with constant-time bearer comparison. Vercel holds API-Football and Firebase Admin credentials, while GitHub needs only the endpoint URL and matching cron secret.

Controlled live verification on 2026-08-29 discovered API-Football fixture `1551672` (CS Cartaginés vs CS Herediano, 2026-08-30 17:00 UTC) and then refreshed that persisted fixture with exactly one focused provider request. The lifecycle remained `not_ready` with no voting timestamps while the provider status was scheduled, confirming that an away fixture is selected without opening a window early.

Home reads relevant Match data through the server-side Admin boundary, so client Firestore rules remain unchanged. Without Admin configuration or a relevant persisted match, Home retains the honest empty state. With data, a localized scoreboard panel shows upcoming, live, preparing, or rating-ready context without exposing a ballot.

## Multi-team scaling

Every match references a tracked `teamId`; community and theme configuration selects the current context. Collections, indexes, rules, and aggregates remain generic. This supports another club without premature tenant administration or separate schemas.

## Deployment and cost

Deploy the Next.js app to a platform compatible with its server runtime (initially Vercel is suitable) and use Firebase Auth/Firestore free tiers. Prefer static/server rendering, cached provider imports, compact ballot documents, materialized aggregates, and bounded reads. Cloud Functions and scheduled imports are deferred until needed; monitor quotas before opening beyond the initial group.
