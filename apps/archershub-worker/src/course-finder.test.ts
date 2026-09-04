import assert from "node:assert/strict";
import test from "node:test";

import { validateClassRows, validateCourseList } from "./course-finder";

test("validates a non-empty course list", () => {
  const courses = validateCourseList({
    CourseDrp: [{ COURSE_CREATION_ID: 367, COURSE_NAME: "STSWENG - TEST" }],
  });
  assert.equal(courses[0].COURSE_CREATION_ID, 367);
});

test("allows a valid empty class response", () => {
  assert.deepEqual(validateClassRows([]), []);
});

test("rejects malformed course lists", () => {
  assert.throws(() => validateCourseList({ CourseDrp: [{ COURSE_NAME: "bad" }] }));
});

test("rejects non-array class responses", () => {
  assert.throws(() => validateClassRows({ error: "login" }));
});
