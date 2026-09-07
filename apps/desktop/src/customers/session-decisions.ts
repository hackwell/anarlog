import { useSyncExternalStore } from "react";

export type SessionCustomerDecision = {
  dismissedSuggestion: boolean;
  cleared: boolean;
};

const NO_DECISION: SessionCustomerDecision = {
  dismissedSuggestion: false,
  cleared: false,
};

// The customer control lives in the session header, which unmounts on every
// note switch, so component state cannot hold what the user already answered
// for a session — a dismissed suggestion came straight back, and an explicit
// "no customer" was reassigned by the resolver on reopening. Surviving the
// run of the app is enough here; persisting it is stage 2's problem.
const decisions = new Map<string, SessionCustomerDecision>();
const listeners = new Set<() => void>();

function setDecision(
  sessionId: string,
  patch: Partial<SessionCustomerDecision>,
): void {
  if (sessionId === "") return;

  const current = decisions.get(sessionId) ?? NO_DECISION;
  const next = { ...current, ...patch };
  if (
    next.dismissedSuggestion === current.dismissedSuggestion &&
    next.cleared === current.cleared
  ) {
    return;
  }

  decisions.set(sessionId, next);
  for (const listener of listeners) {
    listener();
  }
}

export function markSuggestionDismissed(sessionId: string): void {
  setDecision(sessionId, { dismissedSuggestion: true });
}

export function markCustomerCleared(sessionId: string): void {
  setDecision(sessionId, { cleared: true });
}

export function markCustomerAssigned(sessionId: string): void {
  setDecision(sessionId, { cleared: false });
}

export function getSessionCustomerDecision(
  sessionId: string,
): SessionCustomerDecision {
  return decisions.get(sessionId) ?? NO_DECISION;
}

export function resetSessionCustomerDecisions(): void {
  decisions.clear();
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSessionCustomerDecision(
  sessionId: string,
): SessionCustomerDecision {
  return useSyncExternalStore(subscribe, () =>
    getSessionCustomerDecision(sessionId),
  );
}
