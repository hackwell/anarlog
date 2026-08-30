export type Asset = { id: number; name: string; size: number };
export type Release = {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: Asset[];
};

export function versionOf(release: Pick<Release, "tag_name">): string {
  return release.tag_name.replace(/^desktop_v/, "").replace(/^v/, "");
}

// Numeric comparison only: release tags are plain x.y.z, and a pre-release
// suffix would mean a channel this server does not serve.
export function isNewer(candidate: string, current: string): boolean {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(candidate), parse(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) {
      return left > right;
    }
  }
  return false;
}

// The updater bundle and the disk image are different artifacts: Tauri updates
// from the .app.tar.gz and only ever shows the .dmg to a person.
export function updaterBundle(release: Release, arch: string): { bundle: Asset; signature: Asset } | null {
  const bundle = release.assets.find((asset) => asset.name.endsWith(`-macos-${arch}.app.tar.gz`));
  if (!bundle) {
    return null;
  }
  const signature = release.assets.find((asset) => asset.name === `${bundle.name}.sig`);
  return signature ? { bundle, signature } : null;
}

export function diskImage(release: Release, arch: string): Asset | null {
  return release.assets.find((asset) => asset.name.endsWith(`-macos-${arch}.dmg`)) ?? null;
}
