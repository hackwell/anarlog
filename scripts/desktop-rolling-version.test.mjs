import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  lastStableVersion,
  nextRollingVersion,
} from "./desktop-rolling-version.mjs";

const ROLLING_WORKFLOW = ".github/workflows/desktop_rolling_cd.yaml";

test("derives the next patch of the newest published stable release", () => {
  assert.equal(
    nextRollingVersion({
      tags: ["desktop_v1.4.11", "desktop_v1.4.13", "desktop_v1.4.12"],
      runNumber: 412,
    }),
    "1.4.14-dev.412",
  );
});

// desktop_publish.yaml only creates `desktop_v<version>` once a release is
// fully published. A release that was tagged `v<version>` but failed to publish
// must still move the baseline, or every rolling build stays stuck behind it.
test("counts both the release trigger tag and the published release tag", () => {
  assert.deepEqual(lastStableVersion(["v1.5.0", "desktop_v1.4.13"]), [1, 5, 0]);
  assert.deepEqual(lastStableVersion(["v1.4.13", "desktop_v1.5.0"]), [1, 5, 0]);
  assert.equal(
    nextRollingVersion({ tags: ["v1.5.0", "desktop_v1.4.13"], runNumber: 2 }),
    "1.5.1-dev.2",
  );
});

// Lexical sorting of tags is the classic way this breaks: "desktop_v1.10.0"
// sorts before "desktop_v1.9.0" as a string but is the newer release.
test("compares tag versions numerically, not lexically", () => {
  assert.deepEqual(
    lastStableVersion(["desktop_v1.9.0", "desktop_v1.10.0", "desktop_v1.2.30"]),
    [1, 10, 0],
  );
  assert.equal(
    nextRollingVersion({
      tags: ["desktop_v1.9.0", "desktop_v1.10.0"],
      runNumber: 7,
    }),
    "1.10.1-dev.7",
  );
});

test("ignores tags that are not published stable desktop releases", () => {
  assert.equal(
    nextRollingVersion({
      tags: [
        "desktop_v1.4.13",
        "desktop_v2.0.0-rc.1",
        "vor-redesign",
        "desktop-dev",
        "desktop_v1.4",
        "cli_v9.9.9",
        "v",
        "",
      ],
      runNumber: 1,
    }),
    "1.4.14-dev.1",
  );
});

test("accepts the newline-separated output of git tag --list", () => {
  assert.equal(
    nextRollingVersion({
      tags: "desktop_v1.4.12\ndesktop_v1.4.13\n",
      runNumber: 3,
    }),
    "1.4.14-dev.3",
  );
});

test("still produces a version when no stable release exists yet", () => {
  assert.equal(lastStableVersion([]), null);
  assert.equal(nextRollingVersion({ tags: [], runNumber: 5 }), "0.0.1-dev.5");
});

test("rejects a run number that cannot order rolling builds", () => {
  for (const runNumber of [undefined, "", "0", "-1", "1.2", "abc", "01"]) {
    assert.throws(
      () => nextRollingVersion({ tags: ["desktop_v1.4.13"], runNumber }),
      /Run number must be a positive integer/,
    );
  }
});

// The whole point of the shape: a rolling build is newer than the stable
// release it was cut from and older than the stable release that follows, so
// the updater moves a rolling user onto stable rather than stranding them.
test("rolling versions order between the surrounding stable releases", () => {
  const version = nextRollingVersion({
    tags: ["desktop_v1.4.13"],
    runNumber: 412,
  });
  const [core, pre] = version.split("-");
  assert.equal(core, "1.4.14");
  assert.equal(pre, "dev.412");
  assert.ok("1.4.13" < core);
  // A pre-release of 1.4.14 precedes 1.4.14 itself under semver.
  assert.ok(version.startsWith(`${core}-`));
});

test("successive runs of the same base version stay ordered", () => {
  const earlier = nextRollingVersion({
    tags: ["desktop_v1.4.13"],
    runNumber: 9,
  });
  const later = nextRollingVersion({
    tags: ["desktop_v1.4.13"],
    runNumber: 10,
  });
  assert.equal(earlier, "1.4.14-dev.9");
  assert.equal(later, "1.4.14-dev.10");
  assert.ok(
    Number(later.split(".").pop()) > Number(earlier.split(".").pop()),
    "run number must increase",
  );
});

// These assertions are the committed proof of the constraint that matters most:
// a rolling build must never become what the shipped updater reads from
// releases/latest/download/latest.json.
test("the rolling workflow cannot publish itself as the latest release", async () => {
  const workflow = await readFile(ROLLING_WORKFLOW, "utf8");
  // Prose in the leading comment block explains the same flags; assert against
  // the executable part so the test cannot pass on a comment alone.
  const executable = workflow
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  assert.match(executable, /gh release create "\$ROLLING_TAG"/);
  assert.match(executable, /\n\s+--prerelease \\\n/);
  assert.match(executable, /\n\s+--prerelease=true \\\n/);
  // Both gh release create and gh release edit pin Latest off explicitly, and
  // nothing in this workflow ever asks for Latest.
  assert.equal((executable.match(/--latest=false/g) ?? []).length, 2);
  assert.doesNotMatch(executable, /--latest[\s\\]/);
  assert.doesNotMatch(executable, /--latest=true/);

  // No updater manifest is generated or uploaded anywhere in this workflow.
  assert.doesNotMatch(executable, /desktop-latest-json\.mjs/);
  assert.match(executable, /A rolling build must never stage latest\.json/);
  assert.match(
    executable,
    /releases\/latest resolved to the rolling tag \$ROLLING_TAG/,
  );

  // The rolling tag must not collide with the stable release tag namespace
  // (`desktop_v<version>`) that latest.json, the AUR package and the APT
  // repository all address.
  const tag = /ROLLING_TAG: (\S+)/.exec(workflow)?.[1];
  assert.equal(tag, "desktop-dev");
  assert.doesNotMatch(tag, /^desktop_v/);
  assert.doesNotMatch(tag, /^v\d/);
});

test("the rolling workflow builds only the macOS Apple Silicon target", async () => {
  const workflow = await readFile(ROLLING_WORKFLOW, "utf8");

  assert.match(workflow, /ROLLING_TARGET: aarch64-apple-darwin/);
  assert.doesNotMatch(workflow, /x86_64-apple-darwin/);
  assert.doesNotMatch(workflow, /unknown-linux-gnu/);
  assert.doesNotMatch(workflow, /pc-windows-msvc/);

  // The expensive macOS job must not start before RELEASES_TOKEN is proven.
  assert.match(workflow, /build-macos:\n {4}needs: prepare\n/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/releases_preflight/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/macos_notarize_dmg/);
});

test("the stable release path keeps its tag trigger and publish guard", async () => {
  const stable = await readFile(".github/workflows/desktop_cd.yaml", "utf8");

  assert.match(stable, /on:\n {2}push:\n {4}tags:\n {6}- "v\*\.\*\.\*"/);
  assert.doesNotMatch(stable, /\n {4}branches:/);
  assert.match(
    stable,
    /if: \$\{\{ github\.event_name == 'push' && needs\.compute-version\.outputs\.publish == 'true'/,
  );
  assert.match(stable, /Missing changelog for stable version \$VERSION/);
});
