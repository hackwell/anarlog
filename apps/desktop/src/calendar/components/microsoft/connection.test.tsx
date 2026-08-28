import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConnectionChangedPayload = { connected: boolean; error: string | null };
type ConnectionListener = (event: {
  payload: ConnectionChangedPayload;
}) => void;

const mocks = vi.hoisted(() => ({
  microsoftIsConnected: vi.fn(),
  microsoftStartLogin: vi.fn(),
  microsoftCompleteLogin: vi.fn(),
  microsoftDisconnect: vi.fn(),
  listCalendars: vi.fn(),
  createEvent: vi.fn(),
  openCalendar: vi.fn(),
  openUrl: vi.fn(),
  allowReconnectedCalendarConnections: vi.fn(),
  removeDisconnectedCalendarConnection: vi.fn(),
  syncCalendarEvents: vi.fn(),
  listeners: [] as ConnectionListener[],
  unlisten: vi.fn(),
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
      listen: (listener: ConnectionListener) => {
        mocks.listeners.push(listener);
        return Promise.resolve(mocks.unlisten);
      },
    },
  },
}));

vi.mock("@anlg/plugin-opener2", () => ({
  commands: { openUrl: mocks.openUrl },
}));

vi.mock("~/services/calendar", () => ({
  allowReconnectedCalendarConnections:
    mocks.allowReconnectedCalendarConnections,
  removeDisconnectedCalendarConnection:
    mocks.removeDisconnectedCalendarConnection,
  syncCalendarEvents: mocks.syncCalendarEvents,
}));

import {
  BROWSER_RETURN_TIMEOUT_MS,
  useMicrosoftConnection,
} from "./connection";
import { MicrosoftConnectionStatus } from "./status";

function Harness() {
  const connection = useMicrosoftConnection();

  return (
    <div>
      <button type="button" onClick={connection.connect}>
        start sign-in
      </button>
      <button type="button" onClick={connection.disconnect}>
        disconnect
      </button>
      <span data-testid="connected">{String(connection.isConnected)}</span>
      <MicrosoftConnectionStatus connection={connection} />
    </div>
  );
}

function renderHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

function emitConnectionChanged(payload: ConnectionChangedPayload) {
  act(() => {
    for (const listener of mocks.listeners) {
      listener({ payload });
    }
  });
}

const ok = <T,>(data: T) => ({ status: "ok" as const, data });
const err = (error: string) => ({ status: "error" as const, error });

describe("useMicrosoftConnection", () => {
  beforeEach(() => {
    mocks.listeners = [];
    mocks.microsoftIsConnected.mockResolvedValue(false);
    mocks.microsoftStartLogin.mockResolvedValue(
      ok("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1"),
    );
    mocks.microsoftCompleteLogin.mockResolvedValue(ok(null));
    mocks.microsoftDisconnect.mockResolvedValue(ok(null));
    mocks.listCalendars.mockResolvedValue(ok([]));
    mocks.openUrl.mockResolvedValue(ok(null));
    mocks.removeDisconnectedCalendarConnection.mockResolvedValue(undefined);
    mocks.syncCalendarEvents.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("says the build has no Microsoft credentials instead of failing vaguely", async () => {
    mocks.microsoftStartLogin.mockResolvedValue(
      err(
        "Microsoft calendar is unavailable in this build: MICROSOFT_CLIENT_ID was not set at build time",
      ),
    );

    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "start sign-in" }));

    await waitFor(() => {
      expect(
        screen.getByText("Microsoft 365 is not set up in this build"),
      ).toBeTruthy();
    });
    expect(screen.getByText(/MICROSOFT_CLIENT_ID/)).toBeTruthy();
    // Retrying cannot conjure a client id, so no retry is offered.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("reports a cancelled sign-in as cancelled, not as an error to decode", async () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "start sign-in" }));
    await waitFor(() => expect(mocks.openUrl).toHaveBeenCalledOnce());

    emitConnectionChanged({
      connected: false,
      error:
        "microsoft sign-in error: Microsoft rejected the sign-in: access_denied The user denied the request",
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "The sign-in was cancelled. No Microsoft account was connected.",
        ),
      ).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText(/Waiting for the sign-in/)).toBeNull();
  });

  it("stops implying the browser is still coming back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderHarness();
      fireEvent.click(screen.getByRole("button", { name: "start sign-in" }));

      await waitFor(() => {
        expect(screen.getByText(/Waiting for the sign-in/)).toBeTruthy();
      });

      await act(async () => {
        vi.advanceTimersByTime(BROWSER_RETURN_TIMEOUT_MS + 1);
      });

      expect(
        screen.getByText(/Your browser has not come back yet/),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Start over" })).toBeTruthy();
      expect(
        screen.getByRole("button", {
          name: "Paste the callback address instead",
        }),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the pasted-callback escape hatch off the normal path", async () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "start sign-in" }));

    await waitFor(() => {
      expect(screen.getByText(/Waiting for the sign-in/)).toBeTruthy();
    });
    expect(
      screen.queryByRole("button", {
        name: "Paste the callback address instead",
      }),
    ).toBeNull();
  });

  it("redeems a pasted callback URL once the deep link has visibly failed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderHarness();
      fireEvent.click(screen.getByRole("button", { name: "start sign-in" }));
      await waitFor(() => {
        expect(screen.getByText(/Waiting for the sign-in/)).toBeTruthy();
      });
      await act(async () => {
        vi.advanceTimersByTime(BROWSER_RETURN_TIMEOUT_MS + 1);
      });

      fireEvent.click(
        screen.getByRole("button", {
          name: "Paste the callback address instead",
        }),
      );
      fireEvent.change(screen.getByLabelText("Microsoft callback address"), {
        target: {
          value: " sessionecho://ms-calendar/callback?code=abc&state=xyz ",
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Complete sign-in" }));

      await waitFor(() => {
        expect(mocks.microsoftCompleteLogin).toHaveBeenCalledWith(
          "sessionecho://ms-calendar/callback?code=abc&state=xyz",
        );
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for a new sign-in when the stored refresh token stops working", async () => {
    mocks.microsoftIsConnected.mockResolvedValue(true);
    mocks.listCalendars.mockResolvedValue(
      err(
        "microsoft sign-in error: invalid_grant: AADSTS700082 The refresh token has expired due to inactivity",
      ),
    );

    renderHarness();

    await waitFor(() => {
      expect(
        screen.getByText(/Your Microsoft session has expired/),
      ).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeTruthy();
  });

  it("names the network as the problem when Microsoft cannot be reached", async () => {
    mocks.microsoftStartLogin.mockResolvedValue(
      err(
        "microsoft sign-in error: token request failed: error sending request for url (https://login.microsoftonline.com/common/oauth2/v2.0/token)",
      ),
    );

    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "start sign-in" }));

    await waitFor(() => {
      expect(screen.getByText(/Microsoft could not be reached/)).toBeTruthy();
    });
  });

  it("distinguishes a mailbox with no calendars from a broken connection", async () => {
    mocks.microsoftIsConnected.mockResolvedValue(true);
    mocks.listCalendars.mockResolvedValue(ok([]));

    renderHarness();

    await waitFor(() => {
      expect(
        screen.getByText(
          "Connected. Microsoft reports no calendars for this account yet.",
        ),
      ).toBeTruthy();
    });
  });

  it("says nothing at all once a mailbox with calendars is connected", async () => {
    mocks.microsoftIsConnected.mockResolvedValue(true);
    mocks.listCalendars.mockResolvedValue(
      ok([{ id: "cal-1", title: "Kalender", provider: "microsoft" }]),
    );

    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
    });
    await waitFor(() => {
      expect(screen.queryByText(/Microsoft reports no calendars/)).toBeNull();
    });
    expect(screen.queryByText(/expired/)).toBeNull();
    expect(screen.queryByText(/Waiting for the sign-in/)).toBeNull();
  });

  it("clears the sign-in and un-tombstones the connection when the callback lands", async () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "start sign-in" }));
    await waitFor(() => {
      expect(screen.getByText(/Waiting for the sign-in/)).toBeTruthy();
    });

    mocks.microsoftIsConnected.mockResolvedValue(true);
    mocks.listCalendars.mockResolvedValue(
      ok([{ id: "cal-1", title: "Kalender", provider: "microsoft" }]),
    );
    emitConnectionChanged({ connected: true, error: null });

    await waitFor(() => {
      expect(mocks.allowReconnectedCalendarConnections).toHaveBeenCalledWith(
        "microsoft",
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
    });
    expect(screen.queryByText(/Waiting for the sign-in/)).toBeNull();
  });

  it("forgets the token and the local copy of the calendar on disconnect", async () => {
    mocks.microsoftIsConnected.mockResolvedValue(true);
    mocks.listCalendars.mockResolvedValue(
      ok([{ id: "cal-1", title: "Kalender", provider: "microsoft" }]),
    );

    renderHarness();
    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
    });

    mocks.microsoftIsConnected.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: "disconnect" }));

    await waitFor(() => {
      expect(mocks.microsoftDisconnect).toHaveBeenCalledOnce();
    });
    expect(mocks.removeDisconnectedCalendarConnection).toHaveBeenCalledWith(
      "microsoft",
      "microsoft",
    );
    await waitFor(() => {
      expect(mocks.syncCalendarEvents).toHaveBeenCalledOnce();
    });
  });

  it("never reaches for a write operation Microsoft does not support", async () => {
    mocks.microsoftIsConnected.mockResolvedValue(true);
    mocks.listCalendars.mockResolvedValue(
      ok([{ id: "cal-1", title: "Kalender", provider: "microsoft" }]),
    );

    renderHarness();
    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
    });

    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.openCalendar).not.toHaveBeenCalled();
  });
});
