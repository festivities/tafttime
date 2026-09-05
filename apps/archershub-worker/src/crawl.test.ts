import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  type CrawlManifest,
  assertNonEmptyClassRows,
  backoffDelayMs,
  checkCrawlScope,
  createCrawlManifest,
  loadCrawlManifest,
  pendingCourses,
  runCrawlCourses,
  saveCrawlManifest,
} from "./crawl";

const COURSES = [
  { COURSE_CREATION_ID: 367, COURSE_NAME: "STSWENG - X" },
  { COURSE_CREATION_ID: 999, COURSE_NAME: "CCPROG1 - Y" },
];

function manifest(): CrawlManifest {
  return createCrawlManifest("7", "155", COURSES, 10);
}

test("creates a pending manifest and selects pending courses", () => {
  const m = manifest();
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.courses.length, 2);
  assert.deepEqual(
    m.courses.map((c) => [c.courseCreationId, c.status, c.attempts]),
    [
      ["367", "pending", 0],
      ["999", "pending", 0],
    ]
  );
  assert.equal(pendingCourses(m, 0).length, 2);
  assert.equal(pendingCourses(m, 1).length, 1);
  assert.throws(
    () =>
      createCrawlManifest(
        "7",
        "155",
        [...COURSES, { COURSE_CREATION_ID: 367, COURSE_NAME: "DUPLICATE" }],
        10
      ),
    /duplicate course id/
  );
});

test("rejects scope changes on resume", () => {
  const m = manifest();
  checkCrawlScope(m, "7", "155");
  assert.throws(() => checkCrawlScope(m, "8", "155"), /SCOPE_CHANGED/);
  assert.throws(() => checkCrawlScope(m, "7", "156"), /SCOPE_CHANGED/);
});

test("rejects empty class results and backs off exponentially", () => {
  assert.throws(() => assertNonEmptyClassRows("367", []), /EMPTY_RESULT/);
  assert.equal(backoffDelayMs(2000, 1), 2000);
  assert.equal(backoffDelayMs(2000, 2), 4000);
  assert.equal(backoffDelayMs(2000, 3), 8000);
  assert.equal(backoffDelayMs(100_000, 5), 60_000);
});

test("saves and loads the manifest round-trip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crawl-"));
  const m = manifest();
  m.courses[0].status = "ok";
  await saveCrawlManifest(dir, m);
  const loaded = await loadCrawlManifest(dir);
  assert.equal(loaded.courses[0].status, "ok");
  assert.equal(loaded.courses[1].status, "pending");
  const raw = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  assert.equal(raw.schemaVersion, 1);
});

test("rejects malformed manifests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crawl-"));
  await assert.rejects(loadCrawlManifest(dir), /MANIFEST_ERROR/);
});

test("crawls courses, retries failures, and aborts on auth loss", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crawl-"));
  const m = manifest();
  const published: string[] = [];
  const attempts = new Map<string, number>();
  const result = await runCrawlCourses(m, dir, {
    fetchRows: async (course) => {
      const n = (attempts.get(course.courseCreationId) ?? 0) + 1;
      attempts.set(course.courseCreationId, n);
      if (course.courseCreationId === "999" && n < 3) {
        throw new Error(
          "PROVIDER_ERROR: /CourseFinder/GetCFData/ returned HTTP 500"
        );
      }
      return [{ SECTION_NAME: "S06" }];
    },
    publish: async (course) => {
      published.push(course.courseCreationId);
      return "2026-09-05T15:53:08.741Z";
    },
    sleep: async () => {},
  });
  assert.deepEqual(result, { ok: 2, failed: 0 });
  assert.deepEqual(published.sort(), ["367", "999"]);
  assert.equal(attempts.get("999"), 3);
  assert.equal(m.courses[1].retrievedAt, "2026-09-05T15:53:08.741Z");
  const saved = await loadCrawlManifest(dir);
  assert.equal(saved.courses.filter((c) => c.status === "ok").length, 2);
});

test("marks persistent failures and preserves progress", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crawl-"));
  const m = manifest();
  const result = await runCrawlCourses(m, dir, {
    fetchRows: async (course) =>
      course.courseCreationId === "367"
        ? [{ SECTION_NAME: "S06" }]
        : Promise.reject(new Error("INVALID_RESPONSE: bad JSON")),
    publish: async () => "2026-09-05T15:53:08.741Z",
    sleep: async () => {},
  });
  assert.deepEqual(result, { ok: 1, failed: 1 });
  const failed = m.courses.find((c) => c.courseCreationId === "999");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.attempts, 3);
  assert.match(failed?.error ?? "", /INVALID_RESPONSE/);
});

test("aborts the crawl when authentication is lost", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crawl-"));
  const m = manifest();
  await assert.rejects(
    runCrawlCourses(m, dir, {
      fetchRows: async () => {
        throw new Error(
          "AUTHENTICATION_REQUIRED: ArchersHub login is required"
        );
      },
      publish: async () => "never",
      sleep: async () => {},
    }),
    /resume after reauthentication/
  );
  const saved = await loadCrawlManifest(dir);
  assert.equal(saved.courses.filter((c) => c.status === "ok").length, 0);
});
