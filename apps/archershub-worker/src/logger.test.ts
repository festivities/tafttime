import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDiagnosticLogger } from "./logger";

test("removes query strings from logged URLs", () => {
  const directory = mkdtempSync(join(tmpdir(), "archershub-log-"));
  try {
    createDiagnosticLogger(directory).info("page", {
      url: "https://example.com/callback?code=secret&state=secret",
    });
    const file = readFileSync(
      join(directory, readdirSync(directory)[0]),
      "utf8"
    );
    assert.match(file, /https:\/\/example\.com\/callback/);
    assert.doesNotMatch(file, /secret|code|state/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
