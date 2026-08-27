# Phase 2 inventory: the desktop cloud surface

This inventory categorises every file the cloud-surface grep patterns touched in
`apps/desktop/src/`, so Tasks 5 through 8 can remove the cloud layer without
guessing. **Read the stop condition in "Step 4: numbers" before planning Task 5** —
this inventory finds `logic-branch` + `crate-boundary` well over the 60-file
threshold defined in the Task 4 brief, both under the brief's literal Step 1
commands alone and more so once known gaps in those commands are accounted for.

## CORRECTION, 2026-08-27 — `plugin-fs-sync` is not a cloud plugin

A follow-up spike established that **`plugin-fs-sync` must be kept**, and that this
inventory's treatment of it as a `crate-boundary` plugin to remove is wrong.

Evidence:

- Its 26 commands are all local filesystem operations — `audio_path`, `audio_import`,
  `session_dir`, `delete_session_folder`, `attachment_save`, `read_document_batch`,
  `create_folder`, and so on. None uploads, downloads or synchronises anything.
- **It has no network dependency**, neither in `plugins/fs-sync/Cargo.toml` nor in
  `crates/fs-sync-core`, where the implementation lives. It cannot reach a network.
- The single occurrence of the string `upload` is a local temporary filename,
  `audio-upload-{pid}-{nonce}.{ext}`, in the session directory.
- `crates/fs-sync-core` is also a dependency of `plugins/db`, a core plugin.

The `sync` in its name means filesystem synchronisation — persisting app state to disk
as files — not cloud synchronisation. Removing it would break recording (`audio_path`),
transcription (`useUploadFile`, `resume-listening`), attachments, session folders, and
document reads and writes.

### What this invalidates

Line 104 of this document records that 28 files were classified `crate-boundary`
**because of `plugin-fs-sync` alone**. Those classifications do not hold: importing
`@anlg/plugin-fs-sync` is not evidence of cloud coupling. The `crate-boundary` count of
58 is therefore overstated, by up to 28, and the `logic-branch` + `crate-boundary` total
of 169 with it.

**The tables below have not been recomputed.** Anyone planning from the `crate-boundary`
table must first re-derive it, treating a bare `@anlg/plugin-fs-sync` import as neutral.
Files with a dual concern — `audio-player/provider.tsx` pairs an fs-sync import with an
`isPro` gate — still belong somewhere, just not here on fs-sync's account.

### The same test applied to the other three plugins

| Plugin                   | Network deps | Command semantics                                                                        | Verdict        |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------------- | -------------- |
| `plugin-fs-sync`         | none         | local filesystem layout                                                                  | **keep**       |
| `plugin-attachment-sync` | **none**     | `prepare_upload`, `download_and_restore`, `download_shared_attachment`, plus `anlg-e2ee` | remove — cloud |
| `plugin-auth`            | supabase     | authentication                                                                           | remove — cloud |
| `plugin-relay`           | reqwest      | relay                                                                                    | remove — cloud |

Note `plugin-attachment-sync`: it has **no** network dependency either, so a
dependency check alone would have cleared it. It is the local half of a cloud transfer —
it encrypts, chunks and stages uploads, and something else performs the HTTP. **Absence
of a network dependency does not prove a component is local.** In both cases the command
names decided it.

## Step 1: raw hit counts (as run)

```
grep -rn -E "isPro|useSubscription|billing|checkout|cloudSync|CloudSync" apps/desktop/src/   → 2664 hits, 309 distinct files
grep -rn -E "plugin-auth|useAuth|@anlg/supabase|@anlg/pricing|@anlg/api-client" apps/desktop/src/ → 201 hits, 98 distinct files
```

Union of both patterns: **370 distinct files**. Of those, **218 are generated
i18n locale catalogs** (`apps/desktop/src/i18n/locales/*/messages.{po,ts}` —
every one of the 109 locales, both formats) that only contain translated
strings like "Manage billing" or "Finish checkout in your browser" as message
text. They carry zero code logic and are excluded from the four category
tables below (see "Excluded: generated i18n catalogs"). That leaves **152
distinct source files** matching Step 1's literal patterns — this is the
number the four tables below are built from, plus a documented supplementary
set (see "Known gaps in Step 1's patterns").

## Methodology notes — read before using the tables

- **Distinct files, not grep hits.** 2664 + 201 raw hits collapse to 152 real
  source files once the i18n catalogs and duplicate hits within a file are
  removed. Where a file matched both grep patterns, it appears once, in one
  table.
- **`crate-boundary` scope.** The brief names four plugins:
  `plugin-auth`, `plugin-relay`, `plugin-attachment-sync`, `plugin-fs-sync`.
  This inventory also treats a direct import of `@anlg/supabase` or
  `@supabase/supabase-js` as crate-boundary, on the reasoning that the
  Supabase client is the session/storage boundary `plugin-auth` wraps — Task 8
  cannot delete `plugin-auth` and packages/supabase separately without also
  touching every file that imports the Supabase client directly. `@anlg/api-client`
  and `@anlg/pricing` are **not** folded in here — they are typed HTTP/business
  packages, not session/storage clients — so files that only touch those are
  `logic-branch`.
- **`apps/desktop/src/auth/` whole-directory rule.** All 29 files in this
  directory (15 hit Step 1's patterns, 14 more are the internal `cloudsync-*`
  modules Step 1 missed — see gaps below) are classified `crate-boundary`
  regardless of which specific import each one uses. Collectively this
  directory _is_ the wrapper module around `@anlg/plugin-auth` +
  `@supabase/supabase-js` + `plugin-db`'s cloudsync commands; Task 8 must
  delete or fully rewrite it as one unit, not file by file.
- **Fifth table: `plugin-db-cloud-commands`.** `plugin-db` is the core SQLite
  plugin and **stays permanently** (per AGENTS.md). It also exposes
  cloud-only commands (`beginCloudsyncActivity`, `endCloudsyncActivity`,
  `getCloudsyncStatus`, `bindCloudsyncAccount`, `suspendCloudsync*`,
  `configureCloudsyncToken`, `configureE2eeReplica`, …). Files that call these
  do not fit `crate-boundary` under the brief's literal definition (not one of
  the four named plugins) — but they are real cloud coupling that will break
  if left uncategorised, since Task 8 has no reason to touch a plugin that
  isn't being deleted. This is the "fifth table" the brief allows for cloud
  coupling that doesn't fit the four categories.
- **Ambiguous files:** where a file mixes two concerns (e.g. an `isPro` UI
  lock _and_ a direct plugin import), it is listed once in the higher-risk
  table per the brief's rule (`crate-boundary` > `logic-branch` > `ui-gate`),
  with the secondary concern noted in that row.

## Step 4: numbers

| Category                               | Files (this inventory, 152+49=201) | Files (Step 1's literal 152 only) |
| -------------------------------------- | ---------------------------------- | --------------------------------- |
| `import-only`                          | 4                                  | 4                                 |
| `ui-gate`                              | 16                                 | 16                                |
| `logic-branch`                         | 111                                | 99                                |
| `crate-boundary`                       | 58                                 | 25                                |
| `plugin-db-cloud-commands` (5th table) | 12                                 | 8                                 |
| **`logic-branch` + `crate-boundary`**  | **169**                            | **124**                           |

**The stop condition is triggered, decisively, under either count.** Even
restricting the count to files Step 1's exact grep commands surfaced (no
supplementary search at all), `logic-branch` + `crate-boundary` = 124 — more
than double the 60-file threshold. Including the supplementary files found
while investigating known gaps in Step 1's patterns (see below), the total is
169. **Per the brief: stop before Task 5. Phase 2 needs its own spec.** This
document is still complete and usable as the starting inventory for that
follow-up spec.

## Known gaps in Step 1's patterns

Step 1's two grep commands, run exactly as specified, systematically miss
real cloud coupling for three reasons. Each was investigated and folded into
the tables below (49 additional files beyond the 152 Step-1 hits), clearly
marked. Reviewers of Task 5-8 plans should be aware these exist even though
they won't show up if Step 1's commands are re-run verbatim:

1. **Case sensitivity.** The pattern uses `cloudSync|CloudSync`, but much of
   the codebase spells it `cloudsync` (all lowercase, e.g. `cloudsync.ts`,
   `cloudsync_workspace_binding` SQL key) or `Cloudsync` (capital C only,
   e.g. `bindCloudsyncAccount`). A case-insensitive re-run
   (`grep -rliE "cloudsync" apps/desktop/src/`) finds 181 files, 32 of them
   entirely new — including the core `apps/desktop/src/auth/cloudsync*.ts`
   implementation files themselves.
2. **Missing plugin names.** Step 1 searches for `plugin-auth` but not
   `plugin-relay`, `plugin-attachment-sync`, or `plugin-fs-sync`, even though
   the brief's own `crate-boundary` definition names all four.
   `plugin-attachment-sync` is imported directly by 4 files Step 1 misses;
   `plugin-fs-sync` by 28, most of them core session/query/STT files
   (`session/index.tsx`, `session/queries/*`, `stt/useUploadFile.ts`, …), not
   a peripheral feature. `plugin-relay` has **zero** references anywhere in
   `apps/desktop/src/` — confirmed via a plain string search — but is still
   wired into `apps/desktop/package.json`, `apps/desktop/vite.config.ts`, and
   `apps/desktop/src-tauri/Cargo.toml` (outside `src/`, outside this
   inventory's scope, but Task 8 will need to touch those files too).
3. **`~/shared/billing.ts` itself.** Only its test file
   (`apps/desktop/src/shared/billing.test.ts`) matched Step 1's patterns; the
   implementation file did not (it doesn't literally contain "billing" as a
   distinct token in a way grep's word patterns catch inline — worth a
   direct look before Task 6 edits it).

The 49 supplementary files are included in the tables below, each
individually flagged as found beyond Step 1's literal commands.

## import-only

4 files. Each is a **regex false positive** — the grep pattern matched but
there is no real symbol, import, or behavioural coupling. Zero-risk, no
decision needed beyond confirming and moving on.

| File                                                           | Symbol matched | Note                                                                                                        |
| -------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/chat/components/input/index.tsx`             | isProcessing   | Regex false match: `isProcessing` state var, unrelated to `isPro`/billing. No cloud coupling.               |
| `apps/desktop/src/settings/developers/devtools.tsx`            | billing        | "billing dialogs" appears only in translated UI copy describing the devtools panel; no import or gate.      |
| `apps/desktop/src/settings/general/storage/legacy-cleanup.tsx` | CloudSync      | "CloudSync" appears only inside a code comment explaining retry timing; no import, no symbol used.          |
| `apps/desktop/src/shared/utils.ts`                             | checkout       | `/app/checkout` is one literal in a deep-link route-string union type; removing it is a one-line type edit. |

## ui-gate

> **CORRECTION, 2026-08-27 — this table is not the complete set of upgrade prompts.**
>
> Applying it removed the paywall from the sixteen files listed, but three
> user-visible upgrade prompts survive because they were never classified here:
>
> | File                                    | Prompt                   | Attached to                                    |
> | --------------------------------------- | ------------------------ | ---------------------------------------------- |
> | `settings/ai/stt/select.tsx:913`        | "Upgrade to use"         | the `cloud` STT model (`model.id === "cloud"`) |
> | `settings/todo/provider-content.tsx:92` | `onClick={upgradeToPro}` | todo provider connections, gated on `isPaid`   |
> | `settings/todo/github.tsx:106`          | `onClick={upgradeToPro}` | GitHub todo connections, gated on `isPaid`     |
>
> Each is attached to a cloud feature that a later stage removes, so the prompt
> goes with its feature rather than being stripped on its own. **But do not treat
> "the paywall is gone" as true until those three are handled.**
>
> Two rows of the table below could also not be applied in isolation and are
> deferred, not skipped:
>
> - `billing/trial-started-dialog.tsx` and its test — `auth/billing.tsx:25` imports
>   `TrialStartedDialog` for the live trial flow. Goes when `auth/` goes.
> - `settings/ai/stt/context.tsx` and its test — `settings/ai/stt/select.tsx:40`
>   imports `useSttSettings` from it. Goes when the hosted-STT model does.
>
> The lesson for the remaining tables: this inventory was built from grep patterns,
> and a prompt phrased "Upgrade to use" matches none of
> `isPro|useSubscription|billing|checkout|cloudSync|CloudSync`. Before planning from
> any table here, search for the _user-visible copy_ as well as the symbols.

16 files. Every row's Decision column is final — Task 6 should apply it
without re-deciding. All of these ship unconditionally except the two
trial/CTA-only files, which are removed outright since Session Echo has no
subscription to sell.

| File                                                     | Symbol                          | Gated feature / note                                                                  | Decision                                                      |
| -------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/desktop/src/audio-player/timeline.tsx`             | isPro                           | Locks scrub/speed UI variant behind Pro.                                              | ships unconditionally                                         |
| `apps/desktop/src/billing/trial-started-dialog.test.tsx` | TrialStartedDialog              | Test of the dialog.                                                                   | removed                                                       |
| `apps/desktop/src/billing/trial-started-dialog.tsx`      | TrialStartedDialog              | Post-trial-start upsell dialog.                                                       | removed (no trials without subscription)                      |
| `apps/desktop/src/devtools-panel/host.tsx`               | useBillingAccess / Trial*Dialog | Dev-only preview switches for billing/trial dialogs.                                  | removed (dev-only preview of a feature that no longer exists) |
| `apps/desktop/src/main/useShortcuts.test.tsx`            | useBillingAccess (isPro:true)   | Peripheral mock so the shortcuts provider tree renders; not exercising billing logic. | ships unconditionally (test infra only)                       |
| `apps/desktop/src/onboarding/account/after-login.tsx`    | PRO_TRIAL_DAYS                  | Displays trial-length copy after cloud login.                                         | removed (trial copy gone with onboarding sign-in step)        |
| `apps/desktop/src/settings/ai/stt/context.test.tsx`      | upgradeToPro                    | Test of context.tsx.                                                                  | removed                                                       |
| `apps/desktop/src/settings/ai/stt/context.tsx`           | upgradeToPro                    | "Upgrade to try hosted STT" CTA alongside local-model download queueing.              | removed (CTA only; local-model download logic stays)          |
| `apps/desktop/src/settings/appearance/app-icon.test.tsx` | billing.isPro                   | Test of app-icon.tsx.                                                                 | ships unconditionally                                         |
| `apps/desktop/src/settings/appearance/app-icon.tsx`      | billing.isPro                   | Locks certain app icons behind Pro.                                                   | ships unconditionally (all icons free)                        |
| `apps/desktop/src/settings/dictionary/index.test.tsx`    | isPro                           | Test of dictionary settings.                                                          | ships unconditionally                                         |
| `apps/desktop/src/settings/dictionary/index.tsx`         | isPro                           | Locks custom dictionary behind Pro.                                                   | ships unconditionally                                         |
| `apps/desktop/src/sidebar/settings.test.tsx`             | requiresPro / isPro             | Test of sidebar settings.                                                             | ships unconditionally                                         |
| `apps/desktop/src/sidebar/settings.tsx`                  | requiresPro / isPro             | Lock icon on sidebar settings entries flagged requiresPro.                            | ships unconditionally (drop the lock)                         |
| `apps/desktop/src/templates/auto-form.test.tsx`          | billing.isPro                   | Test of auto-form.                                                                    | ships unconditionally                                         |
| `apps/desktop/src/templates/auto-form.tsx`               | billing.isPro                   | Locks/upsells auto-form fields and actions behind Pro throughout the file.            | ships unconditionally                                         |

## logic-branch

111 files. Where a file is part of a wholesale cloud-only feature with no
local equivalent (session-sharing, shared-notes, team/workspace, calendar
OAuth, automations, meeting-import-sync, cloud-api, enterprise-capture),
the Decision says "no local arm" — these are removal candidates for the
whole file/feature, not a branch to prune. Files marked "(test file)" mirror
their non-test counterpart's decision.

| File                                                                             | Symbol                                       | Behaviour / note                                                                                                                                                                                                                                                  | Decision                                                                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/ai/hooks/useLLMConnection.ts`                                  | useAuth/useBillingAccess (isPaid)            | Selects the hosted "anarlog" cloud LLM provider vs local/BYOK providers.                                                                                                                                                                                          | keep every non-"anarlog" provider branch; drop the hosted arm                                                              |
| `apps/desktop/src/ai/traced-fetch.ts`                                            | CharTask (api-client type)                   | Auth-fetch wrapper used only by the hosted "anarlog" LLM branch above.                                                                                                                                                                                            | dead once the hosted branch is removed                                                                                     |
| `apps/desktop/src/attachment-sync/lifecycle.test.tsx`                            | same                                         | Test of lifecycle.tsx.                                                                                                                                                                                                                                            | (test file)                                                                                                                |
| `apps/desktop/src/attachment-sync/lifecycle.tsx`                                 | useAuth/useBillingAccess/cloudSyncEnabled    | Gates whether the attachment transfer lifecycle runs at all.                                                                                                                                                                                                      | local arm: lifecycle never runs (no cloud sync)                                                                            |
| `apps/desktop/src/attachment-sync/store.test.ts`                                 | cloudSyncEnabled                             | Test asserting the sync-job field.                                                                                                                                                                                                                                | (test file)                                                                                                                |
| `apps/desktop/src/attachment-sync/store/jobs.ts`                                 | cloudSyncEnabled                             | Maps DB column cloud_sync_enabled into the job model.                                                                                                                                                                                                             | drop the field/branch                                                                                                      |
| `apps/desktop/src/attachment-sync/store/types.ts`                                | cloudSyncEnabled                             | Type field on the sync job model.                                                                                                                                                                                                                                 | drop the field                                                                                                             |
| `apps/desktop/src/automations/engine.test.ts`                                    | @anlg/api-client                             | Test of engine.ts.                                                                                                                                                                                                                                                | (test file)                                                                                                                |
| `apps/desktop/src/automations/engine.ts`                                         | @anlg/api-client                             | Automation engine executes steps (Slack/Notion/Linear) via the hosted API client.                                                                                                                                                                                 | no local arm; whole automations feature is cloud-only                                                                      |
| `apps/desktop/src/calendar/components/calendar-view.tsx`                         | useBillingAccess/useConnections              | Fetches calendar data for connected (OAuth) accounts.                                                                                                                                                                                                             | local arm: Apple Calendar stays; Google/Outlook OAuth removed                                                              |
| `apps/desktop/src/calendar/components/oauth/provider-content.tsx`                | isPro/useAuth                                | Gates the Google/Outlook calendar OAuth connect flow behind Pro+auth.                                                                                                                                                                                             | removed; Apple Calendar (native, no cloud) is the local arm                                                                |
| `apps/desktop/src/calendar/components/sidebar.test.tsx`                          | same                                         | Test of sidebar.tsx.                                                                                                                                                                                                                                              | (test file)                                                                                                                |
| `apps/desktop/src/calendar/components/sidebar.tsx`                               | isPro/isPaid/useAuth                         | Same OAuth-provider gate inside the calendar sidebar.                                                                                                                                                                                                             | removed; Apple Calendar stays                                                                                              |
| `apps/desktop/src/cloud-api/lifecycle.tsx`                                       | useAuth (session.user.id)                    | Runs a cloud-API backfill lifecycle keyed on the signed-in user.                                                                                                                                                                                                  | no local arm; whole cloud-api/ directory (4 files) is cloud-only, remove wholesale                                         |
| `apps/desktop/src/contacts/queries.test.tsx` _(gap: not in Step 1's hits)_       | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/contacts/queries.ts` _(gap: not in Step 1's hits)_             | cloudsync_workspace_binding (raw SQL)        | Query behaviour keyed on presence of a workspace-binding settings row.                                                                                                                                                                                            | drop the binding gate                                                                                                      |
| `apps/desktop/src/devtools-panel/recurring-notes.ts`                             | cloudsync_workspace_binding (raw SQL)        | Throws if the local app_settings row lacks a cloud workspace binding.                                                                                                                                                                                             | drop the binding requirement                                                                                               |
| `apps/desktop/src/editor-bridge/task-storage.test.ts` _(gap)_                    | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/editor-bridge/task-storage.ts` _(gap)_                         | cloudsync_workspace_binding (raw SQL)        | Same workspace-binding gate pattern.                                                                                                                                                                                                                              | drop the binding gate                                                                                                      |
| `apps/desktop/src/enterprise-capture/lifecycle.test.tsx`                         | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/enterprise-capture/lifecycle.tsx`                              | useAuth (session) + team workspaces          | Client-side remnant of the removed enterprise/ tree: polls a VITE_ENTERPRISE_API_URL server for the signed-in user's workspaces.                                                                                                                                  | no local arm; cloud-only, likely dead now that enterprise/ (Task 1) and the hosted API (Task 2) are gone — flag for Task 6 |
| `apps/desktop/src/error-reporting.test.ts`                                       | same                                         | Test of error-reporting.ts.                                                                                                                                                                                                                                       | (test file)                                                                                                                |
| `apps/desktop/src/error-reporting.ts`                                            | USER_ERROR_MARKERS (billing strings)         | Suppresses Sentry reporting for known billing/quota error strings.                                                                                                                                                                                                | drop the billing-specific markers; keep the BYOK-key markers (invalid api key etc.)                                        |
| `apps/desktop/src/imports/connected-import.test.ts`                              | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/imports/connected-import.ts`                                   | @anlg/api-client                             | Cloud-connected import source (Notion/Linear/etc.) via the hosted API.                                                                                                                                                                                            | no local arm for this source; local file import stays elsewhere                                                            |
| `apps/desktop/src/imports/queries.ts` _(gap)_                                    | cloudsync_workspace_binding (raw SQL)        | Same pattern.                                                                                                                                                                                                                                                     | drop the binding gate                                                                                                      |
| `apps/desktop/src/imports/screen.test.tsx`                                       | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/imports/screen.tsx`                                            | useAuth                                      | Gates the connected-import options in the import screen.                                                                                                                                                                                                          | remove cloud-connected options; local file import stays                                                                    |
| `apps/desktop/src/instruction/index.tsx`                                         | type === "billing"                           | Routes the instruction screen to checkout/billing copy.                                                                                                                                                                                                           | remove the billing instruction branch                                                                                      |
| `apps/desktop/src/main/lifecycle.tsx`                                            | useAuth + cloud lifecycle components         | Mounts AttachmentTransferLifecycle and CloudsyncKeychainRepairToast, registers auth-aware tools.                                                                                                                                                                  | drop cloud lifecycle mounts; keep local tool registration                                                                  |
| `apps/desktop/src/main/sync-status.test.tsx`                                     | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/main/sync-status.tsx`                                          | isPro/isReady/useAuth                        | Entire cloud-sync status widget gated on Pro+session.                                                                                                                                                                                                             | removed (no cloud sync status without cloud sync)                                                                          |
| `apps/desktop/src/onboarding/account/before-login.tsx`                           | useAuth                                      | Cloud sign-in step of onboarding.                                                                                                                                                                                                                                 | remove sign-in step                                                                                                        |
| `apps/desktop/src/onboarding/account/index.tsx`                                  | auth?.session                                | Routes onboarding between BeforeLogin/AfterLogin based on session.                                                                                                                                                                                                | remove branch; no account step                                                                                             |
| `apps/desktop/src/onboarding/account/trial.tsx`                                  | useAuth/useBillingAccess/api-client          | Entire trial-start flow.                                                                                                                                                                                                                                          | removed (no trials without subscription)                                                                                   |
| `apps/desktop/src/onboarding/calendar.tsx`                                       | isPro/useAuth                                | Gates Outlook/Google calendar OAuth onboarding step.                                                                                                                                                                                                              | local arm: Apple Calendar selection stays                                                                                  |
| `apps/desktop/src/onboarding/index.tsx`                                          | useAuth, didSkipLogin                        | Orchestrates onboarding steps; a "didSkipLogin" local-continue path already exists.                                                                                                                                                                               | keep the skip-login path as the only path                                                                                  |
| `apps/desktop/src/routes/app/instruction.tsx`                                    | type === "billing", useAuth                  | Route wrapper for the billing instruction screen.                                                                                                                                                                                                                 | remove billing branch                                                                                                      |
| `apps/desktop/src/services/calendar/storage.test.ts` _(gap)_                     | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/services/calendar/storage.ts` _(gap)_                          | cloudsync_workspace_binding (raw SQL)        | Same pattern.                                                                                                                                                                                                                                                     | drop the binding gate                                                                                                      |
| `apps/desktop/src/services/meeting-import-sync.test.tsx`                         | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/services/meeting-import-sync.tsx`                              | useAuth (signedIn)                           | Entire meeting-import-sync feature gated on cloud sign-in.                                                                                                                                                                                                        | no local arm; cloud-only feature, remove wholesale                                                                         |
| `apps/desktop/src/session-sharing/attachment-controls.test.tsx`                  | cloudSyncEnabled                             | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/session-sharing/attachments.test.ts`                           | cloudSyncEnabled                             | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/session-sharing/comment-anchors.ts`                            | useAuth                                      | Session-sharing comments feature (cloud collaboration).                                                                                                                                                                                                           | no local arm; cloud-only, remove with the feature                                                                          |
| `apps/desktop/src/session-sharing/comments.test.tsx`                             | useAuth                                      | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/session-sharing/comments.tsx`                                  | useAuth                                      | Comment authorship gated on session.                                                                                                                                                                                                                              | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/session-sharing/delivery-panel.tsx`                            | useAuth                                      | Share-delivery panel.                                                                                                                                                                                                                                             | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/session-sharing/draft-panel.tsx`                               | useAuth                                      | Share-draft panel.                                                                                                                                                                                                                                                | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/session-sharing/index.test.tsx`                                | billing/useAuth mocks                        | Large test file for the session-sharing panel.                                                                                                                                                                                                                    | (test file)                                                                                                                |
| `apps/desktop/src/session-sharing/index.tsx`                                     | billing.isPaid/useAuth                       | Session-sharing panel; also renders a SessionShareUpgradeContent upsell (ui-gate-like) inside a broader cloud-only flow.                                                                                                                                          | no local arm; whole feature is cloud-only, remove wholesale                                                                |
| `apps/desktop/src/session-sharing/management-operation.ts`                       | useAuth (type)                               | Management-operation types keyed on auth.                                                                                                                                                                                                                         | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/session-sharing/management-panel.tsx`                          | useAuth                                      | Sharing management panel.                                                                                                                                                                                                                                         | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/session-sharing/management.ts`                                 | useAuth                                      | Sharing management logic.                                                                                                                                                                                                                                         | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/session-sharing/reconciliation.test.ts`                        | cloudSyncEnabled                             | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/session-sharing/source.ts` _(gap)_                             | cloudsync_workspace_binding (raw SQL)        | Same pattern, inside the (cloud-only) session-sharing feature.                                                                                                                                                                                                    | removed with session-sharing/                                                                                              |
| `apps/desktop/src/session-sharing/sync.test.tsx`                                 | useAuth                                      | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/session-sharing/sync.tsx`                                      | useAuth (session)                            | Session-sharing sync.                                                                                                                                                                                                                                             | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/session-sharing/workspace-policy.ts`                           | useAuth                                      | Sharing workspace policy.                                                                                                                                                                                                                                         | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/session/attachments.test.ts`                                   | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/session/attachments.ts`                                        | setAttachmentCloudSyncEnabled                | DB setter toggling an attachment's cloud-sync flag.                                                                                                                                                                                                               | drop the setter/column usage                                                                                               |
| `apps/desktop/src/session/components/note-input/enhanced/enhance-error.test.tsx` | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/session/components/note-input/enhanced/enhance-error.tsx`      | useAuth                                      | Shows a "sign in" error state for the cloud AI-enhance feature.                                                                                                                                                                                                   | depends on whether AI-enhance keeps a cloud arm; flag for Task 6                                                           |
| `apps/desktop/src/session/queries/creation.ts` _(gap)_                           | cloudsync_workspace_binding (raw SQL)        | Same pattern.                                                                                                                                                                                                                                                     | drop the binding gate                                                                                                      |
| `apps/desktop/src/settings/ai/llm/select.tsx`                                    | useAuth/useBillingAccess (isPaid)            | Selects hosted "anarlog" LLM provider vs other configured providers (same pattern as useLLMConnection.ts).                                                                                                                                                        | keep local/BYOK provider branches; drop hosted arm                                                                         |
| `apps/desktop/src/settings/ai/shared/index.tsx`                                  | billing.isPaid                               | Generic "requires pro entitlement" check reused across AI provider settings rows.                                                                                                                                                                                 | drop the entitlement check; treat all providers as available                                                               |
| `apps/desktop/src/settings/ai/stt/select.tsx`                                    | billing.isPaid                               | Canonical cloud-vs-local STT provider selection (hosted "anarlog" STT vs local Whisper models).                                                                                                                                                                   | keep local-stt branch; drop hosted arm                                                                                     |
| `apps/desktop/src/settings/automations/index.test.tsx`                           | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/settings/automations/index.tsx`                                | billing.isPro                                | Gates enabling/saving automations (which are themselves cloud-API-driven).                                                                                                                                                                                        | no local arm; automations feature is cloud-only                                                                            |
| `apps/desktop/src/settings/automations/starter-config.tsx`                       | useAuth/api-client                           | Automation starter configs (Slack/Notion/Linear) via the hosted API.                                                                                                                                                                                              | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/settings/developers/cloud-api.tsx`                             | billing.isReady && billing.isPro             | Gates a query enabling the cloud-api dev settings panel.                                                                                                                                                                                                          | removed with cloud-api/                                                                                                    |
| `apps/desktop/src/settings/developers/index.test.tsx`                            | billing.isPro mocks                          | Test of the developers settings screen.                                                                                                                                                                                                                           | (test file)                                                                                                                |
| `apps/desktop/src/settings/general/account.test.tsx`                             | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/settings/general/account.tsx`                                  | useAuth/@anlg/pricing, checkout/billing URLs | The cloud account-management screen itself: sign-in/out, checkout, billing refresh, trial. **Hardest to categorise** (see report) — effectively _is_ the account feature; arguably belongs with crate-boundary despite not importing the plugin package directly. | no local arm; remove wholesale                                                                                             |
| `apps/desktop/src/settings/general/default-share-access.test.tsx`                | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/settings/general/default-share-access.tsx`                     | useAuth                                      | Default session-sharing access setting.                                                                                                                                                                                                                           | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/settings/general/index.test.tsx`                               | mutateCloudSync/useAuth/billing mocks        | Test of the general settings screen.                                                                                                                                                                                                                              | (test file)                                                                                                                |
| `apps/desktop/src/settings/general/tier-actions.test.ts`                         | @anlg/pricing getActionForTier               | Test of pricing-tier action mapping.                                                                                                                                                                                                                              | (test file)                                                                                                                |
| `apps/desktop/src/settings/queries.test.tsx` _(gap)_                             | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/settings/queries.ts` _(gap)_                                   | cloudsync_workspace_binding (raw SQL)        | Same pattern.                                                                                                                                                                                                                                                     | drop the binding gate                                                                                                      |
| `apps/desktop/src/settings/sync/index.test.tsx`                                  | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/settings/sync/index.tsx`                                       | isPro/useAuth                                | Entire cloud-sync settings screen gated on Pro+session.                                                                                                                                                                                                           | removed wholesale (2-file directory)                                                                                       |
| `apps/desktop/src/settings/team/index.test.tsx`                                  | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/settings/team/index.tsx`                                       | billing.isPro/useAuth                        | Team/workspace settings screen; mixes isPro UI locks with real network calls via auth headers.                                                                                                                                                                    | no local arm; team/workspace is a cloud-only feature                                                                       |
| `apps/desktop/src/settings/team/mirror.ts`                                       | useAuth                                      | Team data mirroring.                                                                                                                                                                                                                                              | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/settings/todo/github.tsx`                                      | useAuth/useBillingAccess                     | GitHub todo-provider integration (OAuth via cloud relay).                                                                                                                                                                                                         | flag for Task 6: does GitHub integration keep a non-OAuth local arm?                                                       |
| `apps/desktop/src/settings/todo/provider-content.tsx`                            | useAuth/useBillingAccess                     | Generic todo-provider OAuth content.                                                                                                                                                                                                                              | same as above                                                                                                              |
| `apps/desktop/src/shared-notes/attachment-cache-lifecycle.tsx`                   | useAuth (session)                            | Shared-notes attachment cache lifecycle.                                                                                                                                                                                                                          | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/shared-notes/index.test.tsx`                                   | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/shared-notes/index.tsx`                                        | useAuth                                      | Shared-notes viewer feature.                                                                                                                                                                                                                                      | no local arm; cloud-only, remove wholesale (18-file directory, only some files matched Step 1)                             |
| `apps/desktop/src/shared-notes/sync.test.tsx`                                    | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/shared-notes/sync.tsx`                                         | useAuth (session, supabase)                  | Shared-notes sync; obtains a supabase client via the auth wrapper (close to crate-boundary, chose logic-branch since it's one layer removed).                                                                                                                     | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/shared/billing.test.ts`                                        | waitForBillingUpdate                         | Tests a billing-event-wait helper (`~/shared/billing.ts` itself wasn't caught by Step 1's patterns — see gaps above).                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/shared/deeplink.test.ts`                                       | /billing/refresh route                       | Tests deep-link routing including the billing-refresh path.                                                                                                                                                                                                       | drop the billing-refresh case                                                                                              |
| `apps/desktop/src/shared/hooks/useDeeplinkHandler.ts`                            | useAuth, /billing/refresh                    | Handles the billing-refresh deep link.                                                                                                                                                                                                                            | drop the billing-refresh branch                                                                                            |
| `apps/desktop/src/shared/integration.ts`                                         | useAuth/api-client (createSession)           | Powers the OAuth integration-connect flow.                                                                                                                                                                                                                        | no local arm for OAuth integrations                                                                                        |
| `apps/desktop/src/shared/long-load-gate.tsx` _(gap)_                             | "configuring_cloudsync" state                | App boot loading-state machine has a cloud-configuration step.                                                                                                                                                                                                    | drop the state/case                                                                                                        |
| `apps/desktop/src/shared/main-app-layout.test.tsx`                               | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/shared/main-app-layout.tsx`                                    | BillingProvider                              | Mounts the entire cloud billing provider around the app shell.                                                                                                                                                                                                    | remove the provider mount                                                                                                  |
| `apps/desktop/src/shared/open-note-dialog.test.tsx`                              | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/shared/open-note-dialog.tsx`                                   | useAuth (session)                            | Session-gated "open note" dialog, part of shared-notes.                                                                                                                                                                                                           | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/sidebar/shared-notes.test.tsx`                                 | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/sidebar/shared-notes.tsx`                                      | useAuth (session)                            | Sidebar entry point into shared notes.                                                                                                                                                                                                                            | no local arm; cloud-only                                                                                                   |
| `apps/desktop/src/sidebar/timeline/index.test.tsx`                               | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/sidebar/timeline/index.tsx`                                    | useAuth (session)                            | Timeline viewer identity for shared/collaborative sessions.                                                                                                                                                                                                       | keep timeline for local sessions; drop the session/viewer-identity branch                                                  |
| `apps/desktop/src/sidebar/toast/index.test.tsx`                                  | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/sidebar/toast/index.tsx`                                       | useAuth                                      | Toast actions include "sign in" prompts.                                                                                                                                                                                                                          | drop the sign-in-prompt branch                                                                                             |
| `apps/desktop/src/stt/useRunBatch.test.ts`                                       | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/stt/useRunBatch.ts`                                            | billing.isPaid/useAuth                       | Gates hosted STT batch transcription vs local.                                                                                                                                                                                                                    | keep local-stt branch; drop hosted arm                                                                                     |
| `apps/desktop/src/stt/useSTTConnection.test.ts`                                  | same                                         | Test.                                                                                                                                                                                                                                                             | (test file)                                                                                                                |
| `apps/desktop/src/stt/useSTTConnection.ts`                                       | billing.isPaid/useAuth                       | Canonical cloud-vs-local STT websocket connection gate.                                                                                                                                                                                                           | keep local-stt branch; drop hosted arm                                                                                     |

## crate-boundary

58 files. These drive Task 8. Files marked _(gap)_ were found via
supplementary search beyond Step 1's literal commands (see "Known gaps"
above) — mostly direct `@anlg/plugin-fs-sync` imports Step 1's patterns never
searched for.

| File                                                                                 | Symbol                                                                               | Note                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/desktop/src/attachment-sync/client.ts`                                         | @anlg/supabase/attachment-backups                                                    | `export * from` re-export.                                                                                                                                   |
| `apps/desktop/src/attachment-sync/native.test.ts` _(gap)_                            | @anlg/plugin-attachment-sync                                                         | Test; vi.mock's the plugin directly.                                                                                                                         |
| `apps/desktop/src/attachment-sync/native.ts` _(gap)_                                 | @anlg/plugin-attachment-sync                                                         | Direct plugin command import.                                                                                                                                |
| `apps/desktop/src/attachment-sync/runner.test.ts`                                    | @anlg/supabase/storage                                                               | Test of runner.ts.                                                                                                                                           |
| `apps/desktop/src/attachment-sync/runner.ts`                                         | @anlg/supabase/storage                                                               | Calls uploadPrivateAttachment directly; also branches on job.cloudSyncEnabled (ambiguous with logic-branch, chose higher-risk crate-boundary).               |
| `apps/desktop/src/audio-player/provider.tsx`                                         | @anlg/plugin-fs-sync + isPro                                                         | Dual concern: direct plugin-fs-sync import for local audio resolution, AND isPro gates playback rate (ui-gate concern). Chose crate-boundary as higher risk. |
| `apps/desktop/src/auth/auth-analytics.ts`                                            | @anlg/plugin-auth, @anlg/supabase                                                    | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/auth-context.ts`                                              | @supabase/supabase-js (Session/SupabaseClient types)                                 | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/billing-context.ts`                                           | @anlg/supabase (BillingInfo type)                                                    | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/billing.test.tsx`                                             | @anlg/plugin-auth, @anlg/api-client (mocked)                                         | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/billing.tsx`                                                  | @anlg/plugin-auth, @anlg/supabase                                                    | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/client.ts`                                                    | @supabase/supabase-js, @anlg/plugin-auth                                             | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync-configuration.ts` _(gap)_                           | @anlg/plugin-db (configureCloudsyncToken)                                            | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync-credentials.test.ts` _(gap)_                        | @anlg/plugin-db (module under test)                                                  | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync-credentials.ts` _(gap)_                             | @anlg/plugin-db                                                                      | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync-keychain-repair.test.tsx`                           | useAuth (module member, test)                                                        | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync-keychain-repair.tsx`                                | useAuth (module member)                                                              | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync-progress.test.ts`                                   | @anlg/plugin-db (module under test)                                                  | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync-progress.ts` _(gap)_                                | @anlg/plugin-db (getCloudsyncStatus)                                                 | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync-session-evictions.ts` _(gap)_                       | @anlg/plugin-fs-sync, @anlg/plugin-db                                                | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync-token-exchange.ts` _(gap)_                          | internal ./cloudsync-credentials (module member)                                     | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync-workspace-keys.test.ts` _(gap)_                     | @anlg/plugin-db (module under test)                                                  | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync-workspace-keys.ts` _(gap)_                          | @anlg/plugin-db (sealWorkspaceE2eeKeyForRecipients)                                  | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync.test.ts`                                            | @anlg/plugin-db (module under test)                                                  | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/cloudsync.ts` _(gap)_                                         | @supabase/supabase-js, @anlg/plugin-db                                               | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/context.test.tsx`                                             | @anlg/plugin-auth, @anlg/supabase (mocked)                                           | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/context.tsx` _(gap)_                                          | @supabase/supabase-js, @anlg/plugin-misc, @anlg/plugin-windows, internal ./cloudsync | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/errors.ts`                                                    | @supabase/supabase-js, @anlg/plugin-auth                                             | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/index.ts`                                                     | re-exports useAuth (module barrel)                                                   | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/sync-devices.test.ts`                                         | @anlg/plugin-db (module under test)                                                  | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/sync-devices.ts` _(gap)_                                      | @anlg/plugin-db (E2eeDeviceEnrollmentPackage type)                                   | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/auth/useConnections.ts`                                            | @anlg/api-client (module member)                                                     | In apps/desktop/src/auth/ — see "whole-directory rule" above.                                                                                                |
| `apps/desktop/src/calendar/components/session-chip.tsx` _(gap)_                      | @anlg/plugin-fs-sync                                                                 | Direct plugin command import.                                                                                                                                |
| `apps/desktop/src/chat/context/entities.ts`                                          | @anlg/plugin-auth (AccountInfo type)                                                 | Type-only import from plugin-auth; ambiguous with import-only, chose crate-boundary (direct plugin dependency, higher risk).                                 |
| `apps/desktop/src/session-sharing/attachments.ts`                                    | @anlg/supabase/storage                                                               | Calls uploadSharedAttachment directly.                                                                                                                       |
| `apps/desktop/src/session/components/note-input/transcript/actions.test.tsx` _(gap)_ | @anlg/plugin-fs-sync / withCloudsyncActivity                                         | Test of actions.ts; "CloudSync deferred" in test description.                                                                                                |
| `apps/desktop/src/session/components/note-input/transcript/actions.ts` _(gap)_       | @anlg/plugin-fs-sync                                                                 | Direct plugin command import; also calls withCloudsyncActivity (plugin-db wrapper, dual concern).                                                            |
| `apps/desktop/src/session/components/outer-header/overflow/misc.tsx` _(gap)_         | @anlg/plugin-fs-sync                                                                 | Direct plugin command import.                                                                                                                                |
| `apps/desktop/src/session/hooks/useAttachmentResolver.ts` _(gap)_                    | @anlg/plugin-fs-sync                                                                 | Direct plugin command import.                                                                                                                                |
| `apps/desktop/src/session/index.tsx` _(gap)_                                         | @anlg/plugin-fs-sync                                                                 | Direct plugin command import in a large, central session file — **hardest to categorise** (see report).                                                      |
| `apps/desktop/src/session/move-contents.test.ts` _(gap)_                             | @anlg/plugin-fs-sync                                                                 | Test; vi.mock's the plugin directly.                                                                                                                         |
| `apps/desktop/src/session/move-contents.ts` _(gap)_                                  | @anlg/plugin-fs-sync                                                                 | Direct plugin command import.                                                                                                                                |
| `apps/desktop/src/session/queries.test.ts` _(gap)_                                   | @anlg/plugin-fs-sync                                                                 | Test; vi.mock's the plugin directly. Also asserts on cloudsync_workspace_binding SQL (dual concern).                                                         |
| `apps/desktop/src/session/queries/deletion.ts` _(gap)_                               | @anlg/plugin-fs-sync                                                                 | Direct plugin command import.                                                                                                                                |
| `apps/desktop/src/shared-notes/preview.test.tsx`                                     | @anlg/plugin-attachment-sync                                                         | Test of preview.tsx.                                                                                                                                         |
| `apps/desktop/src/shared-notes/preview.tsx`                                          | @anlg/plugin-attachment-sync                                                         | Direct plugin command import (attachmentSyncCommands) alongside useAuth.                                                                                     |
| `apps/desktop/src/shared/hooks/useFileUpload.test.tsx` _(gap)_                       | @anlg/plugin-fs-sync                                                                 | Test; vi.mock's the plugin directly.                                                                                                                         |
| `apps/desktop/src/shared/hooks/useFileUpload.ts` _(gap)_                             | @anlg/plugin-fs-sync                                                                 | Direct plugin command import.                                                                                                                                |
| `apps/desktop/src/sidebar/timeline/item.test.tsx` _(gap)_                            | @anlg/plugin-fs-sync                                                                 | Test; vi.mock's the plugin directly.                                                                                                                         |
| `apps/desktop/src/sidebar/timeline/item.tsx` _(gap)_                                 | @anlg/plugin-fs-sync                                                                 | Direct plugin command import.                                                                                                                                |
| `apps/desktop/src/store/zustand/ai-task/task-configs/enhance-images.test.ts` _(gap)_ | @anlg/plugin-fs-sync                                                                 | Test; vi.mock's the plugin directly.                                                                                                                         |
| `apps/desktop/src/store/zustand/ai-task/task-configs/enhance-images.ts` _(gap)_      | @anlg/plugin-fs-sync                                                                 | Direct plugin command import.                                                                                                                                |
| `apps/desktop/src/stt/audio-note-date.ts` _(gap)_                                    | @anlg/plugin-fs-sync (type)                                                          | Type-only import from plugin-fs-sync; ambiguous with import-only, chose crate-boundary.                                                                      |
| `apps/desktop/src/stt/render-transcript.ts` _(gap)_                                  | @anlg/plugin-fs-sync (type)                                                          | Type-only import from plugin-fs-sync; ambiguous with import-only, chose crate-boundary.                                                                      |
| `apps/desktop/src/stt/resume-listening.ts` _(gap)_                                   | @anlg/plugin-fs-sync                                                                 | Direct plugin command import; also calls acquireCloudsyncLease/releaseCloudsyncLease (plugin-db wrapper, dual concern).                                      |
| `apps/desktop/src/stt/useStartListening.test.ts` _(gap)_                             | @anlg/plugin-fs-sync                                                                 | Test; vi.mock's the plugin directly (SUT's transitive dependency).                                                                                           |
| `apps/desktop/src/stt/useUploadFile.test.tsx`                                        | @anlg/plugin-fs-sync                                                                 | Test of useUploadFile.ts.                                                                                                                                    |
| `apps/desktop/src/stt/useUploadFile.ts`                                              | @anlg/plugin-fs-sync                                                                 | Direct plugin command import; also uses withCloudsyncActivity from the plugin-db wrapper (dual concern, see 5th table).                                      |

## plugin-db-cloud-commands (fifth table)

12 files. Not one of the brief's four categories — see "Fifth table" in
Methodology notes above. `plugin-db` stays permanently; these files call its
cloud-only commands and need trimming as a separate, smaller effort with a
different owner than Task 8's plugin deletions.

| File                                                                                  | Symbol                                                                 | Note                                                                                                              |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/chat/components/session-provider.real-sdk.test.tsx`                 | same, test                                                             | plugin-db stays permanently; see Methodology notes above.                                                         |
| `apps/desktop/src/chat/components/session-provider.test.tsx`                          | same, test                                                             | plugin-db stays permanently; see Methodology notes above.                                                         |
| `apps/desktop/src/chat/components/session-provider.tsx` _(gap)_                       | createChatCloudsyncActivityController (consumer of the wrapper below)  | plugin-db stays permanently; see Methodology notes above.                                                         |
| `apps/desktop/src/chat/store/cloudsync-activity.test.ts`                              | beginCloudsyncActivity/endCloudsyncActivity (test)                     | plugin-db stays permanently; see Methodology notes above.                                                         |
| `apps/desktop/src/chat/store/cloudsync-activity.ts`                                   | beginCloudsyncActivity/endCloudsyncActivity                            | plugin-db stays permanently; see Methodology notes above.                                                         |
| `apps/desktop/src/db/cloudsync-activity.test.ts`                                      | same, test                                                             | plugin-db stays permanently; see Methodology notes above.                                                         |
| `apps/desktop/src/db/cloudsync-activity.ts`                                           | beginCloudsyncActivity/endCloudsyncActivity release manager            | plugin-db stays permanently; see Methodology notes above.                                                         |
| `apps/desktop/src/store/zustand/ai-task/task-configs/enhance-success.test.ts` _(gap)_ | same, test                                                             | plugin-db stays permanently; see Methodology notes above.                                                         |
| `apps/desktop/src/store/zustand/ai-task/task-configs/enhance-success.ts` _(gap)_      | beginCloudsyncActivity + releaseCloudsyncActivityEventually            | plugin-db stays permanently; see Methodology notes above.                                                         |
| `apps/desktop/src/stt/capture-lifecycle.ts`                                           | acquireCloudsyncLease/releaseCloudsyncActivityEventually               | plugin-db stays permanently; see Methodology notes above.                                                         |
| `apps/desktop/src/stt/useStartListening.ts`                                           | lifecycle.acquireCloudsyncLease/releaseCloudsyncLease                  | plugin-db stays permanently; see Methodology notes above.                                                         |
| `apps/desktop/src/test-setup.ts` _(gap)_                                              | global vitest mock of plugin-db cloudsync commands for the whole suite | **Hardest to categorise** — global test harness, not a feature file; changing it affects every test in the suite. |

## Excluded: generated i18n catalogs

218 files: `apps/desktop/src/i18n/locales/<locale>/messages.po` and
`messages.ts` for all 109 supported locales. Every one matched the Pro-gate
pattern because every locale's catalog contains translated strings like
"Manage billing", "Finish checkout in your browser, then return to Anarlog.",
and "Refresh billing status" — the localized UI copy for the very features
this inventory is tracking. None import any cloud package or contain logic;
they are lingui-generated build artifacts.

**No action needed on these files directly.** Per AGENTS.md, once the source
components (settings/general/account.tsx, billing/, instruction/, etc.) are
edited or removed in Task 6/7, run:

```
pnpm -F desktop exec lingui extract --clean --workers 1
pnpm -F desktop exec lingui compile --strict --workers 1
```

and commit the resulting catalog diff. Do not hand-edit `.po`/`messages.ts`
files.

## Concerns for Tasks 5–8

- **Whole-feature directories, not scattered gates.** Several directories are
  cloud-only end to end, with only a fraction of their files matching any
  grep pattern: `session-sharing/` (44 files total, 17 matched Step 1),
  `shared-notes/` (18 files, 7 matched), `settings/team/` (8 files),
  `settings/sync/` (2 files), `cloud-api/` (4 files), `automations/`, and the
  calendar OAuth flow. Task 6/7 planning should treat these as directory-level
  removals, not per-symbol edits — grep will keep missing sibling files in
  these directories that don't happen to mention `isPro`/`billing`/`useAuth`
  literally (e.g. plain type/util files with no direct symbol reference).
- **`apps/desktop/src/auth/` needs a design decision before Task 8, not just a deletion.**
  It's not a thin wrapper — 29 files, ~15 of them the actual cloudsync
  credential/E2EE/keychain machinery. Plan to replace it with something
  (even a no-op stub for `useAuth`) rather than delete-and-see-what-breaks,
  since dozens of consumer files across the app call `useAuth()` for
  `session`/`getHeaders()`.
- **`plugin-relay` is unreferenced in `apps/desktop/src/`.** Confirmed via a
  plain string search — zero hits. It's still wired into
  `apps/desktop/package.json`, `apps/desktop/vite.config.ts`, and
  `apps/desktop/src-tauri/Cargo.toml`, all outside this inventory's `src/`
  scope. Task 8 should still delete it, just without a TS consumer list to
  drive from.
- **`plugin-fs-sync` is not purely a "cloud" plugin.** It's imported directly
  by central, non-cloud-looking files: `session/index.tsx`,
  `session/queries/*`, `stt/useUploadFile.ts`, `stt/resume-listening.ts`,
  `sidebar/timeline/item.tsx`. Before Task 8 deletes it, someone needs to
  confirm whether all its commands are cloud-sync-specific or whether some
  are used for ordinary local file/attachment resolution that would need a
  replacement, not just removal.
- **The `cloudsync_workspace_binding` app_settings key is a recurring,
  undocumented gate.** At least 8 files (`contacts/queries.ts`,
  `editor-bridge/task-storage.ts`, `imports/queries.ts`,
  `services/calendar/storage.ts`, `session-sharing/source.ts`,
  `session/queries/creation.ts`, `settings/queries.ts`,
  `devtools-panel/recurring-notes.ts`) read this raw SQLite key directly by
  string literal, not through a shared helper. Task 6 should factor these
  into one removal, not eight independent edits.
- **`shared/billing.ts`** (the implementation, not its test) wasn't caught by
  Step 1's patterns at all — check it directly before editing anything in
  `~/auth/billing.tsx`, which imports `waitForBillingUpdate` from it.

## Hardest to categorise

1. `apps/desktop/src/settings/general/account.tsx` — the entire cloud
   account-management screen (sign-in, checkout, billing refresh, trial).
   Classified `logic-branch` because it only imports the `~/auth` wrapper and
   `@anlg/pricing`, not a named plugin directly — but it functionally _is_
   the account feature and arguably deserves crate-boundary-level caution.
2. `apps/desktop/src/test-setup.ts` — global vitest setup mocking
   plugin-db's cloudsync commands for the whole suite. Not a feature file at
   all; editing it affects every test, so it doesn't fit neatly into any of
   the five tables' risk model.
3. `apps/desktop/src/audio-player/provider.tsx` and
   `apps/desktop/src/stt/{useUploadFile.ts,resume-listening.ts}` — each mixes
   a direct `plugin-fs-sync` import (crate-boundary) with either an `isPro`
   UI gate or a `plugin-db` cloudsync-activity call (fifth table), forcing a
   choice between three legitimate categories in one file.
4. `apps/desktop/src/session/index.tsx` — a large, central session file that
   imports `plugin-fs-sync` directly. It's not a "cloud feature" file by any
   reading of its role, which makes the plugin-fs-sync removal in Task 8
   riskier than the other, more clearly cloud-only crate-boundary files.

## Pattern, recorded 2026-08-27 — components are mixed more often than not

Four components on this inventory's cloud list turned out not to match their label.
Each was established by reading command names and consumers, never by the label:

| Component                | Assumed                 | Actually                                                                                                                                                                                          |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin-fs-sync`         | cloud, remove           | **pure local** — 26 filesystem commands, no network dependency                                                                                                                                    |
| `plugin-attachment-sync` | cloud, remove           | cloud — but with **no network dependency**, so a dependency check alone would have cleared it                                                                                                     |
| `automations/`           | cloud directory, remove | **mixed** — a local rules engine whose action list includes cloud destinations (Linear, Notion, Slack) alongside `plugin-local-api`                                                               |
| `plugins/todo`           | dead end to end         | **mixed** — the integration half called the deleted API, but `github_issue_state/detail/comments` render GitHub previews through the **public** API with no auth, and two live consumers use them |

The `plugins/todo` case is the sharpest: the evidence for "dead" was `env!("VITE_API_URL")`
in `lib.rs`. That was true of the connection half and false of the preview half, and a
literal deletion would have broken `editor-bridge/app-link-view.tsx` and
`task/resource-view.tsx`.

**Before removing anything else on this inventory, establish what each of its commands
or exports actually does and who calls them.** Neither the name, nor the directory, nor
the dependency list has been sufficient — in all four cases only the command semantics
and the consumer list settled it.
