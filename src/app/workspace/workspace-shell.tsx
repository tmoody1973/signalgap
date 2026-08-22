"use client";

import { Button } from "@/components/ui/untitled/button";
import { LabelLegend } from "@/components/ui/editorial/label-legend";
import { BEAT_TEXT } from "@/lib/source-labels";

export function FirstRunState({ onRunFirstScan, disabled }: { onRunFirstScan: () => void; disabled?: boolean }) {
  return (
    <section aria-labelledby="first-run-heading" className="flex flex-col gap-6">
      <div>
        <h1 id="first-run-heading" className="font-editorial text-3xl">No scans yet</h1>
        <p className="mt-2 max-w-prose text-muted">
          SignalGap searches the public web for the City of Milwaukee across three beats, then checks which developments already have local coverage.
        </p>
      </div>
      <dl className="grid gap-4 border-y border-rule py-4 sm:grid-cols-3 text-sm">
        <div><dt className="text-muted">Geography</dt><dd>City of Milwaukee</dd></div>
        <div>
          <dt className="text-muted">Beats</dt>
          <dd><ul>{Object.values(BEAT_TEXT).map((b) => <li key={b}>{b}</li>)}</ul></dd>
        </div>
        <div><dt className="text-muted">Windows</dt><dd>7-day discovery, 30-day coverage check</dd></div>
      </dl>
      <p className="text-sm text-muted">
        Community discussion is not public opinion. AI output is not source evidence. Nothing is configured; the Milwaukee scan is fixed.
      </p>
      <Button color="primary" size="md" onPress={onRunFirstScan} isDisabled={disabled}>Run first scan</Button>
      <LabelLegend />
    </section>
  );
}
