import assert from "node:assert/strict";
import test from "node:test";

import { diskImage, isNewer, type Release, updaterBundle, versionOf } from "./release.ts";

const release = (names: string[]): Release => ({
  tag_name: "desktop_v1.5.0",
  name: "1.5.0",
  body: "",
  published_at: "2026-08-30T20:00:00Z",
  assets: names.map((name, id) => ({ id, name, size: 1 })),
});

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

test("pairs the updater bundle with its signature", () => {
  const found = updaterBundle(
    release(["app-macos-aarch64.app.tar.gz", "app-macos-aarch64.app.tar.gz.sig", "app-macos-aarch64.dmg"]),
    "aarch64",
  );
  assert.equal(found?.bundle.name, "app-macos-aarch64.app.tar.gz");
  assert.equal(found?.signature.name, "app-macos-aarch64.app.tar.gz.sig");
});

// Serving a bundle without its signature makes the updater reject the download
// after it has spent the bandwidth, so it must not be offered at all.
test("refuses an updater bundle whose signature is missing", () => {
  assert.equal(updaterBundle(release(["app-macos-aarch64.app.tar.gz"]), "aarch64"), null);
});

test("keeps the architectures apart", () => {
  const both = release([
    "app-macos-aarch64.app.tar.gz",
    "app-macos-aarch64.app.tar.gz.sig",
    "app-macos-x86_64.app.tar.gz",
    "app-macos-x86_64.app.tar.gz.sig",
    "app-macos-aarch64.dmg",
    "app-macos-x86_64.dmg",
  ]);
  assert.equal(updaterBundle(both, "x86_64")?.bundle.name, "app-macos-x86_64.app.tar.gz");
  assert.equal(diskImage(both, "aarch64")?.name, "app-macos-aarch64.dmg");
});

test("does not mistake the disk image for the updater bundle", () => {
  assert.equal(updaterBundle(release(["app-macos-aarch64.dmg"]), "aarch64"), null);
  assert.equal(diskImage(release(["app-macos-aarch64.app.tar.gz"]), "aarch64"), null);
});
