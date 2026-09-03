import { Trans } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";

import { SettingSwitchRow } from "~/settings/setting-row";

interface SettingItem {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function MeetingSettingsView({
  autoJoinScheduledMeetings,
  autoStartScheduledMeetings,
  autoStopMeetings,
  floatingBar,
  meetingDisclosureAutoPost,
  captureMeetingChat,
  captureMeetingParticipants,
  captureMeetingSnapshots,
}: {
  autoJoinScheduledMeetings: SettingItem;
  autoStartScheduledMeetings: SettingItem;
  autoStopMeetings: SettingItem;
  floatingBar: SettingItem;
  meetingDisclosureAutoPost: SettingItem;
  captureMeetingChat: SettingItem;
  captureMeetingParticipants: SettingItem;
  captureMeetingSnapshots: SettingItem;
}) {
  const currentPlatform = platform();
  const supportsMeetingAx =
    currentPlatform === "macos" || currentPlatform === "linux";
  const supportsMicDetection = currentPlatform !== "windows";

  return (
    <div className="flex flex-col gap-4">
      <SettingSwitchRow
        title={<Trans>Start when meeting begins</Trans>}
        description={
          <Trans>Start listening when a scheduled meeting begins.</Trans>
        }
        checked={autoStartScheduledMeetings.value}
        onChange={autoStartScheduledMeetings.onChange}
      />
      <SettingSwitchRow
        title={<Trans>Join scheduled meetings</Trans>}
        description={
          <Trans>Open the meeting link when listening starts.</Trans>
        }
        checked={autoJoinScheduledMeetings.value}
        onChange={autoJoinScheduledMeetings.onChange}
        disabled={!autoStartScheduledMeetings.value}
      />
      {supportsMicDetection && (
        <SettingSwitchRow
          title={<Trans>Stop when meeting ends</Trans>}
          description={<Trans>Stop listening when your call ends.</Trans>}
          checked={autoStopMeetings.value}
          onChange={autoStopMeetings.onChange}
        />
      )}
      {supportsMeetingAx && (
        <>
          <SettingSwitchRow
            title={<Trans>Post recording disclosure in meeting chat</Trans>}
            description={
              <Trans>
                Tell participants when listening starts; this does not confirm
                consent.
              </Trans>
            }
            checked={meetingDisclosureAutoPost.value}
            onChange={meetingDisclosureAutoPost.onChange}
          />
          <SettingSwitchRow
            title={<Trans>Capture meeting chat in Memos</Trans>}
            description={
              <Trans>
                Save visible chat from supported meetings using Accessibility.
              </Trans>
            }
            checked={captureMeetingChat.value}
            onChange={captureMeetingChat.onChange}
          />
          <SettingSwitchRow
            title={<Trans>Add participants from the meeting window</Trans>}
            description={
              <Trans>
                Names shown on the meeting's video tiles become participants of
                this recording. Needs Accessibility access.
              </Trans>
            }
            checked={captureMeetingParticipants.value}
            onChange={captureMeetingParticipants.onChange}
          />
          <SettingSwitchRow
            title={<Trans>Capture slides from the meeting window</Trans>}
            description={
              <Trans>
                Keep a screenshot of the meeting window whenever the shared
                content changes. Needs Screen Recording access.
              </Trans>
            }
            checked={captureMeetingSnapshots.value}
            onChange={captureMeetingSnapshots.onChange}
          />
        </>
      )}
      <SettingSwitchRow
        title={<Trans>Show floating bar</Trans>}
        description={
          <Trans>Control listening without reopening Session Echo.</Trans>
        }
        checked={floatingBar.value}
        onChange={floatingBar.onChange}
      />
    </div>
  );
}
