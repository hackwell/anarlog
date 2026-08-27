# Session Echo Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the anarlog monorepo into Session Echo — a local-only, MIT-licensed meeting recorder for macOS, with no cloud dependency and a signed, notarized release under the Flagbit Developer ID.

**Architecture:** Subtractive refactor in dependency order. First delete what nothing depends on (the commercially licensed `enterprise/` tree, the standalone cloud apps, the vendor docs). Then remove cloud _usage_ from the desktop app, which turns its cloud crates into orphans that can be deleted mechanically. Only then rename, because renaming a smaller tree is cheaper and the deletions remove most brand strings for free. Identity, infrastructure, signing, and license hygiene follow as independent phases.

**Tech Stack:** Rust (Tauri 2, axum-free after Phase 1), TypeScript/React, pnpm workspaces, turbo, Lingui i18n, SQLite, whisper.cpp, Pyannote, dprint, oxlint.

**Spec:** `docs/superpowers/specs/2026-08-27-session-echo-rebrand-design.md`

## Global Constraints

- Product name: `Session Echo`
- Bundle IDs: `de.flagbit.sessionecho` (stable), `de.flagbit.sessionecho.dev`, `de.flagbit.sessionecho.staging`
- Deeplink scheme: `sessionecho` (replaces `anarlog-dev`, `hypr`, `char`)
- Domain: `sessionecho.flagbit.de`
- Signing identity: `Developer ID Application: Flagbit GmbH & Co. KG (P87KBU95SJ)`
- Apple Team ID secret already present as `APPLE_TEAM_ID`
- App data folder: `sessionecho`, with `anarlog` honoured as legacy folder when it holds data
- Locales after Phase 3: `de`, `en` only. `sourceLocale` stays `en`
- License: MIT. The `Copyright (c) 2023-present Fastrepl, Inc.` line MUST survive in `LICENSE` verbatim. Flagbit copyright is added, never substituted
- Never introduce a new outbound network host. Model downloads go to `huggingface.co` only
- Formatting: `pnpm exec dprint fmt` before every commit, then `pnpm fmt:check`
- Commits: Conventional Commits, English, on branch `chore/session-echo-rebrand`
- No commit may leave `cargo check --all-targets` or `pnpm -F desktop typecheck` failing.
  **`--all-targets` is not optional.** Plain `cargo check` skips `#[cfg(test)]` code, and
  `apps/cli` pulled deleted documentation in via `include_str!` inside a test — the break
  was invisible to `cargo check` and to CI's own lint job, but `cargo test -p anarlog-cli`
  fails on it. After any deletion, check with `--all-targets`.

## Ordering note (refines the spec)

The spec lists cloud crate and plugin removal in Phase 1. That order does not
build: `apps/desktop/src-tauri/Cargo.toml` depends on `tauri-plugin-auth`,
`tauri-plugin-relay`, `tauri-plugin-attachment-sync` and `tauri-plugin-fs-sync`,
so deleting them before removing their usage breaks the tree. This plan moves
those deletions into Phase 2, after usage removal. Phase 1 is restricted to
deletions with zero reverse dependencies.

## File Structure

Phase 1 and 2 are almost entirely deletions. These files are _modified_ rather
than deleted and carry the real risk:

| File                                                                                               | Responsibility                                  | Touched in |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------- |
| `Cargo.toml`                                                                                       | workspace members + 147 `anlg-*` path aliases   | 1, 2       |
| `pnpm-workspace.yaml`                                                                              | package globs                                   | 1          |
| `package.json` (root)                                                                              | `dev:web` and sibling scripts                   | 1          |
| `apps/desktop/src-tauri/Cargo.toml`                                                                | plugin and crate wiring                         | 2          |
| `apps/desktop/src-tauri/tauri.conf.json`                                                           | identifier, productName, deeplink, updater      | 3, 4       |
| `crates/storage/src/global.rs`                                                                     | app data folder resolution + legacy migration   | 3          |
| `crates/detect/src/list/competitors.rs`                                                            | foreign-app detection list — must NOT be sed'ed | 3          |
| `apps/desktop/lingui.config.ts`                                                                    | locale list                                     | 3          |
| `crates/whisper-local-model/src/lib.rs`, `crates/am/src/model.rs`, `crates/local-model/src/lib.rs` | model download URLs                             | 4          |
| `plugins/notification/src/{commands,handler}.rs`, `plugins/windows/src/ext.rs`                     | analytics call sites in kept plugins            | 4          |
| `.github/workflows/desktop_cd.yaml`, `desktop_publish.yaml`                                        | signing and release                             | 5          |
| `LICENSE`, `NOTICE`, `README.md`                                                                   | license hygiene                                 | 6          |

---

## Phase 1 — Deletions with zero reverse dependencies

### Task 1: Remove the commercially licensed enterprise tree

**Files:**

- Delete: `enterprise/` (entire directory)
- Delete: `LICENSE.enterprise`, `LICENSING.md`
- Delete: `.github/workflows/enterprise_ci.yaml`
- Modify: `README.md` — remove the enterprise licensing lines

**Interfaces:**

- Consumes: nothing
- Produces: a tree containing no commercially licensed code. Later tasks may assume `enterprise/` does not exist.

- [ ] **Step 1: Prove nothing depends on it**

```bash
cd /Users/weller/Development/anarlog
grep -rn "enterprise" --include="Cargo.toml" --include="package.json" . \
  --exclude-dir=node_modules --exclude-dir=target --exclude-dir=enterprise
```

Expected: no output. Any hit is a real dependency and must be resolved before deleting.

- [ ] **Step 2: Delete**

```bash
git rm -r -q enterprise LICENSE.enterprise LICENSING.md .github/workflows/enterprise_ci.yaml
```

- [ ] **Step 3: Strip enterprise mentions from README**

Remove these lines from `README.md`: the `Source-visible enterprise components are commercially licensed.` sentence in the leading note, the `| enterprise/ | ... |` table row, the `Contributions outside enterprise/ ...` line, and the `- Enterprise components: [commercial](LICENSE.enterprise)` bullet under `## License`.

- [ ] **Step 4: Verify the tree still builds**

```bash
cargo check 2>&1 | tail -5
```

Expected: `Finished` with no errors. `enterprise/` was its own cargo workspace, so the root workspace is unaffected.

- [ ] **Step 5: Format and commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "chore: remove commercially licensed enterprise tree

The enterprise/ directory is not covered by the repository MIT license
and requires a written agreement with Fastrepl, Inc. Session Echo is
local-only and does not use server-side meeting capture."
```

### Task 2: Remove the standalone cloud apps

**Files:**

- Delete: `apps/api`, `apps/web`, `apps/mobile`, `apps/watch`, `apps/stripe`
- Delete: `.github/workflows/{api_cd,api_ci,web_cd,web_ci,mobile_ci,stripe_cd,bot_cd,bot_ci,chrome_cd,chrome_ci,pro_api_e2e,openstatus,content-check,submit_flathub,download_staging,extensions_cd,slack_internal_cd,eval_run}.{yaml,yml}`
- Modify: `Cargo.toml` — drop `"apps/api"` from `workspace.members`
- Modify: `package.json` — drop `dev:web`
- Modify: `pnpm-workspace.yaml` — drop `examples/plugins/*` and `e2e/*` if those directories are removed; otherwise leave untouched

**Interfaces:**

- Consumes: Task 1's tree
- Produces: a workspace whose only apps are `apps/desktop` and `apps/cli`. Orphans four crates (`api-cloud`, `api-sync`, `api-subscription`, `api-pyannote`) which Task 4 collects.

- [ ] **Step 1: Confirm the desktop app does not depend on them**

```bash
grep -rn "apps/api\|@anlg/web\|@anlg/mobile" apps/desktop/package.json apps/desktop/src-tauri/Cargo.toml apps/cli
```

Expected: no output.

- [ ] **Step 2: Delete the apps**

```bash
git rm -r -q apps/api apps/web apps/mobile apps/watch apps/stripe
```

- [ ] **Step 3: Delete the workflows that referenced them**

```bash
cd .github/workflows
git rm -q api_cd.yaml api_ci.yaml web_cd.yaml web_ci.yaml mobile_ci.yaml \
  stripe_cd.yaml bot_cd.yaml bot_ci.yaml chrome_cd.yaml chrome_ci.yaml \
  pro_api_e2e.yaml openstatus.yaml content-check.yml submit_flathub.yaml \
  download_staging.yaml extensions_cd.yaml slack_internal_cd.yaml eval_run.yaml
cd ../..
```

If any filename does not exist, drop it from the command rather than creating it.

- [ ] **Step 4: Drop `apps/api` from the cargo workspace**

In `Cargo.toml`, remove the `"apps/api",` line from `workspace.members`.

- [ ] **Step 5: Drop the `dev:web` script**

In the root `package.json`, remove the `"dev:web": "pnpm -F @anlg/web dev"` entry.

- [ ] **Step 6: Reinstall and verify**

```bash
pnpm install
cargo check 2>&1 | tail -5
pnpm -F desktop typecheck
```

Expected: all three succeed. `pnpm install` rewrites the lockfile — that is intended and must be committed.

- [ ] **Step 7: Format and commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "chore: remove cloud apps and their workflows

Session Echo ships desktop and CLI only. The hosted API, marketing site,
mobile, watch and Stripe apps are standalone workspace members with no
desktop dependency."
```

### Task 3: Remove the vendor documentation site

**Files:**

- Delete: everything under `docs/` except `docs/superpowers/`
- Delete: `docs/LICENSE` (Mintlify template license, no longer applicable)

**Interfaces:**

- Consumes: Task 2's tree
- Produces: `docs/` containing only `docs/superpowers/{specs,plans}`.

- [ ] **Step 1: See what is there**

```bash
ls -1 docs/
```

- [ ] **Step 2: Delete everything but the superpowers subtree**

```bash
find docs -mindepth 1 -maxdepth 1 -not -name superpowers -exec git rm -r -q {} +
```

- [ ] **Step 3: Verify the spec and plan survived**

```bash
ls -1 docs/superpowers/specs docs/superpowers/plans
```

Expected: both this plan and the design spec are still listed. If not, `git checkout` them from HEAD before continuing.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: remove Mintlify documentation site

docs.anarlog.so is upstream infrastructure. Session Echo documentation
will live at sessionecho.flagbit.de."
```

---

## Phase 2 — Remove cloud usage from the desktop app

> **DEFERRED after Task 4, by human decision on 2026-08-27.**
>
> Task 4's inventory fired the stop condition decisively: `logic-branch` plus
> `crate-boundary` came to 124 files using this plan's own grep commands and 169
> once gaps in those commands were closed, against a threshold of 60. Task 4 also
> showed `apps/desktop/src/auth/` to be a 10,170-line E2EE and keychain subsystem
> holding both the cloud half and the local-credential half the app still needs —
> replacement design work, not deletion.
>
> **Tasks 5 through 8 are not executed from this plan.** Phase 2 gets its own
> brainstorm and spec, using `docs/superpowers/plans/phase2-inventory.md` as its
> input. Execution continues at Task 9.
>
> Consequence for the rest of this plan: the cloud code stays in the tree. It is
> already inert — Task 2 deleted the hosted API it talked to — but it is present,
> and later tasks must neither assume it is gone nor claim in user-facing text
> that it is.

This is the phase with real uncertainty. 309 files match Pro-gate patterns and
118 match auth patterns, but those numbers come from grep, not from reading.
Task 4 exists to convert that guess into a list before any code is touched.

### Task 4: Inventory the cloud surface

**Files:**

- Create: `docs/superpowers/plans/phase2-inventory.md`

**Interfaces:**

- Consumes: Task 3's tree
- Produces: `phase2-inventory.md`, a categorised list that Tasks 5 through 8 work from. Categories are exactly: `import-only`, `ui-gate`, `logic-branch`, `crate-boundary`.

- [ ] **Step 1: Collect the raw hit lists**

```bash
cd /Users/weller/Development/anarlog
grep -rn -E "isPro|useSubscription|billing|checkout|cloudSync|CloudSync" apps/desktop/src/ \
  > /tmp/se-pro-hits.txt
grep -rn -E "plugin-auth|useAuth|@anlg/supabase|@anlg/pricing|@anlg/api-client" apps/desktop/src/ \
  > /tmp/se-auth-hits.txt
wc -l /tmp/se-pro-hits.txt /tmp/se-auth-hits.txt
```

- [ ] **Step 2: Categorise every hit**

Read both files. For each distinct source file, decide which single category fits and record it:

- `import-only` — the symbol is imported but never used, or used only in dead code. Deletion is a one-line change.
- `ui-gate` — the symbol guards rendering (`{isPro && <X/>}`, a paywall dialog, an upsell banner). Removal means deciding whether the gated feature ships unconditionally or disappears. Note the decision per file.
- `logic-branch` — the symbol changes behaviour (picks a cloud STT provider over a local one, routes a sync call). Removal needs the local branch kept and the cloud branch dropped.
- `crate-boundary` — the file talks to `plugin-auth`, `plugin-relay`, `plugin-attachment-sync` or `plugin-fs-sync` directly. These drive Task 8.

- [ ] **Step 3: Write the inventory**

Create `docs/superpowers/plans/phase2-inventory.md` with one table per category:

```markdown
## ui-gate

| File                 | Symbol | Gated feature | Decision                        |
| -------------------- | ------ | ------------- | ------------------------------- |
| apps/desktop/src/... | isPro  | ...           | ships unconditionally / removed |
```

Every file from Step 1 must appear in exactly one table. A file left out is a file that breaks the build later.

- [ ] **Step 4: Report the real numbers**

State in the inventory's opening paragraph how many files fall into each
category. If `logic-branch` plus `crate-boundary` exceeds 60 files, stop and
report back before starting Task 5 — that would mean the phase needs splitting
into its own spec.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/phase2-inventory.md
git commit -m "docs(plan): inventory the desktop cloud surface"
```

### Task 5: Remove import-only cloud references

**Files:**

- Modify: every file in the inventory's `import-only` table

**Interfaces:**

- Consumes: `phase2-inventory.md`
- Produces: a tree where no file imports a cloud symbol without using it.

- [ ] **Step 1: Establish the baseline**

```bash
pnpm -F desktop typecheck && pnpm -F desktop test
```

Expected: both pass. If they already fail, fix or record that before changing anything — otherwise you cannot tell your own breakage apart from pre-existing breakage.

- [ ] **Step 2: Delete the unused imports**

Work through the `import-only` table one file at a time, removing the import statement and any now-unreachable code it enabled.

- [ ] **Step 3: Verify**

```bash
pnpm -F desktop typecheck
pnpm exec oxlint --quiet --format=github apps/desktop/src/
```

Expected: typecheck passes; oxlint reports no new unused-import findings.

- [ ] **Step 4: Commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "refactor(desktop): drop unused cloud imports"
```

### Task 6: Remove Pro gates and billing UI

**Files:**

- Modify: every file in the inventory's `ui-gate` table
- Delete: `packages/pricing`
- Modify: `apps/desktop/package.json` — drop `@anlg/pricing`

**Interfaces:**

- Consumes: Task 5's tree, the per-file decisions recorded in the inventory
- Produces: a UI with no paywall, upsell or subscription surface. No component references `isPro` or `useSubscription`.

- [ ] **Step 1: Apply the recorded decision per file**

For each `ui-gate` row: if the decision was "ships unconditionally", remove the
condition and keep the child. If it was "removed", delete the gated component
and its now-unused imports. Do not re-decide here — the decision was made in
Task 4 with the whole picture in view.

- [ ] **Step 2: Delete the pricing package**

```bash
git rm -r -q packages/pricing
```

Then remove the `"@anlg/pricing": "workspace:*"` line from `apps/desktop/package.json`.

- [ ] **Step 3: Verify nothing references the removed surface**

```bash
grep -rn -E "isPro|useSubscription|@anlg/pricing" apps/desktop/src/ packages/ | grep -v "\.test\."
```

Expected: no output.

- [ ] **Step 4: Verify the app still typechecks and tests pass**

```bash
pnpm install
pnpm -F desktop typecheck && pnpm -F desktop test
```

- [ ] **Step 5: Commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "feat(desktop)!: remove subscription gates and billing UI

Session Echo has no paid tier. All previously gated local features ship
unconditionally."
```

### Task 7: Remove Supabase auth and cloud sync logic

**Files:**

- Modify: every file in the inventory's `logic-branch` table
- Delete: `packages/supabase`
- Modify: `apps/desktop/package.json` — drop `@anlg/supabase`

**Interfaces:**

- Consumes: Task 6's tree
- Produces: a desktop app with no account concept and no remote sync. Local STT and local LLM are the only providers reachable from the UI.

- [ ] **Step 1: Keep the local branch, drop the cloud branch**

For each `logic-branch` row: where the code chose between a cloud and a local
provider, delete the cloud arm and inline the local one. Where it performed a
sync call, delete the call and any state it fed.

- [ ] **Step 2: Delete the supabase package**

```bash
git rm -r -q packages/supabase
```

Then remove `"@anlg/supabase": "workspace:*"` from `apps/desktop/package.json`.

- [ ] **Step 3: Verify no account surface remains**

```bash
grep -rn -E "@anlg/supabase|signIn|signOut|createClient" apps/desktop/src/ | grep -v "\.test\."
```

Expected: no output, or only hits belonging to `plugin-local-auth`, which stays.

- [ ] **Step 4: Verify**

```bash
pnpm install && pnpm -F desktop typecheck && pnpm -F desktop test
cargo check 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "feat(desktop)!: remove Supabase auth and cloud sync

Local-only: no account, no remote sync. plugin-local-auth remains for
on-device credential storage."
```

### Task 8: Delete the orphaned cloud crates and plugins

**Files:**

- Modify: `apps/desktop/src-tauri/Cargo.toml` — drop `tauri-plugin-auth`, `tauri-plugin-relay`, `tauri-plugin-attachment-sync`, `tauri-plugin-fs-sync`, `anlg-db-sync`
- Delete: `plugins/auth`, `plugins/relay`, `plugins/attachment-sync`, `plugins/fs-sync`
- Delete: `crates/api-cloud`, `crates/api-sync`, `crates/api-subscription`, `crates/api-pyannote`, `crates/pyannote-cloud`, `crates/transcribe-proxy`, `crates/transcribe-soniqo`, `crates/openai-transcription`, `crates/llm-proxy`, `crates/db-sync`
- Modify: `Cargo.toml` — drop the matching `anlg-*` path aliases
- Modify: `apps/desktop/package.json` — drop the matching `@anlg/plugin-*` entries

**Interfaces:**

- Consumes: Task 7's tree, where nothing calls into these crates any more
- Produces: a workspace with no cloud crate. `api-auth`, `api-error`, `api-env` and `api-client` may survive if they still have consumers — Step 2 decides that mechanically, not by guess.

- [ ] **Step 1: Unwire the plugins from the desktop app**

Remove these lines from `apps/desktop/src-tauri/Cargo.toml`:

```toml
tauri-plugin-attachment-sync = { workspace = true }
tauri-plugin-auth = { workspace = true }
tauri-plugin-fs-sync = { workspace = true }
tauri-plugin-relay = { workspace = true }
anlg-db-sync = { workspace = true }
```

Then remove their `.plugin(...)` registrations from `apps/desktop/src-tauri/src/lib.rs` (or `main.rs`, whichever holds the builder chain) and the matching `@anlg/plugin-*` dependencies from `apps/desktop/package.json`.

- [ ] **Step 2: Find the true orphan set mechanically**

```bash
cd /Users/weller/Development/anarlog
for c in $(ls -1 crates plugins); do
  hits=$(grep -rl "anlg-$c\b\|tauri-plugin-$c\b" --include="Cargo.toml" \
    apps crates plugins 2>/dev/null | grep -v "/$c/Cargo.toml" | wc -l | tr -d ' ')
  [ "$hits" = "0" ] && echo "orphan: $c"
done
```

This lists every workspace member nothing depends on. Delete only what this
command reports — do not delete a crate because you expect it to be an orphan.

- [ ] **Step 3: Delete the orphans and re-run until the set is empty**

```bash
git rm -r -q crates/<orphan> plugins/<orphan>
```

Remove each deleted member's `anlg-*` alias from the root `Cargo.toml`. Then re-run Step 2 — deleting a crate can orphan its own dependencies. Repeat until Step 2 prints nothing.

- [ ] **Step 4: Verify**

```bash
pnpm install
cargo check 2>&1 | tail -5
pnpm -F desktop typecheck && pnpm -F desktop test
```

- [ ] **Step 5: Confirm the app still records and transcribes**

```bash
turbo dev:desktop
```

Start a recording, let it transcribe locally, stop it. Confirm the transcript appears. This is the first point where a human must look at the running app — the compiler cannot tell you that local STT still works.

- [ ] **Step 6: Prove the app makes no unexpected outbound connection**

This is the phase gate the spec demands, and the evidence for the product's
central claim. Reading the code is not sufficient — a forgotten fetch in a
dependency would not show up that way.

Start the capture, then exercise the app: launch it, record a meeting,
transcribe it, edit the note, quit.

```bash
sudo lsof -i -n -P -r 2 2>/dev/null | grep -i "session\|anarlog" > /tmp/se-net.log &
```

On macOS 15 and later, prefer a full capture:

```bash
sudo tcpdump -i any -n -q 'tcp[tcpflags] & tcp-syn != 0' -w /tmp/se-net.pcap
```

Stop the capture, then list every host the app contacted:

```bash
tcpdump -r /tmp/se-net.pcap -n 2>/dev/null | awk '{print $5}' | cut -d. -f1-4 | sort -u
```

Expected: only `huggingface.co` and its CDN (`cdn-lfs*.huggingface.co`), and only
while a model download is running. Any other host is a finding: identify the
caller before continuing to Phase 3.

- [ ] **Step 7: Record the evidence**

Append the host list and what was exercised to
`docs/superpowers/plans/phase2-network-evidence.md`. This file is the artefact a
customer security review will ask for.

- [ ] **Step 8: Commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "chore: delete orphaned cloud crates and plugins"
git add docs/superpowers/plans/phase2-network-evidence.md
git commit -m "docs: record outbound-traffic evidence for the local-only claim"
```

---

## Phase 3 — Identity

### Task 9: Rename the app data folder and simplify the legacy chain

**Files:**

- Modify: `crates/storage/src/global.rs:4-6` (constants), `:18-36` (resolution + helper), test module
- Test: `crates/storage/src/global.rs` test module (in-file, matches existing style)

**Interfaces:**

- Consumes: Task 3's tree (Tasks 5-8 deferred; the cloud code is still present and must be left alone)
- Produces: `compute_default_base(bundle_id) -> Option<PathBuf>` resolving to `<data_dir>/sessionecho` for stable builds, and to `<data_dir>/<bundle_id>` for debug and staging builds. `resolve_app_folder` keeps its signature `fn resolve_app_folder<'a>(data_dir: &Path, bundle_id: &'a str, is_debug: bool) -> &'a str` so callers are unaffected.

Upstream carries a legacy-folder chain (`hyprnote` → `anarlog`) that keeps the
old directory when it holds data. Session Echo is a fresh fork with no installed
base on the `anarlog` folder, so that branch is dead weight: it can only ever
pick a folder no Session Echo user has. It goes, along with `has_app_data`.

- [ ] **Step 1: Write the failing tests**

Replace the existing test module in `crates/storage/src/global.rs` with:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolve_app_folder_uses_sessionecho_for_stable_installs() {
        let temp = tempdir().unwrap();

        assert_eq!(
            resolve_app_folder(temp.path(), "de.flagbit.sessionecho", false),
            RELEASE_APP_FOLDER
        );
    }

    #[test]
    fn resolve_app_folder_ignores_a_populated_anarlog_folder() {
        let temp = tempdir().unwrap();
        let legacy = temp.path().join("anarlog");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("app.db"), "").unwrap();

        assert_eq!(
            resolve_app_folder(temp.path(), "de.flagbit.sessionecho", false),
            RELEASE_APP_FOLDER
        );
    }

    #[test]
    fn resolve_app_folder_uses_bundle_id_for_staging() {
        let temp = tempdir().unwrap();

        assert_eq!(
            resolve_app_folder(temp.path(), STAGING_BUNDLE_ID, false),
            STAGING_BUNDLE_ID
        );
    }

    #[test]
    fn resolve_app_folder_uses_bundle_id_in_debug() {
        let temp = tempdir().unwrap();

        assert_eq!(
            resolve_app_folder(temp.path(), "de.flagbit.sessionecho.dev", true),
            "de.flagbit.sessionecho.dev"
        );
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cargo test -p storage global 2>&1 | tail -20
```

Expected: FAIL. `RELEASE_APP_FOLDER` is still `"anarlog"`, so test one fails on the value and test two fails because the legacy branch still wins.

- [ ] **Step 3: Change the constants and drop the legacy branch**

In `crates/storage/src/global.rs`, replace lines 4 to 6 with:

```rust
const STAGING_BUNDLE_ID: &str = "de.flagbit.sessionecho.staging";
const RELEASE_APP_FOLDER: &str = "sessionecho";
```

Replace `resolve_app_folder` and delete `has_app_data`:

```rust
fn resolve_app_folder<'a>(_data_dir: &Path, bundle_id: &'a str, is_debug: bool) -> &'a str {
    if is_debug || bundle_id == STAGING_BUNDLE_ID {
        bundle_id
    } else {
        RELEASE_APP_FOLDER
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cargo test -p storage global 2>&1 | tail -20
```

Expected: 4 passed.

- [ ] **Step 5: Verify no caller broke**

```bash
cargo check 2>&1 | tail -5
```

Expected: `Finished`. If a warning names `_data_dir` as unused, that is expected — the parameter stays for signature stability.

- [ ] **Step 6: Commit**

```bash
cargo fmt -p storage
git add -A && git commit -m "feat(storage)!: resolve app data folder to sessionecho

Drops the hyprnote/anarlog legacy folder chain. Session Echo has no
installed base on those folders, so the branch could only ever select a
directory no user has."
```

### Task 10: Set product name, bundle identifier and deeplink scheme

**Files:**

- Modify: `apps/desktop/src-tauri/tauri.conf.json:3` (`productName`), `:5` (`identifier`), `:105-109` (deeplink schemes)
- Modify: every non-test file listed by Step 1 that carries the app's own bundle ID
- Leave untouched: `crates/detect/src/list/competitors.rs`

**Interfaces:**

- Consumes: Task 9's tree
- Produces: an app whose identifier is `de.flagbit.sessionecho.dev` in the dev profile and whose deeplink scheme is `sessionecho`.

- [ ] **Step 1: List every bundle-ID site and separate own from foreign**

```bash
cd /Users/weller/Development/anarlog
grep -rIn "com\.hyprnote\|com\.anarlog" --include="*.json" --include="*.toml" \
  --include="*.yaml" --include="*.rs" --include="*.ts" --include="*.tsx" . \
  --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git
```

`crates/detect/src/list/competitors.rs` lists `com.anarlog.stable` and
`com.hyprnote.stable` as _foreign apps to detect_, alongside `com.openai.chat`
and `com.apple.FaceTime`. Those two entries stay exactly as they are — they
describe other people's software. Every other hit is the app's own identity and
changes.

- [ ] **Step 2: Rewrite the tauri config**

In `apps/desktop/src-tauri/tauri.conf.json`:

```json
"productName": "Session Echo Dev",
"identifier": "de.flagbit.sessionecho.dev",
```

and replace the deeplink schemes block:

```json
"schemes": [
  "sessionecho"
]
```

- [ ] **Step 3: Rewrite the remaining own-identity sites**

Apply the mapping to every file from Step 1 except `competitors.rs`:

| Old                                          | New                              |
| -------------------------------------------- | -------------------------------- |
| `com.hyprnote.dev`, `com.anarlog.dev`        | `de.flagbit.sessionecho.dev`     |
| `com.hyprnote.stable`                        | `de.flagbit.sessionecho`         |
| `com.hyprnote.staging`                       | `de.flagbit.sessionecho.staging` |
| `com.hyprnote.nightly`                       | `de.flagbit.sessionecho.nightly` |
| `com.hyprnote.desktop`, `com.hyprnote.store` | `de.flagbit.sessionecho`         |

- [ ] **Step 4: Verify only the competitor list still mentions the old IDs**

```bash
grep -rIln "com\.hyprnote\|com\.anarlog" . \
  --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git
```

Expected: exactly one file, `crates/detect/src/list/competitors.rs`.

- [ ] **Step 5: Verify the app builds and launches**

```bash
cargo check 2>&1 | tail -5
pnpm -F desktop typecheck && pnpm -F desktop test
turbo dev:desktop
```

The window title must read `Session Echo Dev`. Confirm the app writes to a
directory named `de.flagbit.sessionecho.dev` (debug builds use the bundle ID):

```bash
ls -d ~/Library/Application\ Support/de.flagbit.sessionecho.dev
```

- [ ] **Step 6: Commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "feat: rename to Session Echo with de.flagbit bundle identifiers

Foreign bundle IDs in crates/detect competitor list are deliberately
left unchanged — they identify other vendors' apps."
```

### Task 11: Reduce locales to German and English

**Files:**

- Modify: `apps/desktop/lingui.config.ts` — `locales` array
- Delete: `apps/desktop/src/i18n/locales/<locale>/` for all locales except `de` and `en`
- Modify: regenerated catalogs under `apps/desktop/src/i18n/locales/{de,en}/`

**Interfaces:**

- Consumes: Task 10's tree
- Produces: two locale catalogs. Removes 107 directories and roughly 18,900 brand-name occurrences without a single manual edit.

- [ ] **Step 1: Reduce the locale list**

In `apps/desktop/lingui.config.ts`, replace the entire `locales` array with:

```ts
locales: ["de", "en"],
```

- [ ] **Step 2: Delete the abandoned catalogs**

```bash
cd /Users/weller/Development/anarlog/apps/desktop/src/i18n/locales
for d in */; do
  case "${d%/}" in de|en) ;; *) git rm -r -q "$d" ;; esac
done
cd /Users/weller/Development/anarlog
```

- [ ] **Step 3: Regenerate and compile**

```bash
pnpm -F desktop exec lingui extract --clean --workers 1
pnpm -F desktop exec lingui compile --strict --workers 1
```

Re-run both until the output stops changing — extraction is not always stable on the first pass.

- [ ] **Step 4: Run the CI check**

```bash
pnpm -F desktop i18n:check
```

Expected: pass with no uncommitted catalog diff.

- [ ] **Step 5: Confirm the brand-string count collapsed**

```bash
grep -riIo -E "anarlog|hyprnote|fastrepl" apps/desktop/src/i18n/locales | wc -l
```

Expected: a small number, from German or English source strings that still name the product. Those are fixed in Task 12.

- [ ] **Step 6: Commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "feat(i18n): reduce catalogs to de and en"
```

### Task 12: Sweep the remaining brand strings

**Files:**

- Modify: every file reported by Step 1
- Rename: `agent-plugins/anarlog/` → `agent-plugins/session-echo/`
- Modify: `apps/desktop/src-tauri/icons/{dev,staging,stable,src}/` — regenerate from the `brand/` master

**Interfaces:**

- Consumes: Task 11's tree
- Produces: a tree where `anarlog`, `hyprnote` and `fastrepl` appear only in `LICENSE`, `NOTICE`, `README.md` (as attribution) and `crates/detect/src/list/competitors.rs`.

- [ ] **Step 1: List what is left**

```bash
cd /Users/weller/Development/anarlog
grep -riIln -E "anarlog|hyprnote|fastrepl" . \
  --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git \
  --exclude="pnpm-lock.yaml" --exclude="Cargo.lock"
```

The locale catalogs are deliberately NOT excluded. `locales/en/messages.po` carries
172 `Anarlog` occurrences after Task 11 regenerates, and Step 5 verifies without an
exclusion, so skipping them here would guarantee a failure there.

- [ ] **Step 2: Replace user-visible strings**

Apply: `Anarlog` → `Session Echo`, `anarlog` → `sessionecho` in identifiers and paths, `anarlog.so` → `sessionecho.flagbit.de`. Skip `LICENSE`, `NOTICE`, `README.md` and `competitors.rs`.

Do not hand-edit `apps/desktop/src/i18n/locales/*/messages.po`. Those msgids are
generated from the source strings — fix the components, then regenerate in Step 3b.
A hand-edited catalog is overwritten on the next extraction, silently restoring the
old brand name.

Rename the published agent skill directory too:

```bash
git mv agent-plugins/anarlog agent-plugins/session-echo
```

Then sweep its contents for the old name.

- [ ] **Step 3: Regenerate the per-channel icon sets from the brand master**

`apps/desktop/src-tauri/icons/` is NOT a flat icon set. It holds one subdirectory
per release channel — `dev/` and `staging/` (5 files each), `stable/` (19 files,
including `android/`, `ios/` and the Windows `Square*Logo.png` store assets) — plus
`src/` holding the per-channel source PNGs. `tauri.conf.json` points at `icons/dev/*`.

The brand master is already committed at `brand/app-icon-1024.png` (1024×1024 RGBA
with alpha). Regenerate each channel from it:

```bash
cd /Users/weller/Development/anarlog
for ch in dev staging stable; do
  pnpm -F desktop exec tauri icon ../../brand/app-icon-1024.png \
    -o apps/desktop/src-tauri/icons/$ch
done
```

Verify `tauri icon` emitted the names `tauri.conf.json` expects — at minimum
`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` in `dev/`. If
a name differs, fix the config reference rather than renaming generated files.

Then replace the `anarlog-*.png` sources in `icons/src/` with the Session Echo
masters from `brand/`, and delete the leftover `anarlog-*` files.

All three channels intentionally use the same full-colour master, so dev and stable
look identical in the Dock. Do not invent per-channel artwork.

- [ ] **Step 2b: Remove the in-app documentation links**

Human decision on 2026-08-27: Session Echo publishes no documentation site, so these
links are removed rather than repointed. Rewriting them to `sessionecho.flagbit.de`
would turn links that work today into 404s.

Remove the link, its URL constant, the control that triggers it, and the matching
test assertion, at all 13 sites:

| File                                      | What                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| `settings/imports/index.tsx:10,22`        | `IMPORTS_DOCUMENTATION_URL` + its opener call             |
| `settings/ai/llm/shared.tsx:177,197,228`  | three `url:` fields (`#lm-studio`, `#ollama`, `#unsloth`) |
| `settings/sync/index.tsx:79,972`          | `SYNC_GUIDE_URL` + its opener call                        |
| `settings/developers/index.tsx:16,28`     | `DEVELOPERS_GUIDE_URL` + its opener call                  |
| `calendar/components/shared.tsx:31,41,51` | three `docsPath` fields                                   |
| `main/windows-title-bar.tsx:187`          | inline `openUrl("https://docs.anarlog.so")`               |

Also update `settings/imports/index.test.tsx` and `settings/sync/index.test.tsx`,
which assert on the removed URLs.

Where a field is part of a shared shape (`url:`, `docsPath:`), check whether the
field is optional before deleting it; if it is required, the surrounding UI element
goes too. Do not leave a button that opens nothing.

- [ ] **Step 3b: Regenerate the locale catalogs after the sweep**

```bash
pnpm -F desktop exec lingui extract --clean --workers 1
pnpm -F desktop exec lingui compile --strict --workers 1
pnpm -F desktop i18n:check
```

Re-run until output stops changing. Step 2 changed source strings, so the msgids
must be re-extracted before Step 5 can pass.

- [ ] **Step 4: Verify**

```bash
cargo check 2>&1 | tail -5
pnpm -F desktop typecheck && pnpm -F desktop test
pnpm exec oxlint --quiet --format=github apps/desktop/src/
```

- [ ] **Step 5: Confirm only intended mentions remain**

```bash
grep -riIln -E "anarlog|hyprnote|fastrepl" . \
  --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git \
  --exclude="pnpm-lock.yaml" --exclude="Cargo.lock"
```

Expected: `LICENSE`, `README.md` and `crates/detect/src/list/competitors.rs` only.

- [ ] **Step 6: Commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "feat: complete brand string sweep and swap app icons"
```

---

## Phase 4 — Replace third-party infrastructure

### Task 13: Repoint model downloads to HuggingFace

**Files:**

- Modify: `crates/whisper-local-model/src/lib.rs`, `crates/am/src/model.rs`, `crates/local-model/src/lib.rs`
- Delete: `scripts/s3/upload.sh`

**Interfaces:**

- Consumes: Task 12's tree
- Produces: model URLs pointing at `huggingface.co` only. No reference to `hyprnote.s3.us-east-1.amazonaws.com` remains anywhere.

The S3 paths are plain HuggingFace mirrors — the org and repo are encoded in the
path. `v0/{org}/{repo}/{branch}/{file}` maps to
`https://huggingface.co/{org}/{repo}/resolve/{branch}/{file}`. Verified: both the
whisper and the Llama URL return HTTP 200.

- [ ] **Step 1: List every URL to change**

```bash
cd /Users/weller/Development/anarlog
grep -rn "hyprnote.s3" crates/ scripts/
```

- [ ] **Step 2: Apply the mapping**

| Old                                                                                                        | New                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `https://hyprnote.s3.us-east-1.amazonaws.com/v0/ggerganov/whisper.cpp/main/<file>`                         | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/<file>`                         |
| `https://hyprnote.s3.us-east-1.amazonaws.com/v0/lmstudio-community/Llama-3.2-3B-Instruct-GGUF/main/<file>` | `https://huggingface.co/lmstudio-community/Llama-3.2-3B-Instruct-GGUF/resolve/main/<file>` |

- [ ] **Step 3: Remove the Parakeet models**

`v0/nvidia_parakeet-v2_476MB.tar` and `v0/nvidia_parakeet-v3_494MB.tar` are
custom-packaged tarballs with no HuggingFace equivalent at that path. Delete
their entries and any enum variant or match arm that referenced them. Whisper
covers the transcription path.

- [ ] **Step 4: Delete the S3 upload script**

```bash
git rm -q scripts/s3/upload.sh
```

- [ ] **Step 5: Verify every remaining URL resolves**

```bash
grep -rhoE "https://huggingface\.co/[^\"' )]+" crates/ | sort -u | while read -r u; do
  printf "%s  %s\n" "$(curl -sIL -o /dev/null -w '%{http_code}' "$u")" "$u"
done
```

Expected: every line starts with `200`. A `404` means the file name differs on HuggingFace and must be corrected.

- [ ] **Step 6: Verify no foreign host remains**

```bash
grep -rn "hyprnote.s3\|amazonaws" crates/ plugins/ apps/ scripts/
```

Expected: no output.

- [ ] **Step 7: Verify a real download**

```bash
cargo check 2>&1 | tail -5
turbo dev:desktop
```

Delete the local model cache first so the download actually runs, then download a Whisper model from the app's settings and confirm it completes and transcribes.

- [ ] **Step 8: Commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "feat(models): download from HuggingFace instead of upstream S3

Removes the dependency on a bucket we do not control. Parakeet models
are dropped — they were custom tarballs with no public equivalent."
```

### Task 14: Remove analytics and crash telemetry

**Files:**

- Delete: `crates/analytics`, `plugins/analytics`
- Modify: `plugins/notification/src/commands.rs`, `plugins/notification/src/handler.rs`, `plugins/windows/src/ext.rs`
- Modify: `plugins/notification/Cargo.toml`, `plugins/windows/Cargo.toml`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/package.json`, root `Cargo.toml`
- Modify: `.github/workflows/desktop_cd.yaml` — drop `POSTHOG_API_KEY`, `VITE_POSTHOG_API_KEY`, `SENTRY_DSN`

**Interfaces:**

- Consumes: Task 13's tree
- Produces: a binary containing no telemetry client. `plugins/notification` and `plugins/windows` keep their behaviour minus the event calls.

Analytics is removed rather than disabled. For a product whose selling point is
that nothing leaves the device, a customer code audit counts what is present,
not what is configured off.

- [ ] **Step 1: Find every call site**

```bash
cd /Users/weller/Development/anarlog
grep -rn "analytics\|Analytics" plugins/notification/src plugins/windows/src \
  apps/desktop/src-tauri/src apps/desktop/src | grep -v "\.test\."
```

- [ ] **Step 2: Delete the call sites in the kept plugins**

In `plugins/notification/src/commands.rs` and `plugins/notification/src/handler.rs`, remove the `use tauri_plugin_analytics::{AnalyticsPayload, AnalyticsPluginExt};` imports and every `app.analytics().event_fire_and_forget(...)` call including its payload construction. In `plugins/windows/src/ext.rs` around line 342, remove the inline `use` and the call it enables.

These calls are fire-and-forget side effects with no return value used, so removal cannot change control flow.

- [ ] **Step 3: Unwire and delete the crates**

Remove `tauri-plugin-analytics` from `apps/desktop/src-tauri/Cargo.toml` and its `.plugin(...)` registration, `anlg-analytics` from `plugins/notification/Cargo.toml` and `plugins/windows/Cargo.toml`, `@anlg/plugin-analytics` from `apps/desktop/package.json`, then:

```bash
git rm -r -q crates/analytics plugins/analytics
```

Remove the `anlg-analytics` and `tauri-plugin-analytics` aliases from the root `Cargo.toml`.

- [ ] **Step 4: Strip the telemetry secrets from CI**

In `.github/workflows/desktop_cd.yaml`, delete the `POSTHOG_API_KEY`, `VITE_POSTHOG_API_KEY` and `SENTRY_DSN` env lines (around lines 195 to 197).

- [ ] **Step 5: Verify nothing references telemetry**

```bash
grep -rni "posthog\|sentry\|analytics" --include="*.rs" --include="*.ts" \
  --include="*.tsx" --include="*.toml" --include="*.json" --include="*.yaml" . \
  --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git \
  --exclude="pnpm-lock.yaml" --exclude="Cargo.lock"
```

Expected: no output.

- [ ] **Step 6: Verify**

```bash
pnpm install
cargo check 2>&1 | tail -5
pnpm -F desktop typecheck && pnpm -F desktop test
```

- [ ] **Step 7: Commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "feat!: remove PostHog analytics and Sentry telemetry

Session Echo sends nothing. Removed rather than disabled so a code
audit finds no telemetry client present."
```

### Task 15: Configure the updater with an own signing key

**Files:**

- Modify: `apps/desktop/src-tauri/tauri.conf.json` — `updater.active`, `updater.pubkey`, `bundle.createUpdaterArtifacts`
- Create: the minisign keypair (private key never committed)

**Interfaces:**

- Consumes: Task 14's tree
- Produces: an app that verifies updates against a Flagbit-held key and a build that emits updater artifacts.

- [ ] **Step 1: Generate the keypair**

```bash
cd /Users/weller/Development/anarlog
pnpm -F desktop exec tauri signer generate -w ~/.tauri/sessionecho.key
```

This prints a public key and writes the private key to `~/.tauri/sessionecho.key`. The private key must never enter the repository.

- [ ] **Step 2: Store the private key as a repository secret**

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/sessionecho.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Run these against the new repository once it exists (Task 18). Until then, record that this step is pending.

- [ ] **Step 3: Wire the public key into the config**

In `apps/desktop/src-tauri/tauri.conf.json`, replace the `updater` block, substituting the public key printed in Step 1:

```json
"updater": {
  "active": true,
  "dialog": true,
  "pubkey": "<public key from step 1>",
  "endpoints": [
    "https://github.com/flagbit/session-echo/releases/latest/download/latest.json"
  ]
}
```

Set `"createUpdaterArtifacts": true` in the `bundle` block.

- [ ] **Step 4: Confirm the old key is gone**

```bash
grep -rn "dW50cnVzdGVkIGNvbW1lbnQ" . --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git
```

Expected: no output. That prefix is the base64 header of the upstream minisign key.

- [ ] **Step 5: Verify the config parses**

```bash
pnpm -F desktop exec tauri info 2>&1 | tail -20
```

Expected: no config parse error.

- [ ] **Step 6: Commit**

```bash
pnpm exec dprint fmt && pnpm fmt:check
git add -A && git commit -m "feat(updater): sign updates with an own key and publish via GitHub Releases"
```

### Task 16: Create the DNS record

**Files:** none — this is infrastructure.

**Interfaces:**

- Consumes: nothing in the repository
- Produces: `sessionecho.flagbit.de` resolving to the site host.

- [ ] **Step 1: Confirm the subdomain is still free**

```bash
dig +short sessionecho.flagbit.de
```

Expected: no output. `flagbit.de` resolves to `167.235.234.160` and has no wildcard, so one record is needed.

- [ ] **Step 2: Add the record**

Add an `A` record for `sessionecho` under `flagbit.de` pointing at the host that will serve the landing page, or a `CNAME` if the page is hosted elsewhere. This is a manual change in the Flagbit DNS zone.

- [ ] **Step 3: Verify**

```bash
dig +short sessionecho.flagbit.de
```

Expected: the target address.

---

## Phase 5 — Signing and release

### Task 17: Simplify the release pipeline to GitHub Releases

**Files:**

- Delete: `.github/workflows/desktop_publish.yaml`, `.github/workflows/desktop_store_publish.yaml`, `.github/workflows/handle_release.yaml`, `.github/workflows/handle_staging.yaml`, `.github/workflows/handle_update.yaml`, `.github/workflows/download_staging.yaml`
- Modify: `.github/workflows/desktop_cd.yaml` — drop the CloudSync signing step and CrabNebula usage

**Interfaces:**

- Consumes: Task 16's tree
- Produces: exactly one release workflow, `desktop_cd.yaml`, that builds, signs, notarizes and uploads to GitHub Releases.

`desktop_publish.yaml` references CrabNebula Cloud (`CN_API_KEY`) at twelve
separate points. Session Echo publishes through GitHub Releases, which the
updater in Task 15 already points at, so the CrabNebula pipeline has no
consumer. Porting it would mean adopting another third-party service.

- [ ] **Step 1: Confirm nothing else calls the deleted workflows**

```bash
cd /Users/weller/Development/anarlog
grep -rn "desktop_publish\|handle_release\|handle_staging\|handle_update\|desktop_store_publish" .github/
```

Any `workflow_call` reference found must be removed in the calling workflow too.

- [ ] **Step 2: Delete them**

```bash
cd .github/workflows
git rm -q desktop_publish.yaml desktop_store_publish.yaml handle_release.yaml \
  handle_staging.yaml handle_update.yaml
cd ../..
```

Drop any filename that does not exist rather than creating it.

- [ ] **Step 3: Leave the CloudSync signing step alone**

Earlier drafts of this plan deleted the step at `.github/workflows/desktop_cd.yaml:178-180`
that codesigns `$CLOUDSYNC_DYLIB`, on the grounds that Task 7 had removed CloudSync.
**Task 7 is deferred, so that reasoning does not hold.** `crates/cloudsync/vendor/cloudsync/macos/<arch>/cloudsync.dylib`
still exists and still ships inside the bundle; an unsigned dylib fails notarisation.
Verify the path still resolves, and leave the step in place.

- [ ] **Step 4: Remove the remaining cloud env**

Delete the `VITE_SUPABASE_URL` line and any sibling Supabase or CrabNebula env entries from `desktop_cd.yaml`.

- [ ] **Step 5: Validate the workflow syntax**

```bash
gh workflow list 2>/dev/null || echo "run after the repo exists"
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/desktop_cd.yaml')); print('yaml ok')"
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "ci: publish through GitHub Releases only

Drops the CrabNebula Cloud pipeline and the CloudSync dylib signing
step, which had no remaining artifact to sign."
```

### Task 18: Create the repository and set the signing secrets

**Files:** none — this is repository configuration.

**Interfaces:**

- Consumes: Task 17's tree
- Produces: `flagbit/session-echo` holding the branch, with every secret `desktop_cd.yaml` reads.

`desktop_cd.yaml` expects `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, `KEYCHAIN_PASSWORD`. The existing
`flagbit/SessionEcho` repository holds the same values under three different
names. Setting the secrets under the names the workflow already uses is cheaper
and less error-prone than editing the workflow.

| Secret the workflow reads    | Value source in `flagbit/SessionEcho` |
| ---------------------------- | ------------------------------------- |
| `APPLE_CERTIFICATE`          | `MACOS_CERTIFICATE`                   |
| `APPLE_CERTIFICATE_PASSWORD` | `MACOS_CERTIFICATE_PASSWORD`          |
| `APPLE_PASSWORD`             | `APPLE_APP_PASSWORD`                  |
| `APPLE_ID`                   | `APPLE_ID`                            |
| `APPLE_TEAM_ID`              | `APPLE_TEAM_ID`                       |
| `KEYCHAIN_PASSWORD`          | `KEYCHAIN_PASSWORD`                   |

- [ ] **Step 1: Create the repository**

```bash
gh repo create flagbit/session-echo --private --source=. --remote=sessionecho --push
```

Created private. It goes public in Task 20, after the license files are correct — publishing before the attribution is in place would put an incorrectly licensed tree on the internet.

- [ ] **Step 2: Set the six Apple secrets**

Read each value from the existing repository or from the original source, then:

```bash
gh secret set APPLE_CERTIFICATE --repo flagbit/session-echo
gh secret set APPLE_CERTIFICATE_PASSWORD --repo flagbit/session-echo
gh secret set APPLE_PASSWORD --repo flagbit/session-echo
gh secret set APPLE_ID --repo flagbit/session-echo
gh secret set APPLE_TEAM_ID --repo flagbit/session-echo
gh secret set KEYCHAIN_PASSWORD --repo flagbit/session-echo
```

GitHub secrets cannot be read back, so the certificate values must come from the original `.p12` export or the Keychain, not from the old repository.

- [ ] **Step 3: Set the two updater secrets from Task 15**

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo flagbit/session-echo < ~/.tauri/sessionecho.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo flagbit/session-echo
```

- [ ] **Step 4: Verify all eight are present**

```bash
gh secret list --repo flagbit/session-echo
```

Expected: the six Apple secrets plus the two Tauri signing secrets.

### Task 19: Produce a notarized build and verify it on a second machine

**Files:**

- Modify: `apps/desktop/src-tauri/tauri.conf.json` if the build reveals a config problem

**Interfaces:**

- Consumes: Task 18's repository and secrets
- Produces: a notarized DMG that launches on a machine that never saw the source.

This is the gate the whole phase exists for. Whether CI signing works has never
been confirmed — in the old repository the secret names did not match what the
workflow read, so it is likely it never succeeded there.

- [ ] **Step 1: Confirm the signing identity is available locally**

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
```

Expected: `Developer ID Application: Flagbit GmbH & Co. KG (P87KBU95SJ)`.

- [ ] **Step 2: Trigger the release workflow**

```bash
gh workflow run desktop_cd.yaml --repo flagbit/session-echo --ref chore/session-echo-rebrand
gh run watch --repo flagbit/session-echo
```

- [ ] **Step 3: If signing fails, read the actual error before changing anything**

```bash
gh run view --repo flagbit/session-echo --log-failed | grep -iA5 "codesign\|notariz\|errSec"
```

Fix the specific cause. Do not add secrets speculatively.

- [ ] **Step 4: Download the artifact and verify the signature**

```bash
gh run download --repo flagbit/session-echo -n macos-silicon -D /tmp/se-build
codesign --verify --deep --strict --verbose=2 "/tmp/se-build/Session Echo.app"
spctl --assess --type execute --verbose "/tmp/se-build/Session Echo.app"
```

Expected: `satisfies its Designated Requirement` and `accepted`, with `source=Notarized Developer ID`.

- [ ] **Step 5: Verify on a second machine**

Copy the DMG to a Mac that has never built this project. Install and launch it. Expected: no Gatekeeper warning, no right-click-to-open workaround needed. Verifying on the build host proves nothing — the build host trusts its own certificate.

- [ ] **Step 6: Record the result**

Append the outcome to `docs/superpowers/plans/phase5-signing-result.md`: the run ID, the `spctl` output, and the macOS version of the verifying machine.

```bash
git add docs/superpowers/plans/phase5-signing-result.md
git commit -m "docs: record notarized build verification"
```

---

## Phase 6 — License hygiene and publication

### Task 20: Correct the license files and publish

**Files:**

- Modify: `LICENSE`
- Create: `NOTICE`
- Modify: `README.md`
- Modify: `agent-plugins/session-echo/LICENSE` — add the Flagbit copyright beside Fastrepl's, exactly as in the root `LICENSE`. This is unconditional: `agent-plugins/` is never removed by any task, and Task 12 renamed the directory.

**Interfaces:**

- Consumes: Task 19's verified build
- Produces: a tree that may lawfully be published, with attribution intact.

- [ ] **Step 1: Add the Flagbit copyright without removing Fastrepl's**

In `LICENSE`, replace the single copyright line with both:

```
Copyright (c) 2023-present Fastrepl, Inc.
Copyright (c) 2026-present Flagbit GmbH & Co. KG
```

The Fastrepl line must survive verbatim. MIT requires the notice to be retained in all copies; removing it would make every distribution an infringement.

- [ ] **Step 2: Enumerate the third-party components**

```bash
cd /Users/weller/Development/anarlog
cargo tree --prefix none --format "{p} {l}" 2>/dev/null | sort -u | grep -vE "^$" | head -50
```

Also collect the licenses of the bundled model weights and native libraries: whisper.cpp (MIT), Pyannote (MIT), ONNX Runtime (MIT), and any remaining vendored code.

- [ ] **Step 3: Write NOTICE**

Create `NOTICE` listing every third-party component with its upstream URL, copyright holder and license. Include the entry for the upstream project itself:

```
This product includes software developed by Fastrepl, Inc.
(https://github.com/fastrepl/hyprnote), licensed under the MIT License.
```

- [ ] **Step 4: Rewrite README**

State what Session Echo is, that it is a fork of anarlog by Fastrepl, Inc., what was removed, and that transcription runs entirely on device. Naming the origin is both an MIT obligation and, for a German open-source product, evidence of clean provenance.

**Be accurate about the cloud code.** Tasks 5-8 are deferred, so account, sync and
subscription code is still in the tree — inert, because the hosted API it talked to
was deleted, but present. Do not write that it was removed. Either say nothing about
it, or say plainly that the remaining cloud integration is disconnected and slated
for removal. A README claiming a clean local-only tree is falsifiable in one `grep`,
and this file is the first thing a security reviewer reads.

- [ ] **Step 5: Verify the license claims are true**

```bash
grep -c "Fastrepl" LICENSE NOTICE README.md
grep -rn "enterprise\|commercial" LICENSE NOTICE
```

Expected: `Fastrepl` present in all three files; no commercial-license language anywhere.

- [ ] **Step 6: Full verification before publishing**

```bash
pnpm exec dprint fmt && pnpm fmt:check
cargo check 2>&1 | tail -5
cargo clippy --locked --all-targets -- -D warnings 2>&1 | tail -5
pnpm -r typecheck
pnpm -F desktop test
pnpm -F desktop i18n:check
pnpm exec oxlint --quiet --format=github apps/desktop/src/
```

Every command must pass. This is the last gate before the tree becomes public and mistakes stop being private.

- [ ] **Step 7: Commit, merge and publish**

```bash
git add -A && git commit -m "docs: add Flagbit copyright, NOTICE and rewritten README"
git push sessionecho chore/session-echo-rebrand
gh pr create --repo flagbit/session-echo --fill --base main
```

After the pull request is merged:

```bash
gh repo edit flagbit/session-echo --visibility public --accept-visibility-change-consequences
```

### Task 21: Rename the predecessor to Session Echo Classic

**Files:** in `/Users/weller/Development/sessionecho`, not in this repository.

- Modify: `desktop/src-tauri/tauri.conf.json` — `productName`
- Modify: `README.md`

**Interfaces:**

- Consumes: a published `flagbit/session-echo`
- Produces: two apps that coexist without colliding. The predecessor keeps `cc.weller.sessionecho`, so existing installations are untouched.

- [ ] **Step 1: Rename the product**

In `/Users/weller/Development/sessionecho/desktop/src-tauri/tauri.conf.json`, set `"productName": "Session Echo Classic"`. Leave `identifier` at `cc.weller.sessionecho` — changing it would orphan every existing installation's data directory.

- [ ] **Step 2: Point users at the successor**

Add a note at the top of that project's `README.md` naming `flagbit/session-echo` as the successor and stating that Classic receives no further releases.

- [ ] **Step 3: Verify the two apps cannot collide**

```bash
grep -h '"identifier"' /Users/weller/Development/sessionecho/desktop/src-tauri/tauri.conf.json \
  /Users/weller/Development/anarlog/apps/desktop/src-tauri/tauri.conf.json
```

Expected: `cc.weller.sessionecho` and `de.flagbit.sessionecho.dev` — two distinct identifiers, so both install side by side.

- [ ] **Step 4: Commit in that repository**

```bash
cd /Users/weller/Development/sessionecho
git add -A && git commit -m "chore: rename to Session Echo Classic

Superseded by flagbit/session-echo. Bundle identifier unchanged so
existing installations keep their data."
```

---

## Deferred

Not in this plan, by decision recorded in the spec: Windows and Linux builds
beyond the launch, Mac App Store submission, Parakeet models, `apps/cli` beyond
building and running, renaming the internal `@anlg/*` scope and `anlg-*` crate
prefix, and data migration from the Electron app.

The internal prefixes are worth a note: 1,503 `@anlg/` and 147 `anlg-*`
occurrences remain after this plan. They are private workspace packages and
workspace path aliases, never published and never user-visible, so they block
nothing. They are a single mechanical commit whenever it becomes worth doing.
