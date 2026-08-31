import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, X } from "@phosphor-icons/react";
import { useState } from "react";

import { cn } from "@anlg/utils";

import {
  assignTag,
  unassignTag,
  useTags,
  useTagsForSession,
} from "~/tags/queries";

/**
 * Tagging belongs where the recording is, not in the rail: you decide what a
 * meeting was about while looking at it. The rail only filters by what was
 * decided here.
 */
export function TagEditor({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const assigned = useTagsForSession(sessionId);
  const all = useTags();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const assignedIds = new Set(assigned.map((tag) => tag.id));
  const trimmed = draft.trim();
  // Suggest what already exists before a near-duplicate gets created: "Kunde"
  // and "Kunden" as separate chips would split the same recordings in two.
  const suggestions = all
    .filter(
      (tag) =>
        !assignedIds.has(tag.id) &&
        (trimmed === "" ||
          tag.name.toLowerCase().includes(trimmed.toLowerCase())),
    )
    .slice(0, 5);

  const commit = async (name: string) => {
    const value = name.trim();
    if (!value) return;
    await assignTag(sessionId, value);
    setDraft("");
    setAdding(false);
  };

  return (
    <div data-session-tags className="flex flex-col gap-2">
      <div className="text-muted-foreground text-xs font-medium">
        <Trans>Tags</Trans>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {assigned.map((tag) => (
          <span
            key={tag.id}
            className="bg-accent text-accent-foreground flex items-center gap-1 rounded-full py-1 pr-1 pl-2.5 text-xs"
          >
            {tag.name}
            <button
              type="button"
              aria-label={t`Remove tag ${tag.name}`}
              onClick={() => void unassignTag(sessionId, tag.id)}
              className="hover:bg-background/60 rounded-full p-0.5"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

        {adding ? (
          <input
            autoFocus
            value={draft}
            placeholder={t`Tag name`}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              setDraft("");
              setAdding(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commit(draft);
              if (event.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            className={cn([
              "bg-accent w-28 rounded-full px-2.5 py-1 text-xs",
              "focus-visible:ring-ring/40 focus-visible:ring-2 focus-visible:outline-none",
            ])}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-full px-2 py-1 text-xs"
          >
            <Plus className="size-3" />
            <Trans>Add tag</Trans>
          </button>
        )}
      </div>

      {adding && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((tag) => (
            <button
              key={tag.id}
              type="button"
              // Chosen before blur can cancel the input.
              onMouseDown={(event) => {
                event.preventDefault();
                void commit(tag.name);
              }}
              className="bg-muted text-muted-foreground hover:text-foreground rounded-full px-2.5 py-1 text-xs"
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
