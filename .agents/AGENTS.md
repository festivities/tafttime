# Berkeleytime / TaftTime Agent Guide

This file is the repository guide for coding agents and contributors. It describes the architecture that is present in the repository today. Read the source and package manifests before changing behavior; several older documents still describe an earlier Berkeleytime stack.

TaftTime is intended to be a Berkeleytime fork that uses a different university's SIS and related endpoints. That future work should preserve the existing boundaries unless a provider's capabilities require a deliberate change. The current application is still Berkeleytime-oriented in names, copy, domains, OAuth settings, and some helper data.

## Repository At A Glance

This is a private npm workspaces monorepo managed by Turborepo.

```text
apps/
  frontend/          Main student-facing React application
  backend/           Express + Apollo GraphQL API and jobs
  datapuller/        SIS/AWS ingestion CLI writing MongoDB
  ag-frontend/       Alternate AG frontend, optional Docker profile
  staff-frontend/    Internal staff dashboard, optional Docker profile
  api-sandbox/       API exploration app, optional/auxiliary
  semantic-search/   Python semantic-search service, optional Docker profile
  docs/              mdBook-style developer documentation
  storybook/         Theme/component stories, optional Docker profile
packages/
  common/            Shared Mongoose models and domain utilities
  gql-typedefs/      Shared GraphQL typedef source
  sis-api/           Generated SIS HTTP clients from OpenAPI specs
  shared/            Shared frontend/API helpers and telemetry utilities
  theme/             Shared React theme and UI components
  BtLL/              GradTrak planning library
  eslint-config/     Shared ESLint configuration
  typescript-config/ Shared TypeScript configurations
tests/               Playwright smoke, API, and E2E tests
infra/               Helm charts and deployment values/templates
observability/       Local OTel Collector, Prometheus, Loki, Tempo, Grafana config
migrations/          Historical/one-off migration scripts
scripts/             Repository-level operational scripts
docker/              Docker initialization scripts
```

The workspace is defined by the root `package.json` as `apps/*` and `packages/*`. Use npm, not yarn or pnpm. The expected toolchain is Node `>=22.12.0`, npm `>=10.0.0`, and npm `11.6.1` as the package manager version.

## Runtime Architecture

The normal request path is:

```text
browser
  -> nginx :3000 (main), :3001 (AG), or :3002 (staff)
  -> frontend Vite dev server or static server
  -> /api and redirect routes -> backend :5001
  -> Apollo GraphQL resolvers -> MongoDB and Redis
```

The core Docker Compose stack is `backend`, `frontend`, `mongodb`, `mongodb-init`, `mongodb-preflight`, `redis`, `redis-preflight`, and `nginx`. `semantic-search`, `ag-frontend`, `staff-frontend`, `storybook`, `docs`, and MinIO are opt-in profiles.

### Backend startup

`apps/backend/src/main.ts` imports `instrumentation` first. This is intentional: OpenTelemetry must register before HTTP, Express, Mongoose, and other modules load. It then imports shared configuration and calls `bootstrap`.

`apps/backend/src/bootstrap/index.ts`:

1. Creates the Express application and enables `trust proxy`.
2. Adds request logging, excluding health/readiness paths.
3. Exposes `GET /healthz` with a plain `OK` response.
4. Runs the loaders in `src/bootstrap/loaders`.
5. Starts the HTTP server on `config.port`.

The loader order is significant: MongoDB first, Redis second, Apollo third, then Express route mounting. Background jobs start after the loaders finish. Current jobs include class view-count flushing, banner view-count flushing, user activity-score updates, and tracking-event flushing.

### Express and HTTP routes

`apps/backend/src/bootstrap/loaders/express.ts` installs compression, a 100 KB JSON parser, the persisted-operation body error handler, CORS with credentials, Helmet, Passport authentication, and module routes.

Routes include:

- `/api/graphql` through the persisted-operation gateway only.
- `/api` module APIs and tracking routes.
- `/banner/`, `/go/`, `/nav-item/`, and `/message/` redirect/click/message routes. These are mounted on the root application so they work as direct browser URLs.
- `/semantic-search` for the semantic-search integration.
- Staff-specific backend routes.
- `GET /healthz` for container health checks.

`nginx.conf` exposes the same backend routes on each frontend-facing listener and proxies the catch-all route to the corresponding frontend. It also forwards W3C trace headers (`traceparent`, `tracestate`, and `baggage`) and proxies browser OTLP traffic under `/otlp/` when the observability stack is enabled. Port `8090` is an internal nginx status endpoint and should not be exposed publicly.

### GraphQL boundary

GraphQL is assembled by `apps/backend/src/bootstrap/graphql/buildSchema.ts` from modular backend typedefs/resolvers. Backend modules follow the pattern:

```text
apps/backend/src/modules/<feature>/
  index.ts       GraphQL module registration
  resolver.ts    GraphQL resolver map
  controller.ts  Database/domain operations
  formatter.ts   API output transformation, where needed
  routes.ts      Express routes, where needed
```

The main modules are analytics, banner, cache, class, collection, common, course, curated-classes, enrollment, grade-distribution, nav-item, pod, plan, rating, route-redirect, schedule, semantic-search, staff, targeted-message, term, tracking, and user.

The public GraphQL endpoint is deliberately not raw Apollo HTTP middleware. `apps/backend/src/bootstrap/graphql/persistedOperationGateway.ts` accepts only `POST` requests with `Content-Type: application/json` and a body shaped as:

```json
{"id":"64-character-lowercase-sha256-id","variables":{}}
```

It rejects extra body keys, malformed IDs, arrays, unknown operations, invalid JSON, oversized bodies, wrong methods, and wrong content types. It looks up the ID in generated server-controlled documents, filters variables to the operation's declared variable names, preserves request headers/context, and executes Apollo in-process. Do not mount a raw GraphQL endpoint or bypass this gateway.

The allowlist is generated by `apps/backend/scripts/generate-operation-allowlist.mjs`. It scans GraphQL documents and `gql` tagged templates in:

- `apps/frontend/src`
- `apps/ag-frontend/src`
- `apps/staff-frontend/src`
- `apps/semantic-search/app/graphql`

Each document must contain exactly one named query or mutation. Subscriptions, authored `__typename`, and introspection fields are rejected. The generated backend map is `apps/backend/src/bootstrap/graphql/generated/persistedOperations.ts`; the previous map is retained as `previousPersistedOperations.ts` when content changes. Semantic-search receives a generated Python operation-ID map.

Run `npm run generate:operations` after changing an operation, and use `npm run check:operations` to verify that generated output is current. Generated files are not hand-edited.

Apollo also provides response caching backed by Redis, cache-control handling, GraphQL Armor protections, authentication directives, OpenTelemetry spans/metrics, and structured error logging. Cache keys include a hash of the `bt.sid` session cookie where relevant; cached values are compressed and TTLs are capped by the next expected data-puller run.

### Authentication and sessions

Passport setup is in `apps/backend/src/bootstrap/loaders/passport.ts`. Google OAuth credentials and `SESSION_SECRET` are required by the backend configuration. Requests carry the Express session through Redis. The GraphQL context includes the request, Redis client, authenticated user state, and a logout adapter. Development authentication helpers live in `apps/frontend/src/utils/devAuth.ts` and related backend support; do not use them as production authentication.

Authorization is enforced by module resolver logic and GraphQL auth directives. Staff and analytics paths require their staff checks. Treat all client input as untrusted, including persisted-operation variables.

## Data Layer And Ingestion

### MongoDB

MongoDB is the source of application persistence. The local stack uses `mongodb/mongodb-atlas-local:8.0`, replica set `rs0`, database `bt`, and a named Docker volume. `mongodb-preflight` repairs/initializes mounted paths and the keyfile. `mongodb-init` waits for MongoDB and runs `docker/mongodb/init/01-create-search-indexes.js`.

Shared Mongoose models are in `packages/common/src/models`. Important collections/models include courses, classes, catalog classes, sections, terms, enrollment histories/timeframes, grade distributions, ratings/reviews, schedules, plans, collections, users, banners, targeted messages, navigation items, curated classes, staff members, tracking events, and view-count records. Reuse these models rather than defining duplicate schemas in an app.

`apps/backend/src/bootstrap/loaders/mongoose.ts` connects the backend using `MONGODB_URI`. The datapuller has its own loader and uses the same shared models. The local backend URI normally uses Docker DNS:

```text
mongodb://mongodb:27017/bt?replicaSet=rs0
```

Repository scripts run on the host may instead use `mongodb://localhost:3008/bt?directConnection=true`.

### Redis

Redis is used for Express sessions, Apollo response caching, tracking/event buffering, and other cache operations. Local Redis is `redis/redis-stack-server:7.2.0-v14`. `redis-preflight` waits for Redis and flushes it on startup, so local cached state is intentionally ephemeral across a normal stack startup.

### SIS API clients

`packages/sis-api/specs/{courses,classes,terms}.json` are the provider API specifications. `packages/sis-api/src/index.ts` generates/exports typed clients to `dist/courses.ts`, `dist/classes.ts`, and `dist/terms.ts`; consumers import them through `@repo/sis-api/courses`, `@repo/sis-api/classes`, or `@repo/sis-api/terms`. Provider-specific credentials are the six `SIS_*_APP_*` variables.

For TaftTime provider work, update the specs/generated client and the datapuller mapping together. Do not scatter provider URL/header assumptions through resolvers or UI code. Preserve the normalized shared model shape where possible; put provider-specific transformation in the ingestion layer.

### Datapuller

`apps/datapuller/src/main.ts` is a CLI selected with `-- --puller <name>` when invoked through the package command. It connects to MongoDB, selects one puller, logs success/failure, and exits with status 0 or 1. Available pullers currently include:

- `courses`
- `decals`
- `sections-active`, `sections-last-five-years`
- `classes-active`, `classes-last-five-years`
- `grades-recent`, `grades-last-five-years`
- `enrollments`, `enrollment-timeframe`
- `terms-all`, `terms-nearby`
- `migrate-aggregated-metrics-classid`
- `catalog-sync-grades`

Puller implementation is split between `src/pullers`, transformation/business helpers in `src/lib`, provider clients in `src/lib/api`, and setup/configuration in `src/shared`. The generic paginated fetcher batches 50 pages concurrently, retries non-404 failures up to three times with backoff, treats 404 as end-of-data, allows at most 10% failed pages per batch, and ultimately throws if any page failed. Keep that failure behavior: silently publishing incomplete academic data is worse than failing an ingestion run.

The catalog denormalization path builds `catalog_classes` from normalized course/class data. `scripts/rebuild-catalog.ts` is a catalog-only repair tool: it discovers terms with catalog data, deletes each term's old denormalized rows, and inserts replacements in batches of 2,000.

AWS Athena/S3 settings support enrollment and related data workflows. S3/MinIO settings support staff images and backend object access. Never commit credentials or real data dumps.

## Frontend Architecture

### Main frontend

`apps/frontend` is a Vite React 19 application. `src/main.tsx` mounts `App`, imports browser instrumentation, and imports the global stylesheet. `src/App.tsx` creates the Apollo client with the shared persisted-operation fetcher, wraps the app in Apollo, theme, tracking, and user providers, and defines the React Router 7 route tree.

Routes currently include the landing page, schedule management/comparison, GradTrak onboarding/dashboard, curated classes, about/apply/legal pages, profile/account/support/ratings/bookmarks/notifications, collection details, grades, enrollment, legacy grades/enrollment, catalog, and a not-found route. Many route modules are lazy-loaded behind `SuspenseBoundary`. Preserve route-level code splitting when adding substantial pages.

UI organization is feature-oriented:

- `src/app/<feature>` contains page-level routes and feature components.
- `src/components` contains reusable application components.
- `src/lib` contains domain logic such as course/class parsing, schedule conflict detection, grades, colors, locations, recent items, and enrollment URLs.
- `src/lib/api` contains GraphQL documents/API hooks by domain.
- `src/hooks`, `src/contexts`, and `src/providers` contain shared client state and effects.
- CSS Modules (`*.module.scss`) are the normal feature styling approach; global styles are in `main.scss` and `_mixins.scss`.
- `src/app/_legacy` is intentionally retained legacy UI. Do not delete or rewrite it incidentally.

The frontend uses Apollo normalized caching plus React context for user, schedule, and class state. API files must use named GraphQL operations and remain compatible with persisted-operation generation. Use stable `data-testid` attributes for important E2E targets.

### Alternate frontends and shared packages

`apps/ag-frontend` is served on port 3001 and `apps/staff-frontend` on port 3002. Both use Vite/React and the shared API boundary. Staff uses `@repo/theme` and has dashboard, analytics, and outreach areas. `apps/api-sandbox` is an auxiliary GraphQL/SIS exploration surface, not part of the default core stack.

`packages/theme` is the shared UI package with components, hooks, stories, and theme behavior. `apps/storybook` documents/visualizes it. `packages/shared` contains cross-app helpers such as persisted-operation fetching, ratings configuration, staff data, and metrics. `packages/common` is shared domain/data code and is imported by backend and datapuller as well as some clients.

## Configuration

`packages/common/src/utils/config.ts` loads `.env` with dotenv and eagerly requires backend variables. The datapuller has a separate config loader in `apps/datapuller/src/shared/config.ts`. Start from `.env.template`; never commit `.env`.

Backend variables:

- `PORT`: backend listen port, normally `5001`.
- `CACHE_WARMING_PORT`: reserved cache-warming port.
- `URL`: configured public/frontend origin used by CORS.
- `BACKEND_PATH`: route prefix, normally `/api`.
- `BACKEND_PUBLIC_URL`: optional full backend URL for production OAuth callback handling.
- `GRAPHQL_PATH`: internal GraphQL path, normally `/graphql`; nginx exposes it as `/api/graphql` through the backend prefix.
- `NODE_ENV`: controls development behavior.
- `SEMANTIC_SEARCH_URL`: semantic-search service URL.
- `MONGODB_URI`, `REDIS_URI`: persistence and cache connections.
- `SIS_CLASS_APP_ID`, `SIS_CLASS_APP_KEY`, `SIS_COURSE_APP_ID`, `SIS_COURSE_APP_KEY`, `SIS_TERM_APP_ID`, `SIS_TERM_APP_KEY`: SIS credentials.
- `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: sessions and Google OAuth.
- `S3_ENDPOINT`, `S3_IMAGES_ACCESS_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: object storage/images.

Datapuller-only variables additionally include `AWS_DATABASE`, `AWS_S3_OUTPUT`, `AWS_REGION_NAME`, `AWS_WORKGROUP`, `BACKEND_URL`, `SEMANTIC_SEARCH_URL`, and optional SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`). AWS credential variables and Cloudflare variables are also present in the template for relevant jobs/workflows.

The template contains Berkeley/OCF defaults and placeholder underscores. Replace them for TaftTime; do not assume a university's email, OAuth, SIS headers, academic term names, timezone, or image endpoint can be reused.

## Local Development

Install dependencies from the repository root:

```sh
npm install
npx turbo run generate
```

The current documented bootstrap script targets macOS/Linux/WSL. On Windows, run the equivalent setup steps manually or through WSL. Create `.env` from `.env.template`, fill required values, then start the core stack:

```sh
docker compose up -d
```

The main application is at `http://localhost:3000`. Useful optional profiles:

```sh
docker compose --profile ag up -d
docker compose --profile staff up -d
docker compose --profile semantic-search up -d
docker compose --profile docs up -d
docker compose --profile dev up -d
```

Default host ports are 3000 main, 3001 AG, 3002 staff, 3003 docs, 3004 Redis, 3005 Storybook, 3006/3007 MinIO API/console, 3008 MongoDB, and 3010 semantic search. The API sandbox is listed in the docs as 3009 but is not a default service in the root compose file. `DEV_PORT_PREFIX=80` is the supported alternate prefix for parallel stacks, producing 8000-series ports.

Use `docker compose down` to stop the stack. If dependencies or Docker images changed, use `docker compose down` followed by `docker compose up --build -d`. Source mounts provide live development for the core applications; a dependency change generally requires rebuilding.

The older root `setup.md` refers to Postgres, Django, Node, `make`, and Berkeleytime's historical SQL seed image. That is not the current Compose architecture. Prefer `apps/docs/src/getting-started/local-development.md`, `docker-compose.yml`, `.env.template`, and package scripts. The docs also reference a bootstrap script and workflows; verify those paths against the current tree before relying on them.

## Commands And Verification

Run commands from the repository root unless using a workspace-specific command.

```sh
npm run dev                 # turbo dev for packages/apps that define it
npm run build               # generate then build all eligible workspaces
npm run generate            # workspace GraphQL/client generation
npm run generate:operations # rebuild persisted operation maps
npm run check:operations   # fail if operation maps are stale
npm run lint                # turbo lint
npm run type-check         # turbo TypeScript checks
npm run format             # Prettier over TS/TSX/SCSS
npx playwright test        # all Playwright projects
npx playwright test --project=sanity
npx playwright test --project=api
npx playwright test --grep e2e
```

Workspace scripts are in each app's `package.json`. Backend tests use Node's test runner through `tsx`; frontend unit tests use Vitest. The datapuller has build/lint/type-check scripts but no dedicated test script.

The Playwright config has `sanity`, `api`, and four E2E projects: Chromium, Firefox, WebKit, and iPhone 12. It defaults to `http://localhost:3000`; `TEST_BASE_URL` overrides it. `TEST_ENV=production` targets the configured live Berkeleytime URL and does not start Docker. `REUSE_EXISTING_TEST_SERVER=true` lets local API tests reuse an existing stack. CI retries twice, uses one worker, forbids `.only`, and uses the GitHub reporter.

Tests are grouped by responsibility: sanity checks are fast critical-path checks, API tests call GraphQL directly, and E2E tests cover browser workflows. Prefer API tests for resolver/validation behavior and E2E tests for integrated user flows. Avoid hardcoded waits; use assertions and stable selectors. Keep tests isolated and avoid depending on mutable production data.

## Generated Files And Change Workflow

When changing GraphQL typedefs under backend modules or shared typedef sources, run the relevant `generate` task and inspect generated diffs. When changing a client GraphQL operation, run `npm run generate:operations`; the operation ID is a SHA-256 hash of the canonical source document, so even a meaningful document change changes the ID. Keep old operations only when the compatibility behavior is intentional; the generator automatically snapshots the prior allowlist.

Do not manually edit generated files, generated SIS clients, GraphQL generated types, or persisted-operation maps. Change their source and regenerate. If generated output is unexpectedly huge, inspect the generator inputs before committing.

For a normal change:

1. Identify the owning app/package and trace its callers/data path.
2. Reuse shared models, utilities, theme components, and existing API patterns.
3. Make the smallest behaviorally complete change.
4. Regenerate code when source schemas/operations changed.
5. Run focused tests, then `npm run lint`, `npm run type-check`, and the relevant build.
6. Run `npm run check:operations` for any GraphQL client change.

## Security Rules

Treat the persisted GraphQL gateway as a security boundary. Read `docs/security/public-graphql-boundary.md` before changing it. Never re-enable arbitrary client-supplied GraphQL documents, introspection, subscriptions, or unbounded request bodies on the public path.

Do not commit `.env`, credentials, OAuth secrets, AWS keys, SMTP passwords, Cloudflare tokens, private backups, or real student/user data. Use redacted local fixtures or public seed data. Do not log session cookies, OAuth tokens, SIS credentials, or sensitive request variables.

Preserve Helmet, CORS credential behavior, session handling, auth directives, request limits, and trace propagation unless the change explicitly addresses one of them. Validate input at module boundaries and preserve authorization checks in both GraphQL and staff routes.

## Observability And Operations

The backend and frontend initialize OpenTelemetry. Local observability is defined by `docker-compose.observability.yml` and `observability/`: the Collector receives OTLP, Prometheus handles metrics, Loki handles logs, Tempo handles traces, and Grafana is provisioned with data sources. Backend metrics include request/GraphQL operation counts and durations, feature usage, GraphQL errors, cache hits/misses, Redis operation duration, and rejected persisted-operation requests.

Deployment artifacts live under `infra/` Helm charts and `.github/workflows`. CI covers lint/build/Playwright; CD builds images and deploys development, staging, production, docs, and Storybook according to workflow triggers. Deployment values and secrets are environment-specific. Inspect the workflow and chart before changing ports, image names, probes, ingress, or environment variables.

Operational scripts under `.github/workflows` include MongoDB restore/reset runbooks, Helm diff, datapuller triggering, and deployment workflows. Production data operations require the relevant maintainer permissions and should not be improvised locally.

## Naming And Portability Notes

Many current identifiers remain `berkeleytime`, `bt`, `bt.sid`, Berkeley domains, Berkeley department nicknames, Sather Tower assets, Berkeley OAuth redirect origins, and OCF SMTP settings. These are current implementation details, not proof that the system is provider-neutral. A TaftTime migration should inventory and replace them intentionally, especially:

- SIS OpenAPI specs, credentials, URLs, pagination, headers, and term semantics.
- Course/class/section identifiers and subject/department normalization.
- Academic calendar and enrollment-timeframe parsing.
- Grade and enrollment availability/meaning.
- OAuth allowed origins and callback URLs.
- Public links, legal copy, email sender, branding, maps, and timezone.
- Seed/backup strategy and any Berkeley-specific analytics or curated content.

Keep provider-specific code at the boundary. The frontend should consume normalized GraphQL data and should not call a university SIS directly.

## ArchersHub Integration

Detailed ArchersHub research lives in `.agents/ArchersHub/`. Read it before implementing TaftTime's DLSU provider integration.

The current provider investigation verified that authenticated Course Finder browser requests use:

- `POST https://archershub.dlsu.edu.ph/CourseFinder/GetCourseList/` with URL-encoded `Campusno` and `AcademicSession`, returning `CourseDrp` records containing `COURSE_CREATION_ID` and `COURSE_NAME`.
- `POST https://archershub.dlsu.edu.ph/CourseFinder/GetCFData/` with URL-encoded `Campusno`, `AcademicSession`, and `Courseid`, returning a JSON array of selectable class/section rows. `STSWENG` (course ID `367`) returned 6 rows in the inspected session. Observed row fields include `SESSION`, `CAMPUS`, `COURSE_CREATION_ID`, `SECTION_CREATION_ID`, `SECTION_NAME`, `CAPACITY`, `UPDATED_CAPACITY`, `SUBJECT_NAME`, `SUBJECT_TYPE`, `CREDITS`, `MAIN_TEACHER`, `ADDITIONAL_TEACHER`, `SCHEDULE`, `ENLISTED`, `APPROVED_COUNT`, `START_DATE`, `END_DATE`, `BATCH_CREATION_ID`, `SECTION_REMARK`, `ROOOMNAME`, and `BATCHNAME`.

Both endpoints require the authenticated ArchersHub browser session. The session cookie is not available through `document.cookie` because authentication state is HttpOnly or otherwise browser-managed. Do not copy local-PC cookies or Chrome profiles into production as the primary design: browser cookies may be OS-encrypted, server-side sessions may be device/IP-bound or expire independently, and copied cookies are bearer credentials. Do not put them in TaftTime configuration, logs, MongoDB, Redis, CI artifacts, or GraphQL.

The preferred design is a dedicated persistent Chromium/Playwright or Selenium worker on the Oracle host. A human performs the one-time `Continue with Google` sign-in in that host's browser profile; the worker then makes the Course Finder requests through the same context. Google credential entry, CAPTCHA solving, and 2FA bypass must not be automated. On redirect-to-login, 401/403, or a confirmed expired-session response, pause ingestion and alert for human reauthentication rather than retrying indefinitely.

Keep this provider-specific browser boundary separate from the public backend. Normalize responses in the datapuller/provider adapter into the existing shared models, use bounded concurrency and rate limits, retain source IDs and retrieval timestamps, validate responses, and prevent incomplete runs from replacing complete catalog data. The expected session lifetime is currently unknown; measure it with redacted login/probe timestamps and failure metrics rather than assuming a TTL.

The first implementation milestone is now in `apps/archershub-worker`. It is a private, read-only TypeScript package that attaches to Chrome over localhost CDP, optionally clicks the real ArchersHub `Continue with Google` control, selects the configured Google account, waits for the OAuth callback/dashboard to finish loading, and reads Course Finder data. Run its `npm test`, `npm run type-check`, and `npm run lint` scripts from the workspace root with `--workspace=archershub-worker`.

The worker deliberately does not own or read the `desktop` user's Chrome profile, export cookies, serialize Playwright storage state, enter Google passwords, approve phone MFA, write MongoDB, modify enrollment, or expose an API. Chrome remains a separate `desktop`-owned process with CDP bound to `127.0.0.1:9222`; the `tafttime` worker attaches to it. A current valid session can run without `--login`. After session expiry, run with `--login --google-account <university-email>` and complete any password or phone approval manually in the visible Chrome/RDP session.

The login automation took several iterations and these details are important. The original probe only checked for `/StudentLogin`, but the logged-out page is the ArchersHub root `/`, so it incorrectly treated the login page as authenticated. The Google chooser opens in a separate `accounts.google.com` page, so the worker must scan all CDP-attached pages instead of continuing with the original ArchersHub page. The account entry needs to be loaded, scrolled into view, and given a short settling delay before the click. Selecting the account can return briefly to `/StudentDashboard` before dashboard content exists; authentication is therefore confirmed by real dashboard/Course Finder markers and settled page state, not URL alone. The worker also waits for the OAuth callback and network/page loading before requesting Course Finder.

The verified milestone sequence was: after logout, the login page visibly displayed `Continue with Google`; clicking it reached Google's account chooser; selecting the already-authenticated university account returned to `https://archershub.dlsu.edu.ph/StudentDashboard`; Course Finder then returned 2,772 live offerings, `STSWENG` resolved to course ID `367`, and `GetCFData` returned 6 class rows. The count is live and must not be hardcoded. Do not automate Google credential entry, CAPTCHA solving, or phone approval.

## Source Of Truth Priority

When documentation conflicts, use this order:

1. Running source and package scripts.
2. `docker-compose.yml`, `nginx.conf`, and `.env.template`.
3. `apps/docs/src` current architecture/development docs.
4. Tests and workflow definitions.
5. Root `README.md` and `setup.md`, which contain historical references.

If a change exposes a contradiction, fix the narrowest documentation or code path that is actually wrong, and mention the discrepancy in the change summary.
