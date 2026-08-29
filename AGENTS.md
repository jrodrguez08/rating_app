# Coding agent instructions

Before product-code changes, read this file plus `PRODUCT.md`, `ARCHITECTURE.md`, and `DESIGN_SYSTEM.md`.

- Preserve product invariants: participant-only ballots, one voter/match ballot, hidden in-window aggregates, and club-neutral domain modeling.
- Keep Herediano-specific names and colors in configuration/presentation, not collection names or generic entities.
- Prefer Server Components; add `"use client"` only for concrete browser behavior.
- Keep code simple, typed, and direct. Avoid broad `any`, unnecessary layers, global state libraries, and giant components.
- Keep imports conventional, unique, and free of unused symbols.
- Update meaningful tests when behavior changes. Test outcomes and accessibility semantics, not implementation trivia.
- Update source-of-truth documentation when product or architecture truths change.
- Never commit secrets. Keep local work on emulators or an explicit development Firebase project.
- Run the complete relevant suite (`npm run verify`) and wait for every process to exit. Never report a command as passing while it is still running.
