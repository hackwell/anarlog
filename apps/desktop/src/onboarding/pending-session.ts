const PENDING_ONBOARDING_SESSION_KEY = "anarlog.pending-onboarding-session";

export function setPendingOnboardingSession(sessionId: string | null) {
  if (sessionId) {
    localStorage.setItem(PENDING_ONBOARDING_SESSION_KEY, sessionId);
  } else {
    localStorage.removeItem(PENDING_ONBOARDING_SESSION_KEY);
  }
}

export function takePendingOnboardingSession(): string | null {
  const sessionId = localStorage.getItem(PENDING_ONBOARDING_SESSION_KEY);
  localStorage.removeItem(PENDING_ONBOARDING_SESSION_KEY);
  return sessionId;
}
