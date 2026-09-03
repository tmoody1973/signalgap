/**
 * What a scan's failure means, said the way an editor would say it.
 *
 * The pipeline records a code and a message on the scan. The message is
 * written for whoever debugs the pipeline ("batch 5 invalid_output"). The
 * headline here is written for whoever decides whether to trust the scan.
 * Both are shown: the headline first, the original message as detail.
 */
export const FAILURE_TEXT: Record<string, string> = {
  serpapi_error: "A search returned no usable results.",
  analyze_failed: "Some sources could not be read, so their signals are missing.",
  cluster_failed: "Related signals could not be grouped into leads.",
  adjudicate_failed: "Some near-duplicate leads could not be checked against each other.",
  adjudicate_capped: "Too many near-duplicate pairs to check, so some were left unmerged.",
  over_merged: "Signals about different stories were grouped together and had to be split.",
  candidate_step_failed: "A lead's evidence or brief could not be finished.",
  coverage_partition_failed: "The existing-coverage check did not finish for one group of outlets.",
  plan_failed: "Follow-up searches could not be planned for a lead.",
};

export function failureText(code: string, message: string): { headline: string; detail: string | null } {
  const headline = FAILURE_TEXT[code];
  return headline === undefined ? { headline: message, detail: null } : { headline, detail: message };
}
