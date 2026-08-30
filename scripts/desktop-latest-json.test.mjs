import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLatestJson, writeLatestJson } from "./desktop-latest-json.mjs";
import {
  plannedUpdaterAssets,
  releasePlatformPlan,
} from "./desktop-release-plan.mjs";

const version = "1.4.14";
const notes = "https://sessionecho.flagbit.de/changelog/1.4.14";
const pubDate = "2026-08-27T09:15:00Z";
const signature = "dW50cnVzdGVkQ29tbWVudA==";

// A realistic staging directory: every artifact the release plan expects, each
// updater artifact accompanied by the .sig file tauri build writes beside it.
async function stageAssets({
  includeLinux = true,
  includeWindows = true,
  omitSignatureFor = null,
  omitArtifactFor = null,
} = {}) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "anarlog-latest-json-"),
  );
  const assetDir = path.join(directory, "assets");
  await mkdir(assetDir);

  const groups = [
    "macos",
    ...(includeLinux ? ["linux"] : []),
    ...(includeWindows ? ["windows"] : []),
  ];
  for (const group of groups) {
    for (const asset of releasePlatformPlan[group].assets) {
      if (asset.file !== omitArtifactFor) {
        await writeFile(
          path.join(assetDir, asset.file),
          `payload:${asset.file}`,
        );
      }
      if (asset.updatePlatform !== null && asset.file !== omitSignatureFor) {
        await writeFile(
          path.join(assetDir, `${asset.file}.sig`),
          `${signature}\n`,
        );
      }
    }
  }

  return { directory, assetDir };
}

test("maps every planned updater artifact to a signed download URL", async () => {
  const { directory, assetDir } = await stageAssets();
  try {
    const latest = await buildLatestJson({
      assetDir,
      version,
      notes,
      pubDate,
    });

    assert.equal(latest.version, version);
    assert.equal(latest.pub_date, "2026-08-27T09:15:00Z");
    assert.equal(latest.notes, notes);
    assert.deepEqual(latest.platforms["darwin-aarch64"], {
      url: "https://github.com/flagbit/session-echo/releases/download/desktop_v1.4.14/anarlog-macos-aarch64.app.tar.gz",
      signature,
    });
    assert.deepEqual(latest.platforms["linux-x86_64-deb"], {
      url: "https://github.com/flagbit/session-echo/releases/download/desktop_v1.4.14/anarlog-linux-x86_64.deb",
      signature,
    });
    assert.deepEqual(latest.platforms["windows-x86_64-nsis"], {
      url: "https://github.com/flagbit/session-echo/releases/download/desktop_v1.4.14/anarlog-windows-x86_64-setup.exe",
      signature,
    });
    for (const platform of Object.values(latest.platforms)) {
      assert.ok(platform.signature.length > 0);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// The platform keys are the ones tauri-plugin-updater looks up at runtime
// ({os}-{arch}-{installer}, falling back to {os}-{arch}). Deriving them from
// the plan instead of a hardcoded list is what keeps a platform from silently
// never updating.
test("derives the platform keys from the release plan, not a hardcoded list", async () => {
  const { directory, assetDir } = await stageAssets();
  try {
    const latest = await buildLatestJson({
      assetDir,
      version,
      notes,
      pubDate,
    });

    const planned = plannedUpdaterAssets({
      includeLinux: true,
      includeWindows: true,
    })
      .map((asset) => asset.updatePlatform)
      .sort();

    assert.deepEqual(Object.keys(latest.platforms), planned);
    assert.deepEqual(planned, [
      "darwin-aarch64",
      "linux-aarch64-appimage",
      "linux-aarch64-deb",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "windows-x86_64-nsis",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("covers only the selected platforms for a macOS-only release", async () => {
  const { directory, assetDir } = await stageAssets({
    includeLinux: false,
    includeWindows: false,
  });
  try {
    const latest = await buildLatestJson({
      assetDir,
      version,
      notes,
      pubDate,
      includeLinux: false,
      includeWindows: false,
    });

    assert.deepEqual(Object.keys(latest.platforms), ["darwin-aarch64"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("covers macOS and Linux when Windows is excluded", async () => {
  const { directory, assetDir } = await stageAssets({ includeWindows: false });
  try {
    const latest = await buildLatestJson({
      assetDir,
      version,
      notes,
      pubDate,
      includeWindows: false,
    });

    assert.ok(!("windows-x86_64-nsis" in latest.platforms));
    assert.deepEqual(Object.keys(latest.platforms), [
      "darwin-aarch64",
      "linux-aarch64-appimage",
      "linux-aarch64-deb",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails loudly when an updater signature is missing", async () => {
  const { directory, assetDir } = await stageAssets({
    omitSignatureFor: "anarlog-linux-aarch64.AppImage",
  });
  try {
    await assert.rejects(
      buildLatestJson({ assetDir, version, notes, pubDate }),
      /Missing updater signature anarlog-linux-aarch64\.AppImage\.sig/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("never writes a latest.json when a signature is missing", async () => {
  const { directory, assetDir } = await stageAssets({
    omitSignatureFor: "anarlog-macos-aarch64.app.tar.gz",
  });
  const output = path.join(directory, "latest.json");
  try {
    await assert.rejects(
      writeLatestJson({ assetDir, output, version, notes, pubDate }),
      /Missing updater signature/,
    );
    await assert.rejects(readFile(output, "utf8"), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an empty updater signature", async () => {
  const { directory, assetDir } = await stageAssets();
  try {
    await writeFile(
      path.join(assetDir, "anarlog-windows-x86_64-setup.exe.sig"),
      "   \n",
    );
    await assert.rejects(
      buildLatestJson({ assetDir, version, notes, pubDate }),
      /anarlog-windows-x86_64-setup\.exe\.sig is empty/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a missing updater artifact", async () => {
  const { directory, assetDir } = await stageAssets({
    omitArtifactFor: "anarlog-macos-aarch64.app.tar.gz",
  });
  try {
    await assert.rejects(
      buildLatestJson({ assetDir, version, notes, pubDate }),
      /Missing updater artifact anarlog-macos-aarch64\.app\.tar\.gz/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a version that is not a stable release", async () => {
  const { directory, assetDir } = await stageAssets();
  try {
    await assert.rejects(
      buildLatestJson({ assetDir, version: "1.4.14-rc.1", notes, pubDate }),
      /stable semantic version/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writes a stable, sorted document", async () => {
  const { directory, assetDir } = await stageAssets();
  const output = path.join(directory, "latest.json");
  try {
    await writeLatestJson({ assetDir, output, version, notes, pubDate });
    const written = await readFile(output, "utf8");
    assert.ok(written.endsWith("\n"));

    const parsed = JSON.parse(written);
    assert.deepEqual(
      Object.keys(parsed.platforms),
      [...Object.keys(parsed.platforms)].sort(),
    );
    assert.deepEqual(Object.keys(parsed), [
      "version",
      "pub_date",
      "notes",
      "platforms",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
