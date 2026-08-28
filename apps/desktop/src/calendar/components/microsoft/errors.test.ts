import { describe, expect, it } from "vitest";

import {
  classifyMicrosoftFailure,
  isMicrosoftFailureRetryable,
} from "./errors";

// Every string below is one the Rust side can actually produce; the literals
// come from crates/calendar/src/error.rs, microsoft/oauth.rs and
// microsoft/graph.rs, or from an Entra ID error body they wrap.
describe("classifyMicrosoftFailure", () => {
  it("recognises a build with no client id", () => {
    expect(
      classifyMicrosoftFailure(
        "Microsoft calendar is unavailable in this build: MICROSOFT_CLIENT_ID was not set at build time",
      ),
    ).toBe("not-configured");
  });

  it("recognises a sign-in the person refused", () => {
    expect(
      classifyMicrosoftFailure(
        "microsoft sign-in error: Microsoft rejected the sign-in: access_denied The user denied the request",
      ),
    ).toBe("cancelled");
    expect(
      classifyMicrosoftFailure(
        "microsoft sign-in error: consent_required: AADSTS65004 User declined to consent",
      ),
    ).toBe("cancelled");
  });

  it("recognises a refresh token Entra will no longer redeem", () => {
    expect(
      classifyMicrosoftFailure(
        "microsoft sign-in error: invalid_grant: AADSTS700082 The refresh token has expired due to inactivity",
      ),
    ).toBe("reauth-required");
    expect(classifyMicrosoftFailure("not connected to Microsoft")).toBe(
      "reauth-required",
    );
    expect(
      classifyMicrosoftFailure(
        'microsoft graph error: Graph returned 401 Unauthorized: {"error":{"code":"InvalidAuthenticationToken"}}',
      ),
    ).toBe("reauth-required");
  });

  it("recognises a transport failure, before any HTTP status exists", () => {
    expect(
      classifyMicrosoftFailure(
        "microsoft sign-in error: token request failed: error sending request for url (https://login.microsoftonline.com/common/oauth2/v2.0/token)",
      ),
    ).toBe("offline");
    expect(
      classifyMicrosoftFailure(
        "microsoft graph error: request to Graph failed: error sending request for url (https://graph.microsoft.com/v1.0/me/calendars)",
      ),
    ).toBe("offline");
  });

  it("does not guess at anything else", () => {
    expect(
      classifyMicrosoftFailure(
        "microsoft sign-in error: sign-in state did not match; ignoring the callback",
      ),
    ).toBe("unknown");
    expect(classifyMicrosoftFailure(null)).toBe("unknown");
    expect(classifyMicrosoftFailure("")).toBe("unknown");
  });

  it("keeps a 5xx from Graph out of the reauth bucket", () => {
    expect(
      classifyMicrosoftFailure(
        "microsoft graph error: Graph returned 503 Service Unavailable: {}",
      ),
    ).toBe("unknown");
  });

  it("offers a retry for everything a retry could fix", () => {
    expect(isMicrosoftFailureRetryable("not-configured")).toBe(false);
    expect(isMicrosoftFailureRetryable("cancelled")).toBe(true);
    expect(isMicrosoftFailureRetryable("offline")).toBe(true);
    expect(isMicrosoftFailureRetryable("reauth-required")).toBe(true);
    expect(isMicrosoftFailureRetryable("unknown")).toBe(true);
  });
});
