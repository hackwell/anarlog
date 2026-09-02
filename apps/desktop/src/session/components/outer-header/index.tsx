import { useLingui } from "@lingui/react/macro";
import { Headset, Square, VideoCamera } from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "react";

import { commands as openerCommands } from "@anlg/plugin-opener2";
import { cn, safeParseDate } from "@anlg/utils";

import { FolderPicker } from "../folder-picker";
import { TranscriptEditButton } from "../note-input/transcript";
import { RecordingIcon, useHasTranscript } from "../shared";
import { TagRow } from "../tag-row";
import { TitleInput } from "../title-input";
import { CopyViewButton } from "./copy-view";
import { MetadataButton } from "./metadata";
import { OverflowButton } from "./overflow";

import { useAudioPlayer } from "~/audio-player";
import { useNow } from "~/calendar/hooks";
import { useShell } from "~/contexts/shell";
import { useEventCountdown } from "~/session/hooks/useEventCountdown";
import {
  getRemoteMeeting,
  type RemoteMeeting,
} from "~/session/hooks/useRemoteMeeting";
import { useSessionEvent } from "~/session/hooks/useSessionEvent";
import { useWindowControlsGutter } from "~/shared/hooks/useWindowControlsGutter";
import type { EditorView, Tab } from "~/store/zustand/tabs/schema";
import { useListener } from "~/stt/contexts";
import { useStartListening } from "~/stt/useStartListening";
import {
  isMainWebviewWindow,
  requestMainListenerControl,
} from "~/stt/window-control";

export function OuterHeader({
  sessionId,
  currentView,
  tab,
  standaloneWindow = false,
  viewSwitcher,
  transcriptEditMode = false,
  onTranscriptEditModeChange,
}: {
  sessionId: string;
  currentView: EditorView;
  tab?: Extract<Tab, { type: "sessions" }>;
  standaloneWindow?: boolean;
  viewSwitcher?: React.ReactNode;
  transcriptEditMode?: boolean;
  onTranscriptEditModeChange?: (editMode: boolean) => void;
}) {
  const { leftsidebar } = useShell();
  const sessionMode = useListener((state) => state.getSessionMode(sessionId));
  const sessionEvent = useSessionEvent(sessionId);
  const hasTranscript = useHasTranscript(sessionId);
  const { audioExists } = useAudioPlayer();
  const now = useNow();
  const showWindowControlsGutter = useWindowControlsGutter();
  const showSidebarTimelineHeaderGutter =
    !standaloneWindow && !leftsidebar.expanded;
  const endedAt = sessionEvent?.ended_at
    ? safeParseDate(sessionEvent.ended_at)
    : null;
  const ended = !!endedAt && endedAt.getTime() <= now.getTime();
  const isRecording =
    sessionMode === "active" || sessionMode === "running_batch";
  const isLiveMeeting = isRecording || sessionMode === "finalizing";
  const meetingOver = !isRecording && (ended || hasTranscript || audioExists);
  const showTitleInput = Boolean(tab) && !isLiveMeeting && !meetingOver;

  return (
    <div
      data-tauri-drag-region
      className={cn([
        "relative flex w-full items-center gap-[2px]",
        "h-12",
        standaloneWindow && (showWindowControlsGutter ? "pl-[76px]" : "pl-2"),
        !standaloneWindow && leftsidebar.expanded && "pl-2",
        showSidebarTimelineHeaderGutter &&
          (showWindowControlsGutter ? "pl-[108px]" : "pl-[32px]"),
      ])}
    >
      {viewSwitcher}
      {showTitleInput && tab ? (
        <div className="max-w-56 min-w-0 shrink">
          <TitleInput key={tab.id} tab={tab} variant="breadcrumb" />
        </div>
      ) : null}
      <div
        data-tauri-drag-region
        data-session-header-spacer
        className="min-h-full min-w-0 flex-1"
      />
      <TagRow sessionId={sessionId} />
      <div
        data-tauri-drag-region
        className="relative z-10 flex shrink-0 items-center pr-1"
      >
        <HeaderMeetingControl
          sessionId={sessionId}
          sessionMode={sessionMode}
          currentView={currentView}
          transcriptEditMode={transcriptEditMode}
          onTranscriptEditModeChange={onTranscriptEditModeChange}
        />
        <FolderPicker sessionId={sessionId} align="end" />
        <MetadataButton sessionId={sessionId} />
        <CopyViewButton sessionId={sessionId} currentView={currentView} />
        <OverflowButton
          standaloneWindow={standaloneWindow}
          sessionId={sessionId}
          currentView={currentView}
        />
      </div>
    </div>
  );
}

function HeaderMeetingControl({
  sessionId,
  sessionMode,
  currentView,
  transcriptEditMode,
  onTranscriptEditModeChange,
}: {
  sessionId: string;
  sessionMode: string;
  currentView: EditorView;
  transcriptEditMode: boolean;
  onTranscriptEditModeChange?: (editMode: boolean) => void;
}) {
  const sessionEvent = useSessionEvent(sessionId);
  const hasTranscript = useHasTranscript(sessionId);
  const { audioExists } = useAudioPlayer();
  const now = useNow();
  const endedAt = sessionEvent?.ended_at
    ? safeParseDate(sessionEvent.ended_at)
    : null;
  const ended = !!endedAt && endedAt.getTime() <= now.getTime();
  const canEditTranscript =
    currentView.type === "transcript" &&
    sessionMode === "inactive" &&
    hasTranscript &&
    (!sessionEvent || ended) &&
    onTranscriptEditModeChange;

  if (canEditTranscript) {
    return (
      <TranscriptEditButton
        editMode={transcriptEditMode}
        onEditModeChange={onTranscriptEditModeChange}
      />
    );
  }

  const isRecording =
    sessionMode === "active" || sessionMode === "running_batch";

  if (sessionMode === "finalizing") {
    return null;
  }

  if (!sessionEvent && !isRecording) {
    if (hasTranscript || audioExists) {
      return null;
    }

    return (
      <HeaderMeetingActionPill
        sessionId={sessionId}
        event={null}
        sessionMode={sessionMode}
        hasTranscript={hasTranscript}
        audioExists={audioExists}
      />
    );
  }

  if (
    !isRecording &&
    sessionMode === "inactive" &&
    sessionEvent &&
    (hasTranscript || audioExists)
  ) {
    return null;
  }

  if (ended && !isRecording) {
    return null;
  }

  return (
    <HeaderMeetingActionPill
      sessionId={sessionId}
      event={sessionEvent}
      sessionMode={sessionMode}
      hasTranscript={hasTranscript}
      audioExists={audioExists}
    />
  );
}

function HeaderMeetingActionPill({
  sessionId,
  event,
  sessionMode,
  hasTranscript,
  audioExists,
}: {
  sessionId: string;
  event: {
    meeting_link?: string;
  } | null;
  sessionMode: string;
  hasTranscript: boolean;
  audioExists: boolean;
}) {
  const startListening = useStartListening(sessionId);
  const { stop, stopTranscription } = useListener((state) => ({
    stop: state.stop,
    stopTranscription: state.stopTranscription,
  }));
  const remote = getRemoteMeeting(event?.meeting_link);
  const meetingLink = event?.meeting_link || null;
  const canJoinFromHeader = Boolean(meetingLink && remote !== null);
  const canResume = audioExists || hasTranscript;
  const { t } = useLingui();
  const joiningMeetingRef = useRef(false);
  const [joiningMeeting, setJoiningMeeting] = useState(false);
  const start = useCallback(async () => {
    if (!isMainWebviewWindow()) {
      await requestMainListenerControl("start", sessionId);
      return;
    }

    await startListening();
  }, [sessionId, startListening]);
  const openMeeting = useCallback(() => {
    if (!meetingLink) {
      return;
    }

    void openerCommands.openUrl(meetingLink, null);
  }, [meetingLink]);
  const joinMeeting = useCallback(async () => {
    if (joiningMeetingRef.current) {
      return;
    }

    joiningMeetingRef.current = true;
    setJoiningMeeting(true);
    try {
      openMeeting();
      await start();
    } finally {
      joiningMeetingRef.current = false;
      setJoiningMeeting(false);
    }
  }, [openMeeting, start]);
  const countdown = useEventCountdown(sessionId);
  const stopListening = useCallback(() => {
    if (!isMainWebviewWindow()) {
      void requestMainListenerControl("stop", sessionId);
      return;
    }

    stop();
  }, [sessionId, stop]);
  const action = (() => {
    if (sessionMode === "active") {
      return {
        label: t`Stop`,
        title: t`Stop listening`,
        icon: <Square className="text-foreground size-3" weight="fill" />,
        onClick: stopListening,
      };
    }

    if (sessionMode === "running_batch") {
      return {
        label: t`Stop`,
        title: t`Stop transcription`,
        icon: <Square className="text-foreground size-3" weight="fill" />,
        onClick: () => {
          void stopTranscription(sessionId);
        },
      };
    }

    if (canJoinFromHeader) {
      return {
        label: t`Join & record`,
        title: t`Join meeting and record`,
        icon: remote ? getMeetingDisplay(remote.type).icon : undefined,
        onClick: () => {
          void joinMeeting();
        },
      };
    }

    return {
      label: canResume ? t`Resume` : t`Record`,
      title: canResume ? t`Resume listening` : t`Record`,
      icon: <RecordingIcon />,
      onClick: start,
    };
  })();
  const disabled = sessionMode === "finalizing" || joiningMeeting;
  const isPrimaryCta = sessionMode === "inactive";
  const showCountdown =
    Boolean(countdown.label) &&
    sessionMode !== "active" &&
    sessionMode !== "running_batch" &&
    sessionMode !== "finalizing";

  return (
    <div className="relative mr-1 flex min-w-0 shrink-0 items-center">
      <button
        type="button"
        data-tauri-drag-region="false"
        aria-label={action.label}
        title={action.title}
        disabled={disabled}
        onClick={action.onClick}
        className={cn([
          "flex h-7 max-w-56 shrink-0 items-center gap-1.5 overflow-hidden rounded-full border pr-2.5 pl-1.5",
          "text-sm font-medium",
          "transition-colors",
          isPrimaryCta
            ? "border-primary bg-primary text-primary-foreground shadow-sm dark:border-white dark:bg-white dark:text-black"
            : "border-border bg-card text-foreground",
          !disabled &&
            (isPrimaryCta
              ? "hover:bg-primary/90 dark:hover:bg-white/90"
              : "hover:bg-accent"),
          disabled && "cursor-default opacity-60",
        ])}
      >
        {action.icon}
        <span className="truncate">{action.label}</span>
      </button>
      {showCountdown ? (
        <div
          data-header-meeting-countdown
          className="border-border bg-popover text-popover-foreground pointer-events-none absolute top-full left-1/2 z-20 mt-2 -translate-x-1/2 rounded-md border px-2.5 py-1 font-mono text-xs whitespace-nowrap tabular-nums shadow-sm"
        >
          <span
            data-header-meeting-countdown-tail
            aria-hidden="true"
            className="border-border bg-popover absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-t border-l"
          />
          <span className="relative">{countdown.label}</span>
        </div>
      ) : null}
    </div>
  );
}

function getMeetingDisplay(type: RemoteMeeting["type"]) {
  switch (type) {
    case "zoom":
      return {
        name: "Zoom",
        icon: (
          <img
            src="/assets/zoom-icon.svg"
            alt=""
            className="size-3.5 shrink-0"
          />
        ),
      };
    case "google-meet":
      return {
        name: "Meet",
        icon: (
          <img
            src="/assets/google-meet.svg"
            alt=""
            className="size-3.5 shrink-0"
          />
        ),
      };
    case "webex":
      return {
        name: "Webex",
        icon: (
          <img src="/assets/webex.png" alt="" className="size-3.5 shrink-0" />
        ),
      };
    case "teams":
      return {
        name: "Teams",
        icon: (
          <img src="/assets/teams.png" alt="" className="size-3.5 shrink-0" />
        ),
      };
    case "cal-com":
      return {
        name: "Cal.com",
        icon: <VideoCamera className="size-3.5 shrink-0" />,
      };
    default:
      return {
        name: "Meeting",
        icon: <Headset className="size-3.5 shrink-0" />,
      };
  }
}
