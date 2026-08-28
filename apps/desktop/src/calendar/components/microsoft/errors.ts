/**
 * The Microsoft commands hand back `Display` strings from `anlg_calendar::Error`.
 * Sorting them into a handful of kinds is what lets the UI say what actually
 * went wrong instead of spinning or printing a raw Rust error at the user.
 *
 * Each pattern below is anchored on a literal the Rust side writes itself
 * (`crates/calendar/src/error.rs`, `microsoft/oauth.rs`, `microsoft/graph.rs`)
 * or on an OAuth error code Entra ID returns, so a reworded neighbour cannot
 * quietly reclassify it.
 */
export type MicrosoftFailureKind =
  | "not-configured"
  | "cancelled"
  | "reauth-required"
  | "offline"
  | "unknown";

/** `MICROSOFT_CLIENT_ID` was not set when this binary was built. */
const NOT_CONFIGURED = /MICROSOFT_CLIENT_ID/;

/** Our own prefixes for a transport failure, before any HTTP status exists. */
const OFFLINE =
  /token request failed:|request to Graph failed:|token response unreadable:|Graph response unreadable:/;

/** The person closed the browser tab or refused consent. */
const CANCELLED = /access_denied|AADSTS65004/;

/** A stored refresh token that Entra ID will no longer redeem. */
const REAUTH_REQUIRED =
  /not connected to Microsoft|invalid_grant|interaction_required|login_required|no refresh token|Graph returned 401|Graph returned 403|AADSTS50173|AADSTS700082|AADSTS50076|AADSTS50078/;

export function classifyMicrosoftFailure(
  message: string | null | undefined,
): MicrosoftFailureKind {
  const text = message ?? "";

  if (NOT_CONFIGURED.test(text)) return "not-configured";
  if (OFFLINE.test(text)) return "offline";
  if (CANCELLED.test(text)) return "cancelled";
  if (REAUTH_REQUIRED.test(text)) return "reauth-required";

  return "unknown";
}

export function microsoftFailureFrom(error: unknown): {
  kind: MicrosoftFailureKind;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return { kind: classifyMicrosoftFailure(message), message };
}

/**
 * Retrying a sign-in that has no client id only reproduces the same error, so
 * the not-configured card offers an explanation instead of a button.
 */
export function isMicrosoftFailureRetryable(kind: MicrosoftFailureKind) {
  return kind !== "not-configured";
}
