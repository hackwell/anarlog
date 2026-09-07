# Customer and Project Assignment — Design

## Problem

Every recorded meeting belongs to a customer, and usually to a project of that
customer. Today the app has no field for either. Retrieval works by title and
search, the summary only knows the meeting's own recurring series, and nothing
can be handed to another system, because there is nothing stable to hand over.

Folders exist (`sessions.folder_path`) but are unused, and could not carry this:
the column is a plain string with no table behind it, so a folder is its own
name, cannot belong to a customer, and changes identity when it is renamed.

Tags are the wrong home too. The tag vocabulary is a flat list of themes,
suggested by a model; a customer must never be guessed, a project must belong to
a customer, and forty customer names in the vocabulary would destroy the theme
filter — the exact failure `apps/desktop/src/tags/suggest.ts` already warns
about in its own comment.

## Goals

- A meeting carries a customer and, where it applies, a project.
- Both are assigned without manual work in the common case.
- Retrieval: "everything for this customer", "everything in this project".
- Summary context: the last meetings of the same **project**, across different
  recurring series.
- Handover: stable identifiers another system can match on.

## Non-goals

- Reporting and time aggregation. Not a driver today; the model below does not
  prevent it later.
- Multiple customers per meeting. One customer, one project, or none.
- Nested projects. Flat, exactly like the folders they replace.
- Automatic project creation from a model's invention. Projects are created by
  a person or from an existing calendar series, never guessed into existence.

## What already exists

| Need                      | Existing piece                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Customer as a record      | `organizations` (`crates/db-app/migrations/20260710223922_canonical_data_model.sql:1`) with name, memo, pin state                       |
| Person → customer         | `humans.organization_id` (`:19`)                                                                                                        |
| Meeting → people          | `session_participants`, carrying `human_id` **and** a plain `email` (`:99-107`)                                                         |
| Calendar attendees        | `events.participants_json` (`crates/db-app/migrations/20260414120000_calendars_events.sql:29`)                                          |
| Recurring series          | `events.recurrence_series_id` (`:25`) and `sessions.series_id`                                                                          |
| Past meetings of a series | `buildPastSessionNotes` (`apps/desktop/src/session/insights/past-notes.ts:341`), already classifying `same_series` and `matching_title` |
| Summary consuming that    | `selectPreviousMeetings` in `apps/desktop/src/store/zustand/ai-task/task-configs/enhance-transform.ts`                                  |
| The UI slot               | `FolderPicker` in the session header (`apps/desktop/src/session/components/outer-header/index.tsx:106`)                                 |
| Per-setting storage       | `apps/desktop/src/settings/schema.ts`, path-addressed (`["general", …]`)                                                                |

The customer half is therefore mostly a matter of reading data the app already
stores.

## Data model

### `projects` (new table)

```sql
CREATE TABLE IF NOT EXISTS projects (
  id               TEXT PRIMARY KEY NOT NULL,
  workspace_id     TEXT NOT NULL DEFAULT '',
  owner_user_id    TEXT NOT NULL DEFAULT '',
  organization_id  TEXT NOT NULL DEFAULT '',
  name             TEXT NOT NULL DEFAULT '',
  memo             TEXT NOT NULL DEFAULT '',
  archived_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at       TEXT
) STRICT;
```

`organization_id` empty means an internal project. `archived_at` takes a
finished project out of the suggestion pool without deleting its history.

### `sessions` (two additive columns)

```sql
ALTER TABLE sessions ADD COLUMN organization_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN project_id      TEXT NOT NULL DEFAULT '';
```

Both additive with a default, so an older build still opens the database.
`folder_path` stays and is written with the project's name, so an older build
shows the assignment as a folder rather than nothing.

**The stored value is the truth, the rules are only a suggestion engine.** The
customer is not derived on read: a meeting can hold people from two
organizations, and an internal preparation meeting for a customer has no
external participant at all. What the rules produce, a person can always
override, and the override is never recomputed away.

**A project implies its customer.** Assigning a project whose
`organization_id` is set also sets the session's `organization_id`. Assigning a
customer never changes the project.

### Setting: our own domains

`["general", "own_email_domains"]`, a list. Without it the internal/external
distinction cannot work. Seeded on first run from the signed-in user's own email
domain, editable in Settings › General.

## Assignment rules

### Customer

In order, first match wins:

1. Participants who are known contacts with an `organization_id` → **assign** the
   organization with the most such participants. A tie goes to the customer
   assigned to a session most recently; a tie nothing can settle assigns
   nothing and offers both.
2. No such contact, but a participant's email domain matches the domain of a
   contact belonging to an organization → **suggest**.
3. Neither, and at least one participant is outside our own domains → **suggest
   creating** an organization named after that domain.
4. All participants are within our own domains, or there are none → internal,
   leave empty and suggest nothing.

The line between 1 and 2 is the important one. A confirmed contact is evidence;
a bare domain is an inference. A wrongly assigned meeting is worse than an
unassigned one, because nobody notices it.

Where the emails come from: `session_participants.email` for a running or
finished meeting, `events.participants_json` for a scheduled one, so the
customer can be shown before the meeting even starts.

### Project

Domains say nothing here — the same people sit in three projects. In order:

1. The meeting's recurring series was assigned to a project before → **assign**
   the same project. One recurring meeting is one project in practice, and this
   makes a jour fixe assign itself forever after a single confirmation.
2. Same customer, and the title closely matches earlier meetings of one of that
   customer's projects → **suggest** it.
3. Otherwise → **suggest** the customer's non-archived projects, most recently
   used first, plus "new project".

A model is not required for any of this. If one is used later for step 2, it
picks from the customer's existing projects and never invents a name — the same
discipline the tag suggester already applies.

## Interface

The `FolderPicker` slot in the session header becomes a customer/project
control, sitting next to the tag chips that already live there. Folders leave
the interface; the column stays behind for downgrade safety only.

- Unassigned meeting with a suggestion: the proposal is shown as a chip to
  confirm or dismiss — the interaction the tag suggestions already use, so
  nothing new to learn.
- Assigned meeting: customer and project shown, both changeable.
- The sidebar gets no customer surface. The customer lives on the meeting and
  is reachable through search, which is what makes indexing its name part of
  stage 1 rather than a nicety.

A suggestion is never silently applied except in the two deterministic cases
(known contact, series already assigned).

## Summary context

`buildPastSessionNotes` already classifies past meetings as `same_series` or
`matching_title`. A `same_project` relationship joins them, ranked above
`matching_title` and below `same_series`, and `selectPreviousMeetings` in
`enhance-transform.ts` feeds it into the prompt as it does today.

This is the real payoff: the summary stops seeing one recurring appointment and
starts seeing the project — jour fixe, workshop and ad-hoc call as one thread.

## Staging

**Stage 1 — customer.** The `organization_id` column, the own-domains setting,
the customer rules, the header control, and the customer's name in the search
index. No sidebar surface and no `project_id` yet: a column without a consumer
is not worth a migration.
No project table yet. Deliberately small and deterministic; two weeks of real
use show how well domain matching does here before anything is built on top.

**Stage 2 — project.** The `projects` table, the series rule, the project half
of the header control, the sidebar's customer/project tree, and folders leaving
the interface.

**Stage 3 — what it is all for.** `same_project` in the summary context, and the
identifiers in the export path.

## Risks

- **A wrong customer is invisible.** Mitigated by assigning only on a confirmed
  contact and suggesting everything else, but a mistaken confirmation stays
  until someone notices. The header control must make the current assignment
  visible at a glance rather than hiding it in a menu.
- **Freemailer domains.** A customer contact writing from a gmail.com address
  would attach every unrelated gmail participant to that customer. Rule 2 and 3
  must skip a list of public mail providers.
- **Two organizations in one meeting.** Settled by headcount, then by the most
  recently used customer, then not at all. The remaining exposure is a
  two-versus-one meeting where the larger party is not the customer — the
  person overrides, and the override stands.
- **The series rule inherits a mistake.** If a series was assigned to the wrong
  project, every later occurrence follows silently. Changing the project on one
  occurrence should ask whether the series should follow.
