"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { FeedFilters, isLeadLabel, type LeadFilters } from "@/components/feed/feed-filters";
import { LeadCard } from "@/components/feed/lead-card";
import { Button } from "@/components/ui/untitled/button";
import { feedFiltersToParams, parseFeedFilters } from "@/lib/feed-filters";
import { isScanFinished } from "@/lib/scan-status";
import { cx } from "@/lib/utils/cx";

type Scan = NonNullable<FunctionReturnType<typeof api.scans.get>>;

const PAGE_SIZE = 25;

// The same rule the progress panel applies.
const isFinished = (scan: Scan) => isScanFinished(scan.status);

/**
 * The ranked feed and the did-not-qualify list, as one screen with two views.
 *
 * Both lists come from the same query and the same card; the only difference
 * is the verdict this scan froze against each candidate. The did-not-qualify
 * list is not an appendix — at most ten leads per scan can ever qualify, so it
 * is where most of a scan lives and it is a first-class view here.
 */
export function LeadFeed({
  scan,
  onRunNewScan,
  runNewScanDisabled,
}: {
  scan: Scan;
  onRunNewScan: () => void;
  runNewScanDisabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL is the state. Nothing here mirrors it into React — a filtered feed
  // has to be a link an editor can send, and it has to survive opening a lead
  // and coming back.
  const parsed = parseFeedFilters(searchParams);
  const filters: LeadFilters = { ...parsed, label: isLeadLabel(parsed.label) ? parsed.label : null };
  const filterKey = feedFiltersToParams(filters).toString();

  // Narrowing to one beat should put an editor back at the first 25 of THAT
  // list. Derived during render rather than reset in an effect: no second pass
  // and no frame showing the old page size against the new filters.
  // `prev` is the page size that was on screen before the current one was
  // asked for. It is what the pinned query below reads, so the fallback is
  // always the list the reader is actually looking at.
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE_SIZE, prev: PAGE_SIZE });
  const sameFilters = paging.key === filterKey;
  const limit = sameFilters ? paging.limit : PAGE_SIZE;
  const pinned = sameFilters ? paging.prev : PAGE_SIZE;

  // One growing page rather than a stack of accumulated ones: `listForScan`
  // sorts a bounded in-memory set and its cursor is a plain offset, so asking
  // for fifty returns the twenty-five already on screen plus the next
  // twenty-five — and the whole list stays live, which a client-side pile of
  // frozen pages would not.
  const args = {
    scanId: scan._id,
    view: filters.view,
    beat: filters.beat ?? undefined,
    label: filters.label ?? undefined,
    disposition: filters.disposition ?? undefined,
  };

  // Two subscriptions, on purpose. A Convex query reads `undefined` until its
  // NEW arguments land, so growing the page size on its own would blank the
  // rows already on screen and throw the reader back to the top. The pinned
  // query asks for the PREVIOUS page size, which is the one the reader is
  // looking at and is therefore already in the client's cache — so it holds
  // that exact list steady while the wider one arrives, on the second click
  // and every one after it, not only the first.
  // On a filter change both go undefined together — which is right, because
  // the previous list is then the wrong answer, not a stale one.
  // Keep `pinnedPage` declared FIRST: its subscription must be live before
  // `widerPage`'s observer drops that same argument set, or the client can
  // briefly hold zero listeners for it, drop the cached value, and flash a
  // loading state. Reordering these two silently undoes half of this.
  const pinnedPage = useQuery(api.candidates.list.listForScan, {
    ...args,
    paginationOpts: { numItems: pinned, cursor: null },
  });
  const widerPage = useQuery(
    api.candidates.list.listForScan,
    limit > pinned ? { ...args, paginationOpts: { numItems: limit, cursor: null } } : "skip",
  );
  const result = widerPage ?? pinnedPage;
  const loadingMore = limit > pinned && widerPage === undefined;

  const hrefFor = (next: LeadFilters) => {
    const params = feedFiltersToParams(next).toString();
    return params ? `${pathname}?${params}` : pathname;
  };

  // replace, not push: changing a dropdown refines one list, it does not walk
  // somewhere new, so Back should leave the feed rather than undo a select.
  const setFilters = (next: LeadFilters) => router.replace(hrefFor(next), { scroll: false });
  const clearFilters = () => setFilters({ view: filters.view, beat: null, label: null, disposition: null });

  const anyFilterActive = filters.beat !== null || filters.label !== null || filters.disposition !== null;
  const isEmpty = result !== undefined && result.page.length === 0;

  return (
    <section aria-labelledby="feed-heading" className="mt-8 border-t border-rule pt-5">
      {/* h2, matching the progress panel: the page's h1 is "Latest scan" and a
          card's reporting question is an h3, so the outline reads
          Latest scan > Leads > this question. */}
      <h2 id="feed-heading" className="font-editorial text-xl">Leads</h2>

      {/* All three counts, always, even at zero — the same rule the progress
          panel follows. Two of them name the two views, so the numbers sit on
          the thing they describe instead of repeating the panel's line. */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
        <nav aria-label="Feed view" className="flex flex-wrap gap-x-5 gap-y-1">
          <ViewLink href={hrefFor({ ...filters, view: "eligible" })} isCurrent={filters.view === "eligible"}>
            Ready (<strong className="font-semibold">{scan.eligibleCount}</strong>)
          </ViewLink>
          <ViewLink href={hrefFor({ ...filters, view: "excluded" })} isCurrent={filters.view === "excluded"}>
            Did not qualify (<strong className="font-semibold">{scan.excludedCount}</strong>)
          </ViewLink>
        </nav>
        <p className="text-muted">
          <strong className="font-semibold text-ink">{scan.processingCount}</strong> still working
        </p>
      </div>

      {/* `still working` is only written once the LAST stage starts walking the
          candidate list (convex/stages/finalize.ts) — and so are the other two.
          Earlier stages can have real work in flight against three zeroes, so
          an unfinished scan says so in words rather than letting those zeroes
          read as "nothing is happening". */}
      {/* A stopped scan needs its own sentence. Its counts are never a whole
          picture: a cancel before the last stage leaves all three at their
          initial zeroes, and a cancel during it freezes a mid-walk snapshot
          that can read "3 still working" forever. Saying "still running" there
          would be false, and saying nothing lets a partial count read as final. */}
      {!isFinished(scan) ? (
        <p className="mt-1 text-sm text-muted">
          The scan is still running. These counts only cover leads that have reached the last stage.
        </p>
      ) : scan.status === "canceled" ? (
        <p className="mt-1 text-sm text-muted">
          You stopped this scan. These counts cover only the leads it judged before it stopped — anything
          left as still working never reached a verdict.
        </p>
      ) : null}

      {/* Exactly one reset on screen: it lives with the filters while there is
          a list to reset, and moves into the empty state when there is not. */}
      <FeedFilters
        filters={filters}
        onChange={setFilters}
        onClear={anyFilterActive && !isEmpty ? clearFilters : undefined}
      />

      {result === undefined ? (
        <p className="mt-5 text-sm text-muted">Loading leads…</p>
      ) : isEmpty ? (
        <EmptyState
          scan={scan}
          view={filters.view}
          anyFilterActive={anyFilterActive}
          excludedHref={hrefFor({ view: "excluded", beat: null, label: null, disposition: null })}
          onClearFilters={clearFilters}
          onRunNewScan={onRunNewScan}
          runNewScanDisabled={runNewScanDisabled}
        />
      ) : (
        <>
          <div className="mt-4">
            {result.page.map((lead) => (
              <LeadCard key={lead.candidateId} lead={lead} />
            ))}
          </div>
          {!result.isDone && (
            <Button
              color="secondary"
              size="sm"
              className="mt-4"
              isLoading={loadingMore}
              onPress={() => setPaging({ key: filterKey, limit: limit + PAGE_SIZE, prev: limit })}
            >
              Load next {PAGE_SIZE}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * A real link, so a view is shareable and can be opened in a new tab. The
 * current view is marked three ways — aria-current for a screen reader, weight
 * for a skim, and a rule under it that survives greyscale — never by colour
 * alone.
 */
function ViewLink({ href, isCurrent, children }: { href: string; isCurrent: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={isCurrent ? "page" : undefined}
      className={cx(
        "border-b-2 pb-1",
        isCurrent ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Empty is a state with something to say, not an apology.
 *
 * Nothing here offers to relax a rule, lower a score or widen a window. A scan
 * that found nothing found nothing; the answer is to read what was ruled out
 * and why, or to run again — never to move the bar.
 */
function EmptyState({
  scan,
  view,
  anyFilterActive,
  excludedHref,
  onClearFilters,
  onRunNewScan,
  runNewScanDisabled,
}: {
  scan: Scan;
  view: LeadFilters["view"];
  anyFilterActive: boolean;
  excludedHref: string;
  onClearFilters: () => void;
  onRunNewScan: () => void;
  runNewScanDisabled?: boolean;
}) {
  if (anyFilterActive) {
    return (
      <div className="mt-5 border-t border-rule pt-4">
        <p className="text-sm">No leads in this list match these filters.</p>
        <Button color="secondary" size="sm" className="mt-3" onPress={onClearFilters}>
          Clear filters
        </Button>
      </div>
    );
  }

  if (!isFinished(scan)) {
    return (
      <div className="mt-5 border-t border-rule pt-4">
        <p className="text-sm">
          {view === "eligible"
            ? "No leads have qualified yet. The scan is still running."
            : "Nothing has been ruled out yet. The scan is still running."}
        </p>
      </div>
    );
  }

  // A stopped scan gets its own sentence, before the two that speak for a scan
  // that ran to the end. Both of those state something this scan cannot know:
  // it was cut off, so an empty list here means "not judged", never "judged and
  // found nothing". The candidates it had already formed are real; they simply
  // never reached a verdict.
  if (scan.status === "canceled") {
    return (
      <div className="mt-5 border-t border-rule pt-4">
        <p className="text-sm">
          {view === "eligible"
            ? "No leads qualified before you stopped this scan."
            : "Nothing was ruled out before you stopped this scan."}
        </p>
        <p className="mt-2 max-w-prose text-sm text-muted">
          The scan stopped before it judged everything it found, so this list is not the whole picture.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {view === "eligible" && scan.excludedCount > 0 && (
            <Link href={excludedHref} className="text-sm font-semibold text-accent hover:underline">
              See what did not qualify
            </Link>
          )}
          <Button color="secondary" size="sm" onPress={onRunNewScan} isDisabled={runNewScanDisabled}>
            Run new scan
          </Button>
        </div>
      </div>
    );
  }

  if (view === "excluded") {
    return (
      <div className="mt-5 border-t border-rule pt-4">
        <p className="text-sm">This scan ruled nothing out.</p>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-rule pt-4">
      <p className="text-sm">No leads qualified in this scan.</p>
      <p className="mt-2 max-w-prose text-sm text-muted">
        {scan.excludedCount === 0
          ? "The scan formed no leads at all, so there was nothing to judge."
          : scan.excludedCount === 1
            ? "The one lead this scan formed is in the did-not-qualify list, with the rule it failed."
            : `All ${scan.excludedCount} leads this scan formed are in the did-not-qualify list, each with the rule it failed.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {scan.excludedCount > 0 && (
          <Link href={excludedHref} className="text-sm font-semibold text-accent hover:underline">
            See what did not qualify
          </Link>
        )}
        <Button color="secondary" size="sm" onPress={onRunNewScan} isDisabled={runNewScanDisabled}>
          Run new scan
        </Button>
      </div>
    </div>
  );
}
