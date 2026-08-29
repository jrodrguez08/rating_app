# Architecture

## Application shape

Next.js App Router and strict TypeScript form the web application. Pages and layouts are Server Components by default; use Client Components only for browser state or interaction. Tailwind CSS consumes semantic tokens. Domain types and ports do not import Firebase or React.

`src/config` selects the initial club presentation. `src/domain` describes stable business concepts. `src/lib/firebase/browser.ts` lazily initializes the web SDK only when called and configured. Local mode always connects Firestore to the explicitly configured emulator and never falls back to a cloud project. Development and production modes require complete Firebase Web configuration. A separate server module reserves the privileged boundary; Firebase Admin remains absent because browser reads and an emulator-only bootstrap cover this milestone.

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

The implemented `teams/{teamId}` document contains `displayName`, `shortName`, `countryCode`, `brandingKey`, optional `externalProviderId`, and Firestore `createdAt`/`updatedAt` timestamps. `club-sport-herediano` is the stable initial ID. The seed JSON is the canonical basic Team data; presentation configuration derives its identity and names from that record while keeping theme colors in source code. Firestore snapshots are converted and runtime-validated at the persistence boundary before becoming domain `Team` values.

An explicit emulator-only script ensures the initial document exists. It requires a local emulator host and a `demo-*` project ID, creates only when absent, and leaves an existing record untouched. It never runs during application rendering or startup.

A match stores tracked team, opponent, home/away IDs, competition, season, kickoff, status, score, provider fixture ID, and voting bounds. A participant stores squad role (`starter` or `substitute`), `participated`, and optional entry/exit minutes. Ballot queries and validation must include only `participated == true` records.

A completed ballot is one document containing a map of player IDs to ratings and one coach rating. Its document ID is the authenticated `voterId` inside the match's `ballots` subcollection. A Firestore transaction creates only if absent; security rules require `request.auth.uid == voterId`, immutable match/voter identity, a valid open window, and eligible rating keys. A server-controlled match state is authoritative. This deterministic path plus transaction and rules enforces `one voter + one match` without a per-score write explosion.

## Aggregation

On accepted ballot creation, a future trusted Cloud Function transaction updates `matches/{matchId}/aggregates/summary`. When voting closes, it materializes player match summaries and incrementally updates season/career statistics. Public reads target these summaries rather than scanning ballots. Ballots remain private and aggregates are rule-protected until the window closes. Idempotency/event markers are required before implementing triggers.

## Authentication and security

Start with Firebase Anonymous Authentication for low friction. Domain data keys by Firebase UID, so upgrading or linking an anonymous account to Google, email link, or another provider preserves identity. Authentication is not authorization: future Firestore rules will validate document ownership, match state, window bounds, rating ranges, and allowed keys. Team documents are intentionally public-readable because the product displays club identity without authentication; all browser Team writes remain denied, and every other collection remains deny-all. Development bootstrap uses the emulator's privileged REST context and cannot target a non-local host or non-demo project.

Never expose Admin credentials to the browser. Public Firebase web configuration is not secret, but belongs in environment-specific files. Use separate development/production projects and emulators for local work. Validate App Check and abuse controls before public launch.

## Provider boundary

`MatchDataProvider` is the API-Football-facing port. A future adapter converts provider payloads into domain models and records external IDs. UI and voting logic never consume raw provider responses. Imports should be idempotent, rate-limit aware, cached in Firestore, and runnable manually before automation.

## Multi-team scaling

Every match references a tracked `teamId`; community and theme configuration selects the current context. Collections, indexes, rules, and aggregates remain generic. This supports another club without premature tenant administration or separate schemas.

## Deployment and cost

Deploy the Next.js app to a platform compatible with its server runtime (initially Vercel is suitable) and use Firebase Auth/Firestore free tiers. Prefer static/server rendering, cached provider imports, compact ballot documents, materialized aggregates, and bounded reads. Cloud Functions and scheduled imports are deferred until needed; monitor quotas before opening beyond the initial group.
