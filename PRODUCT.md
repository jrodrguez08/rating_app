# Product

## Purpose and audience

Rating App gives a small football supporter community a fair, simple way to rate the people who shaped a match. The first audience is a WhatsApp group of Club Sport Herediano supporters in Costa Rica.

## Current foundation milestone

Implemented now: a mobile-first shell with an original 16-bit sports-game visual language, Herediano as the initial configured club, accessible Spanish/English localization, generic domain types, and Firestore-backed football persistence. Manual and scheduled server-side API-Football synchronization can discover fixtures, focus on the relevant match, capture a trusted tracked-Team lineup/head-coach snapshot during the final pre-kickoff hour when available, retry that focused capture conservatively during play when complete evidence is still missing, reconcile exact participation after `FT`, and establish an idempotent two-hour future voting window only when rating-ready. Firebase Anonymous Authentication quietly establishes and persists the canonical voter UID without a login screen. During that trusted window, the Home call to action opens a complete player-and-head-coach ballot; one validated, immutable ballot is stored per match and Firebase UID.

`/standings` presents the current domestic league table from a persisted daily snapshot. It is explicitly periodic rather than live, highlights the configured club by stable provider Team ID, and keeps the last valid table visible when a later provider read is empty, malformed, or unavailable. Page rendering never calls the football provider.

While that trusted voting window is open, Home also offers a compact secondary WhatsApp action that shares the canonical rating deep link without voter, ballot, provider, or tracking data.

While a tracked match is live, Home and match detail show a compact chronological summary of persisted confirmed goals when available. Home/away placement mirrors the scoreboard and reflects the latest lifecycle refresh rather than a real-time feed.

At trusted close time, the same lifecycle creates one immutable aggregate summary and closes the rating state. Home and `/matches/{matchId}/results` then reveal community averages, total ballots, player-only co-MVPs, and the separate coach result. `/matches` keeps one relevant match in a featured position and provides compact, tabbed upcoming/recent archive browsing with lifecycle-aware actions, scores, and detail pages. `/players` and `/players/{playerId}` provide a durable supporter-rating catalog, team ranking, and per-match history derived only from those published closed results. Persisted provider fixtures remain useful even when Rating App never opened voting for them; confirmed provider goal events appear as a focused Team/scorer/minute summary when available.

Not implemented now: cloud Team administration, identity-provider linking, season leaderboards, supporter notifications, or general administration. A server-only operator email reports each normal or exceptional voting-window opening without delaying the window. Individual ballot data remains private at all times, and aggregates remain unavailable before close.

The single configured operator has a production-only recovery command for an exceptional missed window. Reopening preserves the original window and every ballot, archives the previously published immutable result as an audit revision, hides aggregates, and establishes a bounded effective window. The operator can close an active original or reopened window early; that trusted transaction stops ballot acceptance and publishes a newly aggregated current result. These controls are not available in supporter UI and are not general match administration.

The same separately authorized operator can register a fixture-specific verified head coach when API-Football supplies valid tracked-Team participant evidence but cannot resolve that fixture's coach unambiguously. The durable assignment records its evidence, reason, operator context, Team and fixture binding, and distinct operator provenance. It never fabricates a provider ID or carries the coach into another match. The normal lifecycle still validates participant eligibility and opens voting only after the participant collection and coach assignment are written together and readiness succeeds.

The public application is available on its current Vercel production URL. Guarded production configuration, bootstrap boundaries, and the runbook continue to control Firebase pilot operations.

On a published match result, a supporter can compare their own submitted player and head-coach ratings with community averages in a compact "Mi voto vs la afición" section. It shows the signed difference (own rating minus average) to one decimal in the existing results order. A supporter without a ballot sees a neutral empty state. This comparison does not score or rank supporters and is unavailable before trusted close and result publication.

## MVP

Partidos prioritizes one relevant featured match, then compact upcoming and recent fixture lists. During an active window it checks the current anonymous voter's deterministic ballot status through the same trusted boundary as Home: an available voter can enter the rating flow, while a voter who already submitted sees confirmation without a second rating action. Results remain hidden until trusted close.

After a match finishes, voting opens for approximately two hours. An authenticated supporter sees every Herediano player who actually played—not unused squad members—and the match's head coach. They submit one complete ballot. Aggregate results remain hidden until voting closes.

After closing, supporters can browse match results, MVPs, coach ratings, player match history, and player averages. A player's overall Rating App average is the unweighted arithmetic mean of their published per-match averages, preserving equal match weight even when ballot counts differ. Players need at least two published rated matches to receive a team rank; deterministic ties use higher average, more rated matches, then stable player ID. Unranked and historically rated players remain visible. Match and player history is durable and keyed by canonical identity with explicit provider-ID aliases, never inferred from the current roster, display name, or shirt number; confirmed aliases combine historical ratings without rewriting ballots or finalized results, while each canonical player contributes at most one published rating per match.

Jugadores enriches canonical player identity with the current API-Football squad position and identification photo persisted ahead of page reads. The catalog and profile never call the football provider while rendering, historical players remain visible when absent from the current squad, explicit aliases prevent duplicate catalog entries when provider IDs change, and a deterministic local initials avatar replaces missing or unavailable photos.

The public app identity is consistent across browser tabs, bookmarks, mobile shortcuts, and shared links. Spanish canonical metadata describes supporter ratings in the current Herediano pilot without claiming official club affiliation; social previews use a deterministic Rating App card and never depend on authentication, Firebase, ballots, or the football provider.

## Product invariants

- At most one ballot exists for a voter and match.
- Player eligibility requires both tracked-Team ownership and confirmed match participation (`teamId == trackedTeamId && participated == true`), not squad membership, the bench, the opponent, or the current roster. Only the tracked Team's head coach is rateable.
- The tracked team may be home or away.
- Provider final status is insufficient by itself: a normal voting window starts only after valid tracked-Team participant and head-coach readiness, lasts two hours from readiness, and is never extended by retries. A separately authorized, audited operator recovery may establish a new effective window without changing the original timestamps.
- Provider and operator coach identities retain explicit provenance. A match-specific operator assignment may recover only an ambiguous provider coach, must match the tracked Team and provider fixture, and cannot be silently replaced by later provider synchronization.
- Aggregates are unavailable to voters during an active window.
- Final results are generated once by trusted server code from immutable, fully validated ballots. Zero ballots yields an explicit no-votes result; one ballot is sufficient; exact top-average ties remain co-MVPs; the coach is excluded from MVP.
- Provider data is imported through a boundary and remains replaceable.
- Herediano is initial configuration and branding, not a special domain entity.

## Non-goals for the initial MVP

Social feeds, comments, fantasy football, betting, player-to-player comparisons, complex moderation, paid subscriptions, and general-purpose multi-tenant administration are excluded.

## Future direction

The same team, competition, season, match, participant, ballot, and result concepts can support more clubs and supporter communities. Add teams through data and theming; do not fork the domain or create club-named collections.

## Owner administrative recovery

`/admin` is an unlinked, non-indexed Spanish operations surface for the single configured owner. Its bounded dashboard separates upcoming/live matches, matches requiring attention, and recent voting/completed matches. A fixture detail page shows persisted lineup evidence, participant and coach readiness, and canonical tracked-Team Players without calling the football provider. Voting and completed matches are read-only.

Before kickoff, during play, or after `FT` while voting remains unopened, the owner may prepare and explicitly save an incomplete fixture lineup without evidence fields or a passphrase. The saved preparation can contain canonical Players, fewer than 11 starters, substitutes, arrangement, and locally reviewed participation states. It is private owner working state only: it never creates MatchParticipants, a verified snapshot, eligibility, or lifecycle progress.

Opening the Match workspace restores the owner's saved draft first, then falls back to the strongest persisted fixture evidence: an existing operator-verified snapshot before tracked-Team provider participants. Starters, unused substitutes, confirmed entrants, and unconfirmed participation stay visibly separate. The owner can search a bounded historical Team catalog by accent-insensitive name and move Players by pointer, touch, keyboard drag-and-drop, or equivalent labeled buttons. The catalog is backed by canonical current-squad and historical MatchParticipant membership, so transferred Players remain discoverable while opponent-only Players do not enter the Team catalog. Reviewed provider aliases collapse duplicate identities.

Verified confirmation is a separate deliberate action requiring exactly 11 starters, independent HTTPS evidence, reason, zero-write preview, exact action hash, independent passphrase, typed fixture confirmation, short-lived one-use challenge, atomic apply, and deterministic durable success receipt. The lineup transaction reloads the Match, protected history, existing participants, canonical identities, Team membership, and provider aliases. It writes the verified snapshot and materialized participants, removes the owner's matching working draft, and does not change `ratingState`, voting timestamps, ballots, results, or revisions. Exact retries recover the receipt without repeating writes even after later lifecycle transitions. The normal lifecycle still owns `FT` confirmation, final participant and coach readiness, and voting-window creation.

For the current live or recently finished lifecycle target, the owner can use **Verificar preparación y solicitar sincronización** after preview, passphrase authorization, and exact fixture confirmation. The request is rate limited, audited, bound to the persisted Team and provider fixture, and invokes the same lifecycle service as the scheduled trigger. It can refresh provider evidence promptly but cannot mark `FT`, change `ratingState`, or open voting by itself. The detail view reports confirmed starters, entering substitutes, unused or unconfirmed players, coach readiness, evidence provenance, last provider and lifecycle execution, first trusted `FT` observation, evidence reconciliation, voting readiness, and measured delays when both endpoints exist.

The accepted lifecycle action also creates a durable execution receipt with `requested`, `running`, `skipped_busy`, `completed`, `failed`, or `voting_open` status, separate from Match `ratingState`. A busy or transient post-commit outcome can be checked and retried for a bounded ten-minute period with the original authorization, without another audit or uncontrolled polling. `voting_open` is shown only after the persisted Match confirms an active window.

When API-Football has no usable lineup, player-statistics, or event evidence after `FT`, a complete fixture-bound verified lineup can supply participant readiness independently. Eleven verified starters are sufficient; a bench list is optional. The normal lifecycle also requires a fixture-bound verified head coach before opening voting. It creates no provider IDs or aliases for internal-only Players, keeps other provider failures retryable, and rejects later provider evidence that conflicts with the verified identities, roles, or confirmed participation.

After deployment, provider reconciliation records a fixture-bound `matched`, `provider_missing`, `provider_partial`, or `conflict` observation for the latest attempt. Missing and partial evidence preserve manual truth; contradictory identity, role, or participation assertions fail closed and preserve the verified materialization.

The surface is dormant until the owner Firebase email/password account and all server secrets are configured. Supporter anonymous identity continues in the default Firebase browser app; admin sign-in uses a named in-memory Auth app and exchanges its ID token for a server session before immediately signing out locally.

Admin sign-in displays one accessible busy state from Firebase password authentication through ID-token exchange, server-session creation, and console refresh. The lifecycle request remains visible on every Match readiness panel; ineligible states disable it and explain the persisted reason without changing server eligibility.
