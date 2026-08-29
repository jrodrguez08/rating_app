# Architecture

## Application shape

Next.js App Router and strict TypeScript form the web application. Pages and layouts are Server Components by default; use Client Components only for browser state or interaction. Tailwind CSS consumes semantic tokens. Domain types and ports do not import Firebase or React.

`src/config` selects the initial club presentation. `src/domain` describes stable business concepts. `src/lib/firebase/browser.ts` lazily initializes the web SDK only when called and configured. A separate server module reserves the privileged boundary; Firebase Admin is deliberately absent until a concrete server use case exists.

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

A match stores tracked team, opponent, home/away IDs, competition, season, kickoff, status, score, provider fixture ID, and voting bounds. A participant stores squad role (`starter` or `substitute`), `participated`, and optional entry/exit minutes. Ballot queries and validation must include only `participated == true` records.

A completed ballot is one document containing a map of player IDs to ratings and one coach rating. Its document ID is the authenticated `voterId` inside the match's `ballots` subcollection. A Firestore transaction creates only if absent; security rules require `request.auth.uid == voterId`, immutable match/voter identity, a valid open window, and eligible rating keys. A server-controlled match state is authoritative. This deterministic path plus transaction and rules enforces `one voter + one match` without a per-score write explosion.

## Aggregation

On accepted ballot creation, a future trusted Cloud Function transaction updates `matches/{matchId}/aggregates/summary`. When voting closes, it materializes player match summaries and incrementally updates season/career statistics. Public reads target these summaries rather than scanning ballots. Ballots remain private and aggregates are rule-protected until the window closes. Idempotency/event markers are required before implementing triggers.

## Authentication and security

Start with Firebase Anonymous Authentication for low friction. Domain data keys by Firebase UID, so upgrading or linking an anonymous account to Google, email link, or another provider preserves identity. Authentication is not authorization: Firestore rules validate document ownership, match state, window bounds, rating ranges, and allowed keys. Default rules currently deny every read and write.

Never expose Admin credentials to the browser. Public Firebase web configuration is not secret, but belongs in environment-specific files. Use separate development/production projects and emulators for local work. Validate App Check and abuse controls before public launch.

## Provider boundary

`MatchDataProvider` is the API-Football-facing port. A future adapter converts provider payloads into domain models and records external IDs. UI and voting logic never consume raw provider responses. Imports should be idempotent, rate-limit aware, cached in Firestore, and runnable manually before automation.

## Multi-team scaling

Every match references a tracked `teamId`; community and theme configuration selects the current context. Collections, indexes, rules, and aggregates remain generic. This supports another club without premature tenant administration or separate schemas.

## Deployment and cost

Deploy the Next.js app to a platform compatible with its server runtime (initially Vercel is suitable) and use Firebase Auth/Firestore free tiers. Prefer static/server rendering, cached provider imports, compact ballot documents, materialized aggregates, and bounded reads. Cloud Functions and scheduled imports are deferred until needed; monitor quotas before opening beyond the initial group.
