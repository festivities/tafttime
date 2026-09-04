import assert from "node:assert/strict";
import test from "node:test";

import {
  isSuccessfulKeepaliveResponse,
  validateClassRows,
  validateCourseList,
} from "./course-finder";

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

test("accepts the authenticated dashboard HTML returned by keepalive", () => {
  assert.equal(
    isSuccessfulKeepaliveResponse({
      status: 200,
      url: "https://archershub.dlsu.edu.ph/StudentDashboard",
      contentType: "text/html; charset=utf-8",
    }),
    true
  );
});

test("rejects a keepalive response redirected to login", () => {
  assert.equal(
    isSuccessfulKeepaliveResponse({
      status: 200,
      url: "https://archershub.dlsu.edu.ph/",
      contentType: "text/html; charset=utf-8",
    }),
    false
  );
});
