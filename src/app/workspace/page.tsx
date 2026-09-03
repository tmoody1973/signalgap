"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { AppHeader } from "@/components/shell/app-header";
import { LeadFeed } from "@/components/feed/lead-feed";
import { ScanProgress } from "@/components/scan/scan-progress";
import { FirstRunState } from "./workspace-shell";

export default function WorkspacePage() {
  const { isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.users.ensureCurrent);
  const me = useQuery(api.users.me);
  // ponytail: gate on isAuthenticated — Convex hasn't attached the Clerk token
  // on first mount, so an ungated call throws "Unauthenticated" once and never
  // retries, permanently starving `me`/`scans`.
  useEffect(() => {
    if (isAuthenticated) void ensure({});
  }, [isAuthenticated, ensure]);
  const scans = useQuery(api.scans.list, me ? { paginationOpts: { numItems: 25, cursor: null } } : "skip");
  const start = useMutation(api.scans.startScan);
  const cancelScan = useMutation(api.scans.cancel);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Item 10's saved fallback. `viewingSavedDemo` starts false and is only ever
  // set by the editor pressing `Open saved demo scan` — nothing here ever
  // reaches for saved data on its own. Whatever ends up on screen carries its
  // own `Saved copy` notice, so the two can never disagree about what is live.
  const savedDemo = useQuery(api.scans.savedDemo, me ? {} : "skip");
  const [viewingSavedDemo, setViewingSavedDemo] = useState(false);

  const handleStart = () => {
    setStarting(true);
    setStartError(null);
    start({})
      .catch((err: unknown) => setStartError(err instanceof Error ? err.message : "Could not start scan"))
      .finally(() => setStarting(false));
  };

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {startError && (
          <p role="alert" className="mb-4 text-sm text-[var(--status-conflict)]">{startError}</p>
        )}
        {scans === undefined ? (
          <p className="text-muted">Loading workspace…</p>
        ) : scans.page.length === 0 ? (
          <FirstRunState onRunFirstScan={handleStart} disabled={starting} />
        ) : (() => {
          const latest = scans.page[0];
          const shown = viewingSavedDemo && savedDemo ? savedDemo : latest;
          const isShowingSaved = shown._id === savedDemo?._id;
          return (
            <section aria-labelledby="latest-scan">
              <h1 id="latest-scan" className="font-editorial text-3xl">
                {isShowingSaved ? "Saved scan" : "Latest scan"}
              </h1>
              <ScanProgress
                scan={shown}
                onCancel={() => {
                  cancelScan({ scanId: shown._id })
                    .catch((err: unknown) => setStartError(err instanceof Error ? err.message : "Could not cancel scan"));
                }}
                onRunNewScan={handleStart}
                runNewScanDisabled={starting}
                // Offered only when there is a saved scan that is not already
                // what the editor is looking at.
                onOpenSavedDemo={savedDemo && !isShowingSaved ? () => setViewingSavedDemo(true) : undefined}
                onShowLatestScan={isShowingSaved && latest._id !== savedDemo?._id ? () => setViewingSavedDemo(false) : undefined}
              />
              <LeadFeed scan={shown} onRunNewScan={handleStart} runNewScanDisabled={starting} />
            </section>
          );
        })()}
      </main>
    </>
  );
}
