export type Asset = { id: number; name: string; size: number };
export type Release = {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: Asset[];
};

// The release ships one latest.json holding every platform's updater signature.
// The build writes it; nothing else in the release carries the signature, so
// this file is the only source for it.
export type LatestJson = {
  version: string;
  pub_date?: string;
  notes?: string;
  platforms: Record<string, { url: string; signature: string }>;
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

export function latestJsonAsset(release: Release): Asset | null {
  return release.assets.find((asset) => asset.name === "latest.json") ?? null;
}

// The url in latest.json points straight at the private repository, where a
// download needs credentials. Only the file name survives; the caller rebuilds
// the link so it goes through this server instead.
export function updaterFor(
  latest: LatestJson,
  target: string,
  arch: string,
): { assetName: string; signature: string } | null {
  const platform = latest.platforms?.[`${target}-${arch}`];
  if (!platform?.signature || !platform.url) {
    return null;
  }
  const assetName = platform.url.split("/").pop();
  return assetName ? { assetName, signature: platform.signature } : null;
}

export function diskImage(release: Release, arch: string): Asset | null {
  return release.assets.find((asset) => asset.name.endsWith(`-macos-${arch}.dmg`)) ?? null;
}
