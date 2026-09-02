import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowSquareOut, CaretDown, Sparkle } from "@phosphor-icons/react";
import { useState } from "react";

import { Spinner } from "@anlg/ui/components/ui/spinner";
import { cn } from "@anlg/utils";

import {
  type PastSessionNote,
  usePastSessionNotes,
} from "~/session/insights/past-notes";
import { preloadSession } from "~/session/queries/sessions";
import { StyledStreamdown } from "~/settings/ai/shared";
import { useTabs } from "~/store/zustand/tabs";

/**
 * What the same people last talked about, readable while this meeting is
 * still running. The brief compresses it into three lines before the meeting;
 * this is the uncut version for when a question comes up mid-call.
 */
export function History({ sessionId }: { sessionId: string }) {
  const { notes, canGenerate, regenerate } = usePastSessionNotes(sessionId);

  if (notes.length === 0) {
    return (
      <div className="text-muted-foreground px-1 py-8 text-center text-sm">
        <Trans>No related meetings yet.</Trans>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-6">
      {notes.map((note) => (
        <HistoryEntry
          key={note.sessionId}
          note={note}
          canGenerate={canGenerate}
          onRegenerate={() => regenerate(note.sessionId)}
        />
      ))}
    </div>
  );
}

function HistoryEntry({
  note,
  canGenerate,
  onRegenerate,
}: {
  note: PastSessionNote;
  canGenerate: boolean;
  onRegenerate: () => void;
}) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const openCurrent = useTabs((state) => state.openCurrent);
  const relationshipLabels = {
    same_series: t`Same series`,
    matching_title: t`Same title`,
    shared_participants: t`Shared participants`,
  };
  const facts = note.summary
    ? note.summary
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean)
    : [];

  const open = async () => {
    try {
      await preloadSession(note.sessionId);
    } catch (error) {
      console.error("[history] failed to preload session", error);
    }
    openCurrent({ id: note.sessionId, type: "sessions" });
  };

  return (
    <div className="border-border bg-card rounded-xl border">
      <div className="flex items-start gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground flex items-center gap-2 text-[11px] font-medium tracking-[0.04em] uppercase">
            <span className="font-variant-numeric tabular-nums">
              {note.dateLabel}
            </span>
            <span className="bg-accent text-accent-foreground rounded-full px-1.5 py-px tracking-normal normal-case">
              {relationshipLabels[note.relationship]}
            </span>
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold">
            {note.title}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void open()}
          aria-label={t`Open meeting`}
          title={t`Open meeting`}
          className="text-muted-foreground hover:text-foreground rounded-md p-1"
        >
          <ArrowSquareOut className="size-4" />
        </button>
      </div>

      <div className="px-4 pb-3">
        {note.isGenerating ? (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Spinner size={12} />
            <Trans>Reading…</Trans>
          </div>
        ) : facts.length > 0 ? (
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-sm">
            {facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        ) : canGenerate ? (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={note.isRegenerateDisabled}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs disabled:opacity-50"
          >
            <Sparkle className="size-3.5" />
            <Trans>Extract key facts</Trans>
          </button>
        ) : null}

        {note.sourceSummary ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 text-xs"
            >
              <CaretDown
                className={cn([
                  "size-3 transition-transform",
                  expanded && "rotate-180",
                ])}
              />
              {expanded ? (
                <Trans>Hide summary</Trans>
              ) : (
                <Trans>Show summary</Trans>
              )}
            </button>
            {expanded && (
              <div className="note-typography mt-1">
                <StyledStreamdown>{note.sourceSummary}</StyledStreamdown>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
