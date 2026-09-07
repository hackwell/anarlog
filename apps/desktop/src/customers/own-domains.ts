import { useEffect, useMemo, useRef } from "react";

import { emailDomain, isPublicMailProvider } from "./domains";

import {
  useSetSettingValue,
  useSettingsReady,
  useStoredSettingValue,
} from "~/settings/queries";
import { useOwnerUserEmail } from "~/shared/owner-user";

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

export function ownDomainSeed(ownerEmail: string): string[] | null {
  const domain = emailDomain(ownerEmail);
  // A freemailer says nothing about which company we are, and claiming it as
  // our own would make every contact writing from it internal.
  if (!domain || isPublicMailProvider(domain)) {
    return null;
  }
  return [domain];
}

// An empty list is not the same as an unconfigured one: the resolver refuses
// to assign anything without it, so it is seeded once from the signed-in
// user's own address. `hasValue` is what separates "never set" from a list
// the user deliberately emptied — that one is left alone.
export function useSeedOwnEmailDomain(): void {
  const { hasValue } = useStoredSettingValue("own_email_domains");
  const settingsReady = useSettingsReady();
  const setOwnEmailDomains = useSetSettingValue("own_email_domains");
  const ownerEmail = useOwnerUserEmail();
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current || !settingsReady || hasValue) return;

    const seed = ownDomainSeed(ownerEmail);
    if (!seed) return;

    seededRef.current = true;
    setOwnEmailDomains(serializeOwnDomains(seed));
  }, [settingsReady, hasValue, ownerEmail, setOwnEmailDomains]);
}
