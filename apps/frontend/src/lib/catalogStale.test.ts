import { describe, expect, it } from "vitest";

import { CATALOG_STALE_AFTER_MS, staleBannerText } from "./catalogStale";

describe("staleBannerText", () => {
  const now = new Date("2026-09-06T12:00:00+08:00").getTime();

  it("returns null for fresh data", () => {
    expect(
      staleBannerText(
        new Date(now - CATALOG_STALE_AFTER_MS + 60_000).toISOString(),
        now
      )
    ).toBeNull();
  });

  it("warns after thirty minutes without a refresh", () => {
    const text = staleBannerText(
      new Date(now - CATALOG_STALE_AFTER_MS - 60_000).toISOString(),
      now
    );
    expect(text).toMatch(/^Course data may be outdated\. Last updated /);
  });

  it("returns null without a retrieval timestamp", () => {
    expect(staleBannerText(null, now)).toBeNull();
    expect(staleBannerText(undefined, now)).toBeNull();
    expect(staleBannerText("not-a-date", now)).toBeNull();
  });
});
