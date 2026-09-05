import type { Page } from "playwright";

import { ARCHERSHUB_ORIGIN, isLoginUrl } from "./authentication";
import type { DiagnosticLogger } from "./logger";
import type {
  ClassRow,
  Course,
  CourseFinderResult,
  CourseListResponse,
} from "./types";

export const COURSE_FINDER_PATH = "/CourseFinder/Index";

export async function keepArchersHubSessionAlive(
  page: Page,
  logger?: DiagnosticLogger
): Promise<void> {
  const started = Date.now();
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    localStorage.setItem("IdleTime", new Date().toString());
  });
  logger?.info("session.activity", {
    durationMs: Date.now() - started,
  });
}

export async function postForm<T>(
  page: Page,
  path: string,
  form: Record<string, string>,
  logger?: DiagnosticLogger
): Promise<T> {
  const started = Date.now();
  logger?.debug("provider.request", { path });
  const response = await page.evaluate(
    async ({ path, form }) => {
      const result = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: new URLSearchParams(form),
        credentials: "same-origin",
      });
      return {
        status: result.status,
        url: result.url,
        contentType: result.headers.get("content-type") ?? "",
        text: await result.text(),
      };
    },
    { path, form }
  );

  if (isLoginUrl(response.url) || /text\/html/i.test(response.contentType)) {
    logger?.warn("provider.authentication_required", {
      path,
      status: response.status,
      contentType: response.contentType,
      durationMs: Date.now() - started,
    });
    throw new Error("AUTHENTICATION_REQUIRED: ArchersHub returned the login page");
  }
  if (response.status < 200 || response.status >= 300) {
    logger?.warn("provider.http_error", {
      path,
      status: response.status,
      durationMs: Date.now() - started,
    });
    throw new Error(`PROVIDER_ERROR: ${path} returned HTTP ${response.status}`);
  }

  try {
    logger?.info("provider.response", {
      path,
      status: response.status,
      durationMs: Date.now() - started,
      bodyBytes: response.text.length,
    });
    return JSON.parse(response.text) as T;
  } catch {
    logger?.error("provider.invalid_json", { path });
    throw new Error(`INVALID_RESPONSE: ${path} did not return JSON`);
  }
}

export function validateCourseList(value: CourseListResponse): Course[] {
  if (!Array.isArray(value.CourseDrp)) {
    throw new Error("INVALID_RESPONSE: CourseDrp was not an array");
  }

  if (
    value.CourseDrp.some(
      (course) =>
        !course ||
        typeof course !== "object" ||
        typeof (course as Course).COURSE_NAME !== "string" ||
        (typeof (course as Course).COURSE_CREATION_ID !== "number" &&
          typeof (course as Course).COURSE_CREATION_ID !== "string")
    )
  ) {
    throw new Error("INVALID_RESPONSE: CourseDrp contained an invalid course");
  }

  return value.CourseDrp as Course[];
}

export function validateClassRows(value: unknown): ClassRow[] {
  if (!Array.isArray(value)) {
    throw new Error("INVALID_RESPONSE: GetCFData did not return an array");
  }
  return value as ClassRow[];
}

export async function fetchCourseFinder(
  page: Page,
  coursePrefix: string,
  logger?: DiagnosticLogger
): Promise<CourseFinderResult> {
  const campus = page.locator("#ddlSelectCampus");
  const academicSession = page.locator("#ddlSelectAcadSession");
  const currentUrl = new URL(page.url());
  let authenticated =
    currentUrl.origin === ARCHERSHUB_ORIGIN &&
    /^\/coursefinder\/index(?:\/|$)/i.test(currentUrl.pathname) &&
    (await campus.count()) > 0 &&
    (await academicSession.count()) > 0;

  if (authenticated) {
    logger?.info("course_finder.authenticated", { source: "existing_page" });
  }

  // OAuth can render the dashboard before the server-side session is ready.
  // Retry navigation without starting another OAuth flow.
  for (let attempt = 1; !authenticated && attempt <= 3; attempt++) {
    await page.goto(`${ARCHERSHUB_ORIGIN}${COURSE_FINDER_PATH}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(
      () => undefined
    );
    if (isLoginUrl(page.url())) break;
    try {
      await campus.waitFor({
        state: "attached",
        timeout: 5_000,
      });
      await academicSession.waitFor({
        state: "attached",
        timeout: 5_000,
      });
      logger?.info("course_finder.authenticated", {
        source: "navigation",
        attempt,
      });
      authenticated = true;
      break;
    } catch {
      // The controls can arrive after the document and network settle.
    }
    if (attempt < 3) await page.waitForTimeout(2_000);
  }

  if (!authenticated) {
    throw new Error("AUTHENTICATION_REQUIRED: ArchersHub login is required");
  }

  await campus.waitFor({ state: "attached" });
  await academicSession.waitFor({ state: "attached" });

  const selection = await page.evaluate(() => ({
    campus: (document.querySelector("#ddlSelectCampus") as HTMLSelectElement)
      ?.value,
    academicSession: (
      document.querySelector("#ddlSelectAcadSession") as HTMLSelectElement
    )?.value,
  }));

  if (
    !selection.campus ||
    selection.campus === "0" ||
    !selection.academicSession ||
    selection.academicSession === "0"
  ) {
    throw new Error("INVALID_RESPONSE: Course Finder selection was incomplete");
  }

  const list = validateCourseList(
    await postForm<CourseListResponse>(page, "/CourseFinder/GetCourseList/", {
      Campusno: selection.campus,
      AcademicSession: selection.academicSession,
    }, logger)
  );
  const matchedCourse = list.find((course) =>
    course.COURSE_NAME.toUpperCase().startsWith(coursePrefix.toUpperCase())
  );
  if (!matchedCourse) {
    throw new Error(`COURSE_NOT_FOUND: no offering starts with ${coursePrefix}`);
  }

  const classes = validateClassRows(
    await postForm<ClassRow[]>(page, "/CourseFinder/GetCFData/", {
      Campusno: selection.campus,
      AcademicSession: selection.academicSession,
      Courseid: String(matchedCourse.COURSE_CREATION_ID),
    }, logger)
  );

  return {
    campus: selection.campus,
    academicSession: selection.academicSession,
    courses: list,
    matchedCourse,
    classes,
  };
}
