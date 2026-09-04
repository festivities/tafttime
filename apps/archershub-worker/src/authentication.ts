import type { BrowserContext, Page } from "playwright";

export const ARCHERSHUB_ORIGIN = "https://archershub.dlsu.edu.ph";

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
  timeoutMs = 5 * 60_000
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  let page = initialPage;
  let accountSelected = false;

  while (Date.now() < deadline) {
    const authenticatedPage = await findAuthenticatedPage(context);
    if (authenticatedPage) return authenticatedPage;

    const googlePage = context.pages().find((candidate) =>
      candidate.url().startsWith("https://accounts.google.com/")
    );
    if (googlePage) page = googlePage;

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
        await Promise.all([
          page.waitForLoadState("domcontentloaded").catch(() => undefined),
          accountEntry.click(),
        ]);
        accountSelected = true;
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
