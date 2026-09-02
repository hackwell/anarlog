import { useLingui } from "@lingui/react/macro";
import { Check, Copy } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@anlg/ui/components/ui/button";

import {
  getStoredNoteMarkdown,
  copyTextToClipboard,
} from "~/session/components/note-input/header-shared";
import {
  buildTranscriptExportSegments,
  formatTranscriptExportSegments,
} from "~/session/components/note-input/transcript/export-data";
import { useSessionTranscriptRenderData } from "~/session/components/note-input/transcript/render-request-hooks";
import { useEnhancedNote, useSession } from "~/session/queries";
import type { EditorView } from "~/store/zustand/tabs/schema";

/**
 * One click copies whatever tab is open. The per-tab context menus keep their
 * Copy entries, but a right-click is not where anyone looks for "copy this".
 */
export function CopyViewButton({
  sessionId,
  currentView,
}: {
  sessionId: string;
  currentView: EditorView;
}) {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  const session = useSession(sessionId);
  const enhancedNote = useEnhancedNote(
    currentView.type === "enhanced" ? currentView.id : "",
  );
  const { request: transcriptRequest } =
    useSessionTranscriptRenderData(sessionId);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const resolveText = useCallback(async () => {
    switch (currentView.type) {
      case "enhanced":
        return getStoredNoteMarkdown(enhancedNote?.content);
      case "raw":
        return getStoredNoteMarkdown(session?.raw_md);
      case "transcript":
        return transcriptRequest
          ? formatTranscriptExportSegments(
              await buildTranscriptExportSegments(transcriptRequest),
            )
          : "";
      default:
        return "";
    }
  }, [currentView, enhancedNote?.content, session?.raw_md, transcriptRequest]);

  const canCopy =
    currentView.type === "enhanced" ||
    currentView.type === "raw" ||
    (currentView.type === "transcript" && Boolean(transcriptRequest));

  if (!canCopy) {
    return null;
  }

  const label = t`Copy to clipboard`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      data-tauri-drag-region="false"
      onClick={async () => {
        const text = (await resolveText()).trim();
        if (!text) {
          return;
        }
        await copyTextToClipboard(text, {
          success: t`Copied to clipboard`,
          error: t`Failed to copy`,
        });
        setCopied(true);
      }}
      className="text-muted-foreground hover:bg-accent hover:text-foreground size-7 rounded-full"
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Button>
  );
}
