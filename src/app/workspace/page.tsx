"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "../../../convex/_generated/api";
import { AppHeader } from "@/components/shell/app-header";
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
  const scans = useQuery(api.scans.list, me ? {} : "skip");
  const start = useMutation(api.scans.startScan);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {scans === undefined ? (
          <p className="text-muted">Loading workspace…</p>
        ) : scans.length === 0 ? (
          <FirstRunState onRunFirstScan={() => void start({})} />
        ) : (
          <section aria-labelledby="latest-scan">
            <h1 id="latest-scan" className="font-editorial text-3xl">Latest scan</h1>
            <p className="mt-2 text-muted">Status: {scans[0].status}. Searches reserved: {scans[0].searchesReserved} / {scans[0].searchBudgetLimit}.</p>
            {/* ponytail: full summary + Run new scan arrive with the feed plan (items 8–9) */}
          </section>
        )}
      </main>
    </>
  );
}
