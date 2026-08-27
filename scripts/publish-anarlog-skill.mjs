import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// skills/session-echo/SKILL.md is the sole authored workflow. This script
// deterministically publishes docs/skill.md from it, rewriting only the
// package-relative reference links to their public GitHub URLs, so any
// other drift between the two files fails CI (--check).
export const CANONICAL_SKILL_PATH = "skills/session-echo/SKILL.md";
export const PUBLISHED_SKILL_PATH = "docs/skill.md";
export const PLUGIN_PACKAGE_MIRRORS = [
  [
    "skills/session-echo/SKILL.md",
    "agent-plugins/session-echo/skills/session-echo/SKILL.md",
  ],
  [
    "skills/session-echo/references/cli.md",
    "agent-plugins/session-echo/skills/session-echo/references/cli.md",
  ],
  [
    "skills/session-echo/references/errors.md",
    "agent-plugins/session-echo/skills/session-echo/references/errors.md",
  ],
  [
    "skills/session-echo/references/mcp.md",
    "agent-plugins/session-echo/skills/session-echo/references/mcp.md",
  ],
  [
    "skills/session-echo/references/setup.md",
    "agent-plugins/session-echo/skills/session-echo/references/setup.md",
  ],
  ["LICENSE", "agent-plugins/session-echo/LICENSE"],
];

const SKILL_REPO_BASE =
  "https://github.com/fastrepl/anarlog/blob/main/skills/session-echo";

export const REFERENCE_LINK_REWRITES = {
  "references/cli.md": `${SKILL_REPO_BASE}/references/cli.md`,
  "references/mcp.md": `${SKILL_REPO_BASE}/references/mcp.md`,
  "references/errors.md": `${SKILL_REPO_BASE}/references/errors.md`,
  "references/setup.md": `${SKILL_REPO_BASE}/references/setup.md`,
};

export function publishSkill(canonical) {
  let published = canonical;
  for (const [reference, url] of Object.entries(REFERENCE_LINK_REWRITES)) {
    published = published.split(`](${reference})`).join(`](${url})`);
  }

  const unrewritten = published.match(/\]\(references\/[^)]*\)/);
  if (unrewritten) {
    throw new Error(
      `SKILL.md links to ${unrewritten[0]} which has no public URL mapping`,
    );
  }
  return published;
}

function main() {
  const check = process.argv.includes("--check");
  const canonical = readFileSync(CANONICAL_SKILL_PATH, "utf8");
  const published = publishSkill(canonical);

  if (check) {
    const drifted = [];
    if (readFileIfPresent(PUBLISHED_SKILL_PATH) !== published) {
      drifted.push(PUBLISHED_SKILL_PATH);
    }
    for (const [source, target] of PLUGIN_PACKAGE_MIRRORS) {
      if (readFileIfPresent(target) !== readFileSync(source, "utf8")) {
        drifted.push(target);
      }
    }

    if (drifted.length > 0) {
      console.error(
        `${drifted.join(", ")} drifted from the Session Echo skill package; run: node scripts/publish-anarlog-skill.mjs`,
      );
      process.exitCode = 1;
      return;
    }
    console.log("Published Session Echo skill files are current");
    return;
  }

  writeFileSync(PUBLISHED_SKILL_PATH, published);
  for (const [source, target] of PLUGIN_PACKAGE_MIRRORS) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(source, "utf8"));
  }
  console.log("Published Session Echo skill files");
}

function readFileIfPresent(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isMain) {
  main();
}
