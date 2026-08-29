# Coding agent instructions

`AGENTS.md` is the canonical agent instruction file. Do not add tool-specific copies such as `CLAUDE.md`, `GEMINI.md`, or `CODEX.md` unless a concrete integration cannot reference this file.

Before product-code changes, read this file completely along with `PRODUCT.md`, `ARCHITECTURE.md`, and `DESIGN_SYSTEM.md`. Those four files are the canonical product, architecture, design, and implementation guidance.

- Preserve product invariants: participant-only ballots, one voter/match ballot, hidden in-window aggregates, and club-neutral domain modeling.
- Keep Herediano-specific names and colors in configuration/presentation, not collection names or generic entities.
- Prefer Server Components; add `"use client"` only for concrete browser behavior.
- Keep code simple, typed, and direct. Keep strict TypeScript enabled, use explicit domain types, infer clear local types, prefer `unknown` to unsafe `any`, and narrow values before use.
- Order imports as framework/external, internal `@/` imports, then relative imports. Use type-only imports where appropriate. Keep imports conventional, unique, and free of unused symbols; do not add cosmetic barrel files.
- Prettier is the formatting authority. Run `npm run format` for intentional formatting and do not add stylistic ESLint rules that compete with it. Preserve UTF-8, LF endings, two-space indentation, and final newlines.
- Update meaningful tests when behavior changes. Test outcomes and accessibility semantics, not implementation trivia.
- Update source-of-truth documentation when product or architecture truths change.
- Never commit secrets or local environment files. Keep `.env.example` placeholder-only and keep local work on emulators or an explicit development Firebase project.
- Treat `teams/{teamId}` as public-readable and client-write-denied. Seed only through the explicit emulator bootstrap; never seed from rendering or application startup and never weaken rules for convenience.
- Keep football providers behind `FootballDataProvider`. Never import provider DTOs into UI or domain models, expose `API_FOOTBALL_KEY` to the browser, or run privileged sync persistence against a non-local or non-`demo-*` Firebase target.
- Preserve sync idempotency and bounded provider reads. Match imports must handle the tracked Team as home or away and must not imply that lineups, participants, coaches, or voting data were synchronized.
- Rating eligibility requires both tracked-Team ownership and confirmed match participation. Opponent players/coaches and unused or unconfirmed substitutes are never rateable. Keep participant DTOs behind `FootballDataProvider`, preserve participant/coach sync idempotency, and allow late provider data to correct participation before lifecycle code consumes it.
- Keep lifecycle polling match-aware and on zero-additional-cost infrastructure unless explicitly approved. Provider `FT` alone never opens a window: tracked-Team participant and head-coach readiness must succeed first. Preserve the first server-controlled voting timestamps across retries, keep privileged lifecycle writes server-only, and never expose cron, provider, or Admin secrets.
- Add every user-visible product string through the i18n layer with both Spanish and English translations; hardcode only proper nouns or documented technical exceptions. Preserve Spanish as the default/fallback, use shared locale-aware date/number formatters, and never create translated copies of provider/domain entities.
- Follow the 16-bit sports-game visual language in `DESIGN_SYSTEM.md` while preserving modern usability; do not introduce generic SaaS/dashboard styling. Apply club colors only through presentation theme tokens.
- Use the central typography roles: DotGothic16 only for short, high-impact game/score UI and the readable sans for body copy and long names. Do not add arbitrary font-family declarations.
- Run `npm run test:firebase` for Firestore persistence or rules changes. It requires Java and the externally installed Firebase CLI; CI runs it separately from the standard gate.
- Do not edit or commit generated output such as `.next`, coverage, emulator data, `next-env.d.ts`, or TypeScript build-info files.
- Use `npm run verify` as the complete local quality gate: formatting, lint, strict typecheck, all tests, and production build. Also run `git diff --check` before handoff. Wait for every process to exit and never report a command as passing while it is still running.
- Keep Git changes scoped and preserve unrelated user work. CI must use `npm ci` and invoke the same canonical verification command without production credentials.
