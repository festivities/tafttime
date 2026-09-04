import assert from "node:assert/strict";
import test from "node:test";

import { errorCategory } from "./state";

test("classifies authentication failures separately", () => {
  assert.equal(
    errorCategory(new Error("AUTHENTICATION_REQUIRED: login")),
    "WAITING_FOR_REAUTHENTICATION"
  );
});

test("classifies other failures as provider outages", () => {
  assert.equal(errorCategory(new Error("ECONNRESET")), "PROVIDER_UNAVAILABLE");
});
