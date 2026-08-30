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

## Buttons and motion

- **Primary:** club-primary surface, high-contrast label, crisp border, hard shadow.
- **Secondary:** raised neutral surface with a clear border.
- **Utility:** quieter game surface for compact actions such as locale selection.

All buttons keep a minimum 44px target, visible label, keyboard focus, and disabled semantics. A press may move 1–2px and remove its hard shadow over 100–180ms. No continuous animation, flashing, glow, screen shake, or spectacle. Reduced-motion preferences collapse transitions.

## Status badges

Status badges are compact rectangular scoreboard labels with text and, when useful, a small icon. Scheduled, live, final, voting-open, voting-closed, and postponed states must remain distinguishable by wording or icon—not color alone. Live/error colors are accents, not full-panel defaults.

## Iconography and team marks

Use a small internal SVG set on a 16×16 grid with crisp geometric paths, `currentColor`, and no copied sprites. Decorative icons are hidden from assistive technology; meaningful icons need an accessible text equivalent. Do not add a broad icon dependency for a few concepts.

Until an intentional provider/logo licensing strategy exists, team marks use original simplified shields with safe initials or abbreviations, flat traditional presentation colors, hard pixel-like geometry, and a neutral fallback for unknown teams. Team-name text must remain present; shields are supplementary and decorative. Never copy, invent, or scrape official crests.

## Rating controls

Ratings use a five-column grid of discrete values `1` through `10`, not a precision slider. Each player and the head coach has a labeled fieldset; every value is a 44px-or-larger button with `aria-pressed`, keyboard operation, high contrast, and an unmistakable club-secondary selected state. The complete-count and sticky submission action remain visible on narrow screens without covering the final control.

Submission uses one focused confirmation dialog because ballots are immutable. It explains that ratings cannot be changed, traps keyboard focus, supports Escape/cancel, and restores focus to the triggering button. Recoverable errors preserve every selected rating. Submitted, closed, not-open, and unavailable states use explicit localized text and never reveal individual or aggregate results.

## Match results

Final results use a scorecard hierarchy, not an analytics dashboard. The match score leads, a crisp secondary-accent block gives player MVP or co-MVP the strongest emphasis, ranked players use numbered inset rows, and the coach sits in a separate panel. Display averages use one decimal in score typography; names remain readable sans and wrap safely. Ranking and MVP labels must be explicit rather than color-only. Do not add traffic-light rating colors, glow, or casino treatment.

## Spacing and responsive behavior

Use a 4px base rhythm and tighter sports-scoreboard density: common gaps are 8, 12, 16, 20, 24, and 32px. Compact does not mean cramped. Body copy keeps comfortable line-height; actions keep touch separation.

Design mobile-first at 320, 360, 390, and 430px. Hard shadows, long Spanish labels, navigation, and menus must not introduce horizontal scrolling. Desktop centers a bounded content column rather than inventing empty dashboards or unnecessary columns.

## Internationalization

Validate every visual component in Spanish and English. Prefer flexible wrapping and content-driven sizing over fixed widths. All visible product strings come from both translation resources. Club, competition, player, and coach names remain untranslated provider/domain data.

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
