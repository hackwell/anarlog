import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createManifest,
  releasePlatformPlan,
  verifyDesktopPlatformSets,
  verifyManifest,
  verifyWorkflowPlatformCoverage,
} from "./desktop-release-provenance.mjs";

const candidateSha = "0123456789abcdef0123456789abcdef01234567";

function createDesktopRelease({
  includeLinux = true,
  includeWindows = true,
  splitMappings = false,
} = {}) {
  const platformPairs = [
    ["dmg-aarch64", "darwin-aarch64", true],
    ["dmg-x86_64", "darwin-x86_64", true],
    ...(includeLinux
      ? [
          ["appimage-x86_64", "linux-x86_64-appimage", false],
          ["debian-x86_64", "linux-x86_64-deb", false],
          ["appimage-aarch64", "linux-aarch64-appimage", false],
          ["debian-aarch64", "linux-aarch64-deb", false],
        ]
      : []),
    ...(includeWindows ? [["nsis-x86_64", "windows-x86_64-nsis", false]] : []),
  ];

  return {
    version: "1.4.0",
    status: "draft",
    assets: platformPairs.flatMap(
      ([publicPlatform, updatePlatform, separateAssets], index) =>
        splitMappings || separateAssets
          ? [
              {
                id: `asset-public-${index}.dmg`,
                publicPlatform,
                updatePlatform: null,
                size: index + 1,
                signature: null,
              },
              {
                id: `asset-update-${index}.tar.gz`,
                publicPlatform: null,
                updatePlatform,
                size: index + 1,
                signature: `signature-${index}`,
              },
            ]
          : [
              {
                id: `asset-${index}.bin`,
                publicPlatform,
                updatePlatform,
                size: index + 1,
                signature: `signature-${index}`,
              },
            ],
    ),
  };
}

test("accepts the complete desktop public and update platform sets", () => {
  verifyDesktopPlatformSets(createDesktopRelease());
});

test("accepts separate public and updater assets", () => {
  verifyDesktopPlatformSets(createDesktopRelease({ splitMappings: true }));
});

test("accepts a macOS and Linux release without Windows", () => {
  verifyDesktopPlatformSets(createDesktopRelease({ includeWindows: false }), {
    includeWindows: false,
  });
});

test("accepts a macOS-only release", () => {
  verifyDesktopPlatformSets(
    createDesktopRelease({ includeLinux: false, includeWindows: false }),
    { includeLinux: false, includeWindows: false },
  );
});

test("rejects an omitted selected platform", () => {
  assert.throws(
    () =>
      verifyDesktopPlatformSets(
        createDesktopRelease({ includeWindows: false }),
      ),
    /public platforms do not match/,
  );
});

test("rejects an extra public desktop platform", () => {
  const release = createDesktopRelease();
  release.assets.push({
    id: "asset-extra-public.dmg",
    publicPlatform: "rpm-x86_64",
    updatePlatform: null,
    size: 1,
    signature: null,
  });

  assert.throws(
    () => verifyDesktopPlatformSets(release),
    /public platforms do not match/,
  );
});

test("rejects duplicate public desktop platforms", () => {
  const release = createDesktopRelease();
  release.assets[0].publicPlatform = release.assets[2].publicPlatform;

  assert.throws(
    () => verifyDesktopPlatformSets(release),
    /public platforms do not match/,
  );
});

test("rejects an updater-only desktop platform", () => {
  const release = createDesktopRelease();
  release.assets.push({
    id: "asset-extra-updater.deb",
    publicPlatform: null,
    updatePlatform: "linux-x86_64-rpm",
    size: 1,
    signature: "signature-extra",
  });

  assert.throws(
    () => verifyDesktopPlatformSets(release),
    /update platforms do not match/,
  );
});

test("rejects an opaque desktop release asset", () => {
  const release = createDesktopRelease();
  release.assets.push({
    id: "asset-opaque.bin",
    publicPlatform: null,
    updatePlatform: null,
    size: 1,
    signature: null,
  });

  assert.throws(
    () => verifyDesktopPlatformSets(release),
    /must map to a public or update platform/,
  );
});

test("rejects an unsigned updater asset", () => {
  const release = createDesktopRelease();
  const updater = release.assets.find((asset) => asset.updatePlatform !== null);
  updater.signature = null;

  assert.throws(
    () => verifyDesktopPlatformSets(release),
    /updater asset must carry a signature/,
  );
});

function workflowFixtures() {
  const groups = Object.values(releasePlatformPlan).filter(
    (group) => typeof group === "object" && group.buildTargets,
  );
  const cdWorkflow = groups
    .flatMap((group) => group.buildTargets)
    .map((target) => `          - target: ${target}\n`)
    .join("");
  const publishWorkflow = [
    "          node scripts/desktop-release-assets.mjs merge \\\n",
    '            --asset-dir "$RUNNER_TEMP/release-assets"\n',
    "          node scripts/desktop-latest-json.mjs \\\n",
    '            --output "$upload_dir/latest.json"\n',
  ].join("");
  return { publishWorkflow, cdWorkflow };
}

test("accepts workflows that cover the complete release plan", () => {
  verifyWorkflowPlatformCoverage(workflowFixtures());
});

test("rejects a release workflow that drops a planned build target", () => {
  const { publishWorkflow, cdWorkflow } = workflowFixtures();
  assert.throws(
    () =>
      verifyWorkflowPlatformCoverage({
        publishWorkflow,
        cdWorkflow: cdWorkflow.replace("x86_64-pc-windows-msvc", ""),
      }),
    /does not build the planned target x86_64-pc-windows-msvc/,
  );
});

test("rejects a publish workflow that does not merge the staged assets", () => {
  const { publishWorkflow, cdWorkflow } = workflowFixtures();
  assert.throws(
    () =>
      verifyWorkflowPlatformCoverage({
        publishWorkflow: publishWorkflow.replace(
          "scripts/desktop-release-assets.mjs merge",
          "cp -r assets/",
        ),
        cdWorkflow,
      }),
    /must merge the staged release assets/,
  );
});

test("rejects a publish workflow that does not generate latest.json", () => {
  const { publishWorkflow, cdWorkflow } = workflowFixtures();
  assert.throws(
    () =>
      verifyWorkflowPlatformCoverage({
        publishWorkflow: publishWorkflow.replace(
          "scripts/desktop-latest-json.mjs",
          "echo skip",
        ),
        cdWorkflow,
      }),
    /must generate latest\.json/,
  );
});

// Hardcoding an updater platform key in a workflow is exactly how a platform
// silently stops updating: the key drifts from what the build produces and
// nothing fails until users stop receiving updates.
test("rejects a workflow that hardcodes an updater platform key", () => {
  const { publishWorkflow, cdWorkflow } = workflowFixtures();
  assert.throws(
    () =>
      verifyWorkflowPlatformCoverage({
        publishWorkflow: `${publishWorkflow}          key: linux-x86_64-appimage\n`,
        cdWorkflow,
      }),
    /desktop_publish\.yaml hardcodes the updater platform key linux-x86_64-appimage/,
  );
  assert.throws(
    () =>
      verifyWorkflowPlatformCoverage({
        publishWorkflow,
        cdWorkflow: `${cdWorkflow}          key: darwin-aarch64\n`,
      }),
    /desktop_cd\.yaml hardcodes the updater platform key darwin-aarch64/,
  );
});

test("repository release workflows match the authored release plan", async () => {
  const [publishWorkflow, cdWorkflow] = await Promise.all([
    readFile(".github/workflows/desktop_publish.yaml", "utf8"),
    readFile(".github/workflows/desktop_cd.yaml", "utf8"),
  ]);

  verifyWorkflowPlatformCoverage({ publishWorkflow, cdWorkflow });
});

test("stable desktop releases submit only the Microsoft Store package", async () => {
  const [publishWorkflow, storeWorkflow] = await Promise.all([
    readFile(".github/workflows/desktop_publish.yaml", "utf8"),
    readFile(".github/workflows/desktop_store_publish.yaml", "utf8"),
  ]);

  assert.match(storeWorkflow, /\n  workflow_call:\n/);
  assert.match(
    publishWorkflow,
    /Stable releases must include Windows for automatic Microsoft Store submission/,
  );

  const jobStart = publishWorkflow.indexOf("\n  store-publish:\n");
  assert.notEqual(jobStart, -1, "missing store-publish job");
  const remainingWorkflow = publishWorkflow.slice(jobStart + 1);
  const nextJob = remainingWorkflow.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  const storePublishJob =
    nextJob === -1
      ? remainingWorkflow
      : remainingWorkflow.slice(0, nextJob + 1);

  assert.match(storePublishJob, /needs: \[parse, gh-release\]/);
  assert.match(
    storePublishJob,
    /uses: \.\/\.github\/workflows\/desktop_store_publish\.yaml/,
  );
  assert.match(storePublishJob, /include_macos: false/);
  assert.match(storePublishJob, /include_windows: true/);
  assert.match(storePublishJob, /submit_to_stores: true/);
  assert.doesNotMatch(storePublishJob, /secrets: inherit/);
  assert.match(
    storeWorkflow,
    /node workflow-source\/scripts\/app-store-connect-submit\.mjs/,
  );
  assert.match(storeWorkflow, /Submitted to App Review/);

  const expectedSecrets = [
    "APPLE_TEAM_ID",
    "APPSTORE_API_KEY_ID",
    "APPSTORE_API_PRIVATE_KEY",
    "APPSTORE_ISSUER_ID",
    "AZURE_AD_APPLICATION_SECRET",
    "KEYCHAIN_PASSWORD",
    "MAC_APP_STORE_APPLICATION_CERTIFICATE",
    "MAC_APP_STORE_APPLICATION_CERTIFICATE_PASSWORD",
    "MAC_APP_STORE_INSTALLER_CERTIFICATE",
    "MAC_APP_STORE_INSTALLER_CERTIFICATE_PASSWORD",
    "MAC_APP_STORE_PROVISIONING_PROFILE",
    "SELLER_ID",
  ];
  const declaredSecrets = [
    ...storeWorkflow.matchAll(
      /^      ([A-Z0-9_]+):\n        required: false$/gm,
    ),
  ].map((match) => match[1]);
  const forwardedSecrets = [
    ...storePublishJob.matchAll(
      /^      ([A-Z0-9_]+): \$\{\{ secrets\.([A-Z0-9_]+) \}\}$/gm,
    ),
  ].map((match) => {
    assert.equal(match[1], match[2]);
    return match[1];
  });

  assert.deepEqual(declaredSecrets, expectedSecrets);
  assert.deepEqual(forwardedSecrets, expectedSecrets);
});

test("Mac App Store builds include a compiled app icon catalog", async () => {
  const [storeWorkflow, appStoreConfig, stableConfig] = await Promise.all([
    readFile(".github/workflows/desktop_store_publish.yaml", "utf8"),
    readFile("apps/desktop/src-tauri/tauri.conf.app-store.json", "utf8").then(
      JSON.parse,
    ),
    readFile("apps/desktop/src-tauri/tauri.conf.stable.json", "utf8").then(
      JSON.parse,
    ),
  ]);

  assert.match(storeWorkflow, /name: Compile Mac App Store asset catalog/);
  assert.match(storeWorkflow, /xcrun actool/);
  assert.match(storeWorkflow, /icons\/stable\/icon\.icns/);
  assert.match(storeWorkflow, /AppIcon\.appiconset/);
  assert.match(storeWorkflow, /icon_512x512@2x\.png/);
  assert.doesNotMatch(storeWorkflow, /icons\/src\/stable\.icon/);
  assert.match(storeWorkflow, /Contents\/Resources\/Assets\.car/);
  assert.match(
    storeWorkflow,
    /security find-identity -v "\$RUNNER_TEMP\/mac-app-store\.keychain-db"/,
  );
  assert.doesNotMatch(
    storeWorkflow,
    /APPLICATION_CERT_SHA1:.*application-cert-sha1/,
  );
  assert.doesNotMatch(storeWorkflow, /application_cert_sha1\^\^/);
  assert.match(
    storeWorkflow,
    /\.bundle\.macOS\.files\["Resources\/Assets\.car"\]/,
  );
  assert.equal(
    appStoreConfig.bundle.macOS.files["Resources/Assets.car"],
    "./resources/app-store/Assets.car",
  );
  assert.equal(
    stableConfig.bundle.macOS.files["Resources/Assets.car"],
    undefined,
  );
});

test("keeps Mac App Store privacy metadata and replacement builds reviewable", async () => {
  const [entitlements, infoPlist, storeWorkflow, submitScript] =
    await Promise.all([
      readFile("apps/desktop/src-tauri/Entitlements.app-store.plist", "utf8"),
      readFile("apps/desktop/src-tauri/Info.plist", "utf8"),
      readFile(".github/workflows/desktop_store_publish.yaml", "utf8"),
      readFile("scripts/app-store-connect-submit.mjs", "utf8"),
    ]);

  assert.doesNotMatch(entitlements, /com\.apple\.security\.network\.server/);
  assert.match(infoPlist, /NSContactsUsageDescription/);
  assert.match(
    infoPlist,
    /match calendar attendees with names and email addresses saved on your Mac/,
  );
  assert.match(storeWorkflow, /build_number:/);
  assert.match(storeWorkflow, /git merge-base --is-ancestor/);
  assert.match(storeWorkflow, /compare\/\$candidate_sha\.\.\.main/);
  assert.match(storeWorkflow, /comparison_status.*identical/);
  assert.match(storeWorkflow, /bundleVersion = \$build/);
  assert.match(storeWorkflow, /--build-version "\$BUILD_NUMBER"/);
  assert.match(submitScript, /"filter\[version\]": buildVersion/);
  assert.match(
    submitScript,
    /"filter\[state\]": "READY_FOR_REVIEW,UNRESOLVED_ISSUES"/,
  );
});

test("binds every release asset to a candidate run and detects replacement", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "anarlog-release-provenance-"),
  );
  const assetDir = path.join(directory, "assets");
  await mkdir(assetDir);

  const contents = new Map([
    ["anarlog-macos-aarch64.dmg", "macOS"],
    ["anarlog-windows-x86_64-setup.exe", "Windows"],
    ["anarlog-linux-x86_64.AppImage", "Linux"],
  ]);
  for (const [id, content] of contents) {
    await writeFile(path.join(assetDir, id), content);
  }

  const release = {
    version: "1.4.0",
    status: "draft",
    assets: [
      {
        id: "anarlog-linux-x86_64.AppImage",
        publicPlatform: "appimage-x86_64",
        updatePlatform: "linux-x86_64-appimage",
        size: Buffer.byteLength(contents.get("anarlog-linux-x86_64.AppImage")),
        signature: "linux-signature",
      },
      {
        id: "anarlog-macos-aarch64.dmg",
        publicPlatform: "dmg-aarch64",
        size: Buffer.byteLength(contents.get("anarlog-macos-aarch64.dmg")),
      },
      {
        id: "anarlog-windows-x86_64-setup.exe",
        publicPlatform: "nsis-x86_64",
        updatePlatform: "windows-x86_64-nsis",
        size: Buffer.byteLength(
          contents.get("anarlog-windows-x86_64-setup.exe"),
        ),
        signature: "windows-signature",
      },
    ],
  };
  const output = path.join(directory, "manifest.json");

  const created = await createManifest({
    release,
    output,
    version: "1.4.0",
    candidateSha,
    workflowRunId: "12345",
    assetDir,
  });
  const manifest = JSON.parse(await readFile(output, "utf8"));

  // Nothing outside this repository is pinned any more: the release assets are
  // the workflow artifacts the candidate run produced.
  assert.equal(created.tools, undefined);
  assert.deepEqual(
    manifest.assets.map((asset) => asset.id),
    [
      "anarlog-linux-x86_64.AppImage",
      "anarlog-macos-aarch64.dmg",
      "anarlog-windows-x86_64-setup.exe",
    ],
  );
  await verifyManifest({
    release,
    manifest,
    version: "1.4.0",
    candidateSha,
    workflowRunId: "12345",
    assetDir,
  });

  await assert.rejects(
    verifyManifest({
      release,
      manifest,
      version: "1.4.0",
      candidateSha,
      workflowRunId: "12346",
      assetDir,
    }),
    /Workflow run ID mismatch/,
  );

  await assert.rejects(
    verifyManifest({
      release,
      manifest,
      version: "1.4.0",
      candidateSha: "f".repeat(40),
      workflowRunId: "12345",
      assetDir,
    }),
    /Candidate SHA mismatch/,
  );

  await assert.rejects(
    verifyManifest({
      release,
      manifest: { ...manifest, tools: { externalCli: {} } },
      version: "1.4.0",
      candidateSha,
      workflowRunId: "12345",
      assetDir,
    }),
    /must not pin an external release tool/,
  );

  await writeFile(
    path.join(assetDir, "anarlog-windows-x86_64-setup.exe"),
    "replaced",
  );
  await assert.rejects(
    verifyManifest({
      release,
      manifest,
      version: "1.4.0",
      candidateSha,
      workflowRunId: "12345",
      assetDir,
    }),
    /size .* expected|SHA-256 changed/,
  );
});

// Asset identity is the published file name, so a platform mapping that moves
// between artifacts is caught even when the bytes are identical.
test("rejects a release whose platform mapping moved after the candidate run", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "anarlog-release-platform-map-"),
  );
  const assetDir = path.join(directory, "assets");
  await mkdir(assetDir);
  const payload = "identical payload";
  await writeFile(path.join(assetDir, "anarlog-macos-aarch64.dmg"), payload);
  await writeFile(
    path.join(assetDir, "anarlog-windows-x86_64-setup.exe"),
    payload,
  );

  const release = {
    version: "1.4.0",
    status: "draft",
    assets: [
      {
        id: "anarlog-macos-aarch64.dmg",
        publicPlatform: "dmg-aarch64",
        size: Buffer.byteLength(payload),
        signature: null,
      },
      {
        id: "anarlog-windows-x86_64-setup.exe",
        publicPlatform: "nsis-x86_64",
        updatePlatform: "windows-x86_64-nsis",
        size: Buffer.byteLength(payload),
        signature: "signature",
      },
    ],
  };
  const output = path.join(directory, "manifest.json");
  await createManifest({
    release,
    output,
    version: "1.4.0",
    candidateSha,
    workflowRunId: "12345",
    assetDir,
  });
  const manifest = JSON.parse(await readFile(output, "utf8"));

  const swapped = {
    ...release,
    assets: [
      { ...release.assets[0], publicPlatform: "nsis-x86_64" },
      { ...release.assets[1], publicPlatform: "dmg-aarch64" },
    ],
  };

  await assert.rejects(
    verifyManifest({
      release: swapped,
      manifest,
      version: "1.4.0",
      candidateSha,
      workflowRunId: "12345",
      assetDir,
    }),
    /Asset metadata changed at index 0/,
  );
});
