import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createArchersHubSnapshot,
  publishArchersHubSnapshot,
  validateArchersHubSnapshot,
} from "./snapshot";
import type { CourseFinderResult } from "./types";

function result(): CourseFinderResult {
  const matchedCourse = {
    COURSE_CREATION_ID: 5125,
    COURSE_NAME: "CCPROG1 - TEST",
  };
  return {
    campus: "7",
    academicSession: "155",
    courses: [matchedCourse],
    matchedCourse,
    classes: [
      { COURSE_CREATION_ID: 5125, SECTION_CREATION_ID: 2130 },
      { COURSE_CREATION_ID: 5125, SECTION_CREATION_ID: 2130 },
    ],
  };
}

test("creates and validates a provider-native snapshot", () => {
  const snapshot = createArchersHubSnapshot(
    result(),
    "2026-09-05T00:00:00.000Z"
  );
  assert.equal(snapshot.scope.courseId, "5125");
  assert.equal(snapshot.classes.length, 2);
  assert.equal(validateArchersHubSnapshot(snapshot), snapshot);
});

test("rejects malformed snapshots and inconsistent class IDs", () => {
  const snapshot = createArchersHubSnapshot(result());
  assert.throws(() => validateArchersHubSnapshot(null));
  assert.throws(() =>
    validateArchersHubSnapshot({ ...snapshot, schemaVersion: 2 })
  );
  assert.throws(() =>
    validateArchersHubSnapshot({
      ...snapshot,
      scope: { ...snapshot.scope, campusId: 7 },
    })
  );
  assert.throws(() =>
    validateArchersHubSnapshot({
      ...snapshot,
      classes: [{ COURSE_CREATION_ID: 999 }],
    })
  );
  assert.throws(() =>
    validateArchersHubSnapshot({ ...snapshot, classes: [null] })
  );
});

test("publishes atomically, rotates once, and preserves latest on failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "archershub-snapshot-"));
  const latest = join(directory, "latest.json");
  const previous = join(directory, "previous.json");
  try {
    const first = createArchersHubSnapshot(
      result(),
      "2026-09-05T00:00:00.000Z"
    );
    const second = createArchersHubSnapshot(
      result(),
      "2026-09-05T00:05:00.000Z"
    );
    await publishArchersHubSnapshot(first, latest);
    await publishArchersHubSnapshot(second, latest);

    assert.equal(
      JSON.parse(await readFile(latest, "utf8")).retrievedAt,
      second.retrievedAt
    );
    assert.equal(
      JSON.parse(await readFile(previous, "utf8")).retrievedAt,
      first.retrievedAt
    );

    const third = createArchersHubSnapshot(
      result(),
      "2026-09-05T00:10:00.000Z"
    );
    await publishArchersHubSnapshot(third, latest);
    assert.equal(
      JSON.parse(await readFile(previous, "utf8")).retrievedAt,
      second.retrievedAt
    );

    const latestBeforeFailure = await readFile(latest, "utf8");
    await rm(previous);
    await mkdir(previous);
    await assert.rejects(
      publishArchersHubSnapshot(
        createArchersHubSnapshot(result(), "2026-09-05T00:15:00.000Z"),
        latest
      ),
      /PUBLICATION_ERROR/
    );
    assert.equal(await readFile(latest, "utf8"), latestBeforeFailure);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
