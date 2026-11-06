# FutRate Wrapped · Phase 1 storyboard

Visual specification for [the #111 feasibility proposal](issue-111-wrapped-feasibility.md). Screen contents are placeholders for a reviewed collective club recap. No production awards or data are represented.

## Shared stage and club treatments

Use one 9:16 composition with original 16-bit football graphics. A stable header carries the pixel ball, club name and edition. The main stage presents one fact or award at a time. A quiet footer keeps previous, next, pause/play and progress in consistent positions. DotGothic16 is reserved for short game labels, scoreboard digits and award marks. Names, explanations and controls use the readable sans. Keep club accents in semantic tokens and use text and shape to distinguish states and awards.

| Layer         | Herediano example                                                                                                  | Saprissa example                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Opening frame | Garnet tunnel and yellow floodlight accents. Neutral graphite pitch and off-white text.                            | Purple tunnel and white floodlight accents with the same neutral stage. Current provisional palette pending owner approval. |
| Award frame   | Yellow trophy edge and garnet inset. A compact square portrait or initials with the rating as the largest element. | White trophy edge and purple inset with identical layout and emphasis.                                                      |
| Final card    | Club-colored scoreboard rail and yellow accents against graphite.                                                  | Same scoreboard rail in purple and white.                                                                                   |

Use existing club configuration rather than literal club colors in shared components. Use a project-owned neutral mark where a team image is unavailable. Team marks and portraits follow existing allowed-source policies. For downloadable or shareable assets, confirm redistribution rights independently. Design each composition to work with initials and original artwork. Use the original FutRate identity without copying Spotify assets or game sprites, fonts, sounds or trade dress.

```text
Herediano · garnet / yellow          Saprissa · purple / white
┌─────────────────────┐              ┌─────────────────────┐
│ FutRate CR   [Club]  │              │ FutRate CR   [Club]  │
│ [Edition]    04 / 09 │              │ [Edition]    04 / 09 │
│    [trophy mark]    │              │    [trophy mark]    │
│ [AB] [Player name]  │              │ [AB] [Player name]  │
│ [rating] [sample]   │              │ [rating] [sample]   │
│ Back   Pause   Next │              │ Back   Pause   Next │
└─────────────────────┘              └─────────────────────┘
```

## Storyboard and motion

Suggested order follows the [statistical contract](issue-111-wrapped-feasibility.md#candidate-statistical-contract). Durations are approximate transition lengths, excluding reading time. Each card settles into a complete static frame. Rendering and motion have no bearing on the approved data.

| Beat                          | Portrait frame and motion                                                                                                                               | Static or conditional treatment                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 · Stadium                  | Original floodlights light in sequence over a tunnel silhouette, ~550 ms. Club and exact edition resolve into a static title.                           | Show the title and scope immediately. Unavailable recaps use a plain localized message with a link to club Home.                                |
| 02 · Scoreboard               | A pixel football rolls once into the frame, ~420 ms, and reveals two scoreboard tiles for rated matches and ballots. Digits settle in one ~240 ms flip. | Show final numbers, labels and coverage together. Announce the final text once.                                                                 |
| 03 · Community                | A restrained row of crowd silhouettes rises, ~320 ms, beside distinct rated Players and median ballots per Match.                                       | Include a visible distinction between ballots and unique supporters.                                                                            |
| 04 · Player of the Tournament | A trophy rises into view, ~460 ms. Name and rating lock in beside a small approved portrait or initials.                                                | Stack co-winners in stable order. Long names wrap. Show qualifying appearances and a plain-language rule summary.                               |
| 05 · Match highlight          | Scoreboard strip slides in, ~300 ms, revealing opponent, date, Player and sample.                                                                       | Show shared leaders if tied. Give a labeled link to the source result where appropriate.                                                        |
| 06 · Tournament trajectory    | Plot two equally weighted period markers, ~400 ms. Show highest-rated Match in a compact block below.                                                   | Supply the same comparison in text. Suppress the trend graphic when sample is too small.                                                        |
| 07 · Tactical XI              | Broad positional bands reveal on an original pitch, ~450 ms total.                                                                                      | Equivalent ordered text list by position family. At 320 px use abbreviated pitch markers linked to names in the list. Omit unsupported XI.      |
| 08 · Entering substitute      | A substitution board turns once, ~320 ms, to reveal the Player and qualifying entrances.                                                                | Static board explicitly labels verified appearances from the bench. Omit when evidence is insufficient.                                         |
| 09 · Coach                    | A touchline card settles, ~300 ms, with head-coach name, rating and sample.                                                                             | Use an initials tile where needed. The coach never appears in the Player rankings.                                                              |
| 10 · Closing                  | A short crowd celebration with original pixel confetti, ~480 ms, frames the coverage line and share action.                                             | Share/copy the canonical recap URL and offer replay. The image has its own approved accessible text and locale. No claim that posting happened. |

## Interaction and responsive behavior

- **Mobile.** At 320 px use one column, wrap team/Player names, keep score digits stable and reserve space for controls and mobile safe areas. The stage may scroll vertically when content exceeds the frame. Artwork exports retain 9:16 composition, while browser text resizing may expand the stage. Use targets of at least 44 px and avoid horizontal overflow.
- **Desktop.** Center a bounded portrait stage, with adjacent controls or keyboard hints when room permits. Keep the reading order the same at every width. Avoid stretching a portrait asset into a wide hero.
- **Navigation.** Use visible Previous/Next, direct labeled progress navigation and an optional swipe gesture. Skip moves to the next card without waiting. Arrow keys navigate within the stage without stealing focus from controls. Replay returns to the start. Pause stops visual progression immediately and preserves the current card. Default to manual advance. If an opt-in auto-advance is approved, pause on focus, interaction and hidden tab, and give the reader control over timing. No audio autoplay.
- **Accessible motion.** With reduced-motion preferences use static final frames with instant changes. The same information and actions are available in both modes. Expose the current card and progress as text, update the heading on navigation, and announce only the new card summary through a polite live region. Avoid flashing, looping confetti and color-only signals. Validate contrast and focus for both club palettes.
- **Language and evidence.** Route UI strings and accessible labels through ES/EN resources, default to Spanish, format dates and ratings with shared helpers and retain original names. When a card lacks evidence, skip or use a single localized coverage explanation. If the recap itself fails a publication gate, expose a generic unavailable state and club navigation without private audit reasons or partial awards.
- **Sharing.** A final share/copy action is the first release target. If per-card sharing is approved, use a canonical recap link with a public stable card reference and no personal data. Reuse the established explicit-locale social image pattern. A downloaded card must identify the club and edition, include the canonical domain, and remain understandable outside the app.
- **Rendering budget.** Prefer CSS transforms and opacity, simple vector/CSS art and existing fonts, with lazy-loaded optional imagery. As proposed review budgets, keep new initial visual assets below 150 KB compressed and optional portraits below 50 KB each. Measure on mobile with a missing or delayed image. No animation library, videos, remote sprite sheets or provider fetches on public entry. Revisit numerical budgets with Phase 2 performance evidence.

Review both themes on a 320 px viewport, a typical mobile viewport and desktop using long names, initials, a tied award, no trend, and an unavailable result. Record the approved direction before implementing motion or changing the canonical design system.
