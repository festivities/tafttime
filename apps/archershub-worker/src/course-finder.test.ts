import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";

import {
  fetchCourseFinder,
  keepArchersHubSessionAlive,
  postForm,
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

test("browser activity does not call the session refresh endpoint", async () => {
  let moved = false;
  const page = {
    mouse: {
      move: async () => {
        moved = true;
      },
    },
    evaluate: async (callback: () => unknown) => {
      assert.doesNotMatch(callback.toString(), /fetch|ReFillSession/);
    },
  } as unknown as Page;

  await keepArchersHubSessionAlive(page);

  assert.equal(moved, true);
});

test("recognizes ArchersHub's expired-session JSON sentinel", async () => {
  const page = {
    evaluate: async () => ({
      status: 200,
      url: "https://archershub.dlsu.edu.ph/CourseFinder/GetCourseList/",
      contentType: "application/json; charset=utf-8",
      text: JSON.stringify("Object reference not set to an instance of an object."),
    }),
  } as unknown as Page;

  await assert.rejects(
    postForm(page, "/CourseFinder/GetCourseList/", {}),
    /AUTHENTICATION_REQUIRED/
  );
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
