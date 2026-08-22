"use client";

import { AppHeader } from "@/components/shell/app-header";
import { FirstRunState } from "./workspace-shell";

export default function WorkspacePage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <FirstRunState onRunFirstScan={() => {}} disabled />
      </main>
    </>
  );
}
