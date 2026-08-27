# MCP tools and resources

Read tools are idempotent. Proposal tools insert or decline staged edits; they never apply those edits to the meeting.

| Tool                            | Use                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `list_meetings`                 | Find recent meetings by title, ID fragment, or recurring series.                                        |
| `get_meeting`                   | Read metadata, canonical note, summaries, participants, and action items.                               |
| `get_meeting_transcript`        | Read a transcript page. Start with `limit: 200`; continue from `pagination.next_offset` only as needed. |
| `get_recurring_meeting_history` | Find meetings from the same recurring series as a known meeting.                                        |
| `propose_summary_edit`          | Stage a complete summary replacement. Pass `target_id` when multiple summaries exist.                   |
| `propose_memo_edit`             | Stage a complete memo replacement.                                                                      |
| `list_proposals`                | List staged proposals. Defaults to `status: pending`.                                                   |
| `get_proposal`                  | Read one proposal and its unified `diff`.                                                               |
| `decline_proposal`              | Discard a pending proposal without changing the meeting.                                                |

## Tool parameters

Each list below is the complete input schema for that tool. A parameter that is not listed is not accepted.

**`list_meetings`**

- `query` (optional): Case-insensitive substring matched against the meeting title or meeting ID
- `series_id` (optional): Exact recurring series ID
- `limit` (optional): Maximum results, 1–200; defaults to 20
- `offset` (optional): Number of results to skip; defaults to 0

**`get_meeting`**

- `meeting_id` (required): Session Echo meeting ID

**`get_meeting_transcript`**

- `meeting_id` (required): Session Echo meeting ID
- `offset` (optional): Word offset to start from; defaults to 0
- `limit` (optional): Maximum transcript words, 1–500; defaults to 200

**`get_recurring_meeting_history`**

- `meeting_id` (required): A meeting ID used to resolve its recurring series
- `limit` (optional): Maximum results, 1–200; defaults to 20
- `offset` (optional): Number of results to skip; defaults to 0

**`propose_summary_edit`**

- `meeting_id` (required): Session Echo meeting ID
- `content` (required): Complete replacement markdown; cannot be empty
- `target_id` (optional): ID of the existing summary to replace. Required when the meeting has more than one summary; may be omitted when it has exactly one. The call fails when the meeting has no summary at all.

**`propose_memo_edit`**

- `meeting_id` (required): Session Echo meeting ID
- `content` (required): Complete replacement markdown; cannot be empty

`propose_memo_edit` has no `target_id`: it always replaces the meeting's canonical note, and fails when the meeting has none. That is the one difference between the two proposal input schemas.

The `kind` and `source` fields you see on a returned proposal are not inputs and cannot be passed. The tool you call decides the kind — `propose_summary_edit` records `summary_replace`, `propose_memo_edit` records `memo_replace` — and the MCP server always records `source: mcp`.

**`list_proposals`**

- `meeting_id` (optional): Limit results to one meeting
- `status` (optional): `pending`, `applied`, `declined`, or `all` for every state; defaults to `pending`
- `limit` (optional): Maximum results, 1–200; defaults to 20
- `offset` (optional): Number of results to skip; defaults to 0

**`get_proposal`**

- `proposal_id` (required): Proposal ID

**`decline_proposal`**

- `proposal_id` (required): Proposal ID

## Resources

- `anarlog://meetings/{meeting_id}`
- `anarlog://meetings/{meeting_id}/transcript{?offset,limit}`
- `anarlog://series/{series_id}`

Prefer tools when the workflow needs structured JSON. Use resources when the client needs concise Markdown or plain-text context.
