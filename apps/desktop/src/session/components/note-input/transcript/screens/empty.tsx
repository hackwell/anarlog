import { t } from "@lingui/core/macro";
import {
  ArrowsClockwise,
  Square,
  WarningCircle,
  Waveform,
} from "@phosphor-icons/react";

import { Button } from "@anlg/ui/components/ui/button";
import { Spinner } from "@anlg/ui/components/ui/spinner";
import { cn } from "@anlg/utils";

export function TranscriptEmptyState({
  isBatching,
  hasAudio,
  percentage,
  phase,
  waveform,
  error,
  onRetranscribe,
  onUploadAudio,
  onUploadTranscript,
  onStopTranscription,
}: {
  isBatching?: boolean;
  hasAudio?: boolean;
  percentage?: number;
  phase?: "importing" | "transcribing";
  waveform?: { peaks: number[]; durationMs: number } | null;
  error?: string | null;
  onRetranscribe?: () => void;
  onUploadAudio?: () => void;
  onUploadTranscript?: () => void;
  onStopTranscription?: () => void;
}) {
  if (error) {
    return (
      <div
        role="alert"
        className="flex h-full min-h-[400px] flex-col items-center justify-center px-6 text-center"
      >
        <WarningCircle
          aria-hidden
          className="text-muted-foreground mb-5 size-9 stroke-[1.5]"
        />
        <div className="mb-6 flex max-w-md flex-col gap-2">
          <p className="text-base font-medium">{t`Transcription failed`}</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {error}
          </p>
        </div>
        {onRetranscribe && (
          <Button size="sm" className="gap-2" onClick={onRetranscribe}>
            <ArrowsClockwise className="size-4" />
            {t`Re-transcribe`}
          </Button>
        )}
      </div>
    );
  }

  if (isBatching) {
    const hasProgress = typeof percentage === "number" && percentage > 0;
    const progress = Math.min(1, Math.max(0, percentage ?? 0));
    const showWaveform =
      phase !== "importing" && !!waveform && waveform.peaks.length > 0;

    return (
      <div
        role="status"
        className="flex h-full min-h-[400px] flex-col items-center justify-center px-6 text-center"
      >
        {!showWaveform && (
          <div className="text-muted-foreground mb-5">
            <Spinner size={36} />
          </div>
        )}
        <div
          className={cn([
            showWaveform ? "mb-7" : onStopTranscription && "mb-6",
          ])}
        >
          <p className="text-base font-medium">
            {phase === "importing"
              ? t`Importing audio...`
              : t`Generating transcript...`}
          </p>
          {showWaveform ? (
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed tabular-nums">
              {t`${formatClock(progress * waveform.durationMs)} of ${formatClock(waveform.durationMs)} processed`}
            </p>
          ) : (
            hasProgress && (
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed tabular-nums">
                {t`${Math.round(progress * 100)}% complete`}
              </p>
            )
          )}
        </div>
        {showWaveform && (
          <BatchWaveform
            peaks={waveform.peaks}
            durationMs={waveform.durationMs}
            progress={progress}
            className={onStopTranscription ? "mb-7" : undefined}
          />
        )}
        {onStopTranscription && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onStopTranscription}
          >
            <Square className="size-3" weight="fill" />
            {t`Stop transcription`}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center px-6 text-center">
      <Waveform
        aria-hidden
        className="text-muted-foreground mb-5 size-9 stroke-[1.5]"
      />
      <div className="mb-6 flex max-w-md flex-col gap-2">
        <p className="text-base font-medium">
          {hasAudio ? t`Audio available` : t`No transcript available`}
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {hasAudio
            ? t`Re-transcribe this audio, or upload a transcript file.`
            : t`Upload audio or a transcript file to populate this note.`}
        </p>
      </div>
      {(onRetranscribe || onUploadAudio || onUploadTranscript) && (
        <div className="flex items-center gap-2">
          {hasAudio && onRetranscribe && (
            <Button size="sm" className="gap-2" onClick={onRetranscribe}>
              <ArrowsClockwise className="size-4" />
              {t`Re-transcribe`}
            </Button>
          )}
          {!hasAudio && onUploadAudio && (
            <Button variant="outline" size="sm" onClick={onUploadAudio}>
              {t`Upload audio`}
            </Button>
          )}
          {onUploadTranscript && (
            <Button variant="outline" size="sm" onClick={onUploadTranscript}>
              {t`Upload transcript`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// The recording is the progress: bars left of the batch position are done,
// the one at the position breathes. Bar heights follow the file's loudness.
function BatchWaveform({
  peaks,
  durationMs,
  progress,
  className,
}: {
  peaks: number[];
  durationMs: number;
  progress: number;
  className?: string;
}) {
  const filled = Math.round(peaks.length * progress);
  return (
    <div
      className={cn(["flex w-full max-w-[336px] flex-col gap-2.5", className])}
    >
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="flex h-9 items-center justify-between"
      >
        {peaks.map((peak, index) => (
          <span
            key={index}
            data-filled={index < filled}
            className={cn([
              "block w-[3px] rounded-full",
              index < filled ? "bg-foreground" : "bg-border",
              index === filled && "bg-foreground/60 animate-pulse",
            ])}
            style={{
              height: `${Math.round(6 + Math.min(1, Math.max(0, peak)) * 28)}px`,
            }}
          />
        ))}
      </div>
      <div className="text-muted-foreground/70 flex justify-between text-[11px] leading-4 tabular-nums">
        <span>{formatClock(0)}</span>
        <span className="text-foreground font-medium">
          {Math.round(progress * 100)}%
        </span>
        <span>{formatClock(durationMs)}</span>
      </div>
    </div>
  );
}

function formatClock(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}
