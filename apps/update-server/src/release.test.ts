import assert from "node:assert/strict";
import test from "node:test";

import { diskImage, isNewer, latestJsonAsset, type LatestJson, type Release, updaterFor, versionOf } from "./release.ts";

const release = (names: string[]): Release => ({
  tag_name: "desktop_v1.5.0",
  name: "1.5.0",
  body: "",
  published_at: "2026-08-30T21:00:43Z",
  assets: names.map((name, id) => ({ id, name, size: 1 })),
});

// Shaped after the latest.json the release actually ships.
const manifest: LatestJson = {
  version: "1.5.0",
  platforms: {
    "darwin-aarch64": {
      url: "https://github.com/flagbit/session-echo/releases/download/desktop_v1.5.0/anarlog-macos-aarch64.app.tar.gz",
      signature: "signature-aarch64",
    },
    "darwin-x86_64": {
      url: "https://github.com/flagbit/session-echo/releases/download/desktop_v1.5.0/anarlog-macos-x86_64.app.tar.gz",
      signature: "signature-x86_64",
    },
  },
};

test("reads the version out of the release tag", () => {
  assert.equal(versionOf({ tag_name: "desktop_v1.5.0" }), "1.5.0");
  assert.equal(versionOf({ tag_name: "v1.5.0" }), "1.5.0");
});

test("offers an update only for a strictly newer version", () => {
  assert.equal(isNewer("1.5.0", "1.4.13"), true);
  assert.equal(isNewer("1.5.0", "1.5.0"), false);
  assert.equal(isNewer("1.4.13", "1.5.0"), false);
});

// 1.4.9 -> 1.4.13 is the case a string comparison gets wrong, and getting it
// wrong strands everyone on the older build.
test("compares version segments as numbers, not as text", () => {
  assert.equal(isNewer("1.4.13", "1.4.9"), true);
  assert.equal(isNewer("1.10.0", "1.9.0"), true);
});

test("finds the manifest among the release assets", () => {
  assert.equal(latestJsonAsset(release(["latest.json", "app.dmg"]))?.name, "latest.json");
  assert.equal(latestJsonAsset(release(["app.dmg"])), null);
});

test("takes the signature and the file name from the manifest", () => {
  const found = updaterFor(manifest, "darwin", "aarch64");
  assert.equal(found?.assetName, "anarlog-macos-aarch64.app.tar.gz");
  assert.equal(found?.signature, "signature-aarch64");
});

test("keeps the architectures apart", () => {
  assert.equal(updaterFor(manifest, "darwin", "x86_64")?.assetName, "anarlog-macos-x86_64.app.tar.gz");
  assert.equal(updaterFor(manifest, "darwin", "x86_64")?.signature, "signature-x86_64");
});

test("has nothing to offer a platform the manifest does not list", () => {
  assert.equal(updaterFor(manifest, "linux", "x86_64"), null);
  assert.equal(updaterFor(manifest, "darwin", "riscv64"), null);
});

// An entry without a signature would produce an update the app downloads and
// then refuses, so it must not be offered at all.
test("refuses a manifest entry that carries no signature", () => {
  const broken: LatestJson = {
    version: "1.5.0",
    platforms: { "darwin-aarch64": { url: "https://example.com/app.tar.gz", signature: "" } },
  };
  assert.equal(updaterFor(broken, "darwin", "aarch64"), null);
});

test("picks the disk image for the requested architecture", () => {
  const both = release(["anarlog-macos-aarch64.dmg", "anarlog-macos-x86_64.dmg", "latest.json"]);
  assert.equal(diskImage(both, "aarch64")?.name, "anarlog-macos-aarch64.dmg");
  assert.equal(diskImage(both, "x86_64")?.name, "anarlog-macos-x86_64.dmg");
});

test("does not mistake the updater bundle for the disk image", () => {
  assert.equal(diskImage(release(["anarlog-macos-aarch64.app.tar.gz"]), "aarch64"), null);
});
