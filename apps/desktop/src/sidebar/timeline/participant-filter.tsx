import { Trans } from "@lingui/react/macro";

import { cn } from "@anlg/utils";

import type { FrequentParticipant } from "~/contacts/queries";

const VISIBLE_CHIPS = 3;

/**
 * The rail's one filter that nobody has to maintain: participants arrive with
 * the calendar invite, so the people you meet most are already ranked without
 * anyone tagging anything.
 */
export function ParticipantFilter({
  onSelect,
  participants,
  selectedHumanId,
}: {
  onSelect: (humanId: string | null) => void;
  participants: FrequentParticipant[];
  selectedHumanId: string | null;
}) {
  if (participants.length === 0) {
    return null;
  }

  // The selected person always stays visible, even when they sit outside the
  // first few - otherwise the filter you are in disappears from its own row.
  const selected = participants.find(
    (participant) => participant.humanId === selectedHumanId,
  );
  const head = participants.slice(0, VISIBLE_CHIPS);
  const shown =
    selected && !head.includes(selected) ? [selected, ...head.slice(1)] : head;
  const hidden = participants.length - shown.length;

  return (
    <div
      data-sidebar-participant-filter
      className="flex shrink-0 flex-wrap gap-1 px-2 pb-2"
    >
      {shown.map((participant) => (
        <Chip
          key={participant.humanId}
          active={participant.humanId === selectedHumanId}
          count={participant.sessionCount}
          label={participant.name || firstNameFallback(participant)}
          onClick={() =>
            onSelect(
              participant.humanId === selectedHumanId
                ? null
                : participant.humanId,
            )
          }
        />
      ))}
      {hidden > 0 && (
        <span className="text-muted-foreground self-center px-1 text-[11px]">
          +{hidden}
        </span>
      )}
    </div>
  );
}

// A contact can exist without a name when only an address came through.
function firstNameFallback(participant: FrequentParticipant): string {
  return participant.humanId.slice(0, 6);
}

function Chip({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
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
      {/* Only the first name: a rail this narrow cannot spend its width on
          surnames, and the count already disambiguates in practice. */}
      {label.split(" ")[0]}
      <span
        className={cn([
          "ml-1 tabular-nums",
          active ? "opacity-80" : "opacity-60",
        ])}
      >
        {count}
      </span>
      <span className="sr-only">
        <Trans>meetings</Trans>
      </span>
    </button>
  );
}
