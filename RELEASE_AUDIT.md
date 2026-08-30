# Release audit

Heavy, cross-platform verification is deliberately **not** run on every PR. It is
batched into a short audit performed just before cutting a release. This keeps
per-PR feedback fast (so the Bugbot → fix → push loop stays cheap) while the real
"moment of truth" happens once, on purpose.

## CI model

- **Per PR (fast lane, Linux only):** lint, format, typecheck, unit/integration
  tests, and Linux `cargo check`/`cargo test`. Deduplicated via
  `concurrency: cancel-in-progress`, so rapid pushes cancel superseded runs.
- **On merge to `main` + nightly (`schedule`):** the full `desktop_ci` matrix —
  macOS, Windows, Linux x64 and arm64, and Swift. Nightly catches platform
  breakage within a day and attributes it to a small window — keeping the
  release audit a clean diff review rather than a regression hunt.
- **Release (this audit):** full builds + signing + real-hardware QA.

## Audit checklist

Run these before publishing a stable desktop release.

1. **Read the cumulative diff since the last version.**
   `git diff <last-stable-tag>..main -- apps/desktop/src-tauri plugins crates`
   (see the `diff` task in `Taskfile.yaml`, which is the source of those paths).
   Polish from first principles:
   simplify, delete dead code, reconcile inconsistencies introduced across PRs.

2. **Confirm the heavy suites are green** on the release candidate:
   - `desktop_ci` — trigger via `workflow_dispatch` on the candidate, or
     confirm the latest nightly on `main` passed.
   - `desktop_e2e` — dispatch it if the change touches a user-facing flow.

3. **Build + sign all platforms** via `desktop_cd`. Dispatch `staging`, then
   dispatch `stable` if you want a candidate without releasing; a dispatch
   never publishes. This produces the signed macOS/Windows/Linux artifacts.

4. **Real-hardware QA** (cannot run in CI/Cloud Agent):
   - Critical Pro user journey on a Mac — follow `.agents/skills/qa-critical-ux`.
     Linux and Windows ship from the same dry-run provenance; do not run a
     separate Linux-only audio QA gate before publish.

5. **Changelog** — add the entry via `.agents/skills/new-changelog`.

6. **Cut the release** — push the `v<version>` tag; `desktop_cd` builds, signs
   and publishes it to this repository's Releases in one run. Follow
   `.agents/skills/release-new-version`.

## Notes

- Anything that fails incidentally but is out of scope for the release gate is
  tracked in Linear, not patched into the candidate (see `qa-critical-ux`).
- macOS and Windows verification requires real Apple/Windows machines; the
  Linux Cloud Agent covers authoring + Linux-native checks only.
