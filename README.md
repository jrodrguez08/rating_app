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
npm run test:firebase # Firestore persistence and security-rule tests
npm run build         # production build
npm run verify        # canonical complete local/CI quality gate
```

## Firebase setup

Firebase environments are explicit:

- `local` always uses the Firestore Emulator and defaults to the safe `demo-rating-app-local` project ID.
- `development` requires a complete Firebase Web configuration for a separate cloud development project.
- `production` requires a complete production Web configuration and must never be used for local seeding or tests.

For local persistence work, install Java and Firebase CLI 15.28.2 separately, copy `.env.example` to `.env.local`, and run:

```bash
npm run firebase:emulators
```

Firestore runs on 8080 and the Emulator UI on 4000. In another terminal, explicitly bootstrap the deterministic initial Team:

```bash
npm run seed:firebase
```

The bootstrap targets `127.0.0.1:8080` by default, accepts only a local host and `demo-*` project ID, creates `teams/club-sport-herediano` only when absent, and never runs during app startup. Run `npm run test:firebase` to start an isolated emulator, verify persistence and rules, then stop it.

`teams/{teamId}` is public-readable and denies all browser writes. Every other collection remains deny-all. The Firebase CLI is intentionally not a project dependency because its large dependency tree is unnecessary for application builds. CI installs a pinned CLI version separately and runs the emulator suite after `npm run verify`.

To use a cloud development project later, register a Web app, set `NEXT_PUBLIC_FIREBASE_ENVIRONMENT=development`, and provide every public Firebase value in `.env.local`. Do not reuse production values. No production credentials, Admin SDK, or deployed Firebase resources are required for this milestone.

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
