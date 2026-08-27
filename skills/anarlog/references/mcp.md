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

**`list_meetings`** accepts optional filters:

- `query`: Case-insensitive title or meeting ID substring
- `series_id`: Exact recurring series ID
- `limit`: Maximum results (1–200, defaults to 20)
- `offset`: Number of results to skip (defaults to 0)

**`get_meeting`** requires:

- `meeting_id`: Anarlog meeting ID

**`get_meeting_transcript`** requires `meeting_id` and accepts:

- `offset`: Word offset (defaults to 0)
- `limit`: Maximum words (1–500, defaults to 200)

**`get_recurring_meeting_history`** requires `meeting_id` and accepts:

- `limit`: Maximum results (1–200, defaults to 20)
- `offset`: Number of results to skip (defaults to 0)

**`propose_summary_edit`** requires:

- `meeting_id`: Anarlog meeting ID
- `kind`: Document type — `summary` or `memo` (or `note` as alias for memo)
- `content`: Complete replacement markdown; cannot be empty

Accepts optional:

- `target_id`: For summaries, names which existing summary to replace; ignored for memos
- `source`: Origin of the proposal — `cli`, `mcp`, or `chat`

**`propose_memo_edit`** is identical to `propose_summary_edit` (same input schema).

**`list_proposals`** accepts optional filters:

- `meeting_id`: Limit results to one meeting
- `status`: Filter by state — `pending`, `applied`, or `declined` (defaults to `pending`)
- `limit`: Maximum results (1–200, defaults to 20)
- `offset`: Number of results to skip (defaults to 0)

**`get_proposal`** requires:

- `proposal_id`: Proposal ID

**`decline_proposal`** requires:

- `proposal_id`: Proposal ID

Transcript limits are measured in words. The default is 200 and the maximum is 500.

Available resources:

- `anarlog://meetings/{meeting_id}`
- `anarlog://meetings/{meeting_id}/transcript{?offset,limit}`
- `anarlog://series/{series_id}`

Prefer tools when the workflow needs structured JSON. Use resources when the client needs concise Markdown or plain-text context.
