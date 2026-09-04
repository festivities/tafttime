import assert from "node:assert/strict";
import test from "node:test";

import { isLoginUrl, parseMfaPrompt } from "./authentication";

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

test("extracts the Google number-matching prompt", () => {
  assert.deepEqual(
    parseMfaPrompt(
      "Open the Gmail app, tap Yes on the prompt, then tap 42 on your phone to verify it's you."
    ),
    { kind: "number_match", number: "42" }
  );
});

test("recognizes the simple Google approval prompt", () => {
  assert.deepEqual(
    parseMfaPrompt("Open the Gmail app and tap Yes on the prompt to sign in."),
    { kind: "approval" }
  );
});
