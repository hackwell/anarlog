import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportMeetingMarkdown: vi.fn(),
  getStoredSettingValues: vi.fn(),
  setSettingValue: vi.fn(),
}));

vi.mock("@anlg/plugin-local-api", () => ({
  commands: { exportMeetingMarkdown: mocks.exportMeetingMarkdown },
}));

vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: mocks.getStoredSettingValues,
  setSettingValue: mocks.setSettingValue,
}));

import {
  parseAutomationRunRecord,
  runMeetingCompletedAutomations,
  runNoteEnhancedAutomations,
} from "./engine";

function storedSettings(values: Record<string, unknown>) {
  mocks.getStoredSettingValues.mockResolvedValue({
    values,
    hasValues: new Set(Object.keys(values)),
  });
}

function recordedRun(settingKey: string) {
  const calls = mocks.setSettingValue.mock.calls.filter(
    (entry) => entry[0] === settingKey,
  );
  const call = calls[calls.length - 1];
  return call ? parseAutomationRunRecord(call[1] as string) : null;
}

function savedWorkflows() {
  const calls = mocks.setSettingValue.mock.calls.filter(
    (entry) => entry[0] === "automation_workflows",
  );
  return JSON.parse(calls[calls.length - 1]?.[1] as string);
}

function markdownStepWorkflow(
  directories: string[],
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "wf-1",
    title: "Export the meeting",
    enabled: true,
    trigger: "note_enhanced",
    steps: directories.map((directory, index) => ({
      id: `step-${index + 1}`,
      type: "markdown_export",
      directory,
    })),
    lastRun: null,
    processedSessionIds: [],
    chatGroupId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setSettingValue.mockResolvedValue(undefined);
});

describe("runMeetingCompletedAutomations (markdown export)", () => {
  it("does nothing while the automation is disabled", async () => {
    storedSettings({
      automation_markdown_export_enabled: false,
      automation_markdown_export_directory: "/exports",
    });

    await runMeetingCompletedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).not.toHaveBeenCalled();
    expect(mocks.setSettingValue).not.toHaveBeenCalled();
  });

  it("exports the meeting and records a successful run", async () => {
    storedSettings({
      automation_markdown_export_enabled: true,
      automation_markdown_export_directory: "/exports",
    });
    mocks.exportMeetingMarkdown.mockResolvedValue({
      status: "ok",
      data: "/exports/2026-08-07 Standup [abc123].md",
    });

    await runMeetingCompletedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).toHaveBeenCalledWith(
      "session-1",
      "/exports",
    );
    expect(recordedRun("automation_markdown_export_last_run")).toMatchObject({
      status: "success",
      detail: "/exports/2026-08-07 Standup [abc123].md",
    });
  });

  it("records a failed run when the export command errors", async () => {
    storedSettings({
      automation_markdown_export_enabled: true,
      automation_markdown_export_directory: "/exports",
    });
    mocks.exportMeetingMarkdown.mockResolvedValue({
      status: "error",
      error: "could not write markdown export: denied",
    });

    await runMeetingCompletedAutomations("session-1");

    expect(recordedRun("automation_markdown_export_last_run")).toMatchObject({
      status: "error",
      detail: "could not write markdown export: denied",
    });
  });
});

describe("parsers", () => {
  it("round-trips run records and rejects malformed values", () => {
    const record = {
      at: "2026-08-07T12:00:00.000Z",
      status: "success",
      detail: "/exports/file.md",
    };
    expect(parseAutomationRunRecord(JSON.stringify(record))).toEqual(record);
    expect(parseAutomationRunRecord(undefined)).toBeNull();
    expect(parseAutomationRunRecord("{broken")).toBeNull();
    expect(parseAutomationRunRecord('{"status":"success"}')).toBeNull();
  });
});

describe("custom workflows", () => {
  it("runs an enabled export workflow after a summary is ready", async () => {
    storedSettings({
      automation_workflows: JSON.stringify([
        markdownStepWorkflow(["/exports"]),
      ]),
    });
    mocks.exportMeetingMarkdown.mockResolvedValue({
      status: "ok",
      data: "/exports/note.md",
    });

    await runNoteEnhancedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).toHaveBeenCalledWith(
      "session-1",
      "/exports",
    );
    const saved = savedWorkflows();
    expect(saved[0].lastRun.status).toBe("success");
    expect(saved[0].lastRun.detail).toBe("/exports/note.md");
    expect(saved[0].processedSessionIds).toEqual(["session-1"]);
  });

  it("marks a session processed after a successful step so a later failure does not retry", async () => {
    storedSettings({
      automation_workflows: JSON.stringify([
        markdownStepWorkflow(["/exports", "/read-only"], {
          title: "Export twice",
        }),
      ]),
    });
    mocks.exportMeetingMarkdown.mockImplementation(
      (_sessionId: string, directory: string) =>
        Promise.resolve(
          directory === "/exports"
            ? { status: "ok", data: "/exports/note.md" }
            : { status: "error", error: "denied" },
        ),
    );

    await runNoteEnhancedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).toHaveBeenCalledTimes(2);
    const afterFailure = savedWorkflows();
    expect(afterFailure[0].processedSessionIds).toEqual(["session-1"]);
    expect(afterFailure[0].lastRun.status).toBe("error");

    storedSettings({
      automation_workflows: JSON.stringify(afterFailure),
    });
    mocks.exportMeetingMarkdown.mockClear();

    await runNoteEnhancedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).not.toHaveBeenCalled();
  });

  it("retries a workflow when the first step fails before any side effect", async () => {
    storedSettings({
      automation_workflows: JSON.stringify([
        markdownStepWorkflow(["/exports"]),
      ]),
    });
    mocks.exportMeetingMarkdown.mockResolvedValue({
      status: "error",
      error: "denied",
    });

    await runNoteEnhancedAutomations("session-1");

    const afterFailure = savedWorkflows();
    expect(afterFailure[0].processedSessionIds).toEqual([]);
    expect(afterFailure[0].lastRun.status).toBe("error");

    storedSettings({
      automation_workflows: JSON.stringify(afterFailure),
    });
    mocks.exportMeetingMarkdown.mockClear();
    mocks.exportMeetingMarkdown.mockResolvedValue({
      status: "ok",
      data: "/exports/note.md",
    });

    await runNoteEnhancedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).toHaveBeenCalledTimes(1);
    expect(savedWorkflows()[0].lastRun.status).toBe("success");
  });

  it("records an error when the step has no export folder yet", async () => {
    storedSettings({
      automation_workflows: JSON.stringify([markdownStepWorkflow([""])]),
    });

    await runNoteEnhancedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).not.toHaveBeenCalled();
    expect(savedWorkflows()[0].lastRun).toMatchObject({
      status: "error",
      detail: "choose an export folder first",
    });
  });

  it("skips disabled or already processed workflows", async () => {
    storedSettings({
      automation_workflows: JSON.stringify([
        markdownStepWorkflow(["/exports"], {
          id: "wf-1",
          title: "Disabled",
          enabled: false,
        }),
        markdownStepWorkflow(["/exports"], {
          id: "wf-2",
          title: "Already ran",
          processedSessionIds: ["session-1"],
        }),
      ]),
    });

    await runNoteEnhancedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).not.toHaveBeenCalled();
  });

  it("runs a meeting_completed workflow only on that trigger", async () => {
    storedSettings({
      automation_workflows: JSON.stringify([
        markdownStepWorkflow(["/exports"], { trigger: "meeting_completed" }),
      ]),
    });
    mocks.exportMeetingMarkdown.mockResolvedValue({
      status: "ok",
      data: "/exports/note.md",
    });

    await runNoteEnhancedAutomations("session-1");
    expect(mocks.exportMeetingMarkdown).not.toHaveBeenCalled();

    await runMeetingCompletedAutomations("session-1");
    expect(mocks.exportMeetingMarkdown).toHaveBeenCalledWith(
      "session-1",
      "/exports",
    );
  });
});
