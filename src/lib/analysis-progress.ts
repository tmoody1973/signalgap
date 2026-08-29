/**
 * "The scan is reading, and here is how far it has got."
 *
 * A scan spends its entire search budget in the first minute, then reads every
 * source it found before a single lead exists. Between those two moments the
 * search counter is finished and the lead counts are all zero, so a working scan
 * and a dead one look identical. On 2026-08-29 a scan was cancelled at 3.1
 * minutes, twenty batches deep and healthy, for exactly that reason.
 *
 * Returns null rather than a placeholder when there is nothing true to say. A
 * progress line for work that has not started is worse than no line at all.
 */
export function analysisProgressText(sourcesAnalyzed: number | undefined, sourcesTotal: number | undefined): string | null {
  if (sourcesTotal === undefined || sourcesTotal <= 0) return null;
  const read = sourcesAnalyzed ?? 0;
  // Clamped: a retried or double-answered batch must never read "390 of 380".
  if (read >= sourcesTotal) return `Read all ${sourcesTotal} sources · grouping them into leads`;
  return `Read ${read} of ${sourcesTotal} sources`;
}
