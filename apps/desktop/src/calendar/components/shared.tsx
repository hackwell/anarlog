import { MicrosoftOutlookLogo } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export type CalendarProvider = {
  disabled: boolean;
  id: string;
  displayName: string;
  icon: ReactNode;
  badge?: string | null;
  platform?: "macos" | "all";
};

const _PROVIDERS = [
  {
    disabled: false,
    id: "apple",
    displayName: "Apple Calendar",
    badge: "",
    icon: (
      <img
        src="/assets/apple-calendar.png"
        alt="Apple Calendar"
        className="size-5 rounded-[4px] object-cover"
      />
    ),
    platform: "macos",
  },
  {
    disabled: false,
    id: "microsoft",
    displayName: "Microsoft 365",
    badge: "",
    icon: (
      <MicrosoftOutlookLogo
        className="size-5 text-[#0F6CBD]"
        weight="fill"
        aria-hidden="true"
      />
    ),
    // Microsoft Graph is reached over HTTPS, so unlike EventKit this provider
    // is the same on macOS, Windows and Linux.
    platform: "all",
  },
] as const satisfies readonly CalendarProvider[];

export const PROVIDERS = [..._PROVIDERS];
