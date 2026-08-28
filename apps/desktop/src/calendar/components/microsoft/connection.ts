import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import {
  commands as calendarCommands,
  events as calendarEvents,
} from "@anlg/plugin-calendar";
import { commands as openerCommands } from "@anlg/plugin-opener2";

import {
  classifyMicrosoftFailure,
  microsoftFailureFrom,
  type MicrosoftFailureKind,
} from "./errors";

import {
  allowReconnectedCalendarConnections,
  removeDisconnectedCalendarConnection,
  syncCalendarEvents,
} from "~/services/calendar";

/** Matches `anlg_calendar::MICROSOFT_CONNECTION_ID`. One mailbox per install. */
export const MICROSOFT_CONNECTION_ID = "microsoft";

export const MICROSOFT_CONNECTION_QUERY_KEY = [
  "microsoftCalendarConnection",
] as const;
const MICROSOFT_INVENTORY_QUERY_KEY = ["microsoftCalendarInventory"] as const;

/**
 * After this long without a callback the sign-in is presented as stalled rather
 * than in progress. The browser may have been closed, or the custom scheme may
 * not be registered in this build — either way an endless spinner would be a lie.
 */
export const BROWSER_RETURN_TIMEOUT_MS = 90_000;

export type MicrosoftFailure = {
  kind: MicrosoftFailureKind;
  message: string;
};

export type MicrosoftConnection = {
  isConnected: boolean;
  isLoadingConnection: boolean;
  isSigningIn: boolean;
  isBusy: boolean;
  /** The browser was opened but nothing came back within the timeout. */
  browserDidNotReturn: boolean;
  failure: MicrosoftFailure | null;
  /** Calendars Microsoft itself reports; `null` until the probe answers. */
  remoteCalendarCount: number | null;
  isProbing: boolean;
  connect: () => void;
  cancelSignIn: () => void;
  disconnect: () => void;
  completeWithCallbackUrl: (callbackUrl: string) => void;
  isCompletingManually: boolean;
};

async function unwrap<T>(
  promise: Promise<
    { status: "ok"; data: T } | { status: "error"; error: string }
  >,
): Promise<T> {
  const result = await promise;
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.data;
}

/**
 * Owns everything about the Microsoft sign-in that is not a calendar list: is a
 * mailbox connected, is a browser round-trip outstanding, and what went wrong.
 *
 * The OAuth callback arrives over the OS deep link, not as the reply to the
 * command that started it, so completion is observed through
 * `microsoftConnectionChangedEvent`.
 */
export function useMicrosoftConnection(): MicrosoftConnection {
  const queryClient = useQueryClient();
  const [signInStartedAt, setSignInStartedAt] = useState<number | null>(null);
  const [browserDidNotReturn, setBrowserDidNotReturn] = useState(false);
  const [callbackFailure, setCallbackFailure] =
    useState<MicrosoftFailure | null>(null);

  const connectionQuery = useQuery({
    queryKey: MICROSOFT_CONNECTION_QUERY_KEY,
    queryFn: () => calendarCommands.microsoftIsConnected(),
    staleTime: 5_000,
  });
  const isConnected = connectionQuery.data === true;

  // A stored refresh token only proves a sign-in once happened. Asking Graph
  // for the calendar list is what distinguishes a live connection from one
  // whose refresh has started failing, and it is also the only honest source
  // for "signed in, but this mailbox has no calendars".
  const inventoryQuery = useQuery({
    queryKey: MICROSOFT_INVENTORY_QUERY_KEY,
    queryFn: async () => {
      const calendars = await unwrap(
        calendarCommands.listCalendars("microsoft", MICROSOFT_CONNECTION_ID),
      );
      return calendars.length;
    },
    enabled: isConnected,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const signInMutation = useMutation({
    mutationFn: async () => {
      const authorizeUrl = await unwrap(calendarCommands.microsoftStartLogin());
      await unwrap(openerCommands.openUrl(authorizeUrl, null));
    },
    onSuccess: () => {
      setSignInStartedAt(Date.now());
      setBrowserDidNotReturn(false);
    },
  });

  const manualMutation = useMutation({
    mutationFn: (callbackUrl: string) =>
      unwrap(calendarCommands.microsoftCompleteLogin(callbackUrl.trim())),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await unwrap(calendarCommands.microsoftDisconnect());
      await removeDisconnectedCalendarConnection(
        "microsoft",
        MICROSOFT_CONNECTION_ID,
      );
      await syncCalendarEvents();
    },
    onSuccess: async () => {
      setSignInStartedAt(null);
      setBrowserDidNotReturn(false);
      setCallbackFailure(null);
      await queryClient.invalidateQueries({
        queryKey: MICROSOFT_CONNECTION_QUERY_KEY,
      });
      queryClient.removeQueries({ queryKey: MICROSOFT_INVENTORY_QUERY_KEY });
    },
  });

  useEffect(() => {
    let cancelled = false;
    const subscription = calendarEvents.microsoftConnectionChangedEvent.listen(
      ({ payload }) => {
        if (cancelled) return;

        setSignInStartedAt(null);
        setBrowserDidNotReturn(false);

        if (payload.connected) {
          setCallbackFailure(null);
          allowReconnectedCalendarConnections("microsoft");
        } else {
          setCallbackFailure({
            kind: classifyMicrosoftFailure(payload.error),
            message: payload.error ?? "",
          });
        }

        void queryClient.invalidateQueries({
          queryKey: MICROSOFT_CONNECTION_QUERY_KEY,
        });
        void queryClient.invalidateQueries({
          queryKey: MICROSOFT_INVENTORY_QUERY_KEY,
        });
      },
    );

    return () => {
      cancelled = true;
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [queryClient]);

  useEffect(() => {
    if (signInStartedAt === null) return;

    const timeout = setTimeout(() => {
      setBrowserDidNotReturn(true);
    }, BROWSER_RETURN_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [signInStartedAt]);

  const connect = useCallback(() => {
    setCallbackFailure(null);
    manualMutation.reset();
    disconnectMutation.reset();
    signInMutation.mutate();
  }, [disconnectMutation, manualMutation, signInMutation]);

  const cancelSignIn = useCallback(() => {
    setSignInStartedAt(null);
    setBrowserDidNotReturn(false);
    setCallbackFailure(null);
    signInMutation.reset();
    manualMutation.reset();
  }, [manualMutation, signInMutation]);

  const disconnect = useCallback(() => {
    disconnectMutation.mutate();
  }, [disconnectMutation]);

  const completeWithCallbackUrl = useCallback(
    (callbackUrl: string) => {
      manualMutation.mutate(callbackUrl);
    },
    [manualMutation],
  );

  // Newest first: a fresh attempt must not keep showing the previous verdict.
  const failure =
    callbackFailure ??
    (signInMutation.error
      ? microsoftFailureFrom(signInMutation.error)
      : null) ??
    (manualMutation.error
      ? microsoftFailureFrom(manualMutation.error)
      : null) ??
    (disconnectMutation.error
      ? microsoftFailureFrom(disconnectMutation.error)
      : null) ??
    (isConnected && inventoryQuery.error
      ? microsoftFailureFrom(inventoryQuery.error)
      : null);

  const isSigningIn =
    (signInMutation.isPending ||
      manualMutation.isPending ||
      signInStartedAt !== null) &&
    failure === null;

  return {
    isConnected,
    isLoadingConnection: connectionQuery.isPending,
    isSigningIn,
    isBusy: isSigningIn || disconnectMutation.isPending,
    browserDidNotReturn: browserDidNotReturn && failure === null,
    failure,
    remoteCalendarCount: inventoryQuery.data ?? null,
    isProbing: isConnected && inventoryQuery.isPending,
    connect,
    cancelSignIn,
    disconnect,
    completeWithCallbackUrl,
    isCompletingManually: manualMutation.isPending,
  };
}
