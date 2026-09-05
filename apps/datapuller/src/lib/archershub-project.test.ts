import { createArchersHubSnapshot } from "archershub-worker/snapshot";
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeArchersHubSnapshot } from "./archershub-normalizer";
import {
  type ProjectCollectionStore,
  type ProjectStores,
  projectArchersHubOffering,
  replaceCatalogClasses,
  toCatalogSemester,
  toCatalogTime,
  toCatalogYear,
  writeProjectedScope,
} from "./archershub-project";

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

function bundleFor(courseId: number, courseName: string) {
  const matchedCourse = {
    COURSE_CREATION_ID: courseId,
    COURSE_NAME: courseName,
  };
  return normalizeArchersHubSnapshot(
    createArchersHubSnapshot(
      {
        campus: "7",
        academicSession: "155",
        courses: [matchedCourse],
        matchedCourse,
        classes: [
          { ...row(), COURSE_CREATION_ID: courseId, SUBJECT_NAME: courseName },
        ],
      },
      RETRIEVED_AT
    )
  );
}

const STSWENG = "STSWENG - ADVANCED SOFTWARE ENGINEERING";

function fakeCollection(): ProjectCollectionStore & { docs: unknown[] } {
  const docs: unknown[] = [];
  return {
    docs,
    async deleteMany(filter: Record<string, unknown>) {
      const [[key, value]] = Object.entries(filter);
      for (let i = docs.length - 1; i >= 0; i--) {
        if ((docs[i] as Record<string, unknown>)[key] === value) {
          docs.splice(i, 1);
        }
      }
      return { acknowledged: true };
    },
    async insertMany(batch: unknown[]) {
      docs.push(...structuredClone(batch));
      return { acknowledged: true };
    },
    async replaceOne(filter: Record<string, unknown>, doc: unknown) {
      const [[key, value]] = Object.entries(filter);
      const idx = docs.findIndex(
        (d) => (d as Record<string, unknown>)[key] === value
      );
      if (idx >= 0) docs[idx] = structuredClone(doc);
      else docs.push(structuredClone(doc));
      return { acknowledged: true };
    },
  };
}

function fakeStores(): ProjectStores & {
  [K in keyof ProjectStores]: ProjectCollectionStore & { docs: unknown[] };
} {
  return {
    terms: fakeCollection(),
    courses: fakeCollection(),
    classes: fakeCollection(),
    sections: fakeCollection(),
    enrollments: fakeCollection(),
    catalogClasses: fakeCollection(),
  };
}

test("maps term labels and academic years to catalog tokens", () => {
  assert.equal(toCatalogSemester("Term 1"), "Term1");
  assert.equal(toCatalogSemester("Term 3"), "Term3");
  assert.equal(toCatalogYear("2026-2027"), 2026);
  assert.throws(() => toCatalogSemester("Fall"), /PROJECT_ERROR/);
  assert.throws(() => toCatalogSemester(null), /PROJECT_ERROR/);
  assert.throws(() => toCatalogYear("2026"), /PROJECT_ERROR/);
});

test("passes through normalized 24-hour meeting times", () => {
  assert.equal(toCatalogTime("16:15"), "16:15");
  assert.equal(toCatalogTime("11:00"), "11:00");
  assert.equal(toCatalogTime("00:00"), "00:00");
  assert.throws(() => toCatalogTime("04:15 PM"), /PROJECT_ERROR/);
  assert.throws(() => toCatalogTime("afternoon"), /PROJECT_ERROR/);
});

test("projects an offering into Berkeley-shaped catalog documents", () => {
  const projected = projectArchersHubOffering(bundleFor(367, STSWENG));

  assert.equal(projected.year, 2026);
  assert.equal(projected.semester, "Term1");
  assert.equal(projected.termId, "archershub-7-155");
  assert.equal(projected.courseId, "archershub-7-155:367");
  assert.deepEqual(
    { ...projected.term },
    {
      academicCareerCode: "UGRD",
      temporalPosition: "Current",
      id: "archershub-7-155",
      name: "2026 Term1",
      academicYear: "2026-2027",
      beginDate: "07/10/2026",
      endDate: "12/12/2026",
      hasCatalogData: true,
      retrievedAt: RETRIEVED_AT,
    }
  );
  assert.deepEqual(
    { ...projected.course },
    {
      courseId: "archershub-7-155:367",
      subject: "STSWENG",
      number: "STSWENG",
      title: "ADVANCED SOFTWARE ENGINEERING",
      academicCareer: "UGRD",
      printInCatalog: true,
    }
  );

  assert.equal(projected.classes.length, 1);
  const cls = projected.classes[0];
  assert.equal(cls.number, "S06");
  assert.equal(cls.sessionId, "155");
  assert.equal(cls.anyPrintInScheduleOfClasses, true);
  assert.deepEqual(cls.allowedUnits, { minimum: 3, maximum: 3 });
  assert.equal(cls.gradingBasis, undefined);
  assert.equal(cls.finalExam, undefined);

  assert.equal(projected.sections.length, 1);
  const section = projected.sections[0];
  assert.equal(section.primary, true);
  assert.equal(section.component, "LEC");
  assert.equal(section.instructionMode, undefined);
  assert.equal(section.sectionId, "archershub-7-155-367-389-0");
  assert.deepEqual(
    section.meetings?.map((m) => m.days),
    [
      [false, true, false, false, false, false, false],
      [false, false, false, false, true, false, false],
    ]
  );
  assert.deepEqual(
    section.meetings?.map((m) => [m.startTime, m.endTime, m.location]),
    [
      ["16:15", "17:45", undefined],
      ["16:15", "17:45", "G206"],
    ]
  );
  assert.deepEqual(section.meetings?.[0].instructors, [
    { familyName: "Teacher One", role: "PI", printInScheduleOfClasses: true },
  ]);

  assert.equal(projected.enrollments.length, 1);
  const enrollment = projected.enrollments[0];
  assert.equal(enrollment.history[0].status, "O");
  assert.equal(enrollment.history[0].enrolledCount, 40);
  assert.equal(enrollment.history[0].maxEnroll, 45);
});

test("fails loudly instead of projecting unknown identities", () => {
  const noCode = bundleFor(367, STSWENG);
  noCode.offering.course.courseCode = null;
  assert.throws(() => projectArchersHubOffering(noCode), /course code/);

  const noDates = bundleFor(367, STSWENG);
  noDates.offering.term.sourceStartDate = null;
  assert.throws(() => projectArchersHubOffering(noDates), /begin\/end dates/);
});

test("writes scopes idempotently and keeps courses separate", async () => {
  const stores = fakeStores();
  const first = projectArchersHubOffering(bundleFor(367, STSWENG));
  await writeProjectedScope(stores, first);
  await writeProjectedScope(stores, first);

  assert.equal(stores.terms.docs.length, 1);
  assert.equal(stores.courses.docs.length, 1);
  assert.equal(stores.classes.docs.length, 1);
  assert.equal(stores.sections.docs.length, 1);
  assert.equal(stores.enrollments.docs.length, 1);

  await writeProjectedScope(
    stores,
    projectArchersHubOffering(bundleFor(999, "CCPROG1 - TEST COURSE"))
  );
  assert.equal(stores.terms.docs.length, 1);
  assert.equal(stores.courses.docs.length, 2);
  assert.equal(stores.classes.docs.length, 2);
});

test("replaces only the target term in catalog classes", async () => {
  const store = fakeCollection();
  await store.insertMany([
    { year: 2026, semester: "Term1", number: "old" },
    { year: 2025, semester: "Fall", number: "keep" },
  ]);
  const inserted = await replaceCatalogClasses(store, 2026, "Term1", [
    { year: 2026, semester: "Term1", number: "new" },
  ] as unknown as Parameters<typeof replaceCatalogClasses>[3]);
  assert.equal(inserted, 1);
  assert.deepEqual(
    store.docs.map((d) => (d as { number: string }).number).sort(),
    ["keep", "new"]
  );
});
