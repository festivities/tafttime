import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";

import {
  fetchCourseFinder,
  isSuccessfulKeepaliveResponse,
  validateClassRows,
  validateCourseList,
} from "./course-finder";

test("reuses a loaded Course Finder page without navigating", async () => {
  let navigations = 0;
  const responses = [
    { campus: "7", academicSession: "155" },
    {
      status: 200,
      url: "https://archershub.dlsu.edu.ph/CourseFinder/GetCourseList/",
      contentType: "application/json",
      text: JSON.stringify({
        CourseDrp: [{ COURSE_CREATION_ID: 367, COURSE_NAME: "STSWENG" }],
      }),
    },
    {
      status: 200,
      url: "https://archershub.dlsu.edu.ph/CourseFinder/GetCFData/",
      contentType: "application/json",
      text: "[]",
    },
  ];
  const page = {
    url: () => "https://archershub.dlsu.edu.ph/CourseFinder/index/53",
    locator: () => ({ count: async () => 1, waitFor: async () => undefined }),
    goto: async () => {
      navigations++;
    },
    evaluate: async () => responses.shift(),
  } as unknown as Page;

  await fetchCourseFinder(page, "STSWENG");

  assert.equal(navigations, 0);
});

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
