import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enhanceTransform, selectPreviousMeetings } from "./enhance-transform";

const mocks = vi.hoisted(() => ({
  collectEnhanceImageContext: vi.fn(),
  getTemplateById: vi.fn(),
  formatMeetingChatContext: vi.fn(),
  loadMeetingChatRecords: vi.fn(),
  loadSessionContentSnapshot: vi.fn(),
  loadHumansByIds: vi.fn(),
  buildRenderTranscriptRequestFromRows: vi.fn(),
  collectAssignedHumanIdsFromTranscriptRows: vi.fn(),
  renderTranscriptSegments: vi.fn(),
  loadPastSessionNotesData: vi.fn(),
  buildPastSessionNotes: vi.fn(),
  loadMeetingSnapshotRecords: vi.fn(),
}));

vi.mock("~/session/insights/past-notes", () => ({
  loadPastSessionNotesData: mocks.loadPastSessionNotesData,
  buildPastSessionNotes: mocks.buildPastSessionNotes,
}));

vi.mock("./enhance-images", () => ({
  collectEnhanceImageContext: mocks.collectEnhanceImageContext,
}));

vi.mock("~/templates/queries", () => ({
  getTemplateById: mocks.getTemplateById,
}));

vi.mock("~/session/content-queries", () => ({
  loadSessionContentSnapshot: mocks.loadSessionContentSnapshot,
}));

vi.mock("~/stt/meeting-chat-records", () => ({
  formatMeetingChatContext: mocks.formatMeetingChatContext,
  loadMeetingChatRecords: mocks.loadMeetingChatRecords,
}));

vi.mock("~/stt/meeting-snapshot-records", () => ({
  loadMeetingSnapshotRecords: mocks.loadMeetingSnapshotRecords,
}));

vi.mock("~/contacts/queries", () => ({
  loadHumansByIds: mocks.loadHumansByIds,
}));

vi.mock("~/stt/render-transcript", () => ({
  buildRenderTranscriptRequestFromRows:
    mocks.buildRenderTranscriptRequestFromRows,
  collectAssignedHumanIdsFromTranscriptRows:
    mocks.collectAssignedHumanIdsFromTranscriptRows,
  renderTranscriptSegments: mocks.renderTranscriptSegments,
}));

function createSnapshot() {
  return {
    sessionId: "session-1",
    ownerUserId: "user-1",
    title: "Weekly Review",
    createdAt: "2026-07-10T00:00:00.000Z",
    event: null,
    eventId: null,
    rawNoteId: "session-1",
    rawTemplateId: "",
    rawContent: "![post](asset://localhost/post.png)",
    rawContentFormat: "markdown",
    rawMarkdown: "![post](asset://localhost/post.png)",
    enhancedNotes: [],
    transcripts: [
      {
        id: "transcript-1",
        started_at: 100,
        ended_at: 200,
        memo: "![pre](asset://localhost/pre.png)",
        wordsJson: "[]",
        words: [],
        speaker_hints: [],
      },
    ],
    participants: [{ humanId: "human-1", name: "Alice", jobTitle: "Engineer" }],
  };
}

const settingsValues = { ai_language: "en" } as const;

describe("enhanceTransform.transformArgs", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.collectEnhanceImageContext.mockResolvedValue([]);
    mocks.getTemplateById.mockResolvedValue(null);
    mocks.formatMeetingChatContext.mockReturnValue("");
    mocks.loadMeetingChatRecords.mockResolvedValue([]);
    mocks.loadSessionContentSnapshot.mockResolvedValue(createSnapshot());
    mocks.loadHumansByIds.mockResolvedValue([{ id: "human-1", name: "Alice" }]);
    mocks.collectAssignedHumanIdsFromTranscriptRows.mockReturnValue([]);
    mocks.buildRenderTranscriptRequestFromRows.mockReturnValue(null);
    mocks.renderTranscriptSegments.mockResolvedValue([]);
    mocks.loadPastSessionNotesData.mockResolvedValue({
      sessions: {},
      participants: [],
      enhancedNotes: [],
      keyFacts: {},
    });
    mocks.buildPastSessionNotes.mockReturnValue({
      notes: [],
      missing: [],
      requests: [],
    });
    mocks.loadMeetingSnapshotRecords.mockResolvedValue([]);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("passes earlier occurrences of the series to the prompt", async () => {
    mocks.buildPastSessionNotes.mockReturnValue({
      notes: [pastNote("older", "same_series", "2026-06-26T10:00:00.000Z")],
      missing: [],
      requests: [],
    });

    const result = await enhanceTransform.transformArgs(
      { sessionId: "session-1", enhancedNoteId: "note-1", templateId: "" },
      settingsValues,
    );

    expect(mocks.buildPastSessionNotes).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      "user-1",
    );
    expect(result.previousMeetings).toEqual([
      { title: "Weekly Review", occurredAt: "older", summary: "Summary older" },
    ]);
  });

  it("uses the selected template when it can be loaded", async () => {
    mocks.getTemplateById.mockResolvedValue({
      title: "Standup",
      description: "Daily sync",
      sections: [{ title: "Updates", description: null }],
    });

    const result = await enhanceTransform.transformArgs(
      {
        sessionId: "session-1",
        enhancedNoteId: "note-1",
        templateId: "template-1",
      },
      settingsValues,
    );

    expect(result.template).toEqual({
      title: "Standup",
      description: "Daily sync",
      sections: [{ title: "Updates", description: null }],
    });
    expect(result.participants).toEqual([
      { name: "Alice", jobTitle: "Engineer" },
    ]);
  });

  it("uses the edited memo headings for its applied template", async () => {
    mocks.loadSessionContentSnapshot.mockResolvedValue({
      ...createSnapshot(),
      rawTemplateId: "template-1",
      rawContent: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Updates" }],
          },
          { type: "paragraph" },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Next Steps" }],
          },
        ],
      }),
      rawContentFormat: "prosemirror_json",
      rawMarkdown: "## Updates\n\n## Next Steps",
    });
    mocks.getTemplateById.mockResolvedValue({
      title: "1:1 Meeting",
      description: "Weekly conversation",
      sections: [
        { title: "Updates", description: "Recent changes" },
        { title: "Action Items", description: "Follow-ups" },
      ],
    });

    const result = await enhanceTransform.transformArgs(
      {
        sessionId: "session-1",
        enhancedNoteId: "note-1",
        templateId: "template-1",
      },
      settingsValues,
    );

    expect(result.template).toEqual({
      title: "1:1 Meeting",
      description: "Weekly conversation",
      sections: [
        { title: "Updates", description: "Recent changes" },
        { title: "Next Steps", description: "Follow-ups" },
      ],
    });
  });

  it("keeps the applied template when the memo has no section headings", async () => {
    mocks.loadSessionContentSnapshot.mockResolvedValue({
      ...createSnapshot(),
      rawTemplateId: "template-1",
      rawContent: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
      rawContentFormat: "prosemirror_json",
      rawMarkdown: "Notes without headings",
    });
    mocks.getTemplateById.mockResolvedValue({
      title: "1:1 Meeting",
      description: "Weekly conversation",
      sections: [
        { title: "Updates", description: "Recent changes" },
        { title: "Action Items", description: "Follow-ups" },
      ],
    });

    const result = await enhanceTransform.transformArgs(
      {
        sessionId: "session-1",
        enhancedNoteId: "note-1",
        templateId: "template-1",
      },
      settingsValues,
    );

    expect(result.template).toEqual({
      title: "1:1 Meeting",
      description: "Weekly conversation",
      sections: [
        { title: "Updates", description: "Recent changes" },
        { title: "Action Items", description: "Follow-ups" },
      ],
    });
  });

  it("uses the saved format override for Auto summaries", async () => {
    const result = await enhanceTransform.transformArgs(
      { sessionId: "session-1", enhancedNoteId: "note-1" },
      {
        ...settingsValues,
        auto_summary_prompt: "  Start with decisions.  ",
      },
    );

    expect(result.formatOverride).toBe("  Start with decisions.  ");
  });

  it("ignores the Auto override when a named template is selected", async () => {
    const result = await enhanceTransform.transformArgs(
      {
        sessionId: "session-1",
        enhancedNoteId: "note-1",
        templateId: "template-1",
      },
      {
        ...settingsValues,
        auto_summary_prompt: "Start with decisions.",
      },
    );

    expect(result.formatOverride).toBe("");
  });

  it("uses the built-in Auto format when no override is saved", async () => {
    const result = await enhanceTransform.transformArgs(
      { sessionId: "session-1", enhancedNoteId: "note-1" },
      settingsValues,
    );

    expect(result.formatOverride).toBe("");
    expect(result.summaryLength).toBe("detailed");
  });

  it("uses the saved summary length mode", async () => {
    const result = await enhanceTransform.transformArgs(
      { sessionId: "session-1", enhancedNoteId: "note-1" },
      { ...settingsValues, summary_length: "crisp" },
    );

    expect(result.summaryLength).toBe("crisp");
  });

  it("includes personalization dictionary terms for summary spelling", async () => {
    const result = await enhanceTransform.transformArgs(
      { sessionId: "session-1", enhancedNoteId: "note-1" },
      {
        ...settingsValues,
        personalization_dictionary_terms: JSON.stringify([
          "Session Echo",
          "Char",
        ]),
      },
    );

    expect(result.dictionaryTerms).toEqual(["Session Echo", "Char"]);
  });

  it("falls back to generic enhancement when template loading fails", async () => {
    mocks.getTemplateById.mockRejectedValue(new Error("Failed query"));

    const result = await enhanceTransform.transformArgs(
      {
        sessionId: "session-1",
        enhancedNoteId: "note-1",
        templateId: "template-1",
      },
      settingsValues,
    );

    expect(result.template).toBeNull();
    expect(result.formatOverride).toBe("");
    expect(result.session.title).toBe("Weekly Review");
    expect(consoleError).toHaveBeenCalledWith(
      "[enhance] failed to load template",
      expect.any(Error),
    );
  });

  it("collects image context from canonical transcript and note content", async () => {
    await enhanceTransform.transformArgs(
      {
        sessionId: "session-1",
        enhancedNoteId: "note-1",
      },
      {
        current_llm_provider: "openai",
        current_llm_model: "gpt-4o",
        ai_language: "en",
      },
    );

    expect(mocks.collectEnhanceImageContext).toHaveBeenCalledWith("session-1", [
      "![pre](asset://localhost/pre.png)",
      "![post](asset://localhost/post.png)",
    ]);
  });

  it("hands meeting snapshots to the image context", async () => {
    const capturedAtMs = Date.UTC(2026, 8, 2, 14, 3, 1);
    const localTime = new Date(capturedAtMs);
    const label = `${String(localTime.getHours()).padStart(2, "0")}:${String(
      localTime.getMinutes(),
    ).padStart(2, "0")}`;
    mocks.loadMeetingSnapshotRecords.mockResolvedValue([
      {
        id: "doc-1",
        attachmentId: "att-1",
        filename: "slide-140301.jpg",
        path: "/tmp/att-1.jpg",
        capturedAtMs,
        width: 1600,
        height: 900,
        appName: "zoom.us",
        windowTitle: "Zoom Meeting",
        text: "Q3 Roadmap\n- Onboarding v2",
      },
      {
        id: "doc-2",
        attachmentId: "att-2",
        filename: "slide-140401.jpg",
        path: "/tmp/att-2.jpg",
        capturedAtMs: capturedAtMs + 60_000,
        width: 1600,
        height: 900,
        appName: "zoom.us",
        windowTitle: "Zoom Meeting",
        text: "   ",
      },
    ]);
    mocks.collectEnhanceImageContext.mockResolvedValue([]);

    const result = await enhanceTransform.transformArgs(
      { sessionId: "session-1", enhancedNoteId: "note-1", templateId: "" },
      {
        current_llm_provider: "openai",
        current_llm_model: "gpt-4o",
        ai_language: "en",
      },
    );

    const [, markdown] = mocks.collectEnhanceImageContext.mock.calls[0]!;
    expect(markdown).toContain(`![Slide ${label}](/tmp/att-1.jpg)`);
    // Slide text rides along as plain text; frames without readable text stay out.
    expect(result.slides).toEqual([
      { shownAt: label, text: "Q3 Roadmap\n- Onboarding v2" },
    ]);
  });

  it("keeps summaries working when snapshot lookup fails", async () => {
    mocks.loadMeetingSnapshotRecords.mockRejectedValue(new Error("db down"));
    mocks.collectEnhanceImageContext.mockResolvedValue([]);

    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await enhanceTransform.transformArgs(
      { sessionId: "session-1", enhancedNoteId: "note-1" },
      {
        current_llm_provider: "openai",
        current_llm_model: "gpt-4o",
        ai_language: "en",
      },
    );

    expect(result.session.title).toBe("Weekly Review");
    expect(consoleWarn).toHaveBeenCalledWith(
      "[enhance] meeting snapshots unavailable",
      expect.any(Error),
    );
    const [, markdown] = mocks.collectEnhanceImageContext.mock.calls[0]!;
    expect(markdown).toEqual([
      "![pre](asset://localhost/pre.png)",
      "![post](asset://localhost/post.png)",
    ]);
    consoleWarn.mockRestore();
  });

  it("builds speaker identity context from SQLite humans", async () => {
    mocks.collectAssignedHumanIdsFromTranscriptRows.mockReturnValue([
      "human-2",
    ]);

    await enhanceTransform.transformArgs(
      { sessionId: "session-1", enhancedNoteId: "note-1" },
      settingsValues,
    );

    expect(mocks.loadHumansByIds).toHaveBeenCalledWith([
      "user-1",
      "human-1",
      "human-2",
    ]);
    expect(mocks.buildRenderTranscriptRequestFromRows).toHaveBeenCalledWith(
      expect.any(Array),
      {
        selfHumanId: "user-1",
        humans: [{ human_id: "human-1", name: "Alice" }],
      },
      ["human-1"],
    );
  });

  it("includes captured meeting chat in the post-meeting memo", async () => {
    mocks.loadMeetingChatRecords.mockResolvedValue([
      { text: "Review the rollout plan" },
    ]);
    mocks.formatMeetingChatContext.mockReturnValue(
      "## Meeting chat\n- Slack · Ada\n  Review the rollout plan",
    );

    const result = await enhanceTransform.transformArgs(
      { sessionId: "session-1", enhancedNoteId: "note-1" },
      settingsValues,
    );

    expect(result.postMeetingMemo).toBe(
      "![post](asset://localhost/post.png)\n\n## Meeting chat\n- Slack · Ada\n  Review the rollout plan",
    );
  });

  it("rejects generation when the session no longer exists", async () => {
    mocks.loadSessionContentSnapshot.mockResolvedValue(null);

    await expect(
      enhanceTransform.transformArgs(
        { sessionId: "missing", enhancedNoteId: "note-1" },
        settingsValues,
      ),
    ).rejects.toThrow("Session missing no longer exists");
  });
});

function pastNote(
  id: string,
  relationship: "same_series" | "matching_title" | "shared_participants",
  occurredAt: string,
  sourceSummary = `Summary ${id}`,
) {
  return {
    sessionId: id,
    title: "Weekly Review",
    dateLabel: id,
    occurredAt,
    sourceSummary,
    relationship,
    summary: null,
    isGenerating: false,
  };
}

describe("selectPreviousMeetings", () => {
  it("keeps series and title matches, newest first, capped at three", () => {
    const notes = [
      pastNote("a", "shared_participants", "2026-07-01T00:00:00.000Z"),
      pastNote("b", "same_series", "2026-06-01T00:00:00.000Z"),
      pastNote("c", "matching_title", "2026-06-15T00:00:00.000Z"),
      pastNote("d", "same_series", "2026-05-01T00:00:00.000Z"),
      pastNote("e", "same_series", "2026-04-01T00:00:00.000Z"),
      pastNote("f", "same_series", "2026-06-20T00:00:00.000Z", "   "),
    ];

    expect(selectPreviousMeetings(notes).map((m) => m.occurredAt)).toEqual([
      "c",
      "b",
      "d",
    ]);
  });

  it("truncates long summaries", () => {
    const [meeting] = selectPreviousMeetings([
      pastNote(
        "x",
        "same_series",
        "2026-06-01T00:00:00.000Z",
        "y".repeat(3000),
      ),
    ]);
    expect(meeting?.summary.length).toBe(2501);
    expect(meeting?.summary.endsWith("…")).toBe(true);
  });
});
