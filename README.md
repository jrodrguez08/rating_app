# Rating App

Mobile-first supporter ratings for football matches. The first community is Club Sport Herediano, while the domain remains club-neutral.

## Foundation status

This milestone provides the application shell, design tokens, domain contracts, Firebase boundaries, emulator configuration, and testing/tooling. It does **not** yet authenticate users, sync matches, accept ballots, or show results.

## Developer workflow

Requirements: Node.js 22 and npm. CI uses the same Node major version.

```bash
npm ci
copy .env.example .env.local
npm run dev
```

The page works without Firebase values and will not contact a Firebase project. `.env.example` is committed, `.env.local` is ignored and developer-owned, and CI variables must be supplied by CI configuration when a future test needs them.

Common commands:

```bash
npm run dev           # local Next.js server
npm run format        # write Prettier formatting
npm run format:check  # check formatting only
npm run lint          # ESLint
npm run typecheck     # strict TypeScript check
npm test              # all Vitest tests once
npm run test:watch    # Vitest watch mode
npm run build         # production build
npm run verify        # canonical complete local/CI quality gate
```

## Firebase setup

1. Create separate Firebase projects for development and production when persistence work begins.
2. Register a Web app and copy its public config values into `.env.local` (never commit that file).
3. Enable Anonymous Authentication for the initial voter identity strategy.
4. Create a Firestore database. Keep the deny-all rules until a tested feature introduces narrower rules.
5. Install the Firebase CLI separately, select a throwaway project ID, and run:

```bash
firebase emulators:start --only auth,firestore
```

Auth runs on 9099, Firestore on 8080, and the Emulator UI on 4000. The Firebase CLI is intentionally not a project dependency because its large dependency tree is unnecessary for application builds. The deny-all Firestore rules remain active in emulator development.

No production credentials, Admin SDK, or deployed Firebase resources are required for this milestone.

## Repository guardrails

Prettier owns formatting, ESLint owns code-quality checks, and strict TypeScript owns static correctness. Optional repository-level VS Code settings align format-on-save with these tools. Pull requests and pushes to `master` run `npm ci` followed by `npm run verify`; CI does not deploy or require Firebase credentials.

There is no pre-commit framework yet. At this repository size, the canonical local gate and CI provide sufficient protection without adding hook lifecycle dependencies. Reconsider lint-staged and Husky only if commit-time feedback becomes a demonstrated need.

## Source map

- `src/app`: App Router UI
- `src/components`: reusable presentation components
- `src/config`: initial community/club presentation configuration
- `src/domain`: provider-neutral entities and ports
- `src/lib/firebase`: browser and future privileged-server boundaries
- `firestore.rules`, `firebase.json`: secure default and local emulator shape

Read [PRODUCT.md](PRODUCT.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), and [AGENTS.md](AGENTS.md) before product changes.
