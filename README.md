# Rating App

Mobile-first supporter ratings for football matches. The first community is Club Sport Herediano, while the domain remains club-neutral.

## Foundation status

This milestone provides the application shell, design tokens, domain contracts, Firebase boundaries, emulator configuration, and testing/tooling. It does **not** yet authenticate users, sync matches, accept ballots, or show results.

## Local development

Requirements: Node.js 20.9+ and npm.

```bash
npm install
copy .env.example .env.local
npm run dev
```

The page works without Firebase values and will not contact a Firebase project. Configure `.env.local` only when working on Firebase functionality. Run `npm run verify` for lint, strict type checking, tests, and a production build.

## Firebase setup

1. Create separate Firebase projects for development and production when persistence work begins.
2. Register a Web app and copy its public config values into `.env.local` (never commit that file).
3. Enable Anonymous Authentication for the initial voter identity strategy.
4. Create a Firestore database. Keep the deny-all rules until a tested feature introduces narrower rules.
5. Install the Firebase CLI separately, select a throwaway project ID, and run `firebase emulators:start` for Auth (9099), Firestore (8080), and Emulator UI (4000).

No production credentials, Admin SDK, or deployed Firebase resources are required for this milestone.

## Source map

- `src/app`: App Router UI
- `src/components`: reusable presentation components
- `src/config`: initial community/club presentation configuration
- `src/domain`: provider-neutral entities and ports
- `src/lib/firebase`: browser and future privileged-server boundaries
- `firestore.rules`, `firebase.json`: secure default and local emulator shape

Read [PRODUCT.md](PRODUCT.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), and [AGENTS.md](AGENTS.md) before product changes.
