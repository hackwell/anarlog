import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PermissionStatus } from "@anlg/plugin-permissions";

type ContextMenuItem = {
  id?: string;
  text?: string;
  action?: () => void;
  separator?: true;
};

const mocks = vi.hoisted(() => ({
  calendar: {
    status: "denied" as PermissionStatus,
    confirmedStatus: "denied" as PermissionStatus,
    isPending: false,
    open: vi.fn(),
    request: vi.fn(),
    reset: vi.fn(),
    error: null as string | null,
  },
  removeDisconnectedCalendarConnection: vi.fn(),
  allowReconnectedCalendarConnections: vi.fn(),
  syncCalendarEvents: vi.fn(),
  contextMenus: [] as ContextMenuItem[][],
  platform: "macos",
  microsoftIsConnected: vi.fn(),
  microsoftStartLogin: vi.fn(),
  microsoftCompleteLogin: vi.fn(),
  microsoftDisconnect: vi.fn(),
  listCalendars: vi.fn(),
  createEvent: vi.fn(),
  openCalendar: vi.fn(),
  openUrl: vi.fn(),
  microsoftListeners: [] as ((event: {
    payload: { connected: boolean; error: string | null };
  }) => void)[],
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
      listen: (
        listener: (event: {
          payload: { connected: boolean; error: string | null };
        }) => void,
      ) => {
        mocks.microsoftListeners.push(listener);
        return Promise.resolve(vi.fn());
      },
    },
  },
}));

vi.mock("@anlg/plugin-opener2", () => ({
  commands: { openUrl: mocks.openUrl },
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => mocks.platform,
}));

vi.mock("~/shared/hooks/useNativeContextMenu", () => ({
  useNativeContextMenu: (items: ContextMenuItem[]) => {
    mocks.contextMenus.push(items);
    return vi.fn();
  },
}));

vi.mock("~/shared/hooks/usePermissions", () => ({
  usePermission: () => mocks.calendar,
}));

vi.mock("~/services/calendar", () => ({
  removeDisconnectedCalendarConnection:
    mocks.removeDisconnectedCalendarConnection,
  allowReconnectedCalendarConnections:
    mocks.allowReconnectedCalendarConnections,
  syncCalendarEvents: mocks.syncCalendarEvents,
}));

vi.mock("./apple/calendar-selection", () => ({
  AppleCalendarSelection: () => null,
}));

vi.mock("./microsoft/calendar-selection", () => ({
  MicrosoftCalendarSelection: () => null,
}));

import { CalendarSidebarContent } from "./sidebar";

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CalendarSidebarContent />
    </QueryClientProvider>,
  );
}

function findContextMenuItem(id: string) {
  for (const items of mocks.contextMenus) {
    const match = items.find(
      (item) => !("separator" in item) && item.id === id,
    );
    if (match && !("separator" in match)) {
      return match;
    }
  }
  return undefined;
}

describe("CalendarSidebarContent", () => {
  afterEach(() => {
    cleanup();
    mocks.calendar.status = "denied";
    mocks.calendar.confirmedStatus = "denied";
    mocks.calendar.isPending = false;
    mocks.calendar.open.mockClear();
    mocks.calendar.request.mockClear();
    mocks.calendar.reset.mockClear();
    mocks.removeDisconnectedCalendarConnection.mockReset();
    mocks.removeDisconnectedCalendarConnection.mockResolvedValue(undefined);
    mocks.allowReconnectedCalendarConnections.mockClear();
    mocks.syncCalendarEvents.mockReset();
    mocks.syncCalendarEvents.mockResolvedValue(undefined);
    mocks.contextMenus = [];
    mocks.platform = "macos";
    mocks.microsoftListeners = [];
    mocks.microsoftIsConnected.mockReset();
    mocks.microsoftIsConnected.mockResolvedValue(false);
    mocks.microsoftStartLogin.mockReset();
    mocks.microsoftStartLogin.mockResolvedValue({
      status: "ok",
      data: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    });
    mocks.microsoftDisconnect.mockReset();
    mocks.microsoftDisconnect.mockResolvedValue({ status: "ok", data: null });
    mocks.listCalendars.mockReset();
    mocks.listCalendars.mockResolvedValue({ status: "ok", data: [] });
    mocks.openUrl.mockReset();
    mocks.openUrl.mockResolvedValue({ status: "ok", data: null });
    mocks.createEvent.mockReset();
    mocks.openCalendar.mockReset();
  });

  it("explains how to recover after Apple Calendar access is denied", () => {
    renderSidebar();

    fireEvent.click(
      screen.getByRole("button", { name: "Connect Apple Calendar" }),
    );

    expect(screen.getByText("Apple Calendar access is off")).toBeTruthy();
    expect(mocks.calendar.open).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));

    expect(mocks.calendar.open).toHaveBeenCalledOnce();
  });

  it("uses the native prompt before Apple Calendar access is decided", () => {
    mocks.calendar.status = "neverRequested";
    mocks.calendar.confirmedStatus = "neverRequested";

    renderSidebar();

    fireEvent.click(
      screen.getByRole("button", { name: "Connect Apple Calendar" }),
    );

    expect(mocks.calendar.request).toHaveBeenCalledOnce();
    expect(screen.queryByText("Apple Calendar access is off")).toBeNull();
  });

  it("offers reconnect and disconnect on the Apple Calendar row", async () => {
    mocks.calendar.status = "authorized";
    mocks.calendar.confirmedStatus = "authorized";

    renderSidebar();

    expect(
      screen.getByRole("button", { name: "Open calendar account actions" }),
    ).toBeTruthy();

    const disconnect = findContextMenuItem("disconnect-apple-calendar");
    const reconnect = findContextMenuItem("reconnect-apple-calendar");
    expect(disconnect?.text).toBe("Disconnect");
    expect(reconnect?.text).toBe("Reconnect");

    disconnect?.action?.();

    expect(mocks.removeDisconnectedCalendarConnection).toHaveBeenCalledWith(
      "apple",
      "apple",
    );
    await waitFor(() => {
      expect(mocks.calendar.reset).toHaveBeenCalledOnce();
    });
    expect(mocks.syncCalendarEvents).toHaveBeenCalledOnce();

    reconnect?.action?.();

    expect(mocks.allowReconnectedCalendarConnections).toHaveBeenCalledWith(
      "apple",
    );
    expect(mocks.calendar.request).toHaveBeenCalledOnce();
  });

  it("keeps Apple Calendar connected when disconnect persistence fails", async () => {
    mocks.calendar.status = "authorized";
    mocks.calendar.confirmedStatus = "authorized";
    mocks.removeDisconnectedCalendarConnection.mockRejectedValueOnce(
      new Error("write failed"),
    );

    renderSidebar();

    const disconnect = findContextMenuItem("disconnect-apple-calendar");
    disconnect?.action?.();

    await waitFor(() => {
      expect(mocks.syncCalendarEvents).toHaveBeenCalledOnce();
    });
    expect(mocks.calendar.reset).not.toHaveBeenCalled();
  });
});

describe("CalendarSidebarContent, Microsoft 365", () => {
  afterEach(() => {
    cleanup();
    mocks.platform = "macos";
    mocks.contextMenus = [];
    mocks.microsoftListeners = [];
    mocks.calendar.status = "denied";
    mocks.calendar.confirmedStatus = "denied";
    mocks.microsoftIsConnected.mockReset();
    mocks.microsoftIsConnected.mockResolvedValue(false);
    mocks.microsoftStartLogin.mockReset();
    mocks.microsoftStartLogin.mockResolvedValue({
      status: "ok",
      data: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    });
    mocks.microsoftDisconnect.mockReset();
    mocks.microsoftDisconnect.mockResolvedValue({ status: "ok", data: null });
    mocks.listCalendars.mockReset();
    mocks.listCalendars.mockResolvedValue({ status: "ok", data: [] });
    mocks.openUrl.mockReset();
    mocks.openUrl.mockResolvedValue({ status: "ok", data: null });
    mocks.removeDisconnectedCalendarConnection.mockReset();
    mocks.removeDisconnectedCalendarConnection.mockResolvedValue(undefined);
    mocks.syncCalendarEvents.mockReset();
    mocks.syncCalendarEvents.mockResolvedValue(undefined);
    mocks.createEvent.mockReset();
    mocks.openCalendar.mockReset();
  });

  it("is the calendar a Windows install can reach, where Apple is not", () => {
    mocks.platform = "windows";

    renderSidebar();

    expect(
      screen.getByRole("button", { name: "Connect Microsoft 365" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Connect Apple Calendar" }),
    ).toBeNull();
  });

  it("sends the sign-in to the system browser", async () => {
    renderSidebar();

    fireEvent.click(
      screen.getByRole("button", { name: "Connect Microsoft 365" }),
    );

    await waitFor(() => {
      expect(mocks.openUrl).toHaveBeenCalledWith(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        null,
      );
    });
    expect(screen.getByText(/Waiting for the sign-in/)).toBeTruthy();
  });

  it("names the missing build variable rather than failing vaguely", async () => {
    mocks.microsoftStartLogin.mockResolvedValue({
      status: "error",
      error:
        "Microsoft calendar is unavailable in this build: MICROSOFT_CLIENT_ID was not set at build time",
    });

    renderSidebar();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect Microsoft 365" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Microsoft 365 is not set up in this build"),
      ).toBeTruthy();
    });
    expect(screen.getByText(/MICROSOFT_CLIENT_ID/)).toBeTruthy();
  });

  it("offers reconnect and disconnect once a mailbox is connected", async () => {
    mocks.platform = "windows";
    mocks.microsoftIsConnected.mockResolvedValue(true);
    mocks.listCalendars.mockResolvedValue({
      status: "ok",
      data: [{ id: "cal-1", title: "Kalender", provider: "microsoft" }],
    });

    renderSidebar();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open calendar account actions" }),
      ).toBeTruthy();
    });

    const disconnect = findContextMenuItem("disconnect-microsoft-calendar");
    const reconnect = findContextMenuItem("reconnect-microsoft-calendar");
    expect(disconnect?.text).toBe("Disconnect");
    expect(reconnect?.text).toBe("Reconnect");

    disconnect?.action?.();

    await waitFor(() => {
      expect(mocks.microsoftDisconnect).toHaveBeenCalledOnce();
    });
    expect(mocks.removeDisconnectedCalendarConnection).toHaveBeenCalledWith(
      "microsoft",
      "microsoft",
    );
  });

  it("offers no write action for a read-only provider", async () => {
    mocks.platform = "windows";
    mocks.microsoftIsConnected.mockResolvedValue(true);
    mocks.listCalendars.mockResolvedValue({
      status: "ok",
      data: [{ id: "cal-1", title: "Kalender", provider: "microsoft" }],
    });

    renderSidebar();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open calendar account actions" }),
      ).toBeTruthy();
    });

    const microsoftMenuIds = mocks.contextMenus
      .flat()
      .map((item) => item.id)
      .filter((id): id is string =>
        Boolean(id?.endsWith("-microsoft-calendar")),
      );
    expect(microsoftMenuIds.sort()).toEqual([
      "disconnect-microsoft-calendar",
      "reconnect-microsoft-calendar",
    ]);
    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.openCalendar).not.toHaveBeenCalled();
  });
});
