# Design system

## Direction

Mobile-first, energetic, and clear. Herediano-inspired red and yellow are the initial theme, but components use semantic tokens (`brand`, `accent`, `surface`, `danger`) so another club can supply a different theme.

## Foundations

- Typography: system sans-serif; bold, compact display headings; comfortable 1.5–1.75 line height for body text.
- Spacing: 4px base rhythm; common gaps 8, 12, 16, 24, 32, and 48px.
- Surfaces: warm canvas, white raised cards, high-contrast dark text, muted secondary text.
- Borders: neutral 1px; accent borders communicate emphasis, not decoration.
- Radius: 8px controls, 12px marks, 20px cards, pills for short statuses only.
- Shadow: one restrained card elevation token.
- Breakpoints: phone-first base; `sm` (640px) adjusts padding/type; larger breakpoints only when content needs them.

## Components

Buttons have a minimum 44px target, clear label, strong focus ring, and disabled semantics. Primary uses `brand`; secondary uses surface plus border; destructive uses `danger` with explicit wording. Cards group one concept and retain readable padding at 320px.

Future rating controls should use large discrete buttons, expose a fieldset/legend and selected state, support arrow/tab/number-key interaction where appropriate, and never rely on color alone. Status states pair text/icon with semantic success, warning, or danger color. Voting-window status must include explicit opening/closing information.

## Accessibility

Use landmarks and heading order, labels for every control, visible keyboard focus, sufficient WCAG AA contrast, reduced-motion preferences, and live regions only for meaningful async changes. Do not disable zoom. Check at 320px width, 200% zoom, keyboard-only, and with a screen reader before shipping interactive work.
