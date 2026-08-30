import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { diskImage, isNewer, type Release, updaterBundle, versionOf } from "./release.ts";

const TOKEN = required("GITHUB_TOKEN");
const REPOSITORY = required("GITHUB_REPOSITORY");
const PUBLIC_URL = required("PUBLIC_URL").replace(/\/+$/, "");
const PORT = Number(process.env.PORT ?? 8080);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_SECONDS ?? 300) * 1000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const api = (path: string, accept = "application/vnd.github+json") =>
  fetch(`https://api.github.com${path}`, {
    headers: {
      accept,
      authorization: `Bearer ${TOKEN}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "session-echo-update-server",
    },
    redirect: "manual",
  });

let cached: { at: number; release: Release } | null = null;

// A repository with no published release is not a failure: it means there is
// nothing to update to, and answering 502 would show the app an error where
// "you are up to date" is the truth.
async function latestRelease(): Promise<Release | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.release;
  }
  const response = await api(`/repos/${REPOSITORY}/releases/latest`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for the latest release`);
  }
  const release = (await response.json()) as Release;
  cached = { at: Date.now(), release };
  return release;
}

// Asset downloads answer with a redirect to a time-limited signed URL that
// needs no credentials. Forwarding our Authorization header to that host makes
// the storage backend reject the request, so the redirect is resolved by the
// caller instead of being followed here.
async function signedAssetUrl(assetId: number): Promise<string> {
  const response = await api(`/repos/${REPOSITORY}/releases/assets/${assetId}`, "application/octet-stream");
  const location = response.headers.get("location");
  if (!location) {
    throw new Error(`GitHub returned ${response.status} without a download location for asset ${assetId}`);
  }
  return location;
}

async function assetText(assetId: number): Promise<string> {
  const signed = await fetch(await signedAssetUrl(assetId));
  if (!signed.ok) {
    throw new Error(`Signed download returned ${signed.status}`);
  }
  return (await signed.text()).trim();
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
};

// Tauri substitutes {{target}} and {{arch}} itself; on macOS target is "darwin".
async function handleUpdate(res: ServerResponse, target: string, arch: string, currentVersion: string) {
  if (target !== "darwin") {
    res.writeHead(204).end();
    return;
  }

  const release = await latestRelease();
  if (!release) {
    res.writeHead(204).end();
    return;
  }
  const version = versionOf(release);
  if (!isNewer(version, currentVersion)) {
    res.writeHead(204).end();
    return;
  }

  const artifacts = updaterBundle(release, arch);
  if (!artifacts) {
    send(res, 404, { error: `No macOS ${arch} updater bundle in ${release.tag_name}` });
    return;
  }

  send(res, 200, {
    version,
    pub_date: release.published_at,
    notes: release.body ?? "",
    url: `${PUBLIC_URL}/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(artifacts.bundle.name)}`,
    signature: await assetText(artifacts.signature.id),
  });
}

async function handleDownload(res: ServerResponse, tag: string, name: string) {
  const release = await latestRelease();
  // Only the current release is served: an older tag would hand out binaries
  // that the newest release exists to replace.
  if (!release || release.tag_name !== tag) {
    send(res, 404, { error: `Unknown release ${tag}` });
    return;
  }
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset) {
    send(res, 404, { error: `Unknown asset ${name}` });
    return;
  }
  res.writeHead(302, { location: await signedAssetUrl(asset.id), "cache-control": "no-store" }).end();
}

async function handleLatestDmg(res: ServerResponse, arch: string) {
  const release = await latestRelease();
  if (!release) {
    send(res, 404, { error: "No published release yet" });
    return;
  }
  const asset = diskImage(release, arch);
  if (!asset) {
    send(res, 404, { error: `No macOS ${arch} disk image in ${release.tag_name}` });
    return;
  }
  res.writeHead(302, { location: await signedAssetUrl(asset.id), "cache-control": "no-store" }).end();
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", PUBLIC_URL);
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  const route = async () => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, { error: "Method not allowed" });
      return;
    }
    if (segments[0] === "healthz") {
      send(res, 200, { ok: true });
      return;
    }
    // /stable/{target}/{arch}/{current_version}
    if (segments[0] === "stable" && segments.length === 4) {
      await handleUpdate(res, segments[1]!, segments[2]!, segments[3]!);
      return;
    }
    // /download/latest/macos/{arch} -- the link a person clicks
    if (segments[0] === "download" && segments[1] === "latest" && segments[2] === "macos" && segments[3]) {
      await handleLatestDmg(res, segments[3]);
      return;
    }
    // /download/{tag}/{asset} -- what the updater follows
    if (segments[0] === "download" && segments.length === 3) {
      await handleDownload(res, segments[1]!, segments[2]!);
      return;
    }
    send(res, 404, { error: "Not found" });
  };

  route().catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) {
      send(res, 502, { error: "Upstream failure" });
    }
  });
});

server.listen(PORT, () => {
  console.log(`update server for ${REPOSITORY} listening on ${PORT}`);
});
