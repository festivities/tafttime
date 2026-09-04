import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import {
  ARCHERSHUB_ORIGIN,
  completeGoogleSignIn,
  isAuthenticatedPage,
} from "./authentication";
import { fetchCourseFinder } from "./course-finder";
import { createNtfyNotifier, notifySafely, type Notifier } from "./notifier";
import { errorCategory, type WorkerState } from "./state";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function numberArgument(name: string, fallback: number): number {
  const value = Number(argument(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

async function connectPage(cdp: string): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const browser = await chromium.connectOverCDP(cdp);
  const context = browser.contexts()[0];
  if (!context) throw new Error("No browser context was available over CDP");
  const page = context.pages()[0] ?? (await context.newPage());
  return { browser, context, page };
}

async function runOnce(
  cdp: string,
  coursePrefix: string,
  login: boolean,
  account: string
): Promise<{ courses: number; classes: number }> {
  const { context, page } = await connectPage(cdp);
  {
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
      await completeGoogleSignIn(context, page, account);
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
    return { courses: result.courses.length, classes: result.classes.length };
  }
}

async function runWatch(
  cdp: string,
  coursePrefix: string,
  login: boolean,
  account: string,
  intervalMs: number,
  notify: Notifier
): Promise<never> {
  let state: WorkerState | undefined;
  let loginAttemptedForIncident = false;

  for (;;) {
    try {
      const result = await runOnce(
        cdp,
        coursePrefix,
        login && !loginAttemptedForIncident,
        account
      );
      if (state !== "AUTHENTICATED") {
        await notifySafely(
          notify,
          "TaftTime ArchersHub recovered",
          `Course Finder is authenticated again. Courses: ${result.courses}; classes for ${coursePrefix}: ${result.classes}.`
        );
      }
      state = "AUTHENTICATED";
      loginAttemptedForIncident = false;
    } catch (error) {
      const nextState = errorCategory(error);
      console.error(`[${nextState}] ${safeError(error)}`);
      if (nextState !== state) {
        const message =
          nextState === "WAITING_FOR_REAUTHENTICATION"
            ? "ArchersHub needs authentication. Connect through RDP, complete Continue with Google and any password/phone approval, then leave Chrome running."
            : "ArchersHub or Chrome is unavailable. The worker will retry automatically.";
        await notifySafely(notify, `TaftTime: ${nextState}`, message);
      }
      state = nextState;
      if (nextState === "WAITING_FOR_REAUTHENTICATION") {
        loginAttemptedForIncident = true;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function main(): Promise<void> {
  const cdp = argument("cdp", "http://127.0.0.1:9222");
  const coursePrefix = argument("course", "STSWENG");
  const account = argument("google-account", process.env.GOOGLE_ACCOUNT ?? "");
  const login = hasFlag("login");
  const watch = hasFlag("watch");

  if (login && !account) {
    throw new Error(
      "GOOGLE_ACCOUNT_REQUIRED: pass --google-account or set GOOGLE_ACCOUNT"
    );
  }

  const notify = createNtfyNotifier(
    process.env.NTFY_TOPIC,
    process.env.NTFY_SERVER,
    process.env.NTFY_TOKEN
  );
  if (watch) {
    await runWatch(
      cdp,
      coursePrefix,
      login,
      account,
      numberArgument("interval-seconds", 900) * 1000,
      notify
    );
    return;
  }

  await runOnce(cdp, coursePrefix, login, account);
  console.log("Probe completed without modifying the attached browser.");
}

main().catch((error: unknown) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
