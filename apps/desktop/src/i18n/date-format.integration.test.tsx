import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  locale: "en",
}));

// The lingui babel macro rewrites `useLingui()` from `@lingui/react/macro`
// into `@lingui/react`'s, so this mock has to keep serving `_` as well.
vi.mock("@lingui/react", () => {
  const translate = (input: TemplateStringsArray | string) =>
    typeof input === "string" ? input : Array.from(input).join("");

  return {
    Trans: ({
      children,
      message,
    }: {
      children?: ReactNode;
      message?: string;
    }) => children ?? message ?? null,
    useLingui: () => ({
      _: translate,
      t: translate,
      i18n: { _: translate, locale: mocks.locale },
    }),
  };
});

vi.mock("~/session/queries", () => ({
  useSession: () => ({ created_at: "2026-08-28T22:01:00" }),
  useUpdateSession: () => vi.fn(),
}));

import { DateEditor } from "~/session/components/outer-header/metadata/date";
import { CurrentTimeIndicator } from "~/sidebar/timeline/realtime";

describe("app language drives rendered clock times", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 28, 22, 1, 0));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    mocks.locale = "en";
  });

  it("renders a 12-hour clock while the app language is English", () => {
    mocks.locale = "en";

    render(<CurrentTimeIndicator />);

    expect(screen.getByText("10:01 PM")).toBeTruthy();
    expect(screen.queryByText("22:01")).toBeNull();
  });

  it("renders a 24-hour clock while the app language is German", () => {
    mocks.locale = "de";

    render(<CurrentTimeIndicator />);

    expect(screen.getByText("22:01")).toBeTruthy();
    expect(screen.queryByText("10:01 PM")).toBeNull();
  });

  it("localizes the date half of combined date-and-time labels too", () => {
    mocks.locale = "en";
    const { unmount } = render(<DateEditor sessionId="session-1" />);

    expect(screen.getByText("Aug 28, 2026 10:01 PM")).toBeTruthy();

    unmount();
    mocks.locale = "de";
    render(<DateEditor sessionId="session-1" />);

    expect(screen.getByText("28. Aug. 2026, 22:01")).toBeTruthy();
  });
});
