# Architecture

## Application shape

Next.js App Router and strict TypeScript form the web application. Pages and layouts are Server Components by default; use Client Components only for browser state or interaction. Tailwind CSS consumes semantic tokens. Domain types and ports do not import Firebase or React.

`src/config` selects the initial club presentation. `src/domain` describes stable business concepts and provider-neutral ports. `src/lib/firebase/browser.ts` lazily initializes the web SDK only when called and configured. Local mode always connects Firestore to the explicitly configured emulator and never falls back to a cloud project. Development and production modes require complete Firebase Web configuration. Explicit scripts use the emulator's REST API as their privileged local boundary; Firebase Admin remains absent.

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

Start with Firebase Anonymous Authentication for low friction. Domain data keys by Firebase UID, so upgrading or linking an anonymous account to Google, email link, or another provider preserves identity. Authentication is not authorization: future Firestore rules will validate document ownership, match state, window bounds, rating ranges, and allowed keys. Team documents are intentionally public-readable because the product displays club identity without authentication; all browser Team writes remain denied, and every other collection remains deny-all. Development bootstrap uses the emulator's privileged REST context and cannot target a non-local host or non-demo project.

Never expose Admin credentials to the browser. Public Firebase web configuration is not secret, but belongs in environment-specific files. Use separate development/production projects and emulators for local work. Validate App Check and abuse controls before public launch.

## Provider boundary

`FootballDataProvider` is the provider-neutral port. `ApiFootballAdapter` uses native server-side `fetch`, sends `API_FOOTBALL_KEY` only in the provider request header, validates response shapes, normalizes UTC timestamps and statuses, and converts payloads into provider-neutral values. The application sync orchestration depends only on this port and `FootballSyncStore`; UI and voting logic never consume raw provider responses.

The manual sync resolves an unmapped Team by exact normalized name and country, then stores the provider ID only after all fetched data validates. It fetches the Team's competition/season metadata, selects distinct provider seasons overlapping a bounded fixture window (120 days back and 60 days ahead), and queries those seasons sequentially to avoid request bursts. It persists only competition-season pairs represented by fixtures involving the tracked Team. Deterministic IDs derived from provider identities make repeated imports idempotent, while updates preserve document identity and `createdAt`. Match documents store home/away snapshots so opponents do not require a global Team import. Provider failures abort before writes.

For a specific persisted match, the participant sync makes one `GET /fixtures?id=...` request. Stable provider Team identity selects the tracked-Team lineup regardless of home/away position or response order; that lineup establishes starters, bench membership, and head coach. Stable-ID substitution events confirm entering substitutes and entry/exit minutes, while positive player-stat minutes provide corroborating participation when that block is populated. Starters participate by definition. A bench player without either substitution or positive-minute evidence remains `participated: false`; missing data is never guessed. Duplicate events reconcile by provider player ID. Only tracked-Team Players and MatchParticipants are persisted, and only its coach can populate the deterministic head-coach assignment. The full response validates before writes, and deterministic provider-mapped IDs make Player, participant, Coach, and assignment upserts idempotent while preserving `createdAt`. Re-running after provider finalization may update snapshots and change a previously unconfirmed substitute to participating before voting lifecycle code consumes the records.

The sync persistence implementation is deliberately restricted to a local Firestore host and `demo-*` project. Browser rules continue to allow public Team reads and deny client writes; `competitions`, `seasons`, `matches`, `players`, `coaches`, participant subcollections, and coach assignments are deny-all until the UI needs them. Scheduled imports, cloud privileged credentials, automatic lifecycle transitions, and voting data are deferred.

Live Pro verification on 2026-08-29 used API-Football fixture `1551668` (CS Herediano vs Sporting San José, Primera División, 2026-08-23 UTC). The combined fixture response supplied 11 starters, 10 substitutes, five tracked-Team substitution events, and head coach Jafet Soto. It normalized to 16 confirmed participants and five unused substitutes in one match-context request. The embedded Costa Rican player-stat entries did not expose positive minutes for this fixture, so substitution events are required rather than treating statistics as the sole participation source.

## Multi-team scaling

Every match references a tracked `teamId`; community and theme configuration selects the current context. Collections, indexes, rules, and aggregates remain generic. This supports another club without premature tenant administration or separate schemas.

## Deployment and cost

Deploy the Next.js app to a platform compatible with its server runtime (initially Vercel is suitable) and use Firebase Auth/Firestore free tiers. Prefer static/server rendering, cached provider imports, compact ballot documents, materialized aggregates, and bounded reads. Cloud Functions and scheduled imports are deferred until needed; monitor quotas before opening beyond the initial group.
