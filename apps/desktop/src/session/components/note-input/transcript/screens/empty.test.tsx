import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TranscriptEmptyState } from "./empty";

describe("TranscriptEmptyState", () => {
  afterEach(() => {
    cleanup();
  });

  it("lets users stop batch transcription", () => {
    const onStopTranscription = vi.fn();

    render(
      <TranscriptEmptyState
        isBatching
        phase="transcribing"
        onStopTranscription={onStopTranscription}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop transcription" }));

    expect(onStopTranscription).toHaveBeenCalledTimes(1);
  });

  it("draws the recording as progress when peaks are known", () => {
    const peaks = Array.from({ length: 56 }, (_, index) => (index % 4) / 4);

    render(
      <TranscriptEmptyState
        isBatching
        phase="transcribing"
        percentage={0.3}
        waveform={{ peaks, durationMs: 42 * 60_000 + 10_000 }}
        onStopTranscription={vi.fn()}
      />,
    );

    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("30");
    expect(bar.children).toHaveLength(56);
    expect(bar.querySelectorAll('[data-filled="true"]')).toHaveLength(17);
    expect(screen.getByText("12:39 of 42:10 processed")).not.toBeNull();
    expect(screen.queryByText("30% complete")).toBeNull();
  });

  it("keeps the spinner while importing even when peaks are known", () => {
    render(
      <TranscriptEmptyState
        isBatching
        phase="importing"
        percentage={0.3}
        waveform={{ peaks: [0.5, 1], durationMs: 60_000 }}
      />,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("30% complete")).not.toBeNull();
  });

  it("hides the stop control while importing audio", () => {
    render(<TranscriptEmptyState isBatching phase="importing" />);

    expect(
      screen.queryByRole("button", { name: "Stop transcription" }),
    ).toBeNull();
  });

  it("uses the same error hierarchy and offers re-transcription", () => {
    const onRetranscribe = vi.fn();

    render(
      <TranscriptEmptyState
        error="The transcription provider timed out."
        onRetranscribe={onRetranscribe}
      />,
    );

    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.getByText("Transcription failed").className).toContain(
      "text-base",
    );
    expect(
      screen.getByText("The transcription provider timed out.").className,
    ).toContain("text-sm");

    fireEvent.click(screen.getByRole("button", { name: "Re-transcribe" }));
    expect(onRetranscribe).toHaveBeenCalledTimes(1);
  });

  it("offers re-transcription instead of replacing existing audio", () => {
    const onRetranscribe = vi.fn();

    render(
      <TranscriptEmptyState
        hasAudio
        onRetranscribe={onRetranscribe}
        onUploadAudio={vi.fn()}
        onUploadTranscript={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Re-transcribe" }));

    expect(onRetranscribe).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Upload audio" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Upload transcript" }),
    ).not.toBeNull();
    expect(screen.getByText("Audio available")).not.toBeNull();
    expect(screen.getByText(/Re-transcribe this audio/)).not.toBeNull();
    expect(screen.queryByText(/refresh button/i)).toBeNull();
  });
});
