"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-detection idiom for next-themes SSR-safe hydration
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const next = resolvedTheme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="rounded-sm border border-rule px-2 py-1 text-sm text-muted hover:text-ink"
      aria-label={`Switch to ${next} mode`}
    >
      {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
