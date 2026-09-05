import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DiagnosticLogger } from "./logger";
import type { ClassRow, Course } from "./types";

export const CRAWL_MANIFEST_NAME = "manifest.json";
export const MAX_COURSE_ATTEMPTS = 3;
export const MAX_BACKOFF_MS = 60_000;

export type CrawlCourseStatus = "pending" | "ok" | "failed";

export type CrawlCourseState = {
  courseCreationId: string;
  courseName: string;
  status: CrawlCourseStatus;
  attempts: number;
  retrievedAt?: string;
  classes?: number;
  error?: string;
};

export type CrawlManifest = {
  schemaVersion: 1;
  provider: "archershub";
  campusId: string;
  academicSessionId: string;
  startedAt: string;
  updatedAt: string;
  delayMs: number;
  courses: CrawlCourseState[];
};

export function createCrawlManifest(
  campusId: string,
  academicSessionId: string,
  courses: Course[],
  delayMs: number,
  startedAt = new Date().toISOString()
): CrawlManifest {
  const seen = new Set<string>();
  const states = courses.map((course) => {
    const courseCreationId = String(course.COURSE_CREATION_ID);
    if (seen.has(courseCreationId)) {
      throw new Error(
        `MANIFEST_ERROR: duplicate course id ${courseCreationId} in course list`
      );
    }
    seen.add(courseCreationId);
    return {
      courseCreationId,
      courseName: course.COURSE_NAME,
      status: "pending" as const,
      attempts: 0,
    };
  });
  return {
    schemaVersion: 1,
    provider: "archershub",
    campusId,
    academicSessionId,
    startedAt,
    updatedAt: startedAt,
    delayMs,
    courses: states,
  };
}

export function checkCrawlScope(
  manifest: CrawlManifest,
  campusId: string,
  academicSessionId: string
): void {
  if (
    manifest.campusId !== campusId ||
    manifest.academicSessionId !== academicSessionId
  ) {
    throw new Error(
      `SCOPE_CHANGED: manifest covers campus ${manifest.campusId} session ${manifest.academicSessionId} but Course Finder now shows campus ${campusId} session ${academicSessionId}`
    );
  }
}

export function pendingCourses(
  manifest: CrawlManifest,
  limit: number
): CrawlCourseState[] {
  const pending = manifest.courses.filter(
    (course) => course.status === "pending"
  );
  return limit > 0 ? pending.slice(0, limit) : pending;
}

export function assertNonEmptyClassRows(
  courseId: string,
  rows: ClassRow[]
): ClassRow[] {
  if (rows.length === 0) {
    throw new Error(
      `EMPTY_RESULT: GetCFData returned zero rows for course ${courseId}`
    );
  }
  return rows;
}

export function backoffDelayMs(delayMs: number, attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, delayMs * 2 ** Math.max(0, attempt - 1));
}

export function courseSnapshotPath(dir: string, courseId: string): string {
  return join(dir, `${courseId}.json`);
}

export function manifestPath(dir: string): string {
  return join(dir, CRAWL_MANIFEST_NAME);
}

function validateManifest(value: unknown): CrawlManifest {
  if (!value || typeof value !== "object") {
    throw new Error("MANIFEST_ERROR: manifest was not an object");
  }
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.provider !== "archershub" ||
    typeof manifest.campusId !== "string" ||
    typeof manifest.academicSessionId !== "string" ||
    typeof manifest.startedAt !== "string" ||
    typeof manifest.updatedAt !== "string" ||
    typeof manifest.delayMs !== "number" ||
    !Array.isArray(manifest.courses)
  ) {
    throw new Error("MANIFEST_ERROR: manifest had an invalid shape");
  }
  for (const course of manifest.courses as Record<string, unknown>[]) {
    if (
      !course ||
      typeof course !== "object" ||
      typeof course.courseCreationId !== "string" ||
      typeof course.courseName !== "string" ||
      (course.status !== "pending" &&
        course.status !== "ok" &&
        course.status !== "failed") ||
      typeof course.attempts !== "number"
    ) {
      throw new Error("MANIFEST_ERROR: manifest had an invalid course entry");
    }
  }
  return value as CrawlManifest;
}

export async function loadCrawlManifest(dir: string): Promise<CrawlManifest> {
  let raw: string;
  try {
    raw = await readFile(manifestPath(dir), "utf8");
  } catch (error) {
    throw new Error(
      `MANIFEST_ERROR: could not read ${manifestPath(dir)}: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }
  try {
    return validateManifest(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "MANIFEST_ERROR: invalid JSON"
    );
  }
}

export async function saveCrawlManifest(
  dir: string,
  manifest: CrawlManifest,
  logger?: DiagnosticLogger
): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const temporary = join(dir, `.manifest.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(manifest)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, manifestPath(dir));
  await chmod(manifestPath(dir), 0o600);
  logger?.info("crawl.manifest_saved", {
    ok: manifest.courses.filter((c) => c.status === "ok").length,
    failed: manifest.courses.filter((c) => c.status === "failed").length,
    pending: manifest.courses.filter((c) => c.status === "pending").length,
  });
}

export type CrawlCourseDeps = {
  fetchRows: (course: CrawlCourseState) => Promise<ClassRow[]>;
  publish: (course: CrawlCourseState, rows: ClassRow[]) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  logger?: DiagnosticLogger;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runCrawlCourses(
  manifest: CrawlManifest,
  dir: string,
  deps: CrawlCourseDeps,
  limit = 0
): Promise<{ ok: number; failed: number }> {
  const sleep = deps.sleep ?? defaultSleep;
  let first = true;
  for (const course of pendingCourses(manifest, limit)) {
    if (!first) {
      await sleep(manifest.delayMs * (0.75 + Math.random() / 2));
    }
    first = false;
    for (let attempt = 1; ; attempt++) {
      course.attempts = attempt;
      try {
        const rows = assertNonEmptyClassRows(
          course.courseCreationId,
          await deps.fetchRows(course)
        );
        const retrievedAt = await deps.publish(course, rows);
        course.status = "ok";
        course.retrievedAt = retrievedAt;
        course.classes = rows.length;
        delete course.error;
        deps.logger?.info("crawl.course_ok", {
          course: course.courseCreationId,
          classes: rows.length,
        });
        break;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        if (message.includes("AUTHENTICATION_REQUIRED")) {
          course.error = message;
          await saveCrawlManifest(dir, manifest, deps.logger);
          throw new Error(
            `AUTHENTICATION_REQUIRED: crawl aborted at course ${course.courseCreationId}; resume after reauthentication`
          );
        }
        if (attempt >= MAX_COURSE_ATTEMPTS) {
          course.status = "failed";
          course.error = message;
          deps.logger?.warn("crawl.course_failed", {
            course: course.courseCreationId,
            attempts: attempt,
            message,
          });
          break;
        }
        deps.logger?.info("crawl.course_retry", {
          course: course.courseCreationId,
          attempt,
          message,
        });
        await sleep(backoffDelayMs(manifest.delayMs, attempt));
      }
    }
    await saveCrawlManifest(dir, manifest, deps.logger);
  }
  return {
    ok: manifest.courses.filter((c) => c.status === "ok").length,
    failed: manifest.courses.filter((c) => c.status === "failed").length,
  };
}
