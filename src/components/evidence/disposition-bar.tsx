"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/untitled/button";
import type { EvidenceView } from "@/lib/evidence-view";

type Disposition = EvidenceView["candidate"]["disposition"];

const ACTIONS: { disposition: Disposition; label: string }[] = [
  { disposition: "assigned", label: "Assign" },
  { disposition: "monitoring", label: "Monitor" },
  { disposition: "rejected", label: "Reject" },
];

/**
 * What an editor DOES with a lead. Three decisions and a note, directly under
 * the headline, because a page with nothing to press is a report, not a desk.
 *
 * The current decision is the pressed button (`aria-pressed`), which is a
 * state a screen reader announces and a keyboard user can find. The header's
 * disposition word updates through the live query, so nothing here mirrors it.
 */
export function DispositionBar({ candidate }: { candidate: EvidenceView["candidate"] }) {
  const set = useMutation(api.candidates.disposition.set);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (disposition: Disposition, withNote: string) => {
    setBusy(true); setError(null); setStatus(null);
    try {
      await set({ candidateId: candidate.id, disposition, ...(withNote ? { note: withNote } : {}) });
      if (withNote) { setNote(""); setStatus("Note saved"); }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="disposition-heading" className="border-t border-rule pt-4">
      <h2 id="disposition-heading" className="text-xs font-medium uppercase tracking-wide text-muted">Your decision</h2>

      <div className="mt-2 flex flex-wrap gap-2">
        {ACTIONS.map(({ disposition, label }) => {
          const current = candidate.disposition === disposition;
          return (
            <Button
              key={disposition}
              color={current ? "primary" : "secondary"}
              size="sm"
              aria-pressed={current}
              isDisabled={busy || current}
              onPress={() => void run(disposition, "")}
            >
              {label}
            </Button>
          );
        })}
        {candidate.disposition !== "new" && (
          <Button color="secondary" size="sm" isDisabled={busy} onPress={() => void run("new", "")}>
            Back to new
          </Button>
        )}
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted">Note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
          className="scheme-light dark:scheme-dark w-full rounded-md border border-rule bg-raised px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button color="secondary" size="sm" isDisabled={busy || note.trim() === ""} onPress={() => void run(candidate.disposition, note.trim())}>
          Save note
        </Button>
        {status && <span role="status" className="text-sm text-muted">{status}</span>}
        {error && <span role="alert" className="text-sm text-[var(--status-conflict)]">{error}</span>}
      </div>
    </section>
  );
}
