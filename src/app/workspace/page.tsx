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
        ) : (
          <section aria-labelledby="latest-scan">
            <h1 id="latest-scan" className="font-editorial text-3xl">Latest scan</h1>
            <ScanProgress
              scan={scans.page[0]}
              onCancel={() => {
                cancelScan({ scanId: scans.page[0]._id })
                  .catch((err: unknown) => setStartError(err instanceof Error ? err.message : "Could not cancel scan"));
              }}
              onRunNewScan={handleStart}
              runNewScanDisabled={starting}
            />
            <LeadFeed scan={scans.page[0]} onRunNewScan={handleStart} runNewScanDisabled={starting} />
          </section>
        )}
      </main>
    </>
  );
}
