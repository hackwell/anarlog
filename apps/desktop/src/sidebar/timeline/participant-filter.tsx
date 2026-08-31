import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";

import { cn } from "@anlg/utils";

import type { FrequentParticipant } from "~/contacts/queries";
import type { TagRecord } from "~/tags/queries";

const COLLAPSED = 3;

type Entry = { id: string; label: string; count: number; isTag: boolean };

/**
 * Two ways into the archive, side by side. People cost nothing to maintain -
 * they arrive with the calendar invite - while tags are what you decided a
 * recording was about.
 */
export function ParticipantFilter({
  onSelectHuman,
  onSelectTag,
  participants,
  query,
  selectedHumanId,
  selectedTagId,
  tags,
}: {
  onSelectHuman: (humanId: string | null) => void;
  onSelectTag: (tagId: string | null) => void;
  participants: FrequentParticipant[];
  query: string;
  selectedHumanId: string | null;
  selectedTagId: string | null;
  tags: TagRecord[];
}) {
  const [expanded, setExpanded] = useState(false);
  const needle = query.trim().toLowerCase();

  // Typing is already how you say who you mean, so the row answers the search
  // rather than sitting beside it. Collapsing again would hide the filter you
  // just found, so a search always shows everything it matched.
  useEffect(() => {
    if (needle) setExpanded(false);
  }, [needle]);

  const all: Entry[] = [
    ...participants.map((entry) => ({
      id: entry.humanId,
      label: entry.name,
      count: entry.sessionCount,
      isTag: false,
    })),
    ...tags
      .filter((tag) => tag.sessionCount > 0)
      .map((tag) => ({
        id: tag.id,
        label: tag.name,
        count: tag.sessionCount,
        isTag: true,
      })),
  ];

  const matching = needle
    ? all.filter((entry) => entry.label.toLowerCase().includes(needle))
    : all;

  const selectedId = selectedTagId ?? selectedHumanId;
  const shown =
    needle || expanded ? matching : withSelected(matching, selectedId);
  const hidden = matching.length - shown.length;

  if (shown.length === 0) {
    return null;
  }

  const toggle = (entry: Entry) => {
    if (entry.isTag) {
      onSelectTag(entry.id === selectedTagId ? null : entry.id);
    } else {
      onSelectHuman(entry.id === selectedHumanId ? null : entry.id);
    }
  };

  return (
    <div
      data-sidebar-participant-filter
      className="flex shrink-0 flex-wrap gap-1 px-2 pb-2"
    >
      {shown.map((entry) => (
        <Chip
          key={`${entry.isTag ? "tag" : "human"}-${entry.id}`}
          active={entry.id === selectedId}
          count={entry.count}
          isTag={entry.isTag}
          label={entry.isTag ? entry.label : firstName(entry.label)}
          onClick={() => toggle(entry)}
        />
      ))}

      {hidden > 0 && (
        <button
          type="button"
          data-sidebar-filter-more
          onClick={() => setExpanded(true)}
          className={cn([
            "text-muted-foreground hover:text-sidebar-foreground rounded-full px-2 py-1 text-[11px]",
            "focus-visible:ring-sidebar-ring/40 focus-visible:ring-2 focus-visible:outline-none",
          ])}
        >
          +{hidden}
        </button>
      )}

      {expanded && !needle && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-muted-foreground hover:text-sidebar-foreground rounded-full px-2 py-1 text-[11px]"
        >
          <Trans>Less</Trans>
        </button>
      )}
    </div>
  );
}

/**
 * The chip you are filtering by has to stay on screen even when it ranks below
 * the cut, or the filter you are inside disappears from its own row.
 */
function withSelected(entries: Entry[], selectedId: string | null): Entry[] {
  const head = entries.slice(0, COLLAPSED);
  const selected = entries.find((entry) => entry.id === selectedId);
  return selected && !head.includes(selected)
    ? [selected, ...head.slice(0, COLLAPSED - 1)]
    : head;
}

// A rail this narrow cannot spend its width on surnames.
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function Chip({
  active,
  count,
  isTag,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  isTag: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn([
        "max-w-[10rem] truncate rounded-full px-2.5 py-1 text-[11.5px]",
        "focus-visible:ring-sidebar-ring/40 focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-sidebar-selected text-sidebar-selected-foreground font-medium"
          : "bg-sidebar-accent text-sidebar-foreground hover:brightness-95",
      ])}
    >
      {isTag && <span className="mr-0.5 opacity-50">#</span>}
      {label}
      <span
        className={cn([
          "ml-1 tabular-nums",
          active ? "opacity-80" : "opacity-60",
        ])}
      >
        {count}
      </span>
    </button>
  );
}
