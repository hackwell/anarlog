import { copyFile, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { readUpdaterSignature } from "./desktop-latest-json.mjs";
import {
  assetsForBuildTarget,
  invariant,
  plannedAssets,
  releasePlatformPlan,
} from "./desktop-release-plan.mjs";

// GitHub Actions artifacts carry built bundles from the candidate build to the
// publish run: every build job stages the bundles the release plan expects
// under their final release asset names, records what it staged, and the
// publish run merges those records back into one release description.

const MANIFEST_PREFIX = "assets-";
const MANIFEST_SUFFIX = ".json";

function normalizeBoolean(value, label) {
  invariant(
    value === "true" || value === "false",
    `${label} must be true or false`,
  );
  return value === "true";
}

export function manifestName(buildTarget) {
  invariant(
    /^[A-Za-z0-9_.-]+$/.test(buildTarget ?? ""),
    `Invalid build target ${buildTarget}`,
  );
  return `${MANIFEST_PREFIX}${buildTarget}${MANIFEST_SUFFIX}`;
}

async function findBundle(bundleDir, extension) {
  let entries;
  try {
    entries = await readdir(bundleDir, { withFileTypes: true });
  } catch {
    throw new Error(`Missing bundle directory ${bundleDir}`);
  }

  const matches = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(bundleDir, entry.name));
  invariant(
    matches.length === 1,
    `Expected exactly one ${extension} bundle in ${bundleDir}, found ${matches.length}`,
  );
  return matches[0];
}

export async function stageBuildTarget({
  bundleRoot,
  buildTarget,
  outputDir,
  plan = releasePlatformPlan,
}) {
  invariant(bundleRoot, "Missing --bundle-root");
  invariant(outputDir, "Missing --output-dir");

  const assets = assetsForBuildTarget(buildTarget, plan);
  const staged = [];

  for (const asset of assets) {
    const source = await findBundle(
      path.join(bundleRoot, buildTarget, "release", "bundle", asset.bundle),
      asset.extension,
    );
    const destination = path.join(outputDir, asset.file);
    await copyFile(source, destination);
    const { size } = await stat(destination);
    invariant(size > 0, `Staged asset ${asset.file} is empty`);

    let signature = null;
    if (asset.updatePlatform !== null) {
      try {
        signature = await readUpdaterSignature(`${source}.sig`);
      } catch (error) {
        throw new Error(`${asset.file}.sig: ${error.message}`);
      }
      await copyFile(`${source}.sig`, `${destination}.sig`);
    }

    staged.push({
      id: asset.file,
      publicPlatform: asset.publicPlatform,
      updatePlatform: asset.updatePlatform,
      size,
      signature,
    });
  }

  staged.sort((left, right) => left.id.localeCompare(right.id));
  await writeFile(
    path.join(outputDir, manifestName(buildTarget)),
    `${JSON.stringify({ buildTarget, assets: staged }, null, 2)}\n`,
  );
  return staged;
}

export async function mergeStagedAssets({
  assetDir,
  version,
  includeLinux = true,
  includeWindows = true,
  plan = releasePlatformPlan,
}) {
  invariant(assetDir, "Missing --asset-dir");

  const entries = await readdir(assetDir, { withFileTypes: true });
  const manifests = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(MANIFEST_PREFIX) &&
        entry.name.endsWith(MANIFEST_SUFFIX),
    )
    .map((entry) => entry.name)
    .sort();
  invariant(
    manifests.length > 0,
    `No staged asset manifests found in ${assetDir}`,
  );

  const expected = plannedAssets({ includeLinux, includeWindows }, plan);
  const expectedByFile = new Map(expected.map((asset) => [asset.file, asset]));

  const assets = [];
  for (const manifest of manifests) {
    const parsed = JSON.parse(
      await readFile(path.join(assetDir, manifest), "utf8"),
    );
    invariant(
      Array.isArray(parsed?.assets),
      `Staged manifest ${manifest} has no asset list`,
    );
    for (const asset of parsed.assets) {
      // A build target that was not selected for this release still leaves its
      // manifest behind if it ran; ignoring it silently would let an
      // unselected platform reach the release, so reject it instead.
      invariant(
        expectedByFile.has(asset.id),
        `Staged asset ${asset.id} is not part of the selected release plan`,
      );
      assets.push(asset);
    }
  }

  const seen = new Set();
  for (const asset of assets) {
    invariant(!seen.has(asset.id), `Duplicate staged asset ${asset.id}`);
    seen.add(asset.id);

    const planned = expectedByFile.get(asset.id);
    invariant(
      asset.publicPlatform === planned.publicPlatform &&
        asset.updatePlatform === planned.updatePlatform,
      `Staged asset ${asset.id} does not match its planned platforms`,
    );
    invariant(
      asset.updatePlatform === null ||
        (typeof asset.signature === "string" && asset.signature.length > 0),
      `Staged updater asset ${asset.id} has no signature`,
    );

    const file = path.join(assetDir, asset.id);
    let stats;
    try {
      stats = await stat(file);
    } catch {
      throw new Error(`Staged asset ${asset.id} is missing from ${assetDir}`);
    }
    invariant(
      stats.isFile() && stats.size === asset.size,
      `Staged asset ${asset.id} is ${stats.size} bytes, expected ${asset.size}`,
    );
  }

  const missing = expected
    .map((asset) => asset.file)
    .filter((file) => !seen.has(file));
  invariant(
    missing.length === 0,
    `The candidate build did not stage: ${missing.join(", ")}`,
  );

  assets.sort((left, right) => left.id.localeCompare(right.id));
  return { version, status: "draft", assets };
}

export function fileForPublicPlatform(
  publicPlatform,
  plan = releasePlatformPlan,
) {
  const matches = plannedAssets(
    { includeLinux: true, includeWindows: true },
    plan,
  ).filter((asset) => asset.publicPlatform === publicPlatform);
  invariant(
    matches.length === 1,
    `Release plan has ${matches.length} assets for public platform ${publicPlatform}`,
  );
  return matches[0].file;
}

export function publicAssetFiles({
  includeLinux = true,
  includeWindows = true,
  plan = releasePlatformPlan,
} = {}) {
  return plannedAssets({ includeLinux, includeWindows }, plan)
    .filter((asset) => asset.publicPlatform !== null)
    .map((asset) => asset.file)
    .sort();
}

export function releaseAssetFiles({
  includeLinux = true,
  includeWindows = true,
  plan = releasePlatformPlan,
} = {}) {
  return plannedAssets({ includeLinux, includeWindows }, plan)
    .map((asset) => asset.file)
    .sort();
}

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "bundle-root": { type: "string" },
      "build-target": { type: "string" },
      "output-dir": { type: "string" },
      "asset-dir": { type: "string" },
      "public-platform": { type: "string" },
      output: { type: "string" },
      version: { type: "string" },
      "include-linux": { type: "string", default: "true" },
      "include-windows": { type: "string", default: "true" },
    },
  });

  const [command] = positionals;
  const selection = {
    includeLinux: normalizeBoolean(values["include-linux"], "include-linux"),
    includeWindows: normalizeBoolean(
      values["include-windows"],
      "include-windows",
    ),
  };

  if (command === "stage") {
    const staged = await stageBuildTarget({
      bundleRoot: values["bundle-root"],
      buildTarget: values["build-target"],
      outputDir: values["output-dir"],
    });
    console.log(
      `Staged ${staged.map((asset) => asset.id).join(", ")} for ${values["build-target"]}`,
    );
    return;
  }

  if (command === "merge") {
    invariant(values.output, "Missing --output");
    const release = await mergeStagedAssets({
      assetDir: values["asset-dir"],
      version: values.version,
      ...selection,
    });
    await writeFile(values.output, `${JSON.stringify(release, null, 2)}\n`);
    console.log(
      `Merged ${release.assets.length} release assets into ${values.output}`,
    );
    return;
  }

  if (command === "list") {
    console.log(releaseAssetFiles(selection).join("\n"));
    return;
  }

  if (command === "file") {
    console.log(fileForPublicPlatform(values["public-platform"]));
    return;
  }

  if (command === "list-public") {
    console.log(publicAssetFiles(selection).join("\n"));
    return;
  }

  throw new Error("Expected stage, merge, list, list-public, or file command");
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
