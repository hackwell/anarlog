import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PermissionStatus } from "@anlg/plugin-permissions";

const mocks = vi.hoisted(() => ({
  platform: "macos",
  calendar: {
    status: "denied" as PermissionStatus,
    confirmedStatus: "denied" as PermissionStatus,
    isPending: false,
    open: vi.fn(),
    request: vi.fn(),
    reset: vi.fn(),
    error: null as string | null,
  },
  microsoftIsConnected: vi.fn(),
  microsoftStartLogin: vi.fn(),
  microsoftCompleteLogin: vi.fn(),
  microsoftDisconnect: vi.fn(),
  listCalendars: vi.fn(),
  createEvent: vi.fn(),
  openCalendar: vi.fn(),
  openUrl: vi.fn(),
  enabledCalendars: [] as unknown[],
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => mocks.platform,
}));

vi.mock("@anlg/plugin-calendar", () => ({
  commands: {
    microsoftIsConnected: mocks.microsoftIsConnected,
    microsoftStartLogin: mocks.microsoftStartLogin,
    microsoftCompleteLogin: mocks.microsoftCompleteLogin,
    microsoftDisconnect: mocks.microsoftDisconnect,
    listCalendars: mocks.listCalendars,
    createEvent: mocks.createEvent,
    openCalendar: mocks.openCalendar,
  },
  events: {
    microsoftConnectionChangedEvent: {
      listen: () => Promise.resolve(vi.fn()),
    },
  },
}));

vi.mock("@anlg/plugin-opener2", () => ({
  commands: { openUrl: mocks.openUrl },
}));

vi.mock("~/services/calendar", () => ({
  allowReconnectedCalendarConnections: vi.fn(),
  removeDisconnectedCalendarConnection: vi.fn().mockResolvedValue(undefined),
  syncCalendarEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/shared/hooks/usePermissions", () => ({
  usePermission: () => mocks.calendar,
}));

vi.mock("~/calendar/hooks", () => ({
  useEnabledCalendars: () => mocks.enabledCalendars,
}));

vi.mock("~/calendar/components/context", () => ({
  SyncProvider: ({ children }: { children: React.ReactNode }) => children,
  useSync: () => ({
    status: "idle",
    canSync: true,
    scheduleSync: vi.fn(),
    scheduleDebouncedSync: vi.fn(),
    cancelDebouncedSync: vi.fn(),
    syncRange: vi.fn(),
  }),
}));

vi.mock("~/calendar/components/apple/calendar-selection", () => ({
  useAppleCalendarSelection: () => ({
    groups: [],
    handleRefresh: vi.fn(),
    handleToggle: vi.fn(),
    isLoading: false,
    scheduleSync: vi.fn(),
  }),
}));

vi.mock("~/calendar/components/microsoft/calendar-selection", () => ({
  useMicrosoftCalendarSelection: () => ({
    groups: [],
    handleRefresh: vi.fn(),
    handleToggle: vi.fn(),
    isLoading: false,
    scheduleSync: vi.fn(),
  }),
}));

import { CalendarSection } from "./calendar";

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CalendarSection onContinue={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("onboarding CalendarSection", () => {
  beforeEach(() => {
    mocks.platform = "macos";
    mocks.calendar.status = "denied";
    mocks.calendar.confirmedStatus = "denied";
    mocks.enabledCalendars = [];
    mocks.microsoftIsConnected.mockResolvedValue(false);
    mocks.microsoftStartLogin.mockResolvedValue({
      status: "ok",
      data: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    });
    mocks.listCalendars.mockResolvedValue({ status: "ok", data: [] });
    mocks.openUrl.mockResolvedValue({ status: "ok", data: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers Microsoft 365 beside Apple Calendar on macOS", () => {
    renderSection();

    expect(screen.getByText("Connect calendar")).toBeTruthy();
    expect(screen.getByText("Connect Microsoft 365")).toBeTruthy();
  });

  it("offers Microsoft 365 on a platform with no Apple Calendar", () => {
    mocks.platform = "windows";

    renderSection();

    expect(screen.queryByText("Connect calendar")).toBeNull();
    expect(screen.getByText("Connect Microsoft 365")).toBeTruthy();
  });

  it("starts the browser sign-in from the tile", async () => {
    renderSection();

    fireEvent.click(screen.getByText("Connect Microsoft 365"));

    await waitFor(() => {
      expect(mocks.openUrl).toHaveBeenCalledWith(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        null,
      );
    });
    expect(screen.getByText(/Waiting for the sign-in/)).toBeTruthy();
  });

  it("says the build has no Microsoft credentials, in onboarding too", async () => {
    mocks.microsoftStartLogin.mockResolvedValue({
      status: "error",
      error:
        "Microsoft calendar is unavailable in this build: MICROSOFT_CLIENT_ID was not set at build time",
    });

    renderSection();
    fireEvent.click(screen.getByText("Connect Microsoft 365"));

    await waitFor(() => {
      expect(
        screen.getByText("Microsoft 365 is not set up in this build"),
      ).toBeTruthy();
    });
  });

  it("never offers to open a read-only Microsoft calendar", async () => {
    mocks.platform = "windows";
    mocks.microsoftIsConnected.mockResolvedValue(true);
    mocks.listCalendars.mockResolvedValue({
      status: "ok",
      data: [{ id: "cal-1", title: "Kalender", provider: "microsoft" }],
    });

    renderSection();

    // The Apple tile turns into "open the Calendar app" once authorized. For
    // Microsoft that command answers UnsupportedOperation, so the connected
    // tile offers nothing to click at all.
    await waitFor(() => {
      expect(screen.queryByText("Connect Microsoft 365")).toBeNull();
    });
    // The only control left is the calendar list's own refresh affordance.
    expect(
      screen
        .getAllByRole("button")
        .map(
          (button) =>
            button.getAttribute("aria-label") ?? button.textContent ?? "",
        ),
    ).toEqual(["Refresh calendars"]);
    expect(mocks.openCalendar).not.toHaveBeenCalled();
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });
});
