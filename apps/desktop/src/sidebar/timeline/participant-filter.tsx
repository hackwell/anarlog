import { cn } from "@anlg/utils";

import type { FrequentParticipant } from "~/contacts/queries";
import type { TagRecord } from "~/tags/queries";

const VISIBLE_PEOPLE = 3;
const VISIBLE_TAGS = 3;

/**
 * Two ways into the archive, side by side. People cost nothing to maintain -
 * they arrive with the calendar invite - while tags are what you decided a
 * recording was about. A tag is marked so the two never read as one list.
 */
export function ParticipantFilter({
  onSelectHuman,
  onSelectTag,
  participants,
  selectedHumanId,
  selectedTagId,
  tags,
}: {
  onSelectHuman: (humanId: string | null) => void;
  onSelectTag: (tagId: string | null) => void;
  participants: FrequentParticipant[];
  selectedHumanId: string | null;
  selectedTagId: string | null;
  tags: TagRecord[];
}) {
  const people = keepSelectedVisible(
    participants,
    selectedHumanId,
    VISIBLE_PEOPLE,
    (entry) => entry.humanId,
  );
  // A tag with nothing on it is a leftover, not a filter.
  const usable = tags.filter((tag) => tag.sessionCount > 0);
  const shownTags = keepSelectedVisible(
    usable,
    selectedTagId,
    VISIBLE_TAGS,
    (entry) => entry.id,
  );

  if (people.shown.length === 0 && shownTags.shown.length === 0) {
    return null;
  }

  return (
    <div
      data-sidebar-participant-filter
      className="flex shrink-0 flex-wrap gap-1 px-2 pb-2"
    >
      {people.shown.map((participant) => (
        <Chip
          key={participant.humanId}
          active={participant.humanId === selectedHumanId}
          count={participant.sessionCount}
          label={firstName(participant.name) || participant.humanId.slice(0, 6)}
          onClick={() =>
            onSelectHuman(
              participant.humanId === selectedHumanId
                ? null
                : participant.humanId,
            )
          }
        />
      ))}
      {people.hidden > 0 && <More count={people.hidden} />}

      {shownTags.shown.map((tag) => (
        <Chip
          key={tag.id}
          active={tag.id === selectedTagId}
          count={tag.sessionCount}
          isTag
          label={tag.name}
          onClick={() => onSelectTag(tag.id === selectedTagId ? null : tag.id)}
        />
      ))}
      {shownTags.hidden > 0 && <More count={shownTags.hidden} />}
    </div>
  );
}

/**
 * The chip you are filtering by has to stay on screen even when it ranks below
 * the cut, or the filter you are inside disappears from its own row.
 */
function keepSelectedVisible<T>(
  entries: T[],
  selectedId: string | null,
  limit: number,
  idOf: (entry: T) => string,
): { shown: T[]; hidden: number } {
  const head = entries.slice(0, limit);
  const selected = entries.find((entry) => idOf(entry) === selectedId);
  const shown =
    selected && !head.includes(selected)
      ? [selected, ...head.slice(0, limit - 1)]
      : head;
  return { shown, hidden: Math.max(0, entries.length - shown.length) };
}

// A rail this narrow cannot spend its width on surnames.
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function More({ count }: { count: number }) {
  return (
    <span className="text-muted-foreground self-center px-1 text-[11px]">
      +{count}
    </span>
  );
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
  isTag?: boolean;
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
