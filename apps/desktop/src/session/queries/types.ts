export type SessionRecord = {
  id: string;
  user_id: string;
  created_at: string;
  folder_id: string;
  event_json: string;
  title: string;
  raw_md: string;
  raw_template_id: string;
  locked: boolean;
  organization_id: string;
  // Persisted twin of the in-memory dismissal in `customers/session-decisions.ts`:
  // survives a restart because an unwatched wrong assignment must not come back.
  customer_cleared: boolean;
};

export type SessionChanges = Partial<
  Pick<
    SessionRecord,
    | "created_at"
    | "customer_cleared"
    | "event_json"
    | "folder_id"
    | "locked"
    | "organization_id"
    | "raw_md"
    | "raw_template_id"
    | "title"
  >
>;

export type SessionSummaryRecord = {
  id: string;
  title: string;
  created_at: string;
};

export type EnhancedNoteRecord = {
  id: string;
  sessionId: string;
  title: string;
  content: string;
  templateId: string;
  position: number;
};

export type SessionParticipantRecord = {
  id: string;
  sessionId: string;
  humanId: string;
  source: string;
  name: string;
  email: string;
  jobTitle: string;
  linkedinUsername: string;
  organizationId: string;
  organizationName: string;
};
