import {
  type ArchersHubSnapshot,
  validateArchersHubSnapshot,
} from "archershub-worker/snapshot";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

export async function readArchersHubSnapshot(
  path: string
): Promise<ArchersHubSnapshot> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error("Snapshot input is not a file");
  if (metadata.size > MAX_SNAPSHOT_BYTES)
    throw new Error("Snapshot is too large");

  const contents = await readFile(path);
  if (contents.byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error("Snapshot is too large");
  }
  let value: unknown;
  try {
    value = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error("Snapshot is not valid JSON");
  }
  return validateArchersHubSnapshot(value);
}

export function summarizeArchersHubSnapshot(snapshot: ArchersHubSnapshot) {
  return {
    provider: snapshot.provider,
    retrievedAt: snapshot.retrievedAt,
    coverage: snapshot.scope.coverage,
    scope: {
      campusId: snapshot.scope.campusId,
      academicSessionId: snapshot.scope.academicSessionId,
      courseId: snapshot.scope.courseId,
    },
    courseCount: snapshot.courses.length,
    classRowCount: snapshot.classes.length,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { input: { type: "string" } },
  });
  if (!values.input) throw new Error("Pass --input <snapshot-path>");
  const snapshot = await readArchersHubSnapshot(values.input);
  console.log(JSON.stringify(summarizeArchersHubSnapshot(snapshot), null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
