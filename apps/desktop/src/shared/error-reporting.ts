import * as Sentry from "@sentry/react";
import { getVersion } from "@tauri-apps/api/app";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect } from "react";

import { useConfigValues } from "~/shared/config";
import { commands } from "~/types/tauri.gen";

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

  const [version, home, installId] = await Promise.all([
    getVersion().catch(() => "unknown"),
    homeDir().catch(() => null),
    commands.getInstallId().catch(() => ""),
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

  if (installId) {
    Sentry.setUser({ id: installId });
  }
}

// A failure inside a poll or a re-render does not happen once, it happens every
// few seconds: the transcript parse bug sent 21 reports in 90 seconds. Sentry
// groups them into one issue either way, so the repeats buy nothing and cost
// quota. The first few of each kind still go, in case the repetition itself is
// the story.
const REPEAT_WINDOW_MS = 60_000;
const REPEATS_PER_WINDOW = 3;
const seen = new Map<string, { count: number; windowStartedAt: number }>();

function isRepeat(event: Sentry.ErrorEvent): boolean {
  const exception = event.exception?.values?.[0];
  const key = `${exception?.type ?? ""}:${exception?.value ?? event.message ?? ""}`;
  const now = Date.now();
  const previous = seen.get(key);
  if (!previous || now - previous.windowStartedAt > REPEAT_WINDOW_MS) {
    seen.set(key, { count: 1, windowStartedAt: now });
    return false;
  }
  previous.count += 1;
  return previous.count > REPEATS_PER_WINDOW;
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (isRepeat(event)) return null;
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
  // The anonymous installation id is the only thing worth keeping; anything
  // else Sentry filled in about the person or the machine is not ours to send.
  event.user = event.user?.id ? { id: event.user.id } : undefined;
  delete event.server_name;
  return event;
}

export const __testing = {
  scrubEvent,
  resetRepeatWindow: () => seen.clear(),
  setHomePath: (path: string | null) => {
    homePath = path;
  },
};

// The tags we actually want to filter by when a report comes in. A transcription
// error whose provider and model are on the event is a one-line diagnosis; the
// same error without them is a search through the code.
export function useErrorReportingTags() {
  const {
    current_llm_provider,
    current_llm_model,
    current_stt_provider,
    current_stt_model,
  } = useConfigValues([
    "current_llm_provider",
    "current_llm_model",
    "current_stt_provider",
    "current_stt_model",
  ] as const);

  useEffect(() => {
    Sentry.setTags({
      "llm.provider": current_llm_provider ?? "",
      "llm.model": current_llm_model ?? "",
      "stt.provider": current_stt_provider ?? "",
      "stt.model": current_stt_model ?? "",
    });
  }, [
    current_llm_provider,
    current_llm_model,
    current_stt_provider,
    current_stt_model,
  ]);
}
