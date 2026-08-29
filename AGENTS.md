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
- Run `npm run test:firebase` for Firestore persistence or rules changes. It requires Java and the externally installed Firebase CLI; CI runs it separately from the standard gate.
- Do not edit or commit generated output such as `.next`, coverage, emulator data, `next-env.d.ts`, or TypeScript build-info files.
- Use `npm run verify` as the complete local quality gate: formatting, lint, strict typecheck, all tests, and production build. Also run `git diff --check` before handoff. Wait for every process to exit and never report a command as passing while it is still running.
- Keep Git changes scoped and preserve unrelated user work. CI must use `npm ci` and invoke the same canonical verification command without production credentials.
