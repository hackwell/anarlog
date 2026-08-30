import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// Version for the rolling development build published on every push to main.
//
// A rolling build has no changelog entry and no tag to take a version from, so
// it derives one from the last stable release: the next patch level, marked as
// a pre-release with the workflow run number as the ordinal.
//
//   last stable v1.5.0 / desktop_v1.5.0  ->  1.5.1-dev.412
//
// Both release tag names count. `v<version>` is the tag whose push starts a
// stable release and `desktop_v<version>` is the tag desktop_publish.yaml
// creates once that release is published; taking the highest of either means a
// release that was tagged but never finished publishing still moves the
// rolling baseline forward instead of leaving it behind.
//
// The shape is chosen so semver ordering does the right thing in both
// directions: 1.5.1-dev.412 sorts after every 1.5.0 and before the eventual
// 1.5.1, so a rolling build always looks newer than the stable release it was
// cut from and always looks older than the next stable release. `run_number`
// only ever increases, so successive rolling builds of the same base version
// stay ordered as well.

const STABLE_TAG = /^(\d+)\.(\d+)\.(\d+)$/;
const ROLLING_VERSION = /^\d+\.\d+\.\d+-dev\.[1-9]\d*$/;

export const DEFAULT_TAG_PREFIXES = ["desktop_v", "v"];

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function lastStableVersion(tags, tagPrefixes = DEFAULT_TAG_PREFIXES) {
  const list = Array.isArray(tags) ? tags : String(tags ?? "").split("\n");
  // Longest prefix wins, so a `desktop_v1.5.0` is matched by `desktop_v` and
  // not left unmatched because a shorter prefix was tried first.
  const prefixes = [...tagPrefixes].sort((a, b) => b.length - a.length);

  let best = null;
  for (const raw of list) {
    const tag = raw.trim();
    const prefix = prefixes.find((candidate) => tag.startsWith(candidate));
    if (prefix === undefined) {
      continue;
    }
    const match = STABLE_TAG.exec(tag.slice(prefix.length));
    if (!match) {
      continue;
    }
    const parsed = match.slice(1, 4).map(Number);
    // Tags are compared numerically, never lexically: `desktop_v1.10.0` is
    // newer than `desktop_v1.9.0` even though it sorts before it as a string.
    if (
      best === null ||
      parsed[0] > best[0] ||
      (parsed[0] === best[0] &&
        (parsed[1] > best[1] || (parsed[1] === best[1] && parsed[2] > best[2])))
    ) {
      best = parsed;
    }
  }

  return best;
}

export function nextRollingVersion({
  tags,
  runNumber,
  tagPrefixes = DEFAULT_TAG_PREFIXES,
}) {
  invariant(
    /^[1-9]\d*$/.test(String(runNumber ?? "")),
    `Run number must be a positive integer, got '${runNumber}'`,
  );

  const last = lastStableVersion(tags, tagPrefixes);
  // A repository with no published stable release yet still has to produce a
  // usable build rather than fail the push.
  const [major, minor, patch] = last ?? [0, 0, 0];
  const version = `${major}.${minor}.${patch + 1}-dev.${runNumber}`;

  invariant(
    ROLLING_VERSION.test(version),
    `Derived rolling version '${version}' is malformed`,
  );
  return version;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "run-number": { type: "string" },
    },
  });

  const tags = await readStdin();
  console.log(
    nextRollingVersion({
      tags,
      runNumber: values["run-number"],
    }),
  );
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
