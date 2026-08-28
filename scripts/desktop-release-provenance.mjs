import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  invariant,
  plannedPlatforms as planPlatformsFor,
  releasePlatformPlan,
} from "./desktop-release-plan.mjs";

const SOURCE_WORKFLOW = ".github/workflows/desktop_cd.yaml";
const PUBLISH_WORKFLOW = ".github/workflows/desktop_publish.yaml";

export { releasePlatformPlan };

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {};

  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    invariant(key?.startsWith("--") && value, `Invalid argument: ${key ?? ""}`);
    args[key.slice(2)] = value;
  }

  return { command, args };
}

function normalizeSha(value) {
  invariant(
    typeof value === "string" && /^[0-9a-fA-F]{40}$/.test(value),
    "Candidate SHA must contain 40 hexadecimal characters",
  );
  return value.toLowerCase();
}

function normalizeRunId(value) {
  const runId = String(value);
  invariant(
    /^[1-9][0-9]*$/.test(runId),
    "Workflow run ID must be a positive integer",
  );
  return runId;
}

function normalizeBoolean(value, label) {
  invariant(
    value === "true" || value === "false",
    `${label} must be true or false`,
  );
  return value === "true";
}

// Release assets are identified by the file name they are published under, so
// provenance binds the exact bytes a viewer downloads to the candidate run.
function normalizeAssetName(value) {
  invariant(
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value),
    `Release asset name is invalid: ${value}`,
  );
  return value;
}

function normalizeAsset(asset) {
  normalizeAssetName(asset?.id);

  const size = Number(asset.size);
  invariant(
    Number.isSafeInteger(size) && size > 0,
    `Asset ${asset.id} has an invalid size`,
  );

  const publicPlatform = asset.publicPlatform ?? null;
  const updatePlatform = asset.updatePlatform ?? null;
  const signature = asset.signature ?? null;
  invariant(
    publicPlatform === null || typeof publicPlatform === "string",
    `Asset ${asset.id} has an invalid public platform`,
  );
  invariant(
    updatePlatform === null || typeof updatePlatform === "string",
    `Asset ${asset.id} has an invalid update platform`,
  );
  invariant(
    signature === null || typeof signature === "string",
    `Asset ${asset.id} has an invalid signature`,
  );

  return {
    id: asset.id,
    publicPlatform,
    updatePlatform,
    size,
    signature,
  };
}

function normalizeAssets(release) {
  invariant(
    Array.isArray(release?.assets) && release.assets.length > 0,
    "Release has no assets",
  );

  const assets = release.assets
    .map(normalizeAsset)
    .sort((left, right) => left.id.localeCompare(right.id));
  invariant(
    new Set(assets.map((asset) => asset.id)).size === assets.length,
    "Release contains duplicate asset IDs",
  );
  return assets;
}

export function verifyDesktopPlatformSets(
  release,
  { includeLinux = true, includeWindows = true } = {},
) {
  const assets = normalizeAssets(release);
  const selection = { includeLinux, includeWindows };
  const expectedPublicPlatforms = planPlatformsFor(
    "publicPlatforms",
    selection,
  );
  const expectedUpdatePlatforms = planPlatformsFor(
    "updatePlatforms",
    selection,
  );
  invariant(
    assets.every(
      (asset) => asset.publicPlatform !== null || asset.updatePlatform !== null,
    ),
    "Every release asset must map to a public or update platform",
  );
  invariant(
    assets.every(
      (asset) =>
        asset.updatePlatform === null ||
        (typeof asset.signature === "string" && asset.signature.length > 0),
    ),
    "Every updater asset must carry a signature",
  );

  const publicPlatforms = assets
    .map((asset) => asset.publicPlatform)
    .filter((platform) => platform !== null)
    .sort();
  invariant(
    JSON.stringify(publicPlatforms) === JSON.stringify(expectedPublicPlatforms),
    `Release public platforms do not match the release plan (expected [${expectedPublicPlatforms}], got [${publicPlatforms}])`,
  );

  const updatePlatforms = assets
    .map((asset) => asset.updatePlatform)
    .filter((platform) => platform !== null)
    .sort();
  invariant(
    JSON.stringify(updatePlatforms) === JSON.stringify(expectedUpdatePlatforms),
    `Release update platforms do not match the release plan (expected [${expectedUpdatePlatforms}], got [${updatePlatforms}])`,
  );
}

// Validates workflow files against the authored release plan instead of
// letting each workflow repeat its own expected platform sets. The CD workflow
// must build every planned target triple, and neither workflow may hardcode an
// updater platform key: those must come from the plan, because a key that
// drifts from what the build produces means that platform silently stops
// updating.
export function verifyWorkflowPlatformCoverage({
  publishWorkflow,
  cdWorkflow,
  plan = releasePlatformPlan,
}) {
  const groups = Object.values(plan).filter(
    (group) => typeof group === "object" && group.buildTargets,
  );

  for (const target of groups.flatMap((group) => group.buildTargets)) {
    invariant(
      cdWorkflow.includes(target),
      `Release workflow does not build the planned target ${target}`,
    );
  }

  invariant(
    publishWorkflow.includes("scripts/desktop-release-assets.mjs merge"),
    `${PUBLISH_WORKFLOW} must merge the staged release assets from the release plan`,
  );
  invariant(
    publishWorkflow.includes("scripts/desktop-latest-json.mjs"),
    `${PUBLISH_WORKFLOW} must generate latest.json from the release plan`,
  );

  for (const [workflow, contents] of [
    [SOURCE_WORKFLOW, cdWorkflow],
    [PUBLISH_WORKFLOW, publishWorkflow],
  ]) {
    for (const platform of groups.flatMap((group) => group.updatePlatforms)) {
      invariant(
        !contents.includes(platform),
        `${workflow} hardcodes the updater platform key ${platform}; it must come from the release plan`,
      );
    }
  }
}

async function hashStream(stream) {
  const hash = createHash("sha256");
  let size = 0;

  for await (const chunk of stream) {
    hash.update(chunk);
    size += chunk.length;
  }

  return { sha256: hash.digest("hex"), size };
}

async function hashAsset(asset, assetDir) {
  invariant(assetDir, "Missing local asset directory");
  const result = await hashStream(
    createReadStream(path.join(assetDir, asset.id)),
  );

  invariant(
    result.size === asset.size,
    `Asset ${asset.id} has size ${result.size}, expected ${asset.size}`,
  );
  return result.sha256;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function createManifest({
  release,
  output,
  version,
  candidateSha,
  workflowRunId,
  assetDir,
}) {
  invariant(
    release?.version === version,
    `Release version is ${release?.version}, expected ${version}`,
  );
  invariant(
    String(release?.status ?? "").toLowerCase() === "draft",
    "A provenance manifest can only be created from a draft release",
  );

  const assets = normalizeAssets(release);
  const hashedAssets = [];
  for (const asset of assets) {
    hashedAssets.push({
      ...asset,
      sha256: await hashAsset(asset, assetDir),
    });
  }

  const manifest = {
    schemaVersion: 1,
    sourceWorkflow: SOURCE_WORKFLOW,
    workflowRunId: normalizeRunId(workflowRunId),
    candidateSha: normalizeSha(candidateSha),
    version,
    channel: "stable",
    publish: false,
    assets: hashedAssets,
  };

  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function verifyManifest({
  release,
  manifest,
  version,
  candidateSha,
  workflowRunId,
  assetDir,
}) {
  invariant(
    manifest?.schemaVersion === 1,
    "Unsupported provenance manifest schema",
  );
  invariant(
    manifest.sourceWorkflow === SOURCE_WORKFLOW,
    "Unexpected source workflow",
  );
  invariant(
    manifest.workflowRunId === normalizeRunId(workflowRunId),
    "Workflow run ID mismatch",
  );
  invariant(
    manifest.candidateSha === normalizeSha(candidateSha),
    "Candidate SHA mismatch",
  );
  invariant(manifest.version === version, "Manifest version mismatch");
  invariant(manifest.channel === "stable", "Manifest channel is not stable");
  invariant(
    manifest.publish === false,
    "Provenance must come from a publish=false run",
  );
  invariant(
    manifest.tools === undefined,
    "Provenance manifest must not pin an external release tool",
  );
  invariant(
    release?.version === version,
    `Release version is ${release?.version}, expected ${version}`,
  );

  const currentAssets = normalizeAssets(release);
  invariant(
    Array.isArray(manifest.assets) &&
      manifest.assets.length === currentAssets.length,
    "Release asset count does not match the provenance manifest",
  );

  for (let index = 0; index < currentAssets.length; index += 1) {
    const current = currentAssets[index];
    const recorded = manifest.assets[index];
    const { sha256, ...recordedMetadata } = recorded ?? {};
    invariant(
      JSON.stringify(recordedMetadata) === JSON.stringify(current),
      `Asset metadata changed at index ${index}`,
    );
    invariant(
      typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256),
      `Asset ${current.id} has an invalid recorded SHA-256`,
    );

    const currentSha256 = await hashAsset(current, assetDir);
    invariant(currentSha256 === sha256, `Asset ${current.id} SHA-256 changed`);
  }
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  invariant(
    command === "create" ||
      command === "verify" ||
      command === "verify-platforms",
    "Expected create, verify, or verify-platforms command",
  );

  const common = {
    version: args.version,
    candidateSha: args["candidate-sha"],
    workflowRunId: args["run-id"],
    assetDir: args["asset-dir"],
  };

  if (command === "create") {
    invariant(args.output, "Missing --output");
    await createManifest({
      ...common,
      release: await readJson(args.release),
      output: args.output,
    });
    console.log(`Wrote release provenance to ${args.output}`);
    return;
  }

  if (command === "verify-platforms") {
    invariant(args.release, "Missing --release");
    verifyDesktopPlatformSets(await readJson(args.release), {
      includeLinux: normalizeBoolean(
        args["include-linux"] ?? "true",
        "include-linux",
      ),
      includeWindows: normalizeBoolean(
        args["include-windows"] ?? "true",
        "include-windows",
      ),
    });
    console.log("Release desktop platforms match the selected release plan");
    return;
  }

  invariant(args.manifest, "Missing --manifest");
  const manifest = await readJson(args.manifest);
  await verifyManifest({
    ...common,
    release: await readJson(args.release),
    manifest,
  });
  console.log("Release provenance verified");
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
