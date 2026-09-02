import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, Sparkle, X } from "@phosphor-icons/react";
import { useState } from "react";

import { cn } from "@anlg/utils";

import { useLanguageModel } from "~/ai/hooks";
import {
  assignTag,
  unassignTag,
  useSessionTranscriptText,
  useTags,
  useTagsForSession,
} from "~/tags/queries";
import { useTagSuggestions } from "~/tags/suggestion-store";

/**
 * Tagging belongs where the recording is, not in the rail: you decide what a
 * meeting was about while looking at it. The rail only filters by what was
 * decided here.
 */
export function TagRow({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const assigned = useTagsForSession(sessionId);
  const all = useTags();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const model = useLanguageModel();
  const transcript = useSessionTranscriptText(sessionId);
  const suggestion = useTagSuggestions((state) => state.bySession[sessionId]);
  const request = useTagSuggestions((state) => state.request);
  const dismiss = useTagSuggestions((state) => state.dismiss);

  const assignedIds = new Set(assigned.map((tag) => tag.id));
  const trimmed = draft.trim();
  // Suggest what already exists before a near-duplicate gets created: "Kunde"
  // and "Kunden" as separate chips would split the same recordings in two.
  const completions = all
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
    dismiss(sessionId, name);
  };

  const thinking = suggestion === "thinking";
  const offered =
    suggestion && suggestion !== "thinking"
      ? [
          ...suggestion.chosen
            .filter((name) => !assigned.some((tag) => tag.name === name))
            .map((name) => ({ name, isNew: false })),
          ...suggestion.proposed.map((name) => ({ name, isNew: true })),
        ]
      : [];
  const canAsk = !!model && transcript.length > 200 && !thinking;

  return (
    <div
      data-session-tags
      className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden pr-1 whitespace-nowrap"
    >
      {assigned.map((tag) => (
        <span
          key={tag.id}
          className="bg-accent text-accent-foreground flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs"
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

      {/* Suggested, never applied: a wrong tag is invisible until months later,
          when the recording cannot be found. Dismissing one costs a second. */}
      {!adding &&
        offered.map((entry) => (
          <span
            key={entry.name}
            className={cn([
              "flex items-center gap-0.5 rounded-full border border-dashed py-0.5 pr-1 pl-2.5 text-xs",
              entry.isNew
                ? "border-primary/50 text-primary"
                : "border-muted-foreground/40 text-muted-foreground",
            ])}
          >
            <button
              type="button"
              onClick={() => void commit(entry.name)}
              className="flex items-center gap-1 hover:underline"
            >
              <Sparkle className="size-3 opacity-70" />
              {entry.name}
            </button>
            <button
              type="button"
              aria-label={t`Dismiss suggestion ${entry.name}`}
              onClick={() => dismiss(sessionId, entry.name)}
              className="hover:bg-background/60 rounded-full p-0.5"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

      {adding ? (
        <>
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
              "bg-accent w-28 rounded-full px-2.5 py-0.5 text-xs",
              "focus-visible:ring-ring/40 focus-visible:ring-2 focus-visible:outline-none",
            ])}
          />
          {completions.map((tag) => (
            <button
              key={tag.id}
              type="button"
              // Chosen before blur can cancel the input.
              onMouseDown={(event) => {
                event.preventDefault();
                void commit(tag.name);
              }}
              className="bg-muted text-muted-foreground hover:text-foreground rounded-full px-2.5 py-0.5 text-xs"
            >
              {tag.name}
            </button>
          ))}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          >
            <Plus className="size-3" />
            <Trans>Tag</Trans>
          </button>
          {thinking ? (
            <span className="text-muted-foreground text-xs">
              <Trans>Reading…</Trans>
            </span>
          ) : (
            canAsk &&
            offered.length === 0 && (
              <button
                type="button"
                aria-label={t`Suggest tags`}
                title={t`Suggest tags`}
                onClick={() => void request(sessionId, model!, { force: true })}
                className="text-muted-foreground hover:text-foreground rounded-full p-1"
              >
                <Sparkle className="size-3.5" />
              </button>
            )
          )}
        </>
      )}
    </div>
  );
}
