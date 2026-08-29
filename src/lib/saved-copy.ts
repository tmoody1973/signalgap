/**
 * When a saved copy was captured, written in Milwaukee's clock.
 *
 * The timezone is pinned rather than left to the reader's browser for two
 * reasons. The product covers one city, so a Milwaukee-local reading is the
 * right one for an editor deciding whether the data is still current. And a
 * client component that formats in the browser's zone disagrees with what the
 * server rendered, which React reports as a hydration mismatch.
 *
 * `timeZoneName: "short"` rather than a hardcoded "CT" so the string says CDT
 * in summer and CST in winter instead of being wrong half the year.
 */
export function captureTimeText(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZone: "America/Chicago", timeZoneName: "short",
  }).format(new Date(ms));
}
