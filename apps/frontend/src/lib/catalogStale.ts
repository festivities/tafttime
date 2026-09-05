export const CATALOG_STALE_AFTER_MS = 30 * 60 * 1000;

export function staleBannerText(
  retrievedAt: string | null | undefined,
  nowMs = Date.now()
): string | null {
  if (!retrievedAt) return null;
  const at = new Date(retrievedAt);
  if (Number.isNaN(at.getTime())) return null;
  if (nowMs - at.getTime() <= CATALOG_STALE_AFTER_MS) return null;
  const formatted = at.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Course data may be outdated. Last updated ${formatted}.`;
}
