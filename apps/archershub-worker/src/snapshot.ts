import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import type { DiagnosticLogger } from "./logger";
import type { ClassRow, Course, CourseFinderResult } from "./types";

export type ArchersHubSnapshot = {
  schemaVersion: 1;
  provider: "archershub";
  retrievedAt: string;
  scope: {
    coverage: "single-course";
    campusId: string;
    academicSessionId: string;
    courseId: string;
  };
  courses: Course[];
  matchedCourse: Course;
  classes: ClassRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string" && value.trim() && value === value.trim()) {
    return value;
  }
  throw new Error("INVALID_SNAPSHOT: expected a canonical ID");
}

function validateCourse(value: unknown): asserts value is Course {
  if (
    !isRecord(value) ||
    typeof value.COURSE_NAME !== "string" ||
    !value.COURSE_NAME.trim()
  ) {
    throw new Error("INVALID_SNAPSHOT: invalid course record");
  }
  canonicalId(value.COURSE_CREATION_ID);
}

function validateClassRow(
  value: unknown,
  courseId: string
): asserts value is ClassRow {
  if (!isRecord(value)) {
    throw new Error("INVALID_SNAPSHOT: invalid class row");
  }
  if (
    value.COURSE_CREATION_ID !== undefined &&
    value.COURSE_CREATION_ID !== null &&
    canonicalId(value.COURSE_CREATION_ID) !== courseId
  ) {
    throw new Error(
      "INVALID_SNAPSHOT: class row course ID did not match scope"
    );
  }
}

export function validateArchersHubSnapshot(value: unknown): ArchersHubSnapshot {
  if (!isRecord(value)) {
    throw new Error("INVALID_SNAPSHOT: expected an object");
  }
  if (value.schemaVersion !== 1 || value.provider !== "archershub") {
    throw new Error("INVALID_SNAPSHOT: unsupported schema version or provider");
  }
  if (
    typeof value.retrievedAt !== "string" ||
    !value.retrievedAt.endsWith("Z") ||
    !Number.isFinite(Date.parse(value.retrievedAt))
  ) {
    throw new Error("INVALID_SNAPSHOT: invalid retrievedAt timestamp");
  }
  if (!isRecord(value.scope) || value.scope.coverage !== "single-course") {
    throw new Error("INVALID_SNAPSHOT: invalid scope");
  }

  const campusId = canonicalId(value.scope.campusId);
  const academicSessionId = canonicalId(value.scope.academicSessionId);
  const courseId = canonicalId(value.scope.courseId);
  if (
    value.scope.campusId !== campusId ||
    value.scope.academicSessionId !== academicSessionId ||
    value.scope.courseId !== courseId
  ) {
    throw new Error("INVALID_SNAPSHOT: scope IDs must be canonical strings");
  }
  if (!Array.isArray(value.courses)) {
    throw new Error("INVALID_SNAPSHOT: courses was not an array");
  }
  value.courses.forEach(validateCourse);
  validateCourse(value.matchedCourse);
  if (canonicalId(value.matchedCourse.COURSE_CREATION_ID) !== courseId) {
    throw new Error("INVALID_SNAPSHOT: matched course did not match scope");
  }
  if (
    !value.courses.some(
      (course) => canonicalId(course.COURSE_CREATION_ID) === courseId
    )
  ) {
    throw new Error("INVALID_SNAPSHOT: matched course was absent from courses");
  }
  if (!Array.isArray(value.classes)) {
    throw new Error("INVALID_SNAPSHOT: classes was not an array");
  }
  value.classes.forEach((row) => validateClassRow(row, courseId));

  return value as ArchersHubSnapshot;
}

export function createArchersHubSnapshot(
  result: CourseFinderResult,
  retrievedAt = new Date().toISOString()
): ArchersHubSnapshot {
  return validateArchersHubSnapshot({
    schemaVersion: 1,
    provider: "archershub",
    retrievedAt,
    scope: {
      coverage: "single-course",
      campusId: canonicalId(result.campus),
      academicSessionId: canonicalId(result.academicSession),
      courseId: canonicalId(result.matchedCourse.COURSE_CREATION_ID),
    },
    courses: result.courses,
    matchedCourse: result.matchedCourse,
    classes: result.classes,
  });
}

function previousPath(destination: string): string {
  if (basename(destination) === "latest.json") {
    return join(dirname(destination), "previous.json");
  }
  const extension = extname(destination);
  const stem = extension
    ? destination.slice(0, -extension.length)
    : destination;
  return `${stem}.previous${extension}`;
}

async function writePrivateFile(path: string, contents: string): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function publishArchersHubSnapshot(
  snapshotValue: unknown,
  destination: string,
  logger?: DiagnosticLogger
): Promise<void> {
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.${randomUUID()}.tmp`
  );
  const previous = previousPath(destination);
  let previousTemporary: string | undefined;
  try {
    const snapshot = validateArchersHubSnapshot(snapshotValue);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await chmod(dirname(destination), 0o700);
    await writePrivateFile(temporary, `${JSON.stringify(snapshot)}\n`);

    try {
      await stat(destination);
      previousTemporary = `${previous}.${randomUUID()}.tmp`;
      await copyFile(destination, previousTemporary);
      await chmod(previousTemporary, 0o600);
      await rename(previousTemporary, previous);
      previousTemporary = undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await rename(temporary, destination);
    await chmod(destination, 0o600);
    logger?.info("snapshot.published", {
      retrievedAt: snapshot.retrievedAt,
      coverage: snapshot.scope.coverage,
      courses: snapshot.courses.length,
      classes: snapshot.classes.length,
    });
  } catch (error) {
    await Promise.all([
      rm(temporary, { force: true }).catch(() => undefined),
      previousTemporary
        ? rm(previousTemporary, { force: true }).catch(() => undefined)
        : Promise.resolve(),
    ]);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`PUBLICATION_ERROR: ${message}`, { cause: error });
  }
}
