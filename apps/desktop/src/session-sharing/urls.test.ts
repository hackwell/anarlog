import { describe, expect, it } from "vitest";

import {
  buildAccountSessionShareUrl,
  buildPublicSessionShareUrl,
  buildSessionInvitationUrl,
  buildSessionShareLinkUrl,
} from "./urls";

const shareId = "33333333-3333-4333-8333-333333333333";
const linkId = "44444444-4444-4444-8444-444444444444";
const invitationId = "55555555-5555-4555-8555-555555555555";
const token = "t".repeat(43);
const publicSlug = `s_${"a".repeat(32)}`;

describe("session share URLs", () => {
  it("places bearer link tokens only in the fragment", () => {
    const url = new URL(
      buildSessionShareLinkUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        linkId,
        linkToken: token,
      }),
    );

    expect(url.pathname).toBe(`/t/${linkId}/`);
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#token=${token}`);
  });

  it("places invitation tokens only in the fragment", () => {
    const url = new URL(
      buildSessionInvitationUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        invitationId,
        inviteToken: token,
      }),
    );

    expect(url.pathname).toBe(`/share/invite/${invitationId}/`);
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#token=${token}`);
  });

  it("builds token-free account and public URLs", () => {
    expect(
      buildAccountSessionShareUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        shareId,
      }),
    ).toBe(`https://sessionecho.flagbit.de/share/${shareId}/`);
    expect(
      buildPublicSessionShareUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        publicSlug,
      }),
    ).toBe(`https://sessionecho.flagbit.de/share/public/${publicSlug}/`);
  });

  it("uses a workspace subdomain for every stable sharing route", () => {
    const workspaceShareSlug = "fastrepl";
    expect(
      buildSessionShareLinkUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        linkId,
        linkToken: token,
        workspaceShareSlug,
      }),
    ).toBe(
      `https://fastrepl.sessionecho.flagbit.de/t/${linkId}/#token=${token}`,
    );
    expect(
      buildSessionInvitationUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        invitationId,
        inviteToken: token,
        workspaceShareSlug,
      }),
    ).toBe(
      `https://fastrepl.sessionecho.flagbit.de/share/invite/${invitationId}/#token=${token}`,
    );
    expect(
      buildAccountSessionShareUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        shareId,
        workspaceShareSlug,
      }),
    ).toBe(`https://fastrepl.sessionecho.flagbit.de/share/${shareId}/`);
    expect(
      buildPublicSessionShareUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        publicSlug,
        workspaceShareSlug,
      }),
    ).toBe(
      `https://fastrepl.sessionecho.flagbit.de/share/public/${publicSlug}/`,
    );
  });

  it("keeps development origins unchanged and rejects malformed workspace slugs", () => {
    expect(
      buildAccountSessionShareUrl({
        appBaseUrl: "http://localhost:3000",
        shareId,
        workspaceShareSlug: "fastrepl",
      }),
    ).toBe(`http://localhost:3000/share/${shareId}/`);
    expect(() =>
      buildAccountSessionShareUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        shareId,
        workspaceShareSlug: "escape.sessionecho.flagbit.de",
      }),
    ).toThrow("Share URL is unavailable");
    expect(() =>
      buildAccountSessionShareUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        shareId,
        workspaceShareSlug: "api",
      }),
    ).toThrow("Share URL is unavailable");
  });

  it("targets non-stable builds without changing stable canonical URLs", () => {
    const linkUrl = new URL(
      buildSessionShareLinkUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        linkId,
        linkToken: token,
        desktopScheme: "sessionecho-staging",
      }),
    );
    expect(linkUrl.searchParams.get("scheme")).toBe("sessionecho-staging");
    expect(linkUrl.hash).toBe(`#token=${token}`);

    const publicUrl = new URL(
      buildPublicSessionShareUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        publicSlug,
        desktopScheme: "sessionecho-dev",
      }),
    );
    expect(publicUrl.searchParams.get("scheme")).toBe("sessionecho-dev");

    const stableUrl = new URL(
      buildAccountSessionShareUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        shareId,
        desktopScheme: "sessionecho",
      }),
    );
    expect(stableUrl.search).toBe("");
  });

  it("rejects tokens or base URLs that could escape the canonical shape", () => {
    expect(() =>
      buildSessionShareLinkUrl({
        appBaseUrl: "javascript:alert(1)",
        linkId,
        linkToken: token,
      }),
    ).toThrow("Share URL is unavailable");
    expect(() =>
      buildSessionShareLinkUrl({
        appBaseUrl: "https://sessionecho.flagbit.de?token=old",
        linkId,
        linkToken: token,
      }),
    ).toThrow("Share URL is unavailable");
    expect(() =>
      buildSessionShareLinkUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        linkId,
        linkToken: "bad?token",
      }),
    ).toThrow("Share URL is unavailable");
    expect(() =>
      buildSessionShareLinkUrl({
        appBaseUrl: "https://sessionecho.flagbit.de",
        linkId: "bad-link",
        linkToken: token,
      }),
    ).toThrow("Share URL is unavailable");
  });
});
