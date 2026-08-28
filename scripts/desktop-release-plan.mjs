import { readFileSync } from "node:fs";

// The authored plan is the single source for supported release platforms,
// release asset file names, and updater platform keys. Workflow matrices and
// generated release metadata are validated against it in the release tests.
export const releasePlatformPlan = JSON.parse(
  readFileSync(
    new URL("./desktop-release-platforms.json", import.meta.url),
    "utf8",
  ),
);

export const PLATFORM_GROUPS = ["macos", "linux", "windows"];

export function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function selectedGroups(
  { includeLinux = true, includeWindows = true } = {},
  plan = releasePlatformPlan,
) {
  return PLATFORM_GROUPS.filter((group) => {
    if (group === "linux") return includeLinux;
    if (group === "windows") return includeWindows;
    return true;
  }).map((group) => {
    invariant(plan[group], `Release plan has no ${group} group`);
    return group;
  });
}

export function plannedPlatforms(kind, selection, plan = releasePlatformPlan) {
  return selectedGroups(selection, plan)
    .flatMap((group) => plan[group][kind])
    .sort();
}

export function plannedAssets(selection, plan = releasePlatformPlan) {
  return selectedGroups(selection, plan).flatMap((group) =>
    plan[group].assets.map((asset) => ({ ...asset, group })),
  );
}

export function plannedUpdaterAssets(selection, plan = releasePlatformPlan) {
  return plannedAssets(selection, plan).filter(
    (asset) => asset.updatePlatform !== null,
  );
}

export function assetsForBuildTarget(buildTarget, plan = releasePlatformPlan) {
  const assets = plannedAssets(
    { includeLinux: true, includeWindows: true },
    plan,
  ).filter((asset) => asset.buildTarget === buildTarget);
  invariant(
    assets.length > 0,
    `Release plan has no assets for build target ${buildTarget}`,
  );
  return assets;
}

export function releaseRepository(plan = releasePlatformPlan) {
  const repository = plan.releaseRepository;
  invariant(
    typeof repository === "string" && /^[\w.-]+\/[\w.-]+$/.test(repository),
    "Release plan has no valid releaseRepository",
  );
  return repository;
}

export function releaseTag(version, plan = releasePlatformPlan) {
  invariant(
    typeof version === "string" && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version),
    `Version must be a stable semantic version, got ${version}`,
  );
  return `${plan.tagPrefix}${version}`;
}
