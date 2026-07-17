"use client";

import { HeartIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { useWatchlist } from "@/lib/watchlist-context";
import { useToast } from "@/lib/toast-context";
import type { Part } from "@/lib/types";

export function WatchlistButton({
  part,
  compact = false,
  className,
}: {
  part: Part;
  compact?: boolean;
  className?: string;
}) {
  const { isWatched, toggle, ready } = useWatchlist();
  const { push } = useToast();
  const watched = ready && isWatched(part.id);

  return (
    <button
      type="button"
      aria-pressed={watched}
      aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const added = toggle(part);
        push({
          title: added ? "Added to watchlist" : "Removed from watchlist",
          description: added ? "We will keep this listing easy to find." : undefined,
          tone: added ? "success" : "info",
        });
      }}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 border text-sm font-semibold transition-colors",
        compact ? "h-10 w-10 border-stone-300 bg-white" : "px-4 py-2.5",
        watched
          ? "border-orange-300 bg-orange-50 text-orange-800"
          : "border-stone-300 bg-white text-slate-700 hover:border-slate-500 hover:text-slate-950",
        className,
      )}
    >
      <HeartIcon className={cn("h-[18px] w-[18px]", watched && "fill-current")} />
      {!compact && (watched ? "Watching" : "Add to watchlist")}
    </button>
  );
}
