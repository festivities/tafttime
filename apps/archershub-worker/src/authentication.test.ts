import assert from "node:assert/strict";
import test from "node:test";

import { isLoginUrl } from "./authentication";

test("recognizes the ArchersHub root login page", () => {
  assert.equal(isLoginUrl("https://archershub.dlsu.edu.ph/"), true);
});

test("recognizes StudentLogin URLs", () => {
  assert.equal(
    isLoginUrl("https://archershub.dlsu.edu.ph/StudentLogin/Index"),
    true
  );
});

test("does not classify authenticated routes as login", () => {
  assert.equal(
    isLoginUrl("https://archershub.dlsu.edu.ph/CourseFinder/Index"),
    false
  );
});
