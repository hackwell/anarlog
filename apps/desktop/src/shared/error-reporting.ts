import * as Sentry from "@sentry/react";
import { getVersion } from "@tauri-apps/api/app";
import { homeDir } from "@tauri-apps/api/path";

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

let homePath: string | null = null;

// The same three rules the log file is scrubbed with
// (`plugins/tracing/src/redaction.rs`), so a string reads the same wherever it
// is sent. Kept in sync by hand: the two run in different languages, and a
// shared implementation would mean shipping a scrubber to the webview.
export function scrubText(value: string): string {
  let scrubbed = value;
  if (homePath) {
    scrubbed = scrubbed.split(homePath).join("[HOME]");
  }
  return scrubbed
    .replace(EMAIL, "[EMAIL_REDACTED]")
    .replace(IPV4, "[IP_REDACTED]");
}

function scrubDeep(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, scrubDeep(entry)]),
    );
  }
  return value;
}

// Starts error reporting for the webview. Without a DSN it does nothing at all,
// so a build with no Sentry configured behaves exactly as it did before.
export async function initErrorReporting() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  const [version, home] = await Promise.all([
    getVersion().catch(() => "unknown"),
    homeDir().catch(() => null),
  ]);
  homePath = home?.replace(/\/$/, "") ?? null;

  Sentry.init({
    dsn,
    release: version,
    environment: import.meta.env.DEV ? "development" : "production",
    // This app records meetings. Nothing that names a person or a meeting may
    // leave the computer: no identifying data, no session replay, no request
    // bodies, and every string that does go out is scrubbed first.
    sendDefaultPii: false,
    maxBreadcrumbs: 50,
    integrations: [
      // The failures worth seeing here are handled ones — a transcription that
      // came back rejected, a transcript that would not parse. Those never
      // reach `window.onerror`, they only reach the console.
      Sentry.captureConsoleIntegration({ levels: ["error"] }),
    ],
    beforeSend: scrubEvent,
  });
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.message) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
    if (breadcrumb.data) {
      breadcrumb.data = scrubDeep(breadcrumb.data) as typeof breadcrumb.data;
    }
  }
  if (event.extra) event.extra = scrubDeep(event.extra) as typeof event.extra;
  // The webview reports the app's own file URLs, and the user's name is usually
  // in the path.
  if (event.request?.url) event.request.url = scrubText(event.request.url);
  delete event.user;
  delete event.server_name;
  return event;
}

export const __testing = {
  scrubEvent,
  setHomePath: (path: string | null) => {
    homePath = path;
  },
};
