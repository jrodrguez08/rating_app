# Product

## Purpose and audience

Rating App gives a small football supporter community a fair, simple way to rate the people who shaped a match. The first audience is a WhatsApp group of Club Sport Herediano supporters in Costa Rica.

## Current foundation milestone

Implemented now: a mobile-first shell with an original 16-bit sports-game visual language, Herediano as the initial configured club, accessible Spanish/English localization, generic domain types, and Firestore-backed football persistence. Manual and scheduled server-side API-Football synchronization can discover fixtures, focus on the relevant match, capture one trusted tracked-Team lineup/head-coach snapshot during the final pre-kickoff hour when available, reconcile exact participation after `FT`, and establish an idempotent two-hour future voting window only when rating-ready. Firebase Anonymous Authentication quietly establishes and persists the canonical voter UID without a login screen. During that trusted window, the Home call to action opens a complete player-and-head-coach ballot; one validated, immutable ballot is stored per match and Firebase UID.

While that trusted voting window is open, Home also offers a compact secondary WhatsApp action that shares the canonical rating deep link without voter, ballot, provider, or tracking data.

At trusted close time, the same lifecycle creates one immutable aggregate summary and closes the rating state. Home and `/matches/{matchId}/results` then reveal community averages, total ballots, player-only co-MVPs, and the separate coach result. `/matches` keeps one relevant match in a featured position and provides compact, tabbed upcoming/recent archive browsing with lifecycle-aware actions, scores, and detail pages. `/players` and `/players/{playerId}` provide a durable supporter-rating catalog, team ranking, and per-match history derived only from those published closed results. Persisted provider fixtures remain useful even when Rating App never opened voting for them; confirmed provider goal events appear as a focused scorer/minute summary when available.

Not implemented now: cloud Team administration, identity-provider linking, season leaderboards, notifications, or administration. Individual ballot data remains private at all times, and aggregates remain unavailable before close.

The public application is available on its current Vercel production URL. Guarded production configuration, bootstrap boundaries, and the runbook continue to control Firebase pilot operations.

## MVP

Partidos prioritizes one relevant featured match, then compact upcoming and recent fixture lists. During an active window it checks the current anonymous voter's deterministic ballot status through the same trusted boundary as Home: an available voter can enter the rating flow, while a voter who already submitted sees confirmation without a second rating action. Results remain hidden until trusted close.

After a match finishes, voting opens for approximately two hours. An authenticated supporter sees every Herediano player who actually played—not unused squad members—and the match's head coach. They submit one complete ballot. Aggregate results remain hidden until voting closes.

After closing, supporters can browse match results, MVPs, coach ratings, player match history, and player averages. A player's overall Rating App average is the unweighted arithmetic mean of their published per-match averages, preserving equal match weight even when ballot counts differ. Players need at least two published rated matches to receive a team rank; deterministic ties use higher average, more rated matches, then stable player ID. Unranked and historically rated players remain visible. Match and player history is durable and keyed by stable identity, not inferred from the current roster or display name.

Jugadores enriches stable player identity with the current API-Football squad position and identification photo persisted ahead of page reads. The catalog and profile never call the football provider while rendering, historical players remain visible when absent from the current squad, and a deterministic local initials avatar replaces missing or unavailable photos.

The public app identity is consistent across browser tabs, bookmarks, mobile shortcuts, and shared links. Spanish canonical metadata describes supporter ratings in the current Herediano pilot without claiming official club affiliation; social previews use a deterministic Rating App card and never depend on authentication, Firebase, ballots, or the football provider.

## Product invariants

- At most one ballot exists for a voter and match.
- Player eligibility requires both tracked-Team ownership and confirmed match participation (`teamId == trackedTeamId && participated == true`), not squad membership, the bench, the opponent, or the current roster. Only the tracked Team's head coach is rateable.
- The tracked team may be home or away.
- Provider final status is insufficient by itself: a voting window starts only after valid tracked-Team participant and head-coach readiness, lasts two hours from readiness, and is never extended by retries.
- Aggregates are unavailable to voters during an active window.
- Final results are generated once by trusted server code from immutable, fully validated ballots. Zero ballots yields an explicit no-votes result; one ballot is sufficient; exact top-average ties remain co-MVPs; the coach is excluded from MVP.
- Provider data is imported through a boundary and remains replaceable.
- Herediano is initial configuration and branding, not a special domain entity.

## Non-goals for the initial MVP

Social feeds, comments, fantasy football, betting, player-to-player comparisons, complex moderation, paid subscriptions, and general-purpose multi-tenant administration are excluded.

## Future direction

The same team, competition, season, match, participant, ballot, and result concepts can support more clubs and supporter communities. Add teams through data and theming; do not fork the domain or create club-named collections.
