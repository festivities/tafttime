# ArchersHub Implementation Plan

## Recommended Shape

Add a dedicated ArchersHub ingestion/worker boundary rather than putting Selenium/Playwright in the public backend request path:

```text
authenticated browser worker
  -> ArchersHub Course Finder AJAX endpoints
  -> normalized provider adapter
  -> TaftTime datapuller/import job
  -> shared MongoDB models
  -> GraphQL/backend/frontend
```

The worker owns browser state and reauthentication. The provider adapter owns endpoint parameters, response validation, normalization, retries, and rate limiting. The rest of TaftTime consumes normalized records.

## Stages

### Stage 1: Contract fixture

- Capture a redacted successful `GetCourseList` response.
- Capture a redacted successful `GetCFData` response with at least one class/section.
- Use a known non-empty verification course such as `STSWENG` (observed course ID `367`, 6 rows in the inspected session) when validating the worker; do not treat an empty course as an endpoint failure.
- Capture an unauthenticated/expired-session response and redirect behavior.
- Record the selected campus/session discovery response.
- Add schema validation and fixture tests without real cookies.

### Stage 2: Interactive persistent browser bootstrap

- Use a dedicated Oracle OS account and persistent Chromium profile.
- Provide a one-time local/remote desktop provisioning flow.
- Navigate to ArchersHub and let the account owner click Google sign-in.
- Store the profile only on the Oracle host with restrictive permissions and encrypted disk/backup handling.
- Expose no cookie export endpoint.

### Stage 3: Read-only worker

- Probe authentication state.
- Load Course Finder and discover current campus/session IDs.
- Fetch offered courses.
- Fetch class rows with low bounded concurrency.
- Validate every response before normalization.
- Emit metrics for successful requests, failures, response counts, duration, and session-expiry detection.
- Stop and alert on confirmed expiry instead of trying to solve Google login automatically.

### Stage 4: TaftTime integration

- Add a provider-specific adapter under the datapuller/provider boundary.
- Map ArchersHub IDs and fields to the existing `packages/common` models.
- Decide whether Course Finder data maps to `course`, `class`, `section`, or a separate source snapshot before writing production data.
- Preserve source IDs, campus, academic session, and retrieval timestamp.
- Use atomic/versioned replacement or staging collections so an incomplete run cannot erase valid data.

## Session State Machine

Use explicit states rather than assuming a cookie lasts:

```text
NEEDS_LOGIN
  -> AUTHENTICATING (human-assisted only)
  -> AUTHENTICATED
  -> PROBING
  -> EXPIRED or PROVIDER_UNAVAILABLE
```

Only `AUTHENTICATED` may run the catalog pull. `EXPIRED` pauses pulls and alerts. `PROVIDER_UNAVAILABLE` retries according to a separate outage policy. Never use an empty course list as proof that a session is valid; an empty list may mean a bad campus/session selection or a provider data issue.

## Secrets And Access

- Never store raw cookies in `.env`, MongoDB, Redis, logs, CI artifacts, or GraphQL responses.
- Never commit a Chrome profile or browser `Cookies` database.
- Keep Google credentials out of TaftTime entirely.
- Restrict the worker's network access to ArchersHub, required observability, and the private TaftTime ingestion endpoint.
- Redact personal names, student IDs, class rosters, and schedules from logs and fixtures.
- Rotate/revoke the session by signing out in the browser and deleting the worker profile if compromise is suspected.
- Treat the worker host as holding account access and harden it accordingly.

## Verification Checklist

- Course Finder page redirects to login when the profile is unauthenticated.
- Google sign-in is performed manually and never by a bot credential flow.
- `GetCourseList` returns a validated `CourseDrp` array.
- At least one valid course produces a validated `GetCFData` class array.
- Invalid campus/session/course IDs fail visibly and do not publish empty replacement data.
- A valid course with no offerings is distinguished from an authentication failure, malformed request, or provider outage.
- Seat availability is `CAPACITY - ENLISTED`, owner-approved. Preserve `UPDATED_CAPACITY` and `APPROVED_COUNT` as unused source observations.
- Session expiry pauses the worker and emits an alert.
- Restarting the worker reuses the persistent profile without cookie export.
- A fresh profile requires interactive sign-in.
- Request concurrency and retry behavior stay within an agreed provider-safe limit.
- No test output contains cookie values, authorization headers, or personal data.

## First Worker Implementation

The first read-only worker milestone is implemented at `apps/archershub-worker`. It attaches to the `desktop` user's Chrome over localhost CDP, optionally clicks the real Google flow, validates Course Finder responses, and prints safe metadata. It has no MongoDB, Redis, GraphQL, or enrollment side effects.

Watch mode is available with `--watch`. It polls at 900 seconds by default, configurable with `--interval-seconds`. Set `NTFY_TOPIC` for unattended alerts; `NTFY_SERVER` and `NTFY_TOKEN` are optional. The worker sends state-change notifications for authentication-required, provider/Chrome unavailable, and recovery. It attempts Google account selection once per authentication incident and then stops initiating login attempts until the incident clears.

The worker never calls `browser.close()` after CDP attachment. The attached browser belongs to `desktop` and must remain available for RDP-based manual reauthentication.
