# Design system

## Direction

Rating App's approved visual language is **16-bit sports game presentation with modern mobile product usability**. It should feel like an original football scoreboard interface: dark, compact, crisp, tactile, and immediately readable. Retro styling supplies identity; semantic HTML, familiar interactions, responsive layouts, and accessible touch targets supply usability.

Do not drift back to soft generic SaaS cards, dashboard control bars, glass effects, casino styling, or copied game interfaces. The system is club-neutral: game structure stays consistent while presentation configuration supplies club colors.

## Tokens and theming

Generic components consume semantic CSS variables defined in `src/app/globals.css`:

- `--game-background`: near-black application canvas
- `--game-surface`: shell and quiet-control surface
- `--game-surface-raised`: menus and elevated controls
- `--game-panel`: meaningful grouped content
- `--game-text` / `--game-muted`: primary and secondary text
- `--game-border`: crisp neutral outline
- `--game-shadow`: hard offset shadow color
- `--club-primary` / `--club-secondary` / `--club-on-primary`: theme inputs
- `--game-focus`: keyboard focus
- `--game-success`, `--game-live`, `--game-warning`, `--game-danger`: semantic states

The initial presentation maps Herediano red and gold from `src/config`; generic components must not introduce club-named tokens or one-off club hex values. Most screen area stays neutral so club colors preserve meaning. New club themes should replace configuration values without changing component structure.

## Typography

Use two canonical roles:

- **Game/score display:** DotGothic16, loaded at build time through `next/font/google` with Latin Extended coverage and exposed centrally as `--font-game` / `--font-score`. Apply it selectively to the wordmark, section labels, status badges, scores, kickoff times, ratings, countdowns, and short game-like headings.
- **Body/UI:** the system sans-serif stack for navigation, club/player/coach names, paragraphs, instructions, menus, forms, and longer labels.

Body paragraphs never use DotGothic16. Long proper names and explanatory text prioritize readability; a major club name may remain in the modern sans. Use the game role to create hierarchy rather than pixel-styling every character. DotGothic16 is a regular-weight face, so avoid synthetic heavy weights and excessive tracking. Short uppercase labels may use restrained tracking. Large numbers such as `2 - 1`, `11:00`, `8.7`, or a countdown should be visually immediate, high contrast, and minimally decorated.

## Shape, borders, and shadows

- Meaningful panels use 2px borders, 0–2px radius, and `4px 4px 0` hard shadows.
- Compact controls use 2px borders and `2px 2px 0` hard shadows.
- Inset information areas use a one-pixel border and no floating elevation.
- Avoid large radii, oversized pills, blurred shadows, glow, and stacked card containers.
- Small cut-corner or pixel-grid details are acceptable when they clarify hierarchy, but ornament must stay restrained.

The reusable `.card`, `.game-inset`, `.status-badge`, `.button-primary`, `.button-secondary`, and `.button-utility` conventions are canonical. Use panels only for meaningful groupings.

## App shell and navigation

The compact header has an identity/utility row and a simple text-navigation row. The `R` mark uses a crisp club-colored block; the wordmark uses display typography without becoming an arcade banner. Navigation retains at least 40px vertical space and uses a small gold underline plus weight for `aria-current`, not giant buttons.

The language switcher remains secondary: a bordered `ES`/`EN` utility control opens a small hard-shadow menu with full language names and semantic current state. It retains 44px targets, Escape and outside-click dismissal, focus restoration, and visible focus.

## Panels and scoreboards

A sports-game panel contains a restrained accent rail, compact status/competition label, strong short heading or scoreboard, readable body detail, and optional inset metadata. Future match panels should support home/away identity, safe abbreviation badges, official provider names, status, kickoff, and score without assuming a particular club.

Future scoreboard states may show `VS`, kickoff time, score, `FT`, live minute, or voting countdown using display typography. Do not fabricate match data to demonstrate the primitive in production, and do not introduce a component until a real product surface consumes it.

Live confirmed-goal summaries stay inside the scoreboard panel and use one chronological row per event. Each row keeps two bounded halves around a visible center axis: home goals occupy and align toward the left half, while away goals occupy and align toward the right half. Stable Team identity determines placement; long scorer names wrap within their own half, and hidden text supplies explicit Team attribution so spatial position is never the only accessible cue. Finished-match summaries retain their standalone post-match treatment and visibly name the scoring Team alongside the scorer and minute. Both presentations derive attribution only from an exact match with the fixture's home/away provider Team IDs and omit an event when neither side can be trusted.

## Buttons and motion

- **Primary:** club-primary surface, high-contrast label, crisp border, hard shadow.
- **Secondary:** raised neutral surface with a clear border.
- **Utility:** quieter game surface for compact actions such as locale selection.

All buttons keep a minimum 44px target, visible label, keyboard focus, and disabled semantics. A press may move 1–2px and remove its hard shadow over 100–180ms. No continuous animation, flashing, glow, screen shake, or spectacle. Reduced-motion preferences collapse transitions.

## Status badges

Status badges are compact rectangular scoreboard labels with text and, when useful, a small icon. Scheduled, live, final, voting-open, voting-closed, and postponed states must remain distinguishable by wording or icon—not color alone. Live/error colors are accents, not full-panel defaults.

## Tabs

Tabs are reserved for a small set of peer views within one stable page hierarchy. Keep primary context, such as a featured match, outside the tab panels. Use compact rectangular controls with crisp borders and an active bottom-border/background treatment, not oversized pills. The selected state must use `aria-selected` and remain visually distinguishable without color alone. Associate tabs and panels, retain 44px targets and visible focus, and support Left/Right plus Home/End keyboard navigation.

## Iconography and team marks

Use a small internal SVG set on a 16×16 grid with crisp geometric paths, `currentColor`, and no copied sprites. Decorative icons are hidden from assistive technology; meaningful icons need an accessible text equivalent. Do not add a broad icon dependency for a few concepts.

Until an intentional provider/logo licensing strategy exists, team marks use original simplified shields with safe initials or abbreviations, flat traditional presentation colors, hard pixel-like geometry, and a neutral fallback for unknown teams. Team-name text must remain present; shields are supplementary and decorative. Never copy, invent, or scrape official crests.

## Rating controls

Ratings use a five-column grid of discrete values `1` through `10`, not a precision slider. Each player and the head coach has a labeled fieldset; every value is a 44px-or-larger button with `aria-pressed`, keyboard operation, high contrast, and an unmistakable club-secondary selected state. The complete-count and sticky submission action remain visible on narrow screens without covering the final control.

Submission uses one focused confirmation dialog because ballots are immutable. It explains that ratings cannot be changed, traps keyboard focus, supports Escape/cancel, and restores focus to the triggering button. Recoverable errors preserve every selected rating. On voting-entry surfaces, a submitted ballot becomes one compact, non-interactive inline success status with a decorative check; it has no button states, shadow, focus stop, or redundant explanation, and may sit beside a real sharing action. Closed, not-open, and unavailable states use explicit localized text. These states never reveal individual or aggregate results.

## Match results

The personal vote comparison follows the published scorecard as a compact, full-width score table with one shared localized header, thin row dividers, players in the existing results order, and a separate coach row group. Flexible name cells wrap without clipping at narrow widths; aligned numeric columns show the supporter's rating, community average, and signed one-decimal difference. The difference header has an explicit accessible label, and screen-reader row text states above, below, or equal. Individual rows have no card border or shadow. This adds no ranking, visual scale, or judgment of the supporter.

Final results use a scorecard hierarchy, not an analytics dashboard. The match score leads, a crisp secondary-accent block gives player MVP or co-MVP the strongest emphasis, ranked players use numbered inset rows, and the coach sits in a separate panel. Display averages use one decimal in score typography; names remain readable sans and wrap safely. Ranking and MVP labels must be explicit rather than color-only. Do not add traffic-light rating colors, glow, or casino treatment.

Published-result sharing uses the same hierarchy in two original static compositions. The 1200×630 card keeps score and Team names in a compact scoreboard above a second-left, first-center, third-right podium; the 1080×1920 Story uses a separate vertical composition with a larger central winner and mobile-safe top and bottom margins. Gold, silver, and bronze borders identify podium positions together with visible numbers. MVP is an explicit text badge, ratings use one decimal, and long names wrap inside fixed hard-bordered nameplates. Persisted allowlisted portraits fill crisp rectangular frames; missing or failed images use large deterministic initials in the same dimensions. Both formats keep the near-black field, red structure, gold focus, subtle pitch geometry, project-owned Rating App identity, and readable sans names. Never stretch one format into the other, copy game or social-network assets, or depend on color alone.

The public result page places sharing immediately after the score and MVP block, before the full ranking, so it remains discoverable on a long mobile result. One full-width primary action shares the result URL; compact secondary controls copy the URL and share the Story, followed by a quieter direct download link. Native controls retain 44px targets, visible focus, disabled loading semantics, and a polite text status. A clipboard failure exposes a selectable canonical URL. Labels describe saving or sharing an image and never imply automatic Instagram publication.

Player evolution charts remain compact dark insets rather than analytics panels. Plot ratings against the fixed product scale of 1–10, label 10, 5, and 1 with only three low-contrast horizontal guides, and run history chronologically from left to right. Use localized short dates for horizontal context, thinning visible labels to a small representative set when history becomes dense. Every point must expose its exact one-decimal rating, opponent, and date through a viewport-bounded tooltip on pointer hover or focus, with a meaningful accessible label and visible keyboard focus. Do not auto-scale to observed results or rely on color alone.

League standings use a compact fixed-layout table. At mobile widths show rank, Team, played, goal difference, and points; reveal wins, draws, and losses at wider widths. Team names truncate safely, numeric cells use score typography, and the configured Team receives a club-accent row marker plus a screen-reader label so identity is never color-only. Do not require horizontal scrolling at 320 px.

## Spacing and responsive behavior

Use a 4px base rhythm and tighter sports-scoreboard density: common gaps are 8, 12, 16, 20, 24, and 32px. Compact does not mean cramped. Body copy keeps comfortable line-height; actions keep touch separation.

Design mobile-first at 320, 360, 390, and 430px. Hard shadows, long Spanish labels, navigation, and menus must not introduce horizontal scrolling. Desktop centers a bounded content column rather than inventing empty dashboards or unnecessary columns.

## Internationalization

Validate every visual component in Spanish and English. Prefer flexible wrapping and content-driven sizing over fixed widths. All visible product strings come from both translation resources. Club, competition, player, and coach names remain untranslated provider/domain data.

Player identity uses a compact, hard-bordered square avatar in lists and a larger version in the profile header. A narrowly allowed persisted identification photo may fill the square without becoming the primary hierarchy; missing, malformed, or failed photos use the same fixed dimensions with deterministic one- or two-letter initials. Position labels use the readable sans and localized domain labels, never raw provider strings.

Public app identity uses a simple project-owned Rating App `R` mark that remains recognizable at browser-icon size: charcoal field, Herediano-inspired red structure, and gold focus. The mark must not reproduce a club crest or imply official affiliation. Social cards use the same colors, hard geometry, high contrast, and generous safe margins; keep primary text within the central 80% of a 1200×630 frame so common sharing crops remain legible. Avoid remote imagery, tiny text, gradients, and decorative density.

## Accessibility checklist

- WCAG AA text and control contrast on dark surfaces
- visible high-contrast focus using `--game-focus`
- semantic landmarks, headings, navigation, menu, and current-state attributes
- at least 44px interactive targets
- no status communicated by color alone
- keyboard and screen-reader operation
- reduced-motion support and no flashing
- zoom remains enabled
- checks at 320px and 200% zoom

Pixel aesthetics never override modern usability.

## Owner console

The Match preparation workspace places **Abrir votación ahora** before lifecycle and lineup tools. It uses the same game card, inset checklist, labeled controls, visible focus states, Spanish status copy, passphrase step, and exact-confirmation pattern as other sensitive owner operations. Readiness remains visible when blocked: eligible Match status, 11 starters, verified lineup, verified coach, reconciliation state, substitute counts, fixture, and Team binding. Scheduled and live states explain that independent confirmation of the real final whistle is required without implying provider `FT`; postponed, suspended, cancelled, and abandoned states show their specific reason and expose no enabled opening action. Default and custom close choices are explicit, and preview renders provider status plus Costa Rica opening, closing, and duration before authorization. An active window replaces the opening form with the Match, verified counts and coach, Costa Rica opening and closing times, and remaining time. Expired and published states remain read-only, and a persistent dashboard link stays above the workflow. Historical lifecycle diagnostics do not visually override any of these authoritative window states.

The private owner console follows the same compact sports-game language without adopting a generic dashboard shell. It uses one narrow responsive column, meaningful hard-bordered panels, readable sans labels, and score typography only for short headings. The dashboard separates open voting, upcoming or preparing Matches, exceptional review, and closed voting or results with semantic headings and explicit text status. Each Match card shows Teams, Costa Rica kickoff, useful verified participant and coach context when available, and one state-specific primary link. Technical Match, fixture, Coach, diagnostic, and synchronization identifiers stay out of the normal dashboard. Lineup and coach preparation live only in the selected Match workspace. Player reconciliation, refresh, and sign out form a compact secondary toolbar with wrapping, 44px targets, and visible keyboard focus.

The lineup editor favors a quick mobile workflow: a bounded searchable canonical Player picker first, then compact lanes for starters, available or unused substitutes, confirmed entrants, and unconfirmed participation. Player cards may show the approved identification photo, number, and localized position when available, with fixed-size initials fallback. Visible counters, provider or operator evidence wording, and concise empty states make the preloaded fixture evidence scannable. Drag-and-drop supports pointer, touch, and keyboard operation, while the same moves remain available as labeled 44px buttons; drag is never the only control. Existing and proposed assignments remain distinguishable in the preview, and a restore action discards local edits before apply. Forms keep visible focus, semantic labels, explicit loading/error status, and natural wrapping at 320px without horizontal overflow. The preview is a readable inset plan before the separately authorized apply control. Sensitive confirmation requires typed fixture text and cannot rely on color. Once voting or protected history exists, the detail remains visible and its mutation controls become unavailable. Admin strings exist in both message resources, while the current operator presentation is intentionally Spanish.

The match detail begins with a compact readiness panel before lineup editing. It uses a semantic definition list for confirmed starters, entering substitutes, unused or unconfirmed players, coach status, lineup provenance, lifecycle execution, provider request count, and timing observations. Missing measurements say that they are unavailable instead of showing zero. The prompt lifecycle control uses the standard primary action, then the existing inset preview, passphrase, and exact-confirmation sequence. After submission it names the durable request state in text and offers explicit status and retry controls only while recovery remains authorized; it does not poll automatically. Busy, running, failed, completed, and confirmed voting-open messages remain distinct and cannot rely on color. Timing and provenance never rely on color alone.

For a Match with published results, place the historical API-Football check in its own standard card. Use one secondary action labeled **Comprobar datos de API-Football**, an explicit busy label, and a polite result status. Present persisted local evidence and retained provider evidence as two matching game-inset panels on wide screens and stack them on narrow screens. Each panel names the starting XI, participating substitutes with available entry or exit minutes, and head coach. Show checked time, retained-evidence time, provider fixture state, request count, missing evidence, and discrepancies in text; when a newer response is less complete, explicitly say that earlier provider evidence remains visible. Color may reinforce but never replace these labels. Do not expose technical IDs or imply that late provider evidence replaces the verified historical record. Closed-result cards provide both **Ver resultados** and **Administrar partido** so the owner can reach this comparison without typing a URL.

The admin login button switches to a spinner and “Iniciando sesión…” for the complete authentication and session exchange, stays disabled against duplicate submission, and pairs the visual change with a polite status region. Lifecycle controls remain in the readiness panel when unavailable: the disabled button and nearby text name scheduled, voting-open, finalized, or unsupported state rather than disappearing.

The lineup workspace's primary path is **select Players → arrange lineup → Guardar borrador**. Show useful historical Team choices before typing, using the same canonical identity and Team affiliation contract as the public Player catalog. Keep the 11-player counter adjacent to the starting group, and keep substitute participation categories visible. Roster results use bounded deterministic pages with a labeled, keyboard-accessible **Cargar más jugadores** control so later historical choices remain reachable without an oversized response. An unavailable or incomplete membership index uses the existing explicit search error state and never presents a partial list as complete. Draft status uses text for unsaved, saving, saved, and failed states. Saving works for incomplete preparations and does not ask for evidence or credentials. Put **Nuevo jugador** beside roster selection in a collapsed inset with name, optional position and shirt number, an independent-verification checkbox, and potential canonical matches from the same search; never show an internal-ID field. Place **Confirmar alineación verificada** in a separate collapsed section with the Match, provider fixture, starter/substitute/entrant summary, authority explanation, evidence fields, preview, passphrase, and exact confirmation. Both drag controls and labeled click controls remain available on touch and keyboard layouts, and cards wrap without horizontal overflow. Validation errors name the safe corrective category and retain every field. An invalid saved internal allocation adds one localized recovery control beside the error; recovery keeps the editor content and Player IDs, reports progress in text, and returns the draft to its saved or unsaved state without exposing a token.

The identity page uses the same card and inset vocabulary as the Match workspace and a compact keyboard-operable **Jugadores / Directores técnicos** tab pair. Each view leads with compact likely-duplicate rows; a suggestion opens one focused review directly, while bounded paginated manual search remains a secondary expandable action. Both routes enter the same review component. Only that review renders the two full identity cards side by side, stacking them at narrow widths. Each sole canonical radio label includes the readable name, manual or API-Football provenance, and protected-history state so identical names remain distinguishable. Prefer and label the history-owning identity when safe, and disable a choice that would abandon protected history. Keep same-person, different-person, review-later, edit-selection, preview explanation, passphrase, and success/error feedback in this one flow. Moving into review focuses its heading; returning to manual selection focuses search and preserves the selected pair. Never expose internal IDs, provider IDs, identity tokens, evidence URLs, raw plans, or typed technical confirmations. Conflicts stay visible, preserve the selection, name the corrective action, and disable apply. Tabs, cards, radio controls, actions, status regions, and wrapping must remain usable by keyboard and at 320 px.
