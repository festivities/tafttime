import { createArchersHubSnapshot } from "archershub-worker/snapshot";
import mongoose from "mongoose";
import assert from "node:assert/strict";
import test from "node:test";

import {
  getArchersHubOfferingFilter,
  importArchersHubBundle,
  summarizeArchersHubImport,
  toArchersHubOfferingDocument,
} from "./archershub-import";
import { normalizeArchersHubSnapshot } from "./lib/archershub-normalizer";

const RETRIEVED_AT = "2026-09-05T15:53:08.741Z";

function row(overrides: Record<string, unknown> = {}) {
  return {
    SESSION: "AY 2026-2027 Term 1",
    CAMPUS: "Manila",
    COURSE_CREATION_ID: 367,
    SECTION_CREATION_ID: 389,
    SECTION_NAME: "S06",
    CAPACITY: 45,
    UPDATED_CAPACITY: 45,
    SUBJECT_NAME: "STSWENG - ADVANCED SOFTWARE ENGINEERING",
    SUBJECT_TYPE: "Lecture",
    CREDITS: 3,
    MAIN_TEACHER: "Teacher One",
    ADDITIONAL_TEACHER: null,
    SCHEDULE:
      "[ FRIDAY - 04:15 PM - 05:45 PM : Room - G206 ] | [ TUESDAY - 04:15 PM - 05:45 PM : Online ]",
    ENLISTED: 40,
    APPROVED_COUNT: 40,
    START_DATE: "07/10/2026",
    END_DATE: "12/12/2026",
    BATCH_CREATION_ID: 0,
    ...overrides,
  };
}

function bundleFor(
  courseId: number,
  courseName: string,
  retrievedAt = RETRIEVED_AT
) {
  const matchedCourse = {
    COURSE_CREATION_ID: courseId,
    COURSE_NAME: courseName,
  };
  const snapshot = createArchersHubSnapshot(
    {
      campus: "7",
      academicSession: "155",
      courses: [matchedCourse],
      matchedCourse,
      classes: [
        { ...row(), COURSE_CREATION_ID: courseId, SUBJECT_NAME: courseName },
      ],
    },
    retrievedAt
  );
  return normalizeArchersHubSnapshot(snapshot);
}

function fakeStore() {
  const docs = new Map<string, unknown>();
  let calls = 0;
  let failNext: unknown;
  return {
    docs,
    get calls() {
      return calls;
    },
    failNextWith(error: unknown) {
      failNext = error;
    },
    async findOneAndReplace(filter: Record<string, unknown>, doc: unknown) {
      calls++;
      if (failNext) {
        const error = failNext;
        failNext = undefined;
        throw error;
      }
      docs.set(JSON.stringify(filter), structuredClone(doc));
      return { acknowledged: true };
    },
  };
}

const STSWENG = "STSWENG - ADVANCED SOFTWARE ENGINEERING";

test("registers only the isolated ArchersHub model", () => {
  assert.deepEqual(mongoose.modelNames(), ["archershub-offering"]);
});

test("builds an exact single-scope filter", () => {
  assert.deepEqual(getArchersHubOfferingFilter(bundleFor(367, STSWENG)), {
    "offering.identity.provider": "archershub",
    "offering.identity.requestCampusId": "7",
    "offering.identity.academicSessionId": "155",
    "offering.identity.courseCreationId": "367",
  });
});

test("strips database bookkeeping from the replacement document", () => {
  const bundle = bundleFor(367, STSWENG);
  const tainted = { ...bundle, _id: "abc", __v: 1 };
  const document = toArchersHubOfferingDocument(tainted as typeof bundle);
  assert.equal("_id" in document, false);
  assert.equal("__v" in document, false);
  assert.equal(document.retrievedAt, RETRIEVED_AT);
});

test("imports idempotently without duplicates", async () => {
  const store = fakeStore();
  const bundle = bundleFor(367, STSWENG);

  await importArchersHubBundle(bundle, store);
  await importArchersHubBundle(bundle, store);

  assert.equal(store.docs.size, 1);
  assert.equal(store.calls, 2);
  assert.deepEqual(
    [...store.docs.values()][0],
    toArchersHubOfferingDocument(bundle)
  );
});

test("keeps different courses as separate scopes", async () => {
  const store = fakeStore();
  await importArchersHubBundle(bundleFor(367, STSWENG), store);
  await importArchersHubBundle(bundleFor(999, "CCPROG1 - TEST COURSE"), store);
  assert.equal(store.docs.size, 2);
});

test("rejects invalid bundles before touching the database", async () => {
  const store = fakeStore();
  const bundle = bundleFor(367, STSWENG);
  bundle.offering.sections[0].credits = 6;
  await assert.rejects(
    importArchersHubBundle(bundle, store),
    /whole-number credits/
  );
  assert.equal(store.calls, 0);
  assert.equal(store.docs.size, 0);
});

test("leaves the previous document intact when persistence fails", async () => {
  const store = fakeStore();
  await importArchersHubBundle(bundleFor(367, STSWENG, RETRIEVED_AT), store);

  store.failNextWith(new Error("DB_UNAVAILABLE: connection lost"));
  await assert.rejects(
    importArchersHubBundle(
      bundleFor(367, STSWENG, "2026-09-05T16:00:00.000Z"),
      store
    ),
    /DB_UNAVAILABLE/
  );

  assert.equal(store.docs.size, 1);
  assert.equal(
    ([...store.docs.values()][0] as { retrievedAt: string }).retrievedAt,
    RETRIEVED_AT
  );
});

test("reports only safe import metadata", () => {
  const summary = summarizeArchersHubImport(bundleFor(367, STSWENG));
  assert.equal(summary.sectionCount, 1);
  assert.equal(summary.scope.courseCreationId, "367");
  assert.doesNotMatch(JSON.stringify(summary), /Teacher One/);
});
