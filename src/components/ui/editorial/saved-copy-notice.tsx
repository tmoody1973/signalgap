import { StatusLabel } from "@/components/ui/editorial/status-label";
import { captureTimeText } from "@/lib/saved-copy";
import { LABEL_EXPLANATIONS, PRODUCT_LABELS } from "@/lib/source-labels";
import { cx } from "@/lib/utils/cx";

/**
 * "You are looking at saved data, and here is how old it is."
 *
 * Every part of that survives greyscale and a screen reader, because every part
 * of it is words: the `Saved copy` label reads as text inside a rule, and the
 * sentence beside it names the capture moment and says plainly that it may not
 * be current. Nothing here depends on noticing a colour.
 *
 * One component rather than two so the workspace and the evidence page cannot
 * drift into telling an editor two different things about the same scan.
 */
export function SavedCopyNotice({ captureTimestamp, className }: { captureTimestamp: number; className?: string }) {
  return (
    <p className={cx("flex flex-wrap items-baseline gap-2 text-sm text-muted", className)}>
      <StatusLabel label={PRODUCT_LABELS.savedNotLive} />
      <span>
        Captured {captureTimeText(captureTimestamp)}. {LABEL_EXPLANATIONS[PRODUCT_LABELS.savedNotLive]}
      </span>
    </p>
  );
}
