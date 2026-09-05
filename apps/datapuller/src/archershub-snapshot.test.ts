import {
  createArchersHubSnapshot,
  publishArchersHubSnapshot,
} from "archershub-worker/snapshot";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readArchersHubSnapshot,
  summarizeArchersHubSnapshot,
} from "./archershub-snapshot";

test("reads a snapshot offline and reports metadata only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "archershub-reader-"));
  const path = join(directory, "latest.json");
  try {
    const matchedCourse = {
      COURSE_CREATION_ID: 5125,
      COURSE_NAME: "CCPROG1 - SECRET-SHOULD-NOT-PRINT",
    };
    const snapshot = createArchersHubSnapshot({
      campus: "7",
      academicSession: "155",
      courses: [matchedCourse],
      matchedCourse,
      classes: [{ COURSE_CREATION_ID: 5125, MAIN_TEACHER: "PRIVATE" }],
    });
    await publishArchersHubSnapshot(snapshot, path);

    const summary = summarizeArchersHubSnapshot(
      await readArchersHubSnapshot(path)
    );
    assert.equal(summary.courseCount, 1);
    assert.equal(summary.classRowCount, 1);
    assert.doesNotMatch(JSON.stringify(summary), /SECRET|PRIVATE/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects malformed snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "archershub-reader-"));
  const path = join(directory, "invalid.json");
  try {
    await writeFile(path, "null");
    await assert.rejects(readArchersHubSnapshot(path), /INVALID_SNAPSHOT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
