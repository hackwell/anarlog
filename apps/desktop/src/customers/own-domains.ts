import { useMemo } from "react";

import { useStoredSettingValue } from "~/settings/queries";

function normalize(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const domain = value.trim().toLowerCase().replace(/^@/, "");
  return domain.includes(".") ? domain : null;
}

export function parseOwnDomains(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const seen = new Set<string>();
  for (const entry of parsed) {
    const domain = normalize(entry);
    if (domain) {
      seen.add(domain);
    }
  }

  return [...seen];
}

export function serializeOwnDomains(domains: readonly string[]): string {
  return JSON.stringify(domains);
}

export function useOwnDomains(): string[] {
  const { value } = useStoredSettingValue("own_email_domains");
  return useMemo(() => parseOwnDomains(value ?? "[]"), [value]);
}
