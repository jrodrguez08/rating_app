# Issue #155: administrative Player search follow-up

## Findings and limits

The November 5, 2026 incident exhausted Firestore's Spark read quota, but available telemetry still cannot attribute the approximately 55,000 daily reads to one workflow. The updated [Issue #155](https://github.com/jrodrguez08/rating_app/issues/155) describes incremental queries, repeated empty queries, HTTP 200 responses, cancellations and slow requests while typing. It does not establish idle polling or daily request volume.

This branch starts from `master` commit `6f8b8ef`. [PR #156](https://github.com/jrodrguez08/rating_app/pull/156) remains a separate, unmerged proposal for Home, admin detail and catalog read duplication. Its measured savings must not be described as deployed behavior. This follow-up reproduces and fixes additional search issues without duplicating those changes.

Confirmed frontend behavior on that master:

- `AdminLineupEditor` already debounces nonempty queries by 200 ms. Typing faster than that interval coalesces requests; pauses longer than it can legitimately send intermediate prefixes. A one-character query is supported. Focus itself starts no search. There is no interval or idle polling loop; a five-second controlled idle observation produced no new request.
- Empty queries intentionally browse historical Team choices before typing. They previously used a zero-millisecond timer, so clearing and quickly entering another name could dispatch an obsolete browse request before the next debounce.
- The search effect depends on `selectedIds`, a Set recreated whenever participants change. Selection, lane/participation changes and minute edits therefore rerun the same search even when club/query are unchanged. Repeated empty requests can come from these edits, intentional clearing, initial mounting and club/Match navigation. Ordinary unrelated rerenders do not continuously trigger the stable dependencies.
- Requests use AbortController, but first-page setters did not check the signal after JSON completion. Pagination had neither a signal nor a scope check. A controlled late page inserted old-query Players into new results and replaced its continuation. An abort should not be interpreted as a server error or proof of avoided reads.
- The identity reconciliation page's secondary manual picker also calls `/api/admin/players`; its callback is query/club scoped, uses a 200 ms typing debounce, and has no idle timer. Its complete suggestion pass is a separate, more expensive endpoint, not a hidden fallback of Player search. This fix is scoped to the demonstrated lineup-picker defects.

## Server path and measured cost

The route verifies the owner session and registered club, validates input/cursor bounds, then calls `AdminConsoleService.searchPlayers` → `searchIndexedTeamPlayers` → `resolveMemberships`. Every request reads the completeness marker, one indexed Team-membership page (20 choices plus one lookahead), and bounded direct Player, provider-alias and distinct canonical-target documents. Empty query means indexed browse; nonempty query uses the maintained normalized `searchPrefixes` array. Missing/incomplete indexes fail explicitly. There is no collection scan, history reconciliation, transaction, provider call, write, query inside a Player loop, server cache or application retry loop in this path. Transparent SDK transport retries are not separately counted by these observations.

Real Admin SDK calls were observed against dedicated demo emulators with 125 memberships per club and 1,000 unrelated global Players. These are document-access observations and billing **estimates**, not production billing measurements. Missing direct reads count, batch paths deduplicate, and empty queries have a one-read minimum. Auth service calls, failed-RPC charges and any index-entry billing are excluded.

| One HTTP search request                                      | Membership queries | Membership documents returned | Client Players | Estimated document reads |
| ------------------------------------------------------------ | -----------------: | ----------------------------: | -------------: | -----------------------: |
| Empty browse, 125 provider-backed members                    |                  1 |                            21 |             20 |                       62 |
| `a`, `ag`, `agui`, `aguil`, `aguilar`                        |             1 each |                       21 each |        20 each |                  62 each |
| `jua`, `juare`                                               |             1 each |                       21 each |        20 each |                  62 each |
| Exact `aguilar 000`                                          |                  1 |                             1 |              1 |                        4 |
| No matches                                                   |                  1 |                             0 |              0 |                        2 |
| Exact reviewed alias to an otherwise-unread canonical Player |                  1 |                             1 |              1 |                        5 |
| Three identical full-page requests                           |                  3 |                      63 total |       60 total |                186 total |

The usual full provider page is `1 marker + 21 memberships + 20 Players + 20 aliases = 62` reads. The aliases can all be absent and still cost 20 reads; an HTTP 200 returning 20 Players is not 20 reads. At most 20 extra distinct canonical-target reads produce an 82-read page ceiling. An operator-only page costs at most 42. A club with no choices still costs two reads. Later pages remain bounded and deterministic; all 125 choices were reached in both clubs without mixing identities. Existing alias/parity integration tests continue to cover canonical duplicates across pages.

Server reads per dispatched request are intentionally unchanged by this fix. It reduces unnecessary dispatches and prevents stale UI state; it does not cache authorization or canonical identity snapshots across requests. Multisecond HTTP latency alone cannot establish a scan or read count: owner verification, cold runtime work, network latency and SDK reads may all contribute. The new duration metric is total request time, not a per-RPC timing or a production trace attributing that delay.

## Before / after reproduction

The initial focused UI baseline passed 20 tests before product changes; the initial emulator search baseline passed 11 tests. Tests then replaced the demonstrated defective expectations with regression budgets.

| Controlled interaction, excluding initial browse unless stated | Before requests | After requests | Full-provider-page read estimate before → after |
| -------------------------------------------------------------- | --------------: | -------------: | ----------------------------------------------: |
| Initial browse                                                 |               1 |              1 |                                         62 → 62 |
| Rapid `j` → `ju` → `jua`                                       |               1 |              1 |                                         62 → 62 |
| Three lineup participation/lane edits                          |               3 |              0 |                                         186 → 0 |
| Add trailing whitespace to an unchanged normalized query       |               1 |              0 |                                          62 → 0 |
| Clear and immediately type a new query                         |               2 |              1 |                                        124 → 62 |
| Five seconds idle                                              |               0 |              0 |                                           0 → 0 |

Now every query, including empty browse, uses 200 ms debounce and the shared accent/case/punctuation/whitespace normalization. The loaded page is retained while arranging the lineup; selected identities are filtered locally during render. Results and continuation are visible only for their club/query key. First-page and load-more requests share cancellation ownership, and obsolete successes/errors are ignored after body parsing. Real navigation retains the existing club/Match component keys, so pending local state is not reused across workspaces. Clearing an already empty field, equivalent normalized input, and lineup edits do not refetch. Returning to a different query or mounting another workspace still performs a fresh authorized read; there is no persistent result cache.

The browser regression checks rapid input, equivalent queries, clear-and-type, three lineup edits and idle time for both clubs. It also deliberately lets the real endpoint finish a superseded request before holding its response and switching clubs: the browser can cancel delivery after server work has already occurred. Deterministic component tests separately force late first-page and pagination bodies to complete despite abort, ensuring no old result/cursor overwrites newer state. Unit, emulator and browser coverage complement each other; a browser Network count alone cannot measure billable reads.

## Catalog and alternative sources

The separate catalog audit was reproduced on unchanged master code: a 25-Player/one-Coach preview with overlapping squad metadata reads 110 documents, apply reads 81 per transaction attempt, and an exact committed receipt retry reads two. Repeated previews after position/photo enrichment still read 110 and create no new identities or metadata fills. Preview/apply resolve focused canonical identities and memberships; they do not scan Player/Coach/history collections or prepare Matches. The [separate read-budget change](issue-155-firestore-reads.md) reduces preview reads from 110 to 84 and removes a redundant no-photo Coach rewrite. Provider requests remain a separate bounded counter (at most eight), not Firestore reads.

Public Home currently reads all Matches for its Team on each uncached request. The archive also reads per-Match result existence; Player profiles build the Team catalog and published history. Lifecycle reads the complete Team Match list once, twice when discovery is due, and daily standings joins its Team history. Shared fixtures retain separate Team Match paths, leases and participation; there is no cross-club global scan or shared eligibility. PR #156's original synthetic measurements were Home 1,001 reads and selected admin detail 71 reads before its proposed optimizations. Complete identity suggestions/protected-history reviews and explicit offline backfills can also accumulate reads. This branch does not silently truncate those paths.

Ranked remaining explanations are repeated public catalog/history/Home requests; recurring per-Team lifecycle reads combined with page traffic; repeated owner search/catalog/reconciliation activity; and explicit offline/console activity. Search amplification is now proven, but its contribution to the incident is unknown. Approximately 807 full provider-page searches would alone exceed 50,000 document reads; that is an illustrative calculation, not observed traffic. A few catalog operations or the provided Network screenshot cannot establish that volume.

The earlier investigation retained quota errors at 19:33–19:35 Costa Rica time and READY production deployment metadata. Hobby's one-hour runtime-log retention prevents reconstruction of the entire day. A later read-only 50-minute `catalog_import` log query returned no matching entries, which cannot prove no catalog requests occurred outside the window or without logs. No connected Firestore Usage time series or per-query billing attribution was available. No production database was scanned or changed for this follow-up.

## Operations and release

`admin.player_search` adds one best-effort server log per authorized, club-resolved request: Team, membership-query count, membership documents returned, estimated successful document reads, returned Player count, duration, completed/failed status and observed abort flag. It never logs query text, cursor, owner UID, Player identity/name, token, cookie or raw payload, and writes nothing to Firestore. Failed-request estimates omit unobserved RPC charges; a false abort flag does not guarantee delivery. Use request records plus these entries and Firebase Usage charts for future attribution, rather than multiplying raw log lines or canceled Network rows by one.

No new index, schema, migration, backfill, credential, paid infrastructure or server cache is required. Existing membership indexes/completeness gates, owner authorization, no-store responses and mutation revalidation remain authoritative. Product/architecture/runbook were updated; design guidance was reviewed and needs no change because layout, controls, typography and localized strings remain unchanged.

Local E2E verification uses `NODE_ENV=test` so Next excludes the developer's `.env.local`; PR #156 separately proposes making that setting explicit in Playwright configuration. Tests stay bound to the dedicated local demo emulators. Neither this report nor a merge authorizes production imports, index deployment, billing changes or a release.
