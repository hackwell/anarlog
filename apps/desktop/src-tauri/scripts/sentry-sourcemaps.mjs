// Hands Sentry the sourcemaps, then removes them before the app is packaged.
//
// Runs from before-bundle.mjs, the one moment where the frontend is built and
// the bundle has not been assembled yet. Without SENTRY_AUTH_TOKEN it does
// nothing at all, which is every local build and every fork's CI. It never
// fails the build either: a release without sourcemaps is harder to debug, not
// broken.
//
// The maps are deleted whatever happens. They are only useful to Sentry, and
// shipping them inside the app would hand every user the unminified source.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist",
);

function removeSourcemaps(directory) {
  if (!existsSync(directory)) return 0;
  let removed = 0;
  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    if (statSync(entryPath).isDirectory()) {
      removed += removeSourcemaps(entryPath);
      continue;
    }
    if (entryPath.endsWith(".map")) {
      rmSync(entryPath);
      removed += 1;
    }
  }
  return removed;
}

export function uploadSourcemaps() {
  const token = process.env.SENTRY_AUTH_TOKEN?.trim();
  const release = process.env.APP_VERSION?.trim();

  if (token && release) {
    const org = process.env.SENTRY_ORG?.trim() || "flagbit-gmbh-co-kg-rc";
    const project = process.env.SENTRY_PROJECT?.trim() || "sessionecho";
    const sentry = (args) =>
      execFileSync("sentry", args, { stdio: "inherit", env: process.env });

    try {
      sentry(["sourcemap", "inject", DIST]);
      sentry([
        "sourcemap",
        "upload",
        DIST,
        "--org",
        org,
        "--project",
        project,
        "--release",
        release,
      ]);
      console.log(`[sentry] uploaded sourcemaps for ${release}`);
    } catch (error) {
      console.warn(`[sentry] sourcemap upload failed, continuing: ${error}`);
    }
  } else if (token) {
    console.warn("[sentry] no APP_VERSION, skipping the sourcemap upload");
  }

  const removed = removeSourcemaps(DIST);
  if (removed > 0) {
    console.log(`[sentry] removed ${removed} sourcemaps before bundling`);
  }
}
