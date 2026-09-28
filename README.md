# EchisWorld

EchisWorld is a local-first, public-source situational-awareness dashboard. It combines a Next.js interface, a Node.js collection worker, PostgreSQL storage, and MapLibre-based geographic views.

> **Pre-release:** the repository is being prepared for its first public release. Provider availability, quotas, and data freshness depend on external services.

## Preview

The final Monitor screenshot will be added here after browser validation. The planned repository asset path is `docs/images/echisworld-monitor.png`.

## Features

- Unified Monitor workspace with report clustering and filtering
- Global, cyber, defense, policy, and public-signal layers
- Server-side public-source adapters and persistent PostgreSQL payloads
- Installation-local RSS, Atom, and public JSON source connections from the Sources screen
- Local Docker workflow with generated database credentials, migrations, worker, health checks, backup, and restore commands
- Explicit unavailable, partial, stale, and error states instead of fabricated live activity

## Architecture

| Area | Implementation |
| --- | --- |
| Web application | Next.js 16, React 19, TypeScript |
| Map rendering | MapLibre GL JS |
| Collection worker | Node.js worker using server-side source adapters |
| Storage | PostgreSQL with versioned SQL migrations |
| Local runtime | Docker Desktop and Compose |

The browser never receives third-party provider secrets. Source adapters read credentials only on the server or in the worker. The Monitor uses OpenStreetMap-derived vector tiles through OpenFreeMap, rendered with a project-owned MapLibre visual system.

## Requirements

- Node.js 24
- npm
- Docker Desktop with Linux containers and Compose 2.24 or newer
- Internet access for live public sources and map tiles

## Local setup

From the repository root:

```powershell
Copy-Item .env.example .env.local
npm.cmd ci
npm.cmd run local:open
```

On Windows, after the first setup you can instead double-click
`Start-EchisWorld.cmd`. The launcher starts Docker Desktop when necessary,
waits for the application health checks, and opens the browser automatically.

The local command creates private database credentials in the ignored `.env.echis-local` file and starts PostgreSQL, migrations, the collector worker, and the web application. Existing images and database data are reused on later starts. Third-party provider credentials are optional and belong only in the ignored `.env.local` file.

### Local commands

| Command | Purpose |
| --- | --- |
| `npm.cmd run dev` | Fast development mode: Docker database plus host worker and Turbopack web server |
| `npm.cmd run dev:webpack` | Compatibility fallback for development if Turbopack causes a problem |
| `npm.cmd run local:open` | Start the complete application and open it in the browser |
| `npm.cmd run local:start` | Start the complete application without opening the browser |
| `npm.cmd run local:rebuild` | Rebuild application images after updating the source code |
| `npm.cmd run local:status` | Show container and application health |
| `npm.cmd run local:stop` | Stop services without deleting data |
| `npm.cmd run local:backup` | Create a checksummed local PostgreSQL backup |
| `npm.cmd run local:restore -- <dump>` | Restore into an empty local database |
| `npm.cmd run local:geo` | Load the separately generated administrative-boundary dataset |

Local services bind to loopback. Application data is stored in the independent `echis-local_data` Docker volume. Do not delete that volume or regenerate `.env.echis-local` for an existing volume.

Development mode does not build production Docker images. It keeps PostgreSQL
in Docker, runs migrations once, builds the small collector bundle, and starts
the collector and Next.js directly on the host. Pressing Ctrl+C stops those two
development processes while leaving PostgreSQL ready for the next fast start.

## Provider configuration

Copy `.env.example` to `.env.local` and configure only the providers you intend to use. Supported optional credentials include:

- `CURRENTS_API_KEY`
- `FINLIGHT_API_KEY`
- `FREENEWSAPI_KEY`
- `GUARDIAN_API_KEY`
- `NEWSDATA_API_KEY`
- `WORLDNEWS_API_KEY`
- `FINDIP_API_KEY`

Never commit `.env.local`, `.env.echis-local`, database dumps, or real credentials. Missing providers remain visibly unavailable; EchisWorld does not replace them with demo records.

### Personal sources

The Sources screen can validate and add HTTPS RSS/Atom feeds or keyless public
JSON feeds. These records live only in the installation's PostgreSQL database;
they do not modify the built-in manifest or travel with the repository. Source
mutations are accepted only from the loopback-bound local application. The
collector worker discovers additions and pause/remove changes without a restart.
API keys are intentionally not accepted by this screen.

## Development checks

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
```

Database integration tests require `ECHIS_TEST_DATABASE_URL` pointing to a disposable test database. Those tests reset the target database and must never use the application database or a production server. Without the variable, database integration tests are skipped.

## Generated and external data

Large administrative-boundary data, local database dumps, build output, and MapLibre worker bundles are deliberately excluded from Git. Documented generator commands rebuild the committed geographic assets where applicable.

Data and service attribution is documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Public-source records may be incomplete, delayed, stale, or incorrect and must not be treated as verified operational intelligence.

## Security

Please do not open public issues containing credentials, private infrastructure details, personal information, or sensitive coordinates. See [SECURITY.md](SECURITY.md) for the disclosure process.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, validation, and data-handling expectations.

## License

EchisWorld is licensed under the [Apache License 2.0](LICENSE). Third-party data, services, and bundled material remain subject to their own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
