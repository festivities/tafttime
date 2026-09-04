import type { BrowserContext, Page } from "playwright";

import type { DiagnosticLogger } from "./logger";

export const ARCHERSHUB_ORIGIN = "https://archershub.dlsu.edu.ph";

export type MfaPrompt =
  | { kind: "number_match"; number: string }
  | { kind: "approval" };

export function parseMfaPrompt(text: string): MfaPrompt | undefined {
  const numberMatch = text.match(
    /Open the Gmail app,\s*tap Yes on the prompt,\s*then tap\s+(\d+)\s+on your phone to verify it(?:’|'|)s you/i
  );
  if (numberMatch) return { kind: "number_match", number: numberMatch[1] };

  if (/open the gmail app.*tap yes on the prompt/i.test(text)) {
    return { kind: "approval" };
  }

  return undefined;
}

export function isLoginUrl(url: string): boolean {
  const parsed = new URL(url);
  return (
    /\/studentlogin(?:\/|$)/i.test(parsed.pathname) ||
    (parsed.hostname === "archershub.dlsu.edu.ph" &&
      (parsed.pathname === "/" || parsed.pathname === ""))
  );
}

export async function isAuthenticatedPage(page: Page): Promise<boolean> {
  const url = new URL(page.url());
  if (url.hostname !== "archershub.dlsu.edu.ph" || isLoginUrl(page.url())) {
    return false;
  }

  return (
    (await page.locator("#ddlSelectCampus").count()) > 0 ||
    (await page.locator("a[href*='/Enlistment'], a[href*='/CourseFinder']").count()) > 0 ||
    (await page.getByText(/Welcome,|Good Evening/i).count()) > 0
  );
}

export async function completeGoogleSignIn(
  context: BrowserContext,
  initialPage: Page,
  account: string,
  onMfaPrompt?: (prompt: MfaPrompt) => Promise<void>,
  timeoutMs = 5 * 60_000,
  logger?: DiagnosticLogger
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  let page = initialPage;
  let accountSelected = false;
  let notifiedMfa: string | undefined;

  while (Date.now() < deadline) {
    logger?.debug("auth.poll", { pages: context.pages().length });
    const authenticatedPage = await findAuthenticatedPage(context);
    if (authenticatedPage) {
      logger?.info("auth.authenticated", { url: authenticatedPage.url() });
      return authenticatedPage;
    }

    const googlePage = context.pages().find((candidate) =>
      candidate.url().startsWith("https://accounts.google.com/")
    );
    if (googlePage) {
      page = googlePage;
      logger?.debug("auth.google_page", { url: page.url() });
    }

    if (googlePage && !accountSelected) {
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      const accountEntry = page
        .locator(
          `[data-email="${account}"], [data-identifier="${account}"], a, div[role="link"]`
        )
        .filter({ hasText: account })
        .first();

      if ((await accountEntry.count()) > 0) {
        await accountEntry.scrollIntoViewIfNeeded();
        await page.waitForTimeout(750);
        console.log("Selecting the configured Google account.");
        logger?.info("auth.google_account_selected");
        await Promise.all([
          page.waitForLoadState("domcontentloaded").catch(() => undefined),
          accountEntry.click(),
        ]);
        accountSelected = true;
      }
    }

    if (googlePage && onMfaPrompt) {
      const prompt = parseMfaPrompt(await page.locator("body").innerText());
      const promptKey = prompt
        ? prompt.kind === "number_match"
          ? `${prompt.kind}:${prompt.number}`
          : prompt.kind
        : undefined;
      if (prompt && promptKey !== notifiedMfa) {
        logger?.info("auth.mfa_prompt", {
          kind: prompt.kind,
          ...(prompt.kind === "number_match" ? { number: prompt.number } : {}),
        });
        await onMfaPrompt(prompt);
        notifiedMfa = promptKey;
      }
    }

    if (accountSelected && page.url().startsWith(`${ARCHERSHUB_ORIGIN}/`)) {
      await page.waitForTimeout(1_500);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(
        () => undefined
      );
      const settledPage = await findAuthenticatedPage(context);
      if (settledPage) return settledPage;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    "AUTHENTICATION_REQUIRED: Google sign-in did not return to an authenticated ArchersHub page; complete any password or phone approval in Chrome"
  );
}

async function findAuthenticatedPage(
  context: BrowserContext
): Promise<Page | undefined> {
  for (const candidate of context.pages().reverse()) {
    if (await isAuthenticatedPage(candidate)) return candidate;
  }
  return undefined;
}
