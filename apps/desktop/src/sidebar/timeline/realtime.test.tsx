import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { CurrentTimeIndicator } from "./realtime";

describe("CurrentTimeIndicator", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("renders inside-item progress from bottom to top", () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date(2024, 0, 15, 12, 0, 0));

    const { container, rerender } = render(
      <CurrentTimeIndicator variant="inside" progress={0} />,
    );

    expect((container.firstChild as HTMLDivElement | null)?.style.top).toBe(
      "100%",
    );

    rerender(<CurrentTimeIndicator variant="inside" progress={1} />);

    expect((container.firstChild as HTMLDivElement | null)?.style.top).toBe(
      "0%",
    );
  });

  test("draws the current-time marker as a quiet rule, not red and not the selection colour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 12, 0, 0));

    const { container } = render(<CurrentTimeIndicator />);
    const line = container.querySelector("[data-sidebar-current-time-line]");
    const label = container.querySelector("[data-sidebar-current-time-label]");

    // Red is reserved for audio capture, and sidebar-selected answers "where
    // am I" - the marker marks a position, so it borrows neither. It reads as
    // a muted time reading against its own 3:1 rule token.
    expect(line?.className).toContain("bg-sidebar-now-line");
    expect(line?.className).not.toContain("red");
    expect(label?.className).toContain("text-muted-foreground");
    expect(label?.className).not.toContain("sidebar-selected");
    expect(label?.className).not.toContain("border");
    expect(label?.className).not.toContain("shadow");
    expect(label?.className).not.toContain("font-semibold");
    expect(label?.className).not.toContain("red");
  });

  test("labels the marker as the current time instead of a bare rule", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 12, 0, 0));

    const { container } = render(<CurrentTimeIndicator />);
    const label = container.querySelector("[data-sidebar-current-time-label]");

    expect(label?.textContent).toBe("Now12:00 PM");
    expect(label?.className).not.toContain("opacity-0");
    expect(label?.className).not.toContain("group-hover:opacity-100");
  });

  test("syncs the label at the next wall-clock minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 12, 0, 45));

    render(<CurrentTimeIndicator />);

    expect(screen.getByText("12:00 PM")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(15_099);
    });

    expect(screen.getByText("12:00 PM")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByText("12:01 PM")).toBeTruthy();
  });
});
