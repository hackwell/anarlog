import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  invariant,
  plannedUpdaterAssets,
  releaseRepository,
  releasePlatformPlan,
  releaseTag,
} from "./desktop-release-plan.mjs";

// Tauri's updater reads a static latest.json: a version, a publication date,
// release notes, and a platforms map keyed by the target it resolves at
// runtime. The keys are never spelled out here -- they come from the release
// plan, which is the same file the build matrix and provenance checks read, so
// a platform can never be silently absent from updates.

function normalizeBoolean(value, label) {
  invariant(
    value === "true" || value === "false",
    `${label} must be true or false`,
  );
  return value === "true";
}

function normalizePubDate(value) {
  invariant(
    typeof value === "string" && !Number.isNaN(Date.parse(value)),
    "Publication date must be an RFC 3339 timestamp",
  );
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function readUpdaterSignature(signaturePath) {
  let contents;
  try {
    contents = await readFile(signaturePath, "utf8");
  } catch {
    throw new Error(
      `Missing updater signature ${path.basename(signaturePath)}; tauri build writes it beside the updater artifact`,
    );
  }

  const signature = contents.trim();
  invariant(
    signature.length > 0,
    `Updater signature ${path.basename(signaturePath)} is empty`,
  );
  // tauri signer writes the base64 of a minisign detached signature file.
  invariant(
    /^[A-Za-z0-9+/=]+$/.test(signature),
    `Updater signature ${path.basename(signaturePath)} is not base64`,
  );
  return signature;
}

export async function assertRegularFile(file, label) {
  let stats;
  try {
    stats = await stat(file);
  } catch {
    throw new Error(`Missing ${label} ${path.basename(file)}`);
  }
  invariant(stats.isFile(), `${label} ${path.basename(file)} is not a file`);
  invariant(stats.size > 0, `${label} ${path.basename(file)} is empty`);
}

export async function buildLatestJson({
  assetDir,
  version,
  notes,
  pubDate,
  includeLinux = true,
  includeWindows = true,
  plan = releasePlatformPlan,
}) {
  invariant(
    typeof assetDir === "string" && assetDir,
    "Missing asset directory",
  );
  invariant(
    typeof notes === "string" && notes.trim().length > 0,
    "Release notes must not be empty",
  );

  const tag = releaseTag(version, plan);
  const repository = releaseRepository(plan);
  const updaterAssets = plannedUpdaterAssets(
    { includeLinux, includeWindows },
    plan,
  );
  invariant(
    updaterAssets.length > 0,
    "Release plan selects no updater artifacts",
  );

  const platforms = {};
  for (const asset of updaterAssets) {
    invariant(
      !(asset.updatePlatform in platforms),
      `Release plan maps ${asset.updatePlatform} to more than one artifact`,
    );

    const artifact = path.join(assetDir, asset.file);
    await assertRegularFile(artifact, "updater artifact");
    const signature = await readUpdaterSignature(`${artifact}.sig`);

    platforms[asset.updatePlatform] = {
      url: `https://github.com/${repository}/releases/download/${tag}/${asset.file}`,
      signature,
    };
  }

  return {
    version,
    pub_date: normalizePubDate(pubDate ?? new Date().toISOString()),
    notes,
    platforms: Object.fromEntries(
      Object.keys(platforms)
        .sort()
        .map((key) => [key, platforms[key]]),
    ),
  };
}

export async function writeLatestJson({ output, ...options }) {
  invariant(typeof output === "string" && output, "Missing --output");
  const latest = await buildLatestJson(options);
  await writeFile(output, `${JSON.stringify(latest, null, 2)}\n`);
  return latest;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "asset-dir": { type: "string" },
      output: { type: "string" },
      version: { type: "string" },
      notes: { type: "string" },
      "pub-date": { type: "string" },
      "include-linux": { type: "string", default: "true" },
      "include-windows": { type: "string", default: "true" },
    },
  });

  const latest = await writeLatestJson({
    assetDir: values["asset-dir"],
    output: values.output,
    version: values.version,
    notes: values.notes,
    pubDate: values["pub-date"],
    includeLinux: normalizeBoolean(values["include-linux"], "include-linux"),
    includeWindows: normalizeBoolean(
      values["include-windows"],
      "include-windows",
    ),
  });

  console.log(
    `Wrote ${values.output} for ${latest.version} covering ${Object.keys(latest.platforms).join(", ")}`,
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
