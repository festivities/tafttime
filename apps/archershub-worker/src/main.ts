import { chromium } from "playwright";

import {
  ARCHERSHUB_ORIGIN,
  completeGoogleSignIn,
  isAuthenticatedPage,
} from "./authentication";
import { fetchCourseFinder } from "./course-finder";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const cdp = argument("cdp", "http://127.0.0.1:9222");
  const coursePrefix = argument("course", "STSWENG");
  const account = argument("google-account", process.env.GOOGLE_ACCOUNT ?? "");
  const login = hasFlag("login");

  if (login && !account) {
    throw new Error(
      "GOOGLE_ACCOUNT_REQUIRED: pass --google-account or set GOOGLE_ACCOUNT"
    );
  }

  const browser = await chromium.connectOverCDP(cdp);
  const context = browser.contexts()[0];
  if (!context) throw new Error("No browser context was available over CDP");

  let page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${ARCHERSHUB_ORIGIN}/CourseFinder/Index`, {
    waitUntil: "domcontentloaded",
  });

  if (!(await isAuthenticatedPage(page))) {
    if (!login) {
      throw new Error(
        "AUTHENTICATION_REQUIRED: use --login to click Continue with Google"
      );
    }

    const googleButton = page.locator("#btnGoogleSignIn");
    await googleButton.waitFor({ state: "visible", timeout: 15_000 });
    console.log("Clicking Continue with Google.");
    console.log("Complete any password or phone approval in Chrome if prompted.");
    await googleButton.click();
    page = await completeGoogleSignIn(context, page, account);
  }

  const result = await fetchCourseFinder(page, coursePrefix);
  const sections = result.classes
    .map((row) => row.SECTION_NAME)
    .filter((section): section is string => typeof section === "string");

  console.log("Attached to Chrome.");
  console.log("Course Finder authentication: authenticated");
  console.log(`Course offerings: ${result.courses.length}`);
  console.log(
    `Matched course: ${result.matchedCourse.COURSE_NAME} (id ${result.matchedCourse.COURSE_CREATION_ID})`
  );
  console.log(`Selectable classes: ${result.classes.length}`);
  console.log(`Sections: ${sections.join(", ") || "none"}`);
  console.log("Probe completed without modifying the attached browser.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Worker failed");
  process.exitCode = 1;
});
