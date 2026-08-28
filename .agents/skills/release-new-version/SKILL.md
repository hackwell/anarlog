---
name: release-new-version
description: Release a new desktop stable version for Session Echo. Use when asked to cut, publish, or prepare a new stable desktop release after checking and merging the changelog.
metadata:
  internal: true
---

# Release a New Desktop Version

Use this for stable desktop releases. A stable release must come from `main`, after the changelog for the computed version is present, accurate, validated, and merged.

## Core Rule

Do not trigger a stable release from an unmerged branch. First make the changelog up to date, merge that changelog change to `main`, then run the stable release from `main`.

## Scope Boundary

Release and QA are separate, explicitly requested workflows. Do not read or
run `qa-critical-ux` or `qa-cli-mcp-api` solely because the user asked for a
release. A release does not require a QA report or QA PASS.

If the user explicitly asks for both release and QA, follow the requested
order and report the outcomes separately. Do not infer that a QA result
approves or blocks the release.

## Release Workflow Requirements

This release path approves macOS, Windows, and Linux. Mobile remains closed.
The patched CloudSync vendor bundle is rebuilt from source and
cancellation-tested on every desktop lane: `rebuild-macos.sh` for Apple
Silicon and Intel, `rebuild-windows.sh` under UCRT64 in `windows_ci`, and
`rebuild-linux.sh` in `linux_ci` for x86_64 and aarch64. Each lane then runs
`cargo test -p cloudsync` and `cargo test -p db-core cloudsync::` against that
freshly built library, covering the stalled-network, logout, configuration
cleanup/init, worker-drain, and immediate-local-write cancellation gates.

The rebuild steps run only on `workflow_dispatch`, so a routine pull-request
run does not prove them. Dispatch `desktop_ci.yaml` against the candidate SHA
and confirm the `cloudsync-windows-*` and `cloudsync-linux-*` artifacts before
treating a desktop lane as approved. Do not treat macOS artifacts or
Rust-only tests as cross-platform approval, and do not open the mobile lane
until its bundle gets the same treatment.

## Preflight

1. Inspect the workflow before assuming release behavior:

```bash
sed -n '1,280p' .github/workflows/desktop_cd.yaml
```

2. Validate the explicit stable version requested by the user:

```bash
VERSION=<version>
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
test -f "packages/changelog/content/$VERSION.md"
```

Stable desktop releases never infer a version. The workflow requires the exact
stable semantic version and a matching changelog file.

3. Identify the latest stable desktop tag and the commits that will ship:

```bash
git fetch --tags --force
git tag -l 'desktop_v*' --sort=-v:refname | grep -E '^desktop_v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1
git log --oneline <latest-desktop-tag>..HEAD
```

Use read-only `git` commands for inspection. If the workspace is on `gitbutler/workspace`, use the `but` skill for commits, pushes, PRs, merges, and other write operations.

## Changelog Gate

The changelog is the release gate. Before releasing:

1. Open `packages/changelog/content/AGENTS.md` and follow its instructions.
2. Confirm `packages/changelog/content/<version>.md` exists.
3. Compare the file against the desktop user-facing changes since the latest `desktop_v*` tag.
4. If the changelog is missing or incomplete, update it before release.

Changelog entries should be worth reading for app users. Exclude internal-only refactors, CI changes, infra noise, and implementation details unless they explain a user-visible change.

Each changelog file must include:

```md
---
date: "YYYY-MM-DD"
summary: "One concise, user-facing sentence for the changelog index preview."
---
```

After editing the changelog, run:

```bash
pnpm exec dprint fmt
pnpm -F @anlg/changelog typecheck
```

## Merge to Main

Only after the changelog is accurate and validation passes:

1. Commit the changelog change.
2. Open or update the changelog PR.
3. Wait for CI and required review state to be clear.
4. Merge the changelog PR to `main`.
5. Verify `main` contains `packages/changelog/content/<version>.md`.
6. Record the resulting `main` SHA as the release candidate.

If using GitButler, prefer:

```bash
but diff
but commit chore/release-changelog -c -m "Update desktop release changelog

Refresh the desktop changelog for the next stable release." --changes <ids>
but pr new <branch-id> -t
```

Use actual IDs from `but diff` / `but status -fv`; do not invent IDs.

## Trigger Stable Release

After the changelog merge, verify `main` has not moved, then push the release
tag. The pushed tag is the whole release: `desktop_cd.yaml` builds, signs and
notarizes every platform, verifies the candidate, and then calls
`desktop_publish.yaml` in the same run to create the GitHub release in
`flagbit/session-echo-releases`. There is no second workflow to start and no
SHA to copy.

```bash
git fetch origin main --no-tags
git tag "v<version>" origin/main
git push origin "refs/tags/v<version>"
```

The tag name is the version: `v1.5.0` releases `1.5.0`. A tag whose version has
no `packages/changelog/content/<version>.md` fails in `compute-version`, before
the build matrix starts, as does a tag that is not `v<major>.<minor>.<patch>`.

Watch the single run:

```bash
gh run list --workflow desktop_cd.yaml --limit 5
gh run view <run-id> --json headSha,url,event
gh run watch <run-id>
```

The run's `event` must be `push` and its `headSha` must equal the recorded
release-candidate SHA. A mismatch blocks acceptance even if the workflow
succeeds.

Do not use GitHub's rerun button for a failed release run. Publication only
accepts first-attempt run IDs, so evidence cannot be mixed across attempts.

The run must:

- take the version from the tag and find the matching changelog entry
- pass the `RELEASES_TOKEN` preflight before the build matrix starts
- build both Apple Silicon and Intel macOS artifacts
- build the signed Windows and Linux artifacts for the same version and commit
- stage every planned release asset as `desktop-release-assets-<target>`
  artifacts, each updater artifact with the `.sig` tauri build wrote beside it
- upload `desktop-release-provenance-<version>-<sha>`, including the exact
  artifact hashes for every staged release asset
- create the `desktop_v<version>` tag and publish the release, verifying every
  uploaded file against the provenance manifest and confirming the published
  `latest.json` matches the one the run generated

### Testing a stable build without releasing

`workflow_dispatch` still builds and verifies a stable candidate but never
publishes: publication is gated on the push event, which a dispatch cannot set.

```bash
gh workflow run desktop_cd.yaml \
  --ref main \
  -f channel=stable \
  -f version=<version>
```

Do not run `desktop_linux_audio_qa` as a publish gate; Linux is covered by the
same provenance as macOS and Windows. That workflow consumes a dispatched
candidate run and remains available for optional debugging.

### Republishing an existing candidate

Only if the release stage of a run failed after the build succeeded, publish
that run's artifacts by hand from `main`:

```bash
gh workflow run desktop_publish.yaml \
  --ref main \
  -f version=<version> \
  -f candidate_sha=<40-character-main-sha> \
  -f source_run_id=<desktop_cd-run-id>
```

This path requires `main` to still point at the candidate.

## Final Checks

Before reporting success, capture:

- released stable version
- pushed `v<version>` tag
- release run URL, event, and head SHA
- `desktop_v<version>` tag
- GitHub release URL in `flagbit/session-echo-releases`
- the updater platform keys listed in the published `latest.json`
- changelog URL
- stable DMG SHA-256

If the workflow fails, inspect the failed job logs with:

```bash
gh run view <run-id> --log-failed
```
