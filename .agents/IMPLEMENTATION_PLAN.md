# TaftTime DLSU Integration Execution Plan

## Status And Lifecycle

Owner-approved planning baseline: September 2026. This is a temporary handoff for an implementing agent. Scrub this file only after implementation is considered fully done by the owner. Before removal, preserve durable decisions, commands, contracts, and limitations in AGENTS.md and provider/application documentation.

The authenticated ArchersHub worker is already implemented. Its twenty-minute reload strategy survived an observed ninety-minute unattended run without post-startup reauthentication. Do not restart authentication research or claim indefinite session lifetime from that observation.

Phases A-E and the pure-normalizer slice of Phase F were implemented in September 2026. The worker validates and atomically publishes a versioned single-course snapshot, datapuller can inspect and normalize it offline through the shared contract, provider boundaries reject malformed/ambiguous responses, and focused tests cover publication preservation, secret-safe summaries, scoped row grouping, schedules, campus, credits, availability, and explicit unknowns. The shared-model/GraphQL schema migration and Phases G-J remain unimplemented. Do not silently expand a single-course export into a complete catalog or production import.

## Product Decisions

| Topic | Approved direction |
| --- | --- |
| Audience | DLSU students, not Berkeley students |
| Database | DLSU-only application database; no Berkeley coexistence requirement |
| Calendar | Trimester system: Term 1, Term 2, Term 3 within an academic year |
| Campuses | Manila, Laguna, Rufino officially; initial API collection is Manila only (`Campusno=7`) |
| Source campus IDs | Live dropdown observed: Manila `7`, Laguna `8`, Rufino `9`; composite program options also exist and are out of scope |
| Section campus | Nonempty section names starting with X mean Laguna/STC provisionally; other nonempty names mean Manila provisionally |
| Rufino | Separate source scope exists (`9`); explicit collection support remains future work |
| Term scope | Current academic term only; select the current ArchersHub session dynamically rather than hardcoding `155` |
| Academic career | Do not filter or classify undergraduate/graduate career initially; preserve available source labels and otherwise use unknown |
| Grade scale | 0.0-4.0 in increments of 0.5; 0.0 fails, 4.0 is highest GPA |
| Credits | Source is GetCFData.CREDITS; whole numbers 0-5, attached to each course/component |
| Modality | Interpret verified SCHEDULE structure; hybrid is common, not a universal default |
| Schedule example | `[ FRIDAY - 11:00 AM - 12:30 PM : Room - G304A ] | [ TUESDAY - 11:00 AM - 12:30 PM : Online ]`; pipe-separated bracketed meetings |
| Timezone | Asia/Manila, UTC+8 |
| Available seats | CAPACITY - ENLISTED, user-verified |
| Other counts | Preserve UPDATED_CAPACITY and APPROVED_COUNT; do not use them in availability yet |
| Section rows | Repeated API rows may share the same scoped section key; group them as instructor/meeting fragments of one selectable section |
| Components | Treat separately identified lecture/lab courses as separate retakeable components by default; do not invent links |
| Prerequisites | No authoritative source; omit GradTrak from the initial public deployment and leave prerequisite data unavailable |
| Ratings/reviews | User-generated TaftTime content; launch with no Berkeley records and allow DLSU students to submit new ratings/reviews after identity fields are migrated |
| Stale data | Keep the latest valid data; after 30 minutes without a successful refresh, show its timestamp and an outdated-data warning |
| Unsupported fields | Make inherited GraphQL fields nullable/explicitly unknown or hide their feature; never fabricate Berkeley-compatible values |
| Snapshot storage | Local Oracle filesystem, worker-only permissions, atomic `latest` plus one automatically replaced `previous`; no object-storage service |
| Future institutions | Possible DLS-CSB support; localize institution-specific rules without building speculative infrastructure |

DLSU-only does not authorize deleting any existing database. Inspect the target and obtain explicit approval before destructive migration or cleanup. Development imports must use an isolated DLSU database first.

## Target Architecture

```text
desktop-owned authenticated Chrome
  -> existing ArchersHub worker
  -> private versioned provider-native snapshot
  -> datapuller validation and normalization
  -> DLSU application MongoDB models
  -> existing persisted-operation GraphQL boundary
  -> catalog and scheduler
```

The immediate milestone ends at offline snapshot consumption. It must not write application MongoDB, modify enrollment, expose an HTTP API, or change frontend/GraphQL contracts.

## Read Before Editing

- .agents/AGENTS.md
- .agents/ArchersHub/authentication.md
- .agents/ArchersHub/course-finder.md
- apps/archershub-worker/src/{main,authentication,course-finder,types,logger,state}.ts
- apps/archershub-worker/src/*.test.ts and README.md
- apps/datapuller/src/main.ts and src/shared/config.ts
- apps/datapuller/src/lib/{courses,classes,sections,terms,catalog-denormalize}.ts
- packages/common/src/models/{course,class,section,term}.ts
- packages/gql-typedefs/{class,term}.ts

Recheck git status and package manifests. Do not assume this baseline is unchanged. Use npm workspaces and installed dependencies. Preserve unrelated edits; do not commit or push unless requested.

## Preserve The Working Browser Lifecycle

- Chrome remains owned by desktop; the worker attaches through localhost CDP.
- Retain the authenticated callback Page and browser context.
- Keep four-minute client activity maintenance and twenty-minute Course Finder reloads.
- Ordinary polls reuse the loaded page; reload is not required for every poll.
- Keep bounded Google account selection and manual passwords/MFA approval, plus ntfy notifications.
- Never call browser.close() on attached Chrome, export cookies, copy profiles, or expose CDP publicly.
- Do not proactively call /StudentLogin/ReFillSession/.
- Preserve handling of the exact HTTP-200 JSON null-reference string observed during expiry. This is observed provider behavior, not proof that every .NET exception means expiry.
- Publication errors must never trigger OAuth.

## Phase A: Provider Snapshot Contract

Suggested new file: apps/archershub-worker/src/snapshot.ts. Keep it browser-free and side-effect-free on import. Reuse existing provider record types, strengthening them only where evidence supports it.

```ts
type ArchersHubSnapshot = {
  schemaVersion: 1;
  provider: "archershub";
  retrievedAt: string;
  scope: {
    coverage: "single-course";
    campusId: string;
    academicSessionId: string;
    courseId: string;
  };
  courses: Course[];
  matchedCourse: Course;
  classes: ClassRow[];
};
```

Contract requirements:

1. courses is the offered-course metadata returned by GetCourseList; classes covers only matchedCourse.
2. retrievedAt is a validated UTC timestamp recorded after successful retrieval.
3. Scope IDs are canonical strings. Keep source record fields intact; do not fabricate global uniqueness.
4. coverage must never imply full-catalog completeness.
5. No Page objects, cookies, headers, student profile data, browser storage, or page HTML.
6. Preserve provider spelling ROOOMNAME and unverified optional values. Do not normalize academic semantics here.
7. Validate untrusted input as unknown: non-null envelope, supported version/provider, timestamp, scope, course records, matched-course membership, and row shape.
8. Verify matching IDs using canonical comparison. Reject conflicting course IDs in class rows where supplied.
9. Empty classes is valid for that course. Invalid rows are not silently discarded.

Use standard language checks or an already-established installed validator; do not introduce a schema framework solely for this task.

Acceptance: valid synthetic snapshots pass; malformed envelopes, versions, IDs, and rows fail explicitly.

## Phase B: Harden Provider Boundaries

Files: apps/archershub-worker/src/course-finder.ts and course-finder.test.ts.

1. Harden validateCourseList against null, primitives, and malformed top-level values.
2. Validate each class row as a non-null object rather than only validating its containing array.
3. Preserve valid empty class arrays.
4. Reject ambiguous case-insensitive course-prefix matches instead of silently choosing the first; preserve a unique match.
5. Keep campus/session discovery dynamic. Do not hardcode observed IDs 7, 155, or course 367.
6. Treat explicit HTTP 401/403 as authentication failures; distinguish other HTTP failures and malformed JSON.
7. Preserve authentication, reload, notification, and rate behavior except for narrowly necessary fixes with tests.

Do not equate the section-name campus heuristic with the Campusno request parameter. Request scope and section classification are distinct.

Acceptance: tests cover malformed provider data, unique/ambiguous prefix selection, valid empty classes, and authentication responses.

## Phase C: Atomic Snapshot Publication

Files: worker main.ts, snapshot.ts, tests, README.md.

Add opt-in --snapshot-path /private/path/latest.json. Without the argument preserve current behavior.

1. Fetch and validate both endpoint responses before publication.
2. Construct and validate the versioned snapshot.
3. Write a temporary file in the destination directory, then rename over the destination after successful completion.
4. Never remove or truncate a good destination before replacement. Clean up failed temporary files when possible.
5. Use restrictive permissions where supported; document POSIX modes versus Windows ACLs.
6. Failed login, provider error, ambiguous/missing course, malformed rows, or write failure must leave the previous artifact unchanged.
7. A valid empty class list may replace the previous snapshot for the same single-course scope.
8. Separate file-output failures from provider/authentication classification. Do not publish recovery success before required output succeeds.
9. Log only safe metadata: publication timestamp, coverage, counts, and error category, not records or credentials.
10. On the Oracle host, use one worker-owned directory with mode `0700` and files with mode `0600` where POSIX permissions are available. Keep only `latest.json` and `previous.json`; rotate them during successful atomic publication so no cleanup service or retention job is needed. Do not add S3/MinIO solely for snapshots.

Acceptance: fault injection proves a failed publication cannot destroy the previous snapshot. Existing probe/watch commands still work without export enabled.

## Phase D: Offline Datapuller Consumer

Suggested new file: apps/datapuller/src/archershub-snapshot.ts.

Add a command such as:

```sh
npm run archershub:inspect --workspace=datapuller -- --input /private/path/archershub-latest.json
```

1. Bound input size before reading/parsing; choose and document a limit suitable for a single-course artifact.
2. Parse and validate with the same browser-free snapshot contract.
3. Expose the contract through an explicit worker package export if needed; never import executable main.ts or duplicate validation.
4. Print provider, timestamp, coverage, scope, and counts only.
5. Exit nonzero on invalid arguments, unsupported versions, unreadable files, or invalid payloads.
6. No database setup, CDP attachment, provider requests, or required service credentials.

The existing datapuller setup eagerly requires SIS/AWS/MongoDB and other configuration. Use a dedicated entrypoint rather than weakening global config validation or requiring dummy credentials.

Acceptance: the reader runs offline without application secrets and rejects malformed files predictably.

## Phase E: Tests, Runbook, And First Handoff

Use existing Node/tsx test patterns; no new framework. Synthetic fixtures only, never real Oracle exports in Git or CI.

Minimum coverage:

- Valid end-to-end exporter/reader contract and valid empty classes.
- Null/primitive/malformed envelopes and rows.
- Unsupported version and inconsistent identifiers.
- Ambiguous course selection.
- Publication failure preserves the previous artifact.
- Reader needs no database/network/service secrets.
- CLI errors exit nonzero and diagnostics contain no raw records.
- Existing reload/reuse and authentication regression tests still pass.

Run from repository root:

```sh
npm test --workspace=archershub-worker
npm run type-check --workspace=archershub-worker
npm run lint --workspace=archershub-worker
npm run type-check --workspace=datapuller
npm run lint --workspace=datapuller
npm run build --workspace=datapuller
git diff --check
```

Add and run a focused datapuller reader test command after inspecting its existing scripts. Report unrelated baseline failures separately. No GraphQL generation is needed for A-E.

Update worker/datapuller usage documentation, provider research, and AGENTS.md. Explain that a retained file may be stale: readers must inspect retrievedAt. Read-only means no enrollment/application-data mutations, not no activity storage updates or page reloads.

Optional approved-host live check: export once, inspect offline, observe a subsequent successful replacement and scheduled reload. Keep artifacts private; do not deliberately expire the account or force MFA.

Deliverable: tested machine-readable single-course handoff, commands, changed-file summary, test results, and deferred unknowns. Stop before domain writes.

## Approved Mapping Decisions

### 2. Campus Support And Collection Scope

Section classification is approved: X-prefixed sections are Laguna; other nonempty names are Manila for now. Normalize surrounding whitespace and case before applying the prefix rule. Persist that this classification is inferred, and retain source CAMPUS/request campus ID separately so Rufino can later be corrected without losing evidence.

Collection scope is now decided for the first implementation: query the current academic term only, using Manila's live source campus ID `7`. The current term should be selected from ArchersHub's session data using its current-session marker, not hardcoded to `155`. Charlotte confirmed that CCPROG1 has Manila-only rows under `7` and a distinct Laguna row under `8`; the one request does not include both campuses. Rufino has its own source ID `9` and should be added only in a later explicitly scoped phase. Do not query composite program options or additional scopes now. If X-prefixed sections appear in Manila-scoped data, classify them as Laguna/STC provisionally and preserve both the request campus and inferred section campus; this does not establish complete Laguna coverage.

Recommended initial UI scope: current-term Manila API scope only, with X-prefixed rows visibly marked as provisionally Laguna/STC if they occur; make no explicit Rufino coverage claim. Do not silently use composite campus options. A composite campus option means a degree/program arrangement such as Laguna for two years followed by Manila for two years; it is not a fourth physical campus and is out of scope.

### 3. Scoped Identity And Repeated Rows

Provider IDs are not permanent identities. Course and section IDs are turbulent: section ranges can change between terms, course names can change with curriculum updates, and the owner confirms `COURSE_CREATION_ID` should be considered unstable. Treat section labels and display names as mutable attributes, not identities.

The current CCPROG1 tab proves `SECTION_CREATION_ID` repeats within the same course, Manila scope, and academic session. Examples include `2130`, `2127`, `1391`, `2110`, and `2112`; repeated rows can have different teachers or meeting text while their Add buttons use the same `COURSE_CREATION_ID|SECTION_CREATION_ID|BATCH_CREATION_ID` key. This means an API row is not necessarily an independently selectable section. Preserve every raw row, then group rows for one selectable term section by provider + request campus + academic-session ID + `COURSE_CREATION_ID` + `SECTION_CREATION_ID` + canonical `BATCH_CREATION_ID`. Aggregate and deduplicate teacher and meeting fragments inside that group. Reject or quarantine a group if supposedly section-level values such as course, section name, credits, capacity, or enlisted count conflict unexpectedly.

Use that scoped composite only as a current-term section-group reconciliation key, never as a permanent cross-term identity. Do not create a uniqueness rule on `SECTION_CREATION_ID`, shorten the key later, or key normalized sections by raw-row position. Use the intact course code plus scoped source evidence for display and reconciliation, and never merge rows across terms merely because IDs or labels match. DLSU-only removes Berkeley coexistence work, not the need for correct term/section identity.

### 4. Course Codes And Display Names

Berkeley splits subject and number; DLSU codes such as STSWENG may be meaningful only as a whole. Recommended product representation: intact courseCode plus title, with an optional department only when a source supports it. Do not turn STSWENG into invented subject STS and number WENG.

Decision for the first implementation: add a nullable `courseCode` field, make legacy `subject` and `number` nullable, and parse the currently consistent `CODE - TITLE` form. Preserve the full source name and define behavior for absent separators or ambiguous delimiters. Update consumers rather than fabricating numbers to satisfy legacy schemas. Scope this as a deliberate DLSU schema migration; do not add Berkeley compatibility unless persisted application data actually requires it.

### 5. Academic Terms

Calendar decision is closed: Term 1, Term 2, Term 3, not semesters. Represent academic year and term ordinal separately; retain ArchersHub academic-session ID. Sort by academic year then ordinal, and display labels such as AY 2026-2027 Term 1.

The owner confirms `START_DATE` and `END_DATE` describe the academic term span. Use those fields for the current-term record after validating consistency across returned rows. The first deployment refreshes only the single session selected/marked current by ArchersHub. If no session or multiple sessions qualify as current, reject that refresh, retain the last valid snapshot, and alert instead of choosing arbitrarily. “Academic career” means categories such as undergraduate or graduate; do not filter or classify them initially because the source meaning is unconfirmed. Preserve source labels when present and otherwise use unknown. Audit legacy Semester enums, name splitting, term ordering, and all user-facing semester copy. Do not infer term dates when the fields are absent or inconsistent.

### 6. Course, Class, And Section Meaning

These are software concepts requiring a mapping, not necessarily DLSU's UI vocabulary. A course is the reusable subject definition; a term offering is that course available in a particular term; a section is a particular group/time/instructor choice.

Recommended mapping: one current-scope source course record per `COURSE_CREATION_ID` plus split `courseCode`/title and preserved full source name, and one selectable term section per scoped section-group key. Multiple `GetCFData` rows sharing that key are raw instructor/meeting fragments of the same selectable section, not duplicate normalized sections. `LBYARCH` is a separate laboratory course with its own course ID and one-credit rows; Charlotte confirmed nine Manila LBYARCH laboratory rows. `CCPROG1` currently returns `Lecture and Laboratory` rows with three credits. Do not combine separate courses merely because names/curricula suggest a relationship. Preserve `SUBJECT_TYPE`, `CREDITS`, `SECTION_CREATION_ID`, `SECTION_NAME`, and `BATCH_CREATION_ID` so a later reviewed association can be added. Course code/title splitting should use the current consistent `CODE - TITLE` format, with a safe fallback to the whole source name when the delimiter is absent or ambiguous.

### 7. Linked Components And Primary Sections

Berkeley's scheduler often selects a lecture plus associated lab/discussion. DLSU's confirmed retake rule says a student who fails a lab but passes its lecture, or vice versa, retakes only the failed class. The safe default is therefore separate selectable components with separate grades and retry eligibility, not an invented compulsory lecture/lab pair.

Implement the separate-component model first because no authoritative association key has been found. This matches the confirmed retake behavior: failure of a laboratory or lecture should not force retaking the passed counterpart. Current observations show that some courses use `Lecture and Laboratory` as one `SUBJECT_TYPE`, while LBYARCH is a separate `Laboratory` course; therefore `SUBJECT_TYPE` is descriptive, not a reliable relationship key. If a future source proves components are linked for enrollment, add an explicit optional association/key and permissible-combination model; do not use `SUBJECT_TYPE` alone as a relationship. Do not fabricate a primary section solely to satisfy Berkeley catalog joins. The scheduler should allow independent retakes and preserve component labels.

### 7a. Prerequisites

DLSU has soft prerequisites, which permit a sequel even after failure, and hard prerequisites, which block the sequel after failure. The current Course Finder requests do not expose prerequisite data. The available CS-only observations cannot be generalized to other colleges or majors.

Keep prerequisites explicitly unavailable until an authoritative source is found. Do not ship GradTrak in the initial public deployment; hide its navigation/routes rather than exposing an incomplete planner. Later add a provider-specific prerequisite source or reviewed override table with `kind: soft | hard`, source/evidence, effective term, and course identity before enabling GradTrak. Do not infer prerequisite edges from course numbers, names, curriculum order, or failed enrollment behavior. The product should distinguish “no prerequisite” from “prerequisite data unavailable.”

### 8. Grades, Credits, Modality, And Unknown Values

The numeric grading scale is approved and must replace Berkeley letter-grade assumptions where grade data is actually implemented. It does not supply grading-basis metadata, historical distributions, or final-exam information. Keep unsupported features unavailable/unknown; do not fabricate values or import Berkeley statistics.

Validate `CREDITS` as a whole number from 0 through 5 without converting missing data to zero. Lecture and laboratory courses carry independent credit values: Charlotte observed LBYARCH at 1 credit and CCPROG1 at 3 credits. Display credits on each course/component; do not sum distinct course records unless a later product view explicitly requests total load. Derive per-meeting modality from verified schedule tokens; hybrid can mean different meetings are online and in-person. Missing/unrecognized modality remains unknown. Final-exam availability remains a source question.

### 9. Meeting Grammar

Meeting grammar means the exact syntax used in SCHEDULE: how day names, day abbreviations, times, ranges, dates, rooms, online markers, and multiple meetings are separated. A parser needs examples and rules, not just a timezone.

The confirmed syntax includes `[ FRIDAY - 11:00 AM - 12:30 PM   : Room - G304A ] | [ TUESDAY - 11:00 AM - 12:30 PM   : Online ]`. Parse `|` as the meeting separator, brackets as meeting boundaries, the day token before the first separator, the two time tokens as a local time range, and the suffix after `:` as a location or online marker. Whitespace is non-semantic. Confirmed variants also include a missing suffix (`[ FRIDAY - 01:00 PM - 03:00 PM ]`), single-day online (`: Online`), all-room multi-day meetings, and a missing suffix on one of several meetings. A missing location means unknown location, not online. The owner reports no other known schedule forms; still preserve raw text and fail safely if future malformed or changed values appear.

The ArchersHub `GetScheduleData` endpoint is triggered by the Course Finder page's `View Schedule` button (`#btnViewSchedule`). The button first requires at least one class/section to be added/selected; it then posts selected `COURSE_CREATION_ID`, `SECTION_CREATION_ID`, `BATCH_CREATION_ID`, `CAMPUSNO`, the current session, and a start/end date range to `POST /CourseFinder/GetScheduleData/`. It is a user-selected schedule aggregation endpoint, not a prerequisite for parsing each row's `SCHEDULE`. Use `SCHEDULE` for the first ingestion implementation; investigate this endpoint later for a user's combined calendar view or when row text is insufficient.

Normalize validated entries to day-of-week, local start/end time, optional date range/location, and per-meeting modality using Asia/Manila. Preserve raw schedule and parse status. `Online` means online for that meeting; a row with one room and one online meeting is hybrid, not wholly online. A missing suffix is unknown modality/location, not online. Reject impossible times and mark unrecognized syntax; never silently convert an unparsed schedule into an empty conflict-free calendar. Add fixtures for all confirmed variants and unknown-input behavior. Use real dates only from verified fields.

### 10. Availability

Formula decision is closed: CAPACITY - ENLISTED. Validate actual numeric representations; unknown source values remain unknown. Preserve the signed raw difference, with any UI clamp decided separately. Retain UPDATED_CAPACITY and APPROVED_COUNT but exclude them from calculations until semantics and policy are revised. Do not infer waitlist status from these fields.

## Phase F: Approved DLSU Normalization And Schema Changes

Write a reviewed fixture-to-domain mapping table from the approved decisions above before database code.

Status: the safe database-free slice is implemented in `apps/datapuller/src/lib/archershub-normalizer.ts`. It validates the snapshot, emits one scoped term offering, groups colliding source rows, preserves raw fragments, deduplicates teachers/meetings, parses the confirmed schedule grammar, and retains unsupported values as `null`. The live STSWENG snapshot normalized to six sections with parsed schedules. `START_DATE`/`END_DATE` remain preserved source strings because their numeric date ordering is not yet authoritative. Empty class snapshots intentionally have unknown term label/dates because schema version 1 carries no selected-session label outside class rows.

1. Add a pure ArchersHub normalizer under apps/datapuller/src/lib/.
2. Reuse packages/common models only where their meaning fits; revise incompatible Berkeley assumptions deliberately.
3. Add scoped section-group/provenance fields and unique constraints only on the full approved current-term grouping key; preserve colliding raw rows as fragments.
4. Replace semester terminology/contracts with numbered DLSU terms across shared models, GraphQL, resolvers, frontend ordering, and display.
5. Apply the provisional section campus heuristic with provenance and raw campus preservation.
6. Parse credits and availability using approved rules; retain unsupported values as unknown.
7. Make unsupported inherited GraphQL fields nullable where consumers can handle absence. Use `null` for unknown `gradingBasis`, `finalExam`, and modality; remove the requirement for a fabricated primary section; expose parsed meeting collections only when parsing succeeded, alongside raw schedule/parse status where needed. Hide any feature that cannot operate truthfully with absent data.
8. Keep institutional rules at the provider/domain boundary; do not implement speculative CSB support.

Acceptance for the pure slice is complete: mapper tests establish deterministic scoped section groups, colliding-row aggregation, term/campus mapping, numeric edge cases, supported schedules, and explicit unknown handling without network or MongoDB. Shared Mongoose and GraphQL changes in items 2-4 and 7 still require one coordinated migration before Phase G writes.

## Phase G: Isolated DLSU Import

1. Import into an explicitly isolated DLSU development database first.
2. Validate the complete intended scope before writes and preserve retrieval provenance.
3. Use transactions/staging appropriate to the existing deployment; publish atomically at the exact declared scope.
4. Never feed a one-course snapshot into a term-wide replacement job.
5. Repeated import is idempotent. Partial/failed import leaves the previous good scope intact and exits nonzero.
6. Do not delete Berkeley records or reset databases without explicit owner approval. DLSU-only is the destination policy, not permission for destructive cleanup.

Acceptance: two identical imports produce no duplicates; controlled failure does not erase valid records; different terms/courses cannot overwrite each other.

## Phase H: Catalog And API Integration

Inspect apps/datapuller/src/lib/catalog-denormalize.ts and apps/backend/src/modules/{catalog,class,term}/. The catalog reads catalog_classes, not just courses. Existing joins, visibility flags, and primary-section requirements need the approved DLSU mapping.

Update authoritative shared typedefs in packages/gql-typedefs, not stale duplicate local typedefs. Preserve the persisted-operation gateway and regenerate affected artifacts through repository commands. Verify catalog/detail queries and term/campus filters before frontend work. Do not attach Berkeley grades, preexisting Berkeley ratings/reviews, enrollment history, prerequisite edges, or final-exam data to DLSU identities. The existing authenticated ratings/reviews feature is user-generated, not provider-sourced: migrate it to DLSU course/term/section identities, start with no Berkeley records, and allow TaftTime users to create new DLSU ratings and reviews. Initial public navigation must not expose GradTrak.

## Phase I: Full-Catalog Collection

Only after narrow imports work, add complete-scope crawling with an expected/completed-course manifest. Start conservatively, use bounded concurrency, deadlines, and controlled backoff. Validate request-campus/term coverage and detect mid-run scope changes or expiry. Coordinate reloads with crawl requests; do not reload during an in-flight page evaluation. Final deployment keeps the proven worker cadence: five-minute polling and twenty-minute Course Finder reloads.

Publish only complete artifacts for the declared scope. A failed request must never become a valid empty result. During ArchersHub outage or reauthentication, retain and serve the latest successful current-term data and do not delete it. Always expose `retrievedAt`; after 30 minutes without a successful refresh, show `Course data may be outdated. Last updated <time>.` If no valid snapshot has ever been published, report temporary unavailability rather than an empty catalog.

## Phase J: DLSU Catalog And Scheduler UX

Update course-code and trimester presentation, Manila/Laguna section classification, approved availability, and unsupported-data states. Implement verified meeting/component semantics and use Asia/Manila throughout schedule display, conflict checks, week calculation, and calendar export. Remove inherited America/Los_Angeles assumptions in the active paths. Hide GradTrak routes and navigation for the initial public deployment; retain its code rather than deleting it so it can return if authoritative prerequisite data becomes available.

Verify desktop and mobile, term ordering across academic years, hybrid meetings, missing/unparsed schedules, component selection rules, and timezone-correct calendar exports. No speculative CSB UI or institutional selector is required.

## Later-Phase Verification

Inspect scripts before running; generate rather than hand-edit generated types and operation maps.

```sh
npm test --workspace=backend
npm test --workspace=frontend
npm run type-check --workspace=backend
npm run type-check --workspace=frontend
npm run generate --workspace=backend
npm run generate --workspace=frontend
npm run generate:operations
npm run check:operations
```

Run relevant catalog/API and scheduler E2E checks with isolated fixtures. Document unavailable services or unrelated failures; do not claim checks ran when they did not.

## Deferred Unknowns

None of these block the approved initial deployment:

1. `COURSE_CREATION_ID` is considered unstable; a permanent cross-term course identity remains unavailable.
2. No authoritative relationship between separately identified lecture and laboratory courses has been found; keep them independent.
3. Academic-career classification is not modeled or filtered initially.
4. No authoritative prerequisite source exists; GradTrak is excluded from the initial public deployment.
5. No additional schedule forms are known; preserve parse failures for future source changes.
6. Final exams, grading basis, historical grades, and similar provider-sourced Berkeley data remain unavailable unless a DLSU source is later verified. Student-submitted TaftTime ratings/reviews are supported separately and begin with an empty DLSU dataset.
7. Rufino and full Laguna collection remain later explicitly scoped work.

## Implementing-Agent Instructions

Phases A-E are complete. Preserve authentication and existing unrelated behavior while continuing. Do not perform production writes or resolve domain questions by guessing. Execute later phases only once their mapping decisions are implemented and verified. Prefer existing dependencies, native filesystem operations, and small functions over services/frameworks.

For each phase report changed files, exact commands, tests/results, acceptance evidence, and remaining limitations. Keep this plan updated as work completes. Preserve durable decisions in AGENTS.md before the owner considers the implementation fully done and this temporary plan is scrubbed.
