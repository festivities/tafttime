import { createArchersHubSnapshot } from "archershub-worker/snapshot";
import assert from "node:assert/strict";
import test from "node:test";

import { ArchersHubOfferingModel } from "@repo/common/models";

import { normalizeArchersHubSnapshot } from "./archershub-normalizer";

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

function snapshot(
  classes: Record<string, unknown>[],
  courseName = "STSWENG - ADVANCED SOFTWARE ENGINEERING"
) {
  const matchedCourse = {
    COURSE_CREATION_ID: 367,
    COURSE_NAME: courseName,
  };
  return createArchersHubSnapshot(
    {
      campus: "7",
      academicSession: "155",
      courses: [matchedCourse],
      matchedCourse,
      classes,
    },
    RETRIEVED_AT
  );
}

test("normalizes DLSU course, term, campus, credits, seats, and meetings", () => {
  const normalized = normalizeArchersHubSnapshot(snapshot([row()]));
  const { offering } = normalized;
  const section = offering.sections[0];

  assert.deepEqual(offering.course, {
    sourceCourseId: "367",
    courseCode: "STSWENG",
    title: "ADVANCED SOFTWARE ENGINEERING",
    sourceName: "STSWENG - ADVANCED SOFTWARE ENGINEERING",
  });
  assert.deepEqual(offering.term, {
    sourceAcademicSessionId: "155",
    label: "AY 2026-2027 Term 1",
    academicYear: "2026-2027",
    ordinal: 1,
    sourceStartDate: "07/10/2026",
    sourceEndDate: "12/12/2026",
    parseStatus: "parsed",
    timezone: "Asia/Manila",
  });
  assert.equal(section.credits, 3);
  assert.equal(section.availableSeats, 5);
  assert.equal(section.campus.inferredCampus, "Manila");
  assert.equal(section.modality, "hybrid");
  assert.deepEqual(section.meetings, [
    {
      day: "TUESDAY",
      startTime: "16:15",
      endTime: "17:45",
      location: null,
      modality: "online",
    },
    {
      day: "FRIDAY",
      startTime: "16:15",
      endTime: "17:45",
      location: "G206",
      modality: "in-person",
    },
  ]);
  assert.equal(offering.academicCareer, null);
  assert.equal(offering.gradingBasis, null);
  assert.equal(offering.finalExam, null);
});

test("groups colliding rows and deterministically deduplicates teachers and meetings", () => {
  const first = row({
    MAIN_TEACHER: "Teacher Two",
    SCHEDULE: "[ TUESDAY - 09:15 AM - 10:45 AM : Online ]",
  });
  const second = row({
    MAIN_TEACHER: "Teacher One",
    SCHEDULE: "[ FRIDAY - 09:15 AM - 10:45 AM : Room - G302B ]",
  });
  const forward = normalizeArchersHubSnapshot(snapshot([first, second]));
  const reversed = normalizeArchersHubSnapshot(snapshot([second, first]));

  assert.deepEqual(forward, reversed);
  assert.equal(forward.offering.sections.length, 1);
  assert.deepEqual(forward.offering.sections[0].teachers, [
    "Teacher One",
    "Teacher Two",
  ]);
  assert.equal(forward.offering.sections[0].meetings?.length, 2);
  assert.equal(forward.offering.sections[0].fragments.length, 2);
});

test("keeps unknown schedule details explicit and preserves negative availability", () => {
  const missingLocation = row({
    SECTION_CREATION_ID: 1,
    SECTION_NAME: "X01",
    CAPACITY: "20",
    ENLISTED: "21",
    CREDITS: "5",
    SCHEDULE: "[ FRIDAY - 01:00 PM - 03:00 PM ]",
  });
  const malformed = row({
    SECTION_CREATION_ID: 2,
    SECTION_NAME: "S02",
    SCHEDULE: "FRIDAY SOMETIME",
  });
  const normalized = normalizeArchersHubSnapshot(
    snapshot([missingLocation, malformed])
  );
  const laguna = normalized.offering.sections.find(
    (section) => section.sectionName === "X01"
  );
  const invalid = normalized.offering.sections.find(
    (section) => section.sectionName === "S02"
  );

  assert.equal(laguna?.campus.inferredCampus, "Laguna");
  assert.equal(laguna?.credits, 5);
  assert.equal(laguna?.availableSeats, -1);
  assert.equal(laguna?.scheduleStatus, "parsed");
  assert.equal(laguna?.meetings?.[0].modality, null);
  assert.equal(laguna?.modality, null);
  assert.equal(invalid?.scheduleStatus, "unparsed");
  assert.equal(invalid?.meetings, null);
});

test("rejects conflicting section values and invalid credits", () => {
  assert.throws(
    () => normalizeArchersHubSnapshot(snapshot([row(), row({ CAPACITY: 40 })])),
    /CAPACITY conflicted/
  );
  assert.throws(
    () => normalizeArchersHubSnapshot(snapshot([row({ CREDITS: 6 })])),
    /CREDITS was outside 0-5/
  );
  assert.throws(
    () => normalizeArchersHubSnapshot(snapshot([row({ CREDITS: 1.5 })])),
    /CREDITS was not a non-negative integer/
  );
});

test("does not fabricate ambiguous course codes or empty-snapshot term data", () => {
  const ambiguous = normalizeArchersHubSnapshot(
    snapshot([], "CODE - TITLE - EXTRA")
  );
  assert.equal(ambiguous.offering.course.courseCode, null);
  assert.equal(ambiguous.offering.course.title, "CODE - TITLE - EXTRA");
  assert.deepEqual(ambiguous.offering.sections, []);
  assert.deepEqual(ambiguous.offering.term, {
    sourceAcademicSessionId: "155",
    label: null,
    academicYear: null,
    ordinal: null,
    sourceStartDate: null,
    sourceEndDate: null,
    parseStatus: "missing",
    timezone: "Asia/Manila",
  });
});

test("fits the shared persistence schema and enforces scoped sections", async () => {
  const normalized = normalizeArchersHubSnapshot(snapshot([row()]));
  const document = new ArchersHubOfferingModel(normalized);
  await document.validate();
  assert.equal(document.offering.academicCareer, null);
  assert.equal(document.offering.sections[0].fragments[0].SECTION_NAME, "S06");

  const duplicate = structuredClone(normalized);
  duplicate.offering.sections.push(
    structuredClone(duplicate.offering.sections[0])
  );
  await assert.rejects(
    new ArchersHubOfferingModel(duplicate).validate(),
    /Duplicate section identity within offering/
  );

  const wrongScope = structuredClone(normalized);
  wrongScope.offering.sections[0].identity.requestCampusId = "8";
  await assert.rejects(
    new ArchersHubOfferingModel(wrongScope).validate(),
    /Section identity did not match offering scope/
  );

  const wrongAvailability = structuredClone(normalized);
  wrongAvailability.offering.sections[0].availableSeats = 999;
  await assert.rejects(
    new ArchersHubOfferingModel(wrongAvailability).validate(),
    /Available seats did not match capacity minus enlisted/
  );

  const invalidCredits = structuredClone(normalized);
  invalidCredits.offering.sections[0].credits = 6;
  await assert.rejects(
    new ArchersHubOfferingModel(invalidCredits).validate(),
    /Expected whole-number credits from 0 through 5 or null/
  );

  const unsupportedValue = structuredClone(normalized);
  Reflect.set(unsupportedValue.offering, "gradingBasis", "Graded");
  await assert.rejects(
    new ArchersHubOfferingModel(unsupportedValue).validate(),
    /Expected unavailable source data to remain null/
  );

  const uniqueIndex = ArchersHubOfferingModel.schema
    .indexes()
    .find(([, options]) => options.name === "unique_archershub_offering_scope");
  assert.deepEqual(uniqueIndex, [
    {
      "offering.identity.provider": 1,
      "offering.identity.requestCampusId": 1,
      "offering.identity.academicSessionId": 1,
      "offering.identity.courseCreationId": 1,
    },
    {
      unique: true,
      name: "unique_archershub_offering_scope",
      background: true,
    },
  ]);
});
