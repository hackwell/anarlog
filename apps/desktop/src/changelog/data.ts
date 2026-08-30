import { useMemo } from "react";
// @ts-ignore virtual module provided by ../../plugins/changelog.ts
import { entries, latestVersion } from "virtual:changelog";

import { processContent } from "@anlg/changelog";

export function getLatestVersion(): string | null {
  return latestVersion;
}

export function useChangelogContent(version: string) {
  return useMemo(() => {
    const raw = (entries as Record<string, string>)[version];
    if (!raw) {
      return { content: null, date: null, loading: false };
    }

    const { content, date } = processContent(raw);
    return { content, date, loading: false };
  }, [version]);
}
