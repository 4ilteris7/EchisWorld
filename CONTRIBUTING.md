# Contributing

## Setup

Use Node.js 24 and install the locked dependency tree:

```powershell
npm.cmd ci
```

Copy `.env.example` to `.env.local` only when a provider credential is needed. Never place real values in commits, fixtures, screenshots, logs, or issue reports.

## Validation

Before submitting a change, run:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
```

Database integration tests may run only against a disposable database supplied through `ECHIS_TEST_DATABASE_URL`.

## Change scope

- Keep changes focused and avoid unrelated formatting or refactors.
- Preserve visible unavailable, partial, stale, and error states.
- Do not introduce fabricated live activity or demo records into production paths.
- Document the source, generation method, date, and license of committed datasets.
- Keep provider credentials and database access server-side.

## Commit messages

Use short, descriptive messages such as `feat: add report clustering`, `fix: keep provider keys server-side`, or `docs: document local setup`.
