import { describe, expect, it } from "vitest";

import { __testing, scrubText } from "./error-reporting";

describe("scrubText", () => {
  it("removes an email address", () => {
    expect(scrubText("upload failed for person@example.com")).toBe(
      "upload failed for [EMAIL_REDACTED]",
    );
  });

  it("removes an IPv4 address", () => {
    expect(scrubText("could not reach 192.168.1.4")).toBe(
      "could not reach [IP_REDACTED]",
    );
  });

  it("leaves an ordinary message alone", () => {
    const message = "audio duration 1500.012 seconds is longer than 1400";
    expect(scrubText(message)).toBe(message);
  });

  it("removes the home directory once it is known", () => {
    __testing.setHomePath("/Users/someone");
    try {
      expect(scrubText("wrote /Users/someone/Library/app.db")).toBe(
        "wrote [HOME]/Library/app.db",
      );
    } finally {
      __testing.setHomePath(null);
    }
  });
});

describe("scrubEvent", () => {
  it("scrubs the message, the exceptions and the breadcrumbs", () => {
    const event = __testing.scrubEvent({
      type: undefined,
      message: "failed for person@example.com",
      exception: { values: [{ value: "host 10.0.0.8 refused" }] },
      breadcrumbs: [
        {
          message: "retrying for person@example.com",
          data: { detail: ["second@example.com"] },
        },
      ],
      extra: { path: "person@example.com" },
      user: { id: "someone" },
      server_name: "a-personal-machine.local",
    });

    expect(event.message).toBe("failed for [EMAIL_REDACTED]");
    expect(event.exception?.values?.[0]?.value).toBe(
      "host [IP_REDACTED] refused",
    );
    expect(event.breadcrumbs?.[0]?.message).toBe(
      "retrying for [EMAIL_REDACTED]",
    );
    expect(event.breadcrumbs?.[0]?.data?.detail).toEqual(["[EMAIL_REDACTED]"]);
    expect(event.extra?.path).toBe("[EMAIL_REDACTED]");
    expect(event.user).toBeUndefined();
    expect(event.server_name).toBeUndefined();
  });
});
