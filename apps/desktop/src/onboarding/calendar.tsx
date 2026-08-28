import { Trans } from "@lingui/react/macro";
import { MicrosoftOutlookLogo } from "@phosphor-icons/react";
import { platform } from "@tauri-apps/plugin-os";
import { useState } from "react";

import { OnboardingButton } from "./shared";

import { useAppleCalendarSelection } from "~/calendar/components/apple/calendar-selection";
import { TroubleShootingLink } from "~/calendar/components/apple/permission";
import {
  type CalendarGroup,
  CalendarSelection,
} from "~/calendar/components/calendar-selection";
import { SyncProvider, useSync } from "~/calendar/components/context";
import { useMicrosoftCalendarSelection } from "~/calendar/components/microsoft/calendar-selection";
import { useMicrosoftConnection } from "~/calendar/components/microsoft/connection";
import { MicrosoftConnectionStatus } from "~/calendar/components/microsoft/status";
import { useEnabledCalendars } from "~/calendar/hooks";
import { useMountEffect } from "~/shared/hooks/useMountEffect";
import { usePermission } from "~/shared/hooks/usePermissions";

const CALENDAR_LIST_CLASSNAME =
  "border-border/45 bg-card/28 rounded-xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_24px_-20px_rgba(87,83,78,0.35)] backdrop-blur-md backdrop-saturate-150";

function getCalendarSelectionKey(groups: CalendarGroup[]) {
  return groups.length === 0
    ? "empty"
    : groups
        .map((group) => `${group.sourceName}:${group.calendars.length}`)
        .join("|");
}

function AppleCalendarList() {
  const { scheduleSync } = useSync();
  const { groups, handleRefresh, handleToggle, isLoading } =
    useAppleCalendarSelection();

  useMountEffect(() => {
    scheduleSync();
  });

  return (
    <CalendarSelection
      key={getCalendarSelectionKey(groups)}
      groups={groups}
      onToggle={handleToggle}
      onRefresh={handleRefresh}
      isLoading={isLoading}
      disableHoverTone
      className={CALENDAR_LIST_CLASSNAME}
    />
  );
}

function AppleCalendarProvider({
  isAuthorized,
  isPending,
  onRequest,
  onTroubleshoot,
  onOpen,
}: {
  isAuthorized: boolean;
  isPending: boolean;
  onRequest: () => void;
  onTroubleshoot: () => void;
  onOpen: () => void;
}) {
  return (
    <>
      {isAuthorized && (
        <div className="order-1 w-full basis-full">
          <AppleCalendarList />
        </div>
      )}

      <div className="order-2 flex min-w-56 flex-1">
        <OnboardingButton
          onClick={() => {
            if (isAuthorized) {
              onOpen();
              return;
            }

            onTroubleshoot();
            onRequest();
          }}
          disabled={isPending}
          className="border-border bg-card text-foreground hover:bg-accent flex h-full w-full items-center justify-center gap-3 border px-6 shadow-[0_2px_6px_rgba(87,83,78,0.08),0_10px_18px_-10px_rgba(87,83,78,0.22)] transition-all duration-150"
        >
          <img
            src="/assets/apple-calendar.png"
            alt=""
            aria-hidden="true"
            className="size-6 rounded-[4px] object-cover"
          />
          <Trans>Connect calendar</Trans>
        </OnboardingButton>
      </div>
    </>
  );
}

function MicrosoftCalendarList() {
  const { scheduleSync } = useSync();
  const { groups, handleRefresh, handleToggle, isLoading } =
    useMicrosoftCalendarSelection();

  useMountEffect(() => {
    scheduleSync();
  });

  return (
    <CalendarSelection
      key={getCalendarSelectionKey(groups)}
      groups={groups}
      onToggle={handleToggle}
      onRefresh={handleRefresh}
      isLoading={isLoading}
      disableHoverTone
      className={CALENDAR_LIST_CLASSNAME}
    />
  );
}

/**
 * Microsoft is read-only (Calendars.Read), so the tile never turns into an
 * "open the calendar" button the way the Apple one does: open_calendar and
 * create_event answer UnsupportedOperation for this provider.
 */
function MicrosoftCalendarProvider() {
  const connection = useMicrosoftConnection();

  return (
    <>
      {connection.isConnected && (
        <div className="order-1 w-full basis-full">
          <MicrosoftCalendarList />
        </div>
      )}

      <div className="order-2 flex min-w-56 flex-1 flex-col gap-1">
        {!connection.isConnected && (
          <OnboardingButton
            onClick={connection.connect}
            disabled={connection.isBusy}
            className="border-border bg-card text-foreground hover:bg-accent flex h-full w-full items-center justify-center gap-3 border px-6 shadow-[0_2px_6px_rgba(87,83,78,0.08),0_10px_18px_-10px_rgba(87,83,78,0.22)] transition-all duration-150"
          >
            <MicrosoftOutlookLogo
              className="size-6 text-[#0F6CBD]"
              weight="fill"
              aria-hidden="true"
            />
            <Trans>Connect Microsoft 365</Trans>
          </OnboardingButton>
        )}
        <MicrosoftConnectionStatus connection={connection} />
      </div>
    </>
  );
}

function CalendarSectionContent({ onContinue }: { onContinue: () => void }) {
  const isMacos = platform() === "macos";
  const calendar = usePermission("calendar");
  const isAuthorized = calendar.status === "authorized";
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const enabledCalendars = useEnabledCalendars();
  const hasConnectedCalendar = enabledCalendars.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-stretch gap-3">
        {isMacos && (
          <AppleCalendarProvider
            isAuthorized={isAuthorized}
            isPending={calendar.isPending}
            onRequest={calendar.request}
            onTroubleshoot={() => setShowTroubleshooting(true)}
            onOpen={calendar.open}
          />
        )}
        <MicrosoftCalendarProvider />
      </div>

      {hasConnectedCalendar && (
        <OnboardingButton onClick={onContinue}>
          <Trans>Continue</Trans>
        </OnboardingButton>
      )}

      {showTroubleshooting && !isAuthorized && (
        <TroubleShootingLink
          onRequest={calendar.request}
          onReset={calendar.reset}
          onOpen={calendar.open}
          isPending={calendar.isPending}
          className="text-muted-foreground text-sm"
        />
      )}
    </div>
  );
}

export function CalendarSection({ onContinue }: { onContinue: () => void }) {
  return (
    <SyncProvider>
      <CalendarSectionContent onContinue={onContinue} />
    </SyncProvider>
  );
}
