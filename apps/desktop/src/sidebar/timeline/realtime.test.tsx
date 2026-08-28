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

  test("uses the sidebar brand tone for the current-time marker, not red", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 12, 0, 0));

    const { container } = render(<CurrentTimeIndicator />);
    const line = container.querySelector("[data-sidebar-current-time-line]");
    const label = container.querySelector("[data-sidebar-current-time-label]");

    // Red is reserved for audio capture, so the "now" marker reads in the
    // sidebar's own brand tone through theme-aware tokens rather than a
    // literal red with a dark-mode override.
    expect(line?.className).toContain("bg-sidebar-border");
    expect(line?.className).not.toContain("red");
    expect(label?.className).toContain("bg-sidebar-selected");
    expect(label?.className).toContain("border-sidebar-border");
    expect(label?.className).toContain("text-sidebar-selected-foreground");
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
