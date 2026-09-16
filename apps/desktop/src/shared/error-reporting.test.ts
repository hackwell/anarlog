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
      user: {
        id: "install-1",
        email: "person@example.com",
        username: "someone",
      },
      server_name: "a-personal-machine.local",
    });

    expect(event).not.toBeNull();
    expect(event!.message).toBe("failed for [EMAIL_REDACTED]");
    expect(event!.exception?.values?.[0]?.value).toBe(
      "host [IP_REDACTED] refused",
    );
    expect(event!.breadcrumbs?.[0]?.message).toBe(
      "retrying for [EMAIL_REDACTED]",
    );
    expect(event!.breadcrumbs?.[0]?.data?.detail).toEqual(["[EMAIL_REDACTED]"]);
    expect(event!.extra?.path).toBe("[EMAIL_REDACTED]");
    // The anonymous installation id survives; nothing else about the person does.
    expect(event!.user).toEqual({ id: "install-1" });
    expect(event!.server_name).toBeUndefined();
  });
});

describe("console context objects", () => {
  it("keeps the title readable and leaves the arguments intact", () => {
    __testing.resetRepeatWindow();

    const event = __testing.scrubEvent({
      type: undefined,
      message: "[listener] post-stop transcript repair failed [object Object]",
      extra: {
        arguments: [
          "[listener] post-stop transcript repair failed",
          {
            sessionId: "f615afbd",
            reasons: ["live_transcription_unavailable"],
          },
        ],
      },
    } as never);

    expect(event!.message).toBe(
      "[listener] post-stop transcript repair failed",
    );
    expect(event!.extra?.arguments).toEqual([
      "[listener] post-stop transcript repair failed",
      { sessionId: "f615afbd", reasons: ["live_transcription_unavailable"] },
    ]);
  });

  it("groups two reports of the same failure together", () => {
    __testing.resetRepeatWindow();

    const report = (sessionId: string) =>
      __testing.scrubEvent({
        type: undefined,
        message: "[listener] repair failed [object Object]",
        extra: { arguments: ["[listener] repair failed", { sessionId }] },
      } as never);

    expect(report("session-a")!.message).toBe(report("session-b")!.message);
  });
});

describe("repeat throttling", () => {
  const failure = () =>
    __testing.scrubEvent({
      type: undefined,
      exception: { values: [{ type: "SyntaxError", value: "same failure" }] },
    } as never);

  it("lets the first few of a repeating failure through and drops the rest", () => {
    __testing.resetRepeatWindow();

    expect(failure()).not.toBeNull();
    expect(failure()).not.toBeNull();
    expect(failure()).not.toBeNull();
    expect(failure()).toBeNull();
    expect(failure()).toBeNull();
  });

  it("does not throttle a different failure", () => {
    __testing.resetRepeatWindow();

    failure();
    failure();
    failure();
    failure();

    expect(
      __testing.scrubEvent({
        type: undefined,
        exception: { values: [{ type: "TypeError", value: "another one" }] },
      } as never),
    ).not.toBeNull();
  });
});
