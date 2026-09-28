# AGENTS.md - EchisWorld

Short standing notes for coding agents. Code is the source of truth when this
file disagrees with implementation.

## Project

EchisWorld is a local-first public-source situational-awareness dashboard:
Next.js web app, PostgreSQL, and a Node.js collector worker.

The active UI is the Monitor workspace:

- App shell: `components/layout/AppShell.tsx`
- Monitor UI: `components/monitor/MonitorWorkspace.tsx`
- Monitor map: `components/monitor/MonitorMap.tsx`
- Monitor CSS: `components/monitor/MonitorWorkspace.module.css`
- Map engine: `components/map/engine/`
- Source provider: `components/source-intelligence/SourceIntelligenceProvider.tsx`

Auxiliary standalone screens from earlier iterations were intentionally removed
from this working tree for the public release cleanup.

## Commands

- Local app stack: `npm run dev`
- Lint: `npm run lint`
- Type check: `npm run typecheck`
- Tests: `npm test`

`npm run dev` starts the local Docker-backed database/migrations/worker and
Next.js through `scripts/local.mjs`; verbose local logs are expected.

## Security

- Never print, copy, commit, or summarize real `.env*` values.
- Keep provider keys server-side. Do not expose secrets through client props,
  `NEXT_PUBLIC_*`, or generated assets.
- `.env.example` may contain empty placeholders only.
- Use public-source wording; do not imply classified, covert, or private
  surveillance capability.

## Editing

- Preserve existing behavior unless the task asks for a change.
- Prefer focused edits over broad refactors.
- Do not add dependencies, env vars, or database schema changes unless asked.
- Keep compatibility-sensitive names such as `ECHIS_*`, `echis_*` database
  objects, and existing browser storage keys unless the task explicitly asks
  for a migration.

## Public Repo Cleanup

This worktree is being prepared for a clean `EchisWorld` public repository.
The old git history should not be pushed publicly. When ready, create a fresh
repo/worktree without the old `.git` directory and make the first public commit
from the cleaned source state.
