import { getIdentifier } from "@tauri-apps/api/app";

import { env } from "~/env";

// export * from "../shared/config/configure-pro-settings";
// export * from "~/sidebar/timeline/utils";
// export * from "~/stt/segment";

export const id = () => crypto.randomUUID() as string;

export type DesktopScheme =
  | "sessionecho"
  | "sessionecho-staging"
  | "sessionecho-dev";

export const getScheme = async (): Promise<DesktopScheme> => {
  const id = await getIdentifier();
  const schemes: Record<string, DesktopScheme> = {
    "de.flagbit.sessionecho": "sessionecho",
    "de.flagbit.sessionecho.staging": "sessionecho-staging",
    "de.flagbit.sessionecho.dev": "sessionecho-dev",
  };
  return schemes[id] ?? "sessionecho";
};

type DesktopFlowPath =
  | "/auth"
  | "/app/account"
  | "/app/integration"
  | "/app/checkout"
  | "/app/switch-plan"
  | "/app/portal";

export const buildWebAppUrl = async (
  path: DesktopFlowPath,
  params?: Record<string, string>,
): Promise<string> => {
  const scheme = await getScheme();
  const url = new URL(path, env.VITE_APP_URL);
  url.searchParams.set("flow", "desktop");
  url.searchParams.set("scheme", scheme);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

// https://www.rfc-editor.org/rfc/rfc4122#section-4.1.7
export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000";

export const DEVICE_FINGERPRINT_HEADER = "x-device-fingerprint";
export const REQUEST_ID_HEADER = "x-request-id";
export const CHAR_TASK_HEADER = "x-char-task";
