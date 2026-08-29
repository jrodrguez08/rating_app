# Product

## Purpose and audience

Rating App gives a small football supporter community a fair, simple way to rate the people who shaped a match. The first audience is a WhatsApp group of Club Sport Herediano supporters in Costa Rica.

## Current foundation milestone

Implemented now: a mobile-first shell with an original 16-bit sports-game visual language, Herediano as the initial configured club, accessible Spanish/English localization, generic domain types, and Firestore-backed football persistence. Manual and scheduled server-side API-Football synchronization can discover fixtures, focus on the relevant match, synchronize its tracked-Team participants/head coach after `FT`, establish an idempotent two-hour future voting window only when rating-ready, and show honest upcoming/live/preparing/ready match context on Home when trusted server persistence is configured.

Not implemented now: cloud Team administration, voter authentication, ballot submission, ratings, aggregates/results, history pages, notifications, or administration. Lifecycle readiness and timestamps exist, but the ready Home state explicitly does not claim the ballot is implemented.

## MVP (planned)

After a match finishes, voting opens for approximately two hours. An authenticated supporter sees every Herediano player who actually played—not unused squad members—and the match's head coach. They submit one complete ballot. Aggregate results remain hidden until voting closes.

After closing, supporters can browse match results, MVPs, coach ratings, player match history, and player averages. Match and player history must be durable, not inferred from the current roster.

## Product invariants

- At most one ballot exists for a voter and match.
- Player eligibility requires both tracked-Team ownership and confirmed match participation (`teamId == trackedTeamId && participated == true`), not squad membership, the bench, the opponent, or the current roster. Only the tracked Team's head coach is rateable.
- The tracked team may be home or away.
- Provider final status is insufficient by itself: a voting window starts only after valid tracked-Team participant and head-coach readiness, lasts two hours from readiness, and is never extended by retries.
- Aggregates are unavailable to voters during an active window.
- Provider data is imported through a boundary and remains replaceable.
- Herediano is initial configuration and branding, not a special domain entity.

## Non-goals for the initial MVP

Social feeds, comments, fantasy football, betting, player-to-player comparisons, complex moderation, paid subscriptions, and general-purpose multi-tenant administration are excluded.

## Future direction

The same team, competition, season, match, participant, ballot, and result concepts can support more clubs and supporter communities. Add teams through data and theming; do not fork the domain or create club-named collections.
