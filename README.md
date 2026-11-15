# RubayOS

Academic management platform: routines, notices, self-reported attendance, question bank, AI study tools.
First deployment: National University Bangladesh, Dhaka City College, CSE (B.Sc. Honours).

## Structure

```text
client/           React + Vite + Tailwind + DaisyUI (JavaScript)
server/           Node + Express + Mongoose (TypeScript)
packages/shared/  Shared constants and API types
docs/             Architecture, API, database notes
```

## Setup (Node 20+)

```bash
npm install
cp server/.env.example server/.env     # then fill MONGODB_URI
npm run dev:server                      # http://localhost:5000/api/v1/health
npm run dev:client                      # http://localhost:5173
```

## Checks

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Roadmap

Step 1.1 foundation (done) → 1.2 academic hierarchy (done) → 1.3 auth + roster join (done) → 1.4 RBAC + scoped admin (this step) → 1.5 roll engine → 1.6 role layouts.
