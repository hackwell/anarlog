import { emailDomain, isOwnDomain, isPublicMailProvider } from "./domains";

export type CustomerParticipant = {
  email: string;
  organization_id: string;
  organization_name: string;
};

export type KnownContact = { email: string; organization_id: string };

export type CustomerResolution =
  | { kind: "assign"; organizationId: string; reason: "known_contact" }
  | {
      kind: "suggest";
      organizationId: string;
      reason: "domain_match" | "known_contact";
    }
  | { kind: "suggest_create"; domain: string }
  | { kind: "none" };

const NONE: CustomerResolution = { kind: "none" };

export function resolveSessionCustomer(input: {
  participants: readonly CustomerParticipant[];
  knownContacts: readonly KnownContact[];
  ownDomains: readonly string[];
  recentOrganizationIds: readonly string[];
}): CustomerResolution {
  const { participants, knownContacts, ownDomains, recentOrganizationIds } =
    input;

  const external = participants.filter(
    (participant) => !isOwnDomain(emailDomain(participant.email), ownDomains),
  );
  if (external.length === 0) {
    return NONE;
  }

  // Participants the user has already filed under an organization are evidence.
  // Everything below is an inference and only ever suggests.
  const headcount = new Map<string, number>();
  for (const participant of external) {
    const organizationId = participant.organization_id.trim();
    if (organizationId) {
      headcount.set(organizationId, (headcount.get(organizationId) ?? 0) + 1);
    }
  }

  if (headcount.size > 0) {
    const winner = pickOrganization(headcount, recentOrganizationIds);
    if (winner) {
      // Without a configured own domain there is no internal/external
      // distinction, so "external participant filed under an organization"
      // is not evidence — colleagues filed under our own company look
      // exactly the same. Ask instead of writing it silently.
      return {
        kind: ownDomains.length > 0 ? "assign" : "suggest",
        organizationId: winner,
        reason: "known_contact",
      };
    }
    // A tie nothing can settle: two customers with equal standing in one
    // meeting, neither used recently. Guessing here would be silently wrong.
    return NONE;
  }

  const organizationByDomain = new Map<string, string>();
  for (const contact of knownContacts) {
    const domain = emailDomain(contact.email);
    if (
      domain &&
      !isPublicMailProvider(domain) &&
      contact.organization_id.trim() !== "" &&
      !organizationByDomain.has(domain)
    ) {
      organizationByDomain.set(domain, contact.organization_id);
    }
  }

  for (const participant of external) {
    const domain = emailDomain(participant.email);
    if (!domain || isPublicMailProvider(domain)) {
      continue;
    }

    const organizationId = organizationByDomain.get(domain);
    if (organizationId) {
      return { kind: "suggest", organizationId, reason: "domain_match" };
    }
  }

  for (const participant of external) {
    const domain = emailDomain(participant.email);
    if (domain && !isPublicMailProvider(domain)) {
      return { kind: "suggest_create", domain };
    }
  }

  return NONE;
}

function pickOrganization(
  headcount: ReadonlyMap<string, number>,
  recentOrganizationIds: readonly string[],
): string | null {
  const best = Math.max(...headcount.values());
  const leaders = [...headcount.entries()]
    .filter(([, count]) => count === best)
    .map(([organizationId]) => organizationId);

  if (leaders.length === 1) {
    return leaders[0] ?? null;
  }

  for (const organizationId of recentOrganizationIds) {
    if (leaders.includes(organizationId)) {
      return organizationId;
    }
  }

  return null;
}
