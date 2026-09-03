import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { ThemeToggle } from "@/components/ui/editorial/theme-toggle";
import { routes } from "@/lib/routes";

export function AppHeader() {
  return (
    <header className="border-b border-rule">
      <nav aria-label="Workspace" className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
        <div className="flex items-center gap-4">
          <Link href={routes.workspace()} className="font-editorial text-lg">SignalGap</Link>
          <span className="text-xs text-muted">Milwaukee workspace</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <UserButton />
        </div>
      </nav>
    </header>
  );
}
