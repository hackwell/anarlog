import { readdirSync, readFileSync, watch } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const changelogDir = resolve(__dirname, "../../../packages/changelog/content");

const VIRTUAL_ID = "virtual:changelog";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

function listVersions(): string[] {
  try {
    const files = readdirSync(changelogDir).filter(
      (f) => f.endsWith(".md") && /^\d/.test(f),
    );
    const versions = files.map((f) => f.replace(".md", ""));
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions;
  } catch {
    return [];
  }
}

function buildModule(): string {
  const versions = listVersions();
  const entries: Record<string, string> = {};

  for (const version of versions) {
    try {
      entries[version] = readFileSync(
        resolve(changelogDir, `${version}.md`),
        "utf-8",
      );
    } catch {}
  }

  return [
    `export const latestVersion = ${JSON.stringify(versions[0] ?? null)};`,
    `export const entries = ${JSON.stringify(entries)};`,
  ].join("\n");
}

export function changelog(): Plugin {
  return {
    name: "changelog",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id === RESOLVED_ID) return buildModule();
    },
    configureServer(server: ViteDevServer) {
      if (process.env.NODE_ENV === "test" || process.env.VITEST) {
        return;
      }

      try {
        watch(changelogDir, { recursive: true }, () => {
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: "full-reload" });
          }
        });
      } catch {}
    },
  };
}
