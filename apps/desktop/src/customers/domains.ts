// A contact writing from a freemailer says nothing about which company they
// belong to, so these domains never produce a match or a create suggestion.
export const PUBLIC_MAIL_PROVIDERS: readonly string[] = [
  "aol.com",
  "gmail.com",
  "gmx.at",
  "gmx.ch",
  "gmx.de",
  "gmx.net",
  "hotmail.com",
  "hotmail.de",
  "icloud.com",
  "live.com",
  "mail.com",
  "me.com",
  "outlook.com",
  "outlook.de",
  "posteo.de",
  "proton.me",
  "protonmail.com",
  "t-online.de",
  "web.de",
  "yahoo.com",
  "yahoo.de",
  "yandex.com",
];

const PUBLIC_SET = new Set(PUBLIC_MAIL_PROVIDERS);

export function emailDomain(email: string): string {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) {
    return "";
  }

  const [local, domain] = parts;
  return local && domain?.includes(".") ? domain : "";
}

export function isPublicMailProvider(domain: string): boolean {
  return PUBLIC_SET.has(domain.trim().toLowerCase());
}

export function isOwnDomain(
  domain: string,
  ownDomains: readonly string[],
): boolean {
  const needle = domain.trim().toLowerCase();
  return (
    needle !== "" &&
    ownDomains.some((own) => own.trim().toLowerCase() === needle)
  );
}
