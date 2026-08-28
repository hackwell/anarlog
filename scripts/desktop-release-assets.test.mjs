import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  manifestName,
  mergeStagedAssets,
  publicAssetFiles,
  releaseAssetFiles,
  stageBuildTarget,
} from "./desktop-release-assets.mjs";
import { releasePlatformPlan } from "./desktop-release-plan.mjs";

const signature = "dW50cnVzdGVkQ29tbWVudA==";

async function scratch(prefix) {
  return mkdtemp(path.join(os.tmpdir(), `anarlog-${prefix}-`));
}

// Reproduces the layout `tauri build` leaves behind for one target triple.
async function fakeBundleTree(
  root,
  buildTarget,
  { omitSignature = null } = {},
) {
  const assets = Object.values(releasePlatformPlan)
    .filter((group) => typeof group === "object" && group.assets)
    .flatMap((group) => group.assets)
    .filter((asset) => asset.buildTarget === buildTarget);

  for (const asset of assets) {
    const bundleDir = path.join(
      root,
      buildTarget,
      "release",
      "bundle",
      asset.bundle,
    );
    await mkdir(bundleDir, { recursive: true });
    const source = path.join(
      bundleDir,
      `Session Echo_1.4.14${asset.extension}`,
    );
    await writeFile(source, `payload:${asset.file}`);
    if (asset.updatePlatform !== null && asset.file !== omitSignature) {
      await writeFile(`${source}.sig`, `${signature}\n`);
    }
  }
  return assets;
}

test("stages every planned asset for a build target under its release name", async () => {
  const directory = await scratch("stage");
  try {
    const bundleRoot = path.join(directory, "target");
    const outputDir = path.join(directory, "staged");
    await mkdir(outputDir);
    await fakeBundleTree(bundleRoot, "x86_64-unknown-linux-gnu");

    const staged = await stageBuildTarget({
      bundleRoot,
      buildTarget: "x86_64-unknown-linux-gnu",
      outputDir,
    });

    assert.deepEqual(
      staged.map((asset) => asset.id),
      ["anarlog-linux-x86_64.AppImage", "anarlog-linux-x86_64.deb"],
    );
    assert.deepEqual(
      staged.map((asset) => asset.updatePlatform),
      ["linux-x86_64-appimage", "linux-x86_64-deb"],
    );
    for (const asset of staged) {
      assert.equal(asset.signature, signature);
      assert.ok(asset.size > 0);
    }
    assert.equal(
      manifestName("x86_64-unknown-linux-gnu"),
      "assets-x86_64-unknown-linux-gnu.json",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses to stage an updater artifact without its .sig", async () => {
  const directory = await scratch("stage-unsigned");
  try {
    const bundleRoot = path.join(directory, "target");
    const outputDir = path.join(directory, "staged");
    await mkdir(outputDir);
    await fakeBundleTree(bundleRoot, "aarch64-apple-darwin", {
      omitSignature: "anarlog-macos-aarch64.app.tar.gz",
    });

    await assert.rejects(
      stageBuildTarget({
        bundleRoot,
        buildTarget: "aarch64-apple-darwin",
        outputDir,
      }),
      /anarlog-macos-aarch64\.app\.tar\.gz\.sig: Missing updater signature/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an ambiguous bundle directory", async () => {
  const directory = await scratch("stage-ambiguous");
  try {
    const bundleRoot = path.join(directory, "target");
    const outputDir = path.join(directory, "staged");
    await mkdir(outputDir);
    await fakeBundleTree(bundleRoot, "x86_64-pc-windows-msvc");
    await writeFile(
      path.join(
        bundleRoot,
        "x86_64-pc-windows-msvc/release/bundle/nsis/Session Echo_1.4.13.exe",
      ),
      "stale",
    );

    await assert.rejects(
      stageBuildTarget({
        bundleRoot,
        buildTarget: "x86_64-pc-windows-msvc",
        outputDir,
      }),
      /Expected exactly one \.exe bundle/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function stageAll(directory, buildTargets) {
  const bundleRoot = path.join(directory, "target");
  const assetDir = path.join(directory, "assets");
  await mkdir(assetDir, { recursive: true });
  for (const buildTarget of buildTargets) {
    await fakeBundleTree(bundleRoot, buildTarget);
    await stageBuildTarget({ bundleRoot, buildTarget, outputDir: assetDir });
  }
  return assetDir;
}

const allTargets = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
];

test("merges the whole matrix into one release description", async () => {
  const directory = await scratch("merge");
  try {
    const assetDir = await stageAll(directory, allTargets);
    const release = await mergeStagedAssets({ assetDir, version: "1.4.14" });

    assert.equal(release.version, "1.4.14");
    assert.equal(release.status, "draft");
    assert.deepEqual(
      release.assets.map((asset) => asset.id),
      releaseAssetFiles(),
    );
    for (const asset of release.assets) {
      if (asset.updatePlatform !== null) {
        assert.equal(asset.signature, signature);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails when the matrix did not stage a selected platform", async () => {
  const directory = await scratch("merge-missing");
  try {
    const assetDir = await stageAll(directory, [
      "aarch64-apple-darwin",
      "x86_64-apple-darwin",
    ]);

    await assert.rejects(
      mergeStagedAssets({ assetDir, version: "1.4.14" }),
      /did not stage: anarlog-linux-aarch64\.AppImage/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("merges a macOS-only release when Linux and Windows are excluded", async () => {
  const directory = await scratch("merge-macos");
  try {
    const assetDir = await stageAll(directory, [
      "aarch64-apple-darwin",
      "x86_64-apple-darwin",
    ]);
    const release = await mergeStagedAssets({
      assetDir,
      version: "1.4.14",
      includeLinux: false,
      includeWindows: false,
    });

    assert.deepEqual(
      release.assets.map((asset) => asset.id),
      publicAssetFiles({ includeLinux: false, includeWindows: false })
        .concat([
          "anarlog-macos-aarch64.app.tar.gz",
          "anarlog-macos-x86_64.app.tar.gz",
        ])
        .sort(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a platform that was not selected for this release", async () => {
  const directory = await scratch("merge-unselected");
  try {
    const assetDir = await stageAll(directory, allTargets);

    await assert.rejects(
      mergeStagedAssets({
        assetDir,
        version: "1.4.14",
        includeWindows: false,
      }),
      /anarlog-windows-x86_64-setup\.exe is not part of the selected release plan/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a staged asset whose bytes changed after the build", async () => {
  const directory = await scratch("merge-tampered");
  try {
    const assetDir = await stageAll(directory, allTargets);
    await writeFile(
      path.join(assetDir, "anarlog-windows-x86_64-setup.exe"),
      "a much longer replacement payload",
    );

    await assert.rejects(
      mergeStagedAssets({ assetDir, version: "1.4.14" }),
      /anarlog-windows-x86_64-setup\.exe is \d+ bytes, expected \d+/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an updater asset whose signature was stripped from the manifest", async () => {
  const directory = await scratch("merge-unsigned");
  try {
    const assetDir = await stageAll(directory, allTargets);
    const manifest = path.join(
      assetDir,
      manifestName("x86_64-unknown-linux-gnu"),
    );
    const parsed = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(manifest, "utf8"),
      ),
    );
    parsed.assets[0].signature = null;
    await writeFile(manifest, JSON.stringify(parsed, null, 2));

    await assert.rejects(
      mergeStagedAssets({ assetDir, version: "1.4.14" }),
      /has no signature/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("public assets exclude the updater-only macOS archives", () => {
  assert.deepEqual(publicAssetFiles(), [
    "anarlog-linux-aarch64.AppImage",
    "anarlog-linux-aarch64.deb",
    "anarlog-linux-x86_64.AppImage",
    "anarlog-linux-x86_64.deb",
    "anarlog-macos-aarch64.dmg",
    "anarlog-macos-x86_64.dmg",
    "anarlog-windows-x86_64-setup.exe",
  ]);
});
