import type { Page } from "playwright";

import { ARCHERSHUB_ORIGIN, isAuthenticatedPage, isLoginUrl } from "./authentication";
import type {
  ClassRow,
  Course,
  CourseFinderResult,
  CourseListResponse,
} from "./types";

export const COURSE_FINDER_PATH = "/CourseFinder/Index";

export async function postForm<T>(
  page: Page,
  path: string,
  form: Record<string, string>
): Promise<T> {
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
    throw new Error("AUTHENTICATION_REQUIRED: ArchersHub returned the login page");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`PROVIDER_ERROR: ${path} returned HTTP ${response.status}`);
  }

  try {
    return JSON.parse(response.text) as T;
  } catch {
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
  coursePrefix: string
): Promise<CourseFinderResult> {
  await page.goto(`${ARCHERSHUB_ORIGIN}${COURSE_FINDER_PATH}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(
    () => undefined
  );

  if (!(await isAuthenticatedPage(page))) {
    throw new Error("AUTHENTICATION_REQUIRED: ArchersHub login is required");
  }

  await page.locator("#ddlSelectCampus").waitFor({ state: "attached" });
  await page.locator("#ddlSelectAcadSession").waitFor({ state: "attached" });

  const selection = await page.evaluate(() => ({
    campus: (document.querySelector("#ddlSelectCampus") as HTMLSelectElement)
      ?.value,
    academicSession: (
      document.querySelector("#ddlSelectAcadSession") as HTMLSelectElement
    )?.value,
  }));

  if (!selection.campus || !selection.academicSession) {
    throw new Error("INVALID_RESPONSE: Course Finder selection was incomplete");
  }

  const list = validateCourseList(
    await postForm<CourseListResponse>(page, "/CourseFinder/GetCourseList/", {
      Campusno: selection.campus,
      AcademicSession: selection.academicSession,
    })
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
    })
  );

  return {
    campus: selection.campus,
    academicSession: selection.academicSession,
    courses: list,
    matchedCourse,
    classes,
  };
}
