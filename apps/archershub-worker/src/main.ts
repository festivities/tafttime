import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import {
  ARCHERSHUB_ORIGIN,
  completeGoogleSignIn,
  type MfaPrompt,
} from "./authentication";
import { fetchCourseFinder, keepArchersHubSessionAlive } from "./course-finder";
import { createNtfyNotifier, notifySafely, type Notifier } from "./notifier";
import { errorCategory, type WorkerState } from "./state";
import { createDiagnosticLogger, type DiagnosticLogger } from "./logger";

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
  context: BrowserContext,
  initialPage: Page,
  coursePrefix: string,
  login: boolean,
  account: string,
  notify: Notifier,
  logger: DiagnosticLogger
): Promise<{ courses: number; classes: number; page: Page }> {
  let page = initialPage;
  try {
    const result = await fetchCourseFinder(page, coursePrefix, logger);
    return logResult(result, page);
  } catch (error) {
    if (!login || !(error instanceof Error) || !error.message.includes("AUTHENTICATION_REQUIRED")) {
      throw error;
    }

    await page.goto(`${ARCHERSHUB_ORIGIN}/`, { waitUntil: "domcontentloaded" });
    const googleButton = page.locator("#btnGoogleSignIn");
    await googleButton.waitFor({ state: "visible", timeout: 15_000 });
    console.log("Clicking Continue with Google.");
    console.log("Complete any password or phone approval in Chrome if prompted.");
    await googleButton.click();
    page = await completeGoogleSignIn(context, page, account, async (prompt) => {
      await notifyMfaPrompt(notify, prompt);
    }, 5 * 60_000, logger);

    const result = await fetchCourseFinder(page, coursePrefix, logger);
    return logResult(result, page);
  }
}

function logResult(
  result: Awaited<ReturnType<typeof fetchCourseFinder>>,
  page: Page
): { courses: number; classes: number; page: Page } {
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
    return { courses: result.courses.length, classes: result.classes.length, page };
}

async function notifyMfaPrompt(
  notify: Notifier,
  prompt: MfaPrompt
): Promise<void> {
  if (prompt.kind === "number_match") {
    await notifySafely(
      notify,
      `TaftTime: Google number matching required (${prompt.number})`,
      `Open the Gmail app, tap Yes on the sign-in prompt, then tap ${prompt.number} on your phone. The worker is waiting for ArchersHub authentication.`
    );
    return;
  }

  await notifySafely(
    notify,
    "TaftTime: Google approval required",
    "Open the Gmail app and tap Yes on the sign-in prompt. The worker is waiting for ArchersHub authentication."
  );
}

async function runWatch(
  cdp: string,
  coursePrefix: string,
  login: boolean,
  account: string,
  intervalMs: number,
  notify: Notifier,
  logger: DiagnosticLogger
): Promise<never> {
  let state: WorkerState | undefined;
  let loginAttemptedForIncident = false;
  let activePage: Page | undefined;
  let keepAliveInFlight = false;
  let connection = await connectPage(cdp);

  setInterval(() => {
    if (!activePage || keepAliveInFlight) return;
    keepAliveInFlight = true;
    keepArchersHubSessionAlive(activePage, logger)
      .catch(async (error: unknown) => {
        const nextState = errorCategory(error);
        logger.error("session.keepalive_failed", { state: nextState });
        if (nextState !== state) {
          state = nextState;
          loginAttemptedForIncident = nextState === "WAITING_FOR_REAUTHENTICATION";
          await notifySafely(
            notify,
            `TaftTime: ${nextState}`,
            nextState === "WAITING_FOR_REAUTHENTICATION"
              ? "ArchersHub logged out during inactivity. Connect through RDP and complete Continue with Google; the worker will resume automatically."
              : "ArchersHub session keepalive failed. The worker will retry automatically."
          );
        }
      })
      .finally(() => {
        keepAliveInFlight = false;
      });
  }, 4 * 60 * 1000);

  for (;;) {
    try {
      const result = await runOnce(
        connection.context,
        activePage ?? connection.page,
        coursePrefix,
        login && !loginAttemptedForIncident,
        account,
        notify,
        logger
      );
      activePage = result.page;
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
      logger.error("worker.error", {
        state: nextState,
        message: safeError(error),
      });
      if (nextState !== state) {
        logger.info("worker.state_change", {
          from: state ?? "STARTING",
          to: nextState,
        });
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
      if (nextState === "PROVIDER_UNAVAILABLE") {
        try {
          connection = await connectPage(cdp);
          activePage = connection.page;
          logger.info("worker.cdp_reconnected");
        } catch (reconnectError) {
          logger.warn("worker.cdp_reconnect_failed", {
            message: safeError(reconnectError),
          });
        }
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
  const logger = createDiagnosticLogger(
    argument("log-dir", process.env.ARCHERSHUB_LOG_DIR ?? "") || undefined
  );
  logger.info("worker.start", {
    mode: watch ? "watch" : "once",
    cdp,
    coursePrefix,
    intervalSeconds: numberArgument("interval-seconds", 900),
  });

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
      notify,
      logger
    );
    return;
  }

  const connection = await connectPage(cdp);
  await runOnce(
    connection.context,
    connection.page,
    coursePrefix,
    login,
    account,
    notify,
    logger
  );
  console.log("Probe completed without modifying the attached browser.");
}

main().catch((error: unknown) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
