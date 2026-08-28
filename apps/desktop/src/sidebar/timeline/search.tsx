import { useLingui } from "@lingui/react/macro";
import { MagnifyingGlass, X } from "@phosphor-icons/react";

import { cn } from "@anlg/utils";

import type { TimelineBucket } from "./utils";

export function filterTimelineBuckets(
  buckets: TimelineBucket[],
  query: string,
): TimelineBucket[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return buckets;
  }

  const filtered: TimelineBucket[] = [];
  for (const bucket of buckets) {
    const items = bucket.items.filter((item) =>
      (item.data.title ?? "").toLowerCase().includes(needle),
    );

    if (items.length > 0) {
      filtered.push({ ...bucket, items });
    }
  }

  return filtered;
}

export function TimelineSearchField({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  const { t } = useLingui();

  return (
    <div
      data-sidebar-timeline-search
      className={cn([
        "border-border bg-accent/50 flex h-8 w-full shrink-0 items-center gap-2 rounded-lg border px-3",
        "focus-within:bg-accent transition-colors",
      ])}
    >
      <MagnifyingGlass
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
      <input
        type="text"
        aria-label={t`Search notes and meetings`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onChange("");
          }
        }}
        placeholder={t`Search notes and meetings...`}
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm placeholder:text-sm focus:outline-hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className={cn([
            "size-4 shrink-0",
            "text-muted-foreground hover:text-foreground",
            "transition-colors",
          ])}
          aria-label={t`Clear search`}
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
