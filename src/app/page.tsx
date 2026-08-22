import Link from "next/link";
import { LabelLegend } from "@/components/ui/editorial/label-legend";
import { ThemeToggle } from "@/components/ui/editorial/theme-toggle";
import { routes } from "@/lib/routes";
import { BEAT_TEXT } from "@/lib/source-labels";

const SCOPE_LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-editorial text-4xl leading-tight">SignalGap</h1>
          <p className="mt-2 max-w-prose text-lg text-muted">
            Finds Milwaukee developments that appear across several public web signals but have limited verified local coverage, then drafts a source-linked reporting brief for a human editor.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section aria-labelledby="scope-heading" className="grid gap-4 border-y border-rule py-6 sm:grid-cols-3">
        <div>
          <h2 id="scope-heading" className={SCOPE_LABEL_CLASS}>Coverage area</h2>
          <p className="mt-1">City of Milwaukee</p>
        </div>
        <div>
          <h2 className={SCOPE_LABEL_CLASS}>Beats</h2>
          <ul className="mt-1 space-y-1">
            {Object.values(BEAT_TEXT).map((beat) => <li key={beat}>{beat}</li>)}
          </ul>
        </div>
        <div>
          <h2 className={SCOPE_LABEL_CLASS}>Evidence standard</h2>
          <p className="mt-1 text-sm">Two independent signal categories. No more than two original local reports in 30 days. Every confirmed fact has a working citation.</p>
        </div>
      </section>

      <p className="text-sm text-muted">
        Community discussion is not representative public opinion. AI output is never treated as source evidence. SignalGap proposes; the editor decides.
      </p>

      <Link href={routes.signIn()} className="inline-flex w-fit rounded-sm bg-accent px-4 py-2 font-medium text-accent-fg">
        Sign in to the Milwaukee workspace
      </Link>

      <LabelLegend />
    </main>
  );
}
