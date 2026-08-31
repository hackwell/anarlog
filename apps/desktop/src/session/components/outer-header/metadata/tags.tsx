import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, X } from "@phosphor-icons/react";
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
import { suggestTags, type TagSuggestion } from "~/tags/suggest";

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
  const model = useLanguageModel();
  const transcript = useSessionTranscriptText(sessionId);
  const [suggestion, setSuggestion] = useState<TagSuggestion | null>(null);
  const [thinking, setThinking] = useState(false);

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
    // A suggestion that has been taken should not keep offering itself.
    setSuggestion((current) =>
      current
        ? {
            chosen: current.chosen.filter((entry) => entry !== name),
            proposed: current.proposed.filter((entry) => entry !== name),
          }
        : current,
    );
  };

  const ask = async () => {
    if (!model) return;
    setThinking(true);
    try {
      setSuggestion(
        await suggestTags({
          model,
          title: "",
          transcript,
          vocabulary: all.map((tag) => tag.name),
        }),
      );
    } catch (error) {
      console.error("[tags] suggestion failed", error);
      setSuggestion({ chosen: [], proposed: [] });
    } finally {
      setThinking(false);
    }
  };

  const offered = suggestion
    ? [
        ...suggestion.chosen
          .filter((name) => !assigned.some((tag) => tag.name === name))
          .map((name) => ({ name, isNew: false })),
        ...suggestion.proposed.map((name) => ({ name, isNew: true })),
      ]
    : [];

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

      {/* Suggested, never applied: a wrong tag is invisible until months later,
          when the recording cannot be found. Dismissing one costs a second. */}
      {transcript.length > 200 && !adding && (
        <div className="flex flex-wrap items-center gap-1.5">
          {offered.map((entry) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => void commit(entry.name)}
              className={cn([
                "rounded-full border border-dashed px-2.5 py-1 text-xs",
                "hover:border-solid",
                entry.isNew
                  ? "border-primary/50 text-primary"
                  : "border-muted-foreground/40 text-muted-foreground",
              ])}
            >
              {entry.isNew && <span className="mr-1 opacity-60">+</span>}
              {entry.name}
            </button>
          ))}
          {suggestion === null && (
            <button
              type="button"
              disabled={thinking || !model}
              onClick={() => void ask()}
              className="text-muted-foreground hover:text-foreground rounded-full px-2 py-1 text-xs disabled:opacity-50"
            >
              {thinking ? <Trans>Reading…</Trans> : <Trans>Suggest tags</Trans>}
            </button>
          )}
          {suggestion !== null && offered.length === 0 && (
            <span className="text-muted-foreground text-xs">
              <Trans>Nothing to suggest</Trans>
            </span>
          )}
        </div>
      )}

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
