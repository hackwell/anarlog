import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@anlg/utils";

import { CalendarSection } from "./calendar";
import {
  getInitialStep,
  getNextStep,
  getPrevStep,
  getStepStatus,
} from "./config";
import { FinalDescription, FinalSection, finishOnboarding } from "./final";
import { FolderLocationSection } from "./folder-location";
import { ImportSection } from "./imports";
import { PermissionsSection } from "./permissions";
import { OnboardingSection } from "./shared";

import { trackAnalyticsEvent } from "~/analytics";
import { useAuth } from "~/auth";
import { useWindowControlsGutter } from "~/shared/hooks/useWindowControlsGutter";
import { StandaloneWindowShell } from "~/shared/window-shell";
import { type Tab, useTabs } from "~/store/zustand/tabs";

export function TabContentOnboarding({
  tab: _tab,
}: {
  tab: Extract<Tab, { type: "onboarding" }>;
}) {
  const openCurrent = useTabs((state) => state.openCurrent);

  const handleFinish = useCallback(
    (sessionId: string) => {
      openCurrent({ type: "sessions", id: sessionId });
    },
    [openCurrent],
  );

  return <OnboardingScreen onFinish={handleFinish} />;
}

function OnboardingScreen({
  onFinish,
}: {
  onFinish: (sessionId: string) => void;
}) {
  return (
    <OnboardingScreenContent
      onFinish={onFinish}
      headerClassName="pr-12 pt-4 pb-8"
      headerDragRegion
    />
  );
}

export function StandaloneOnboardingScreen({
  onFinish,
}: {
  onFinish: (sessionId: string) => void;
}) {
  return (
    <StandaloneWindowShell>
      <OnboardingScreenContent
        onFinish={onFinish}
        headerClassName="pr-12 pt-4 pb-8"
        headerDragRegion
      />
    </StandaloneWindowShell>
  );
}

function OnboardingScreenContent({
  onFinish,
  headerClassName,
  headerDragRegion = false,
}: {
  onFinish: (sessionId: string) => void;
  headerClassName: string;
  headerDragRegion?: boolean;
}) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const [currentStep, setCurrentStep] = useState(getInitialStep);
  const currentPlatform = platform();
  const showWindowControlsGutter = useWindowControlsGutter();

  const goNext = useCallback(() => {
    trackAnalyticsEvent("onboarding_step_completed", {
      step: currentStep,
      platform: currentPlatform,
    });
    const next = getNextStep(currentStep);
    if (next) setCurrentStep(next);
  }, [currentPlatform, currentStep]);

  const skipCurrentStep = useCallback(() => {
    trackAnalyticsEvent("onboarding_step_skipped", {
      step: currentStep,
      platform: currentPlatform,
    });
    const next = getNextStep(currentStep);
    if (next) setCurrentStep(next);
  }, [currentPlatform, currentStep]);

  const goBack = useCallback(() => {
    const prev = getPrevStep(currentStep);
    if (prev) setCurrentStep(prev);
  }, [currentStep]);

  const handleCalendarSignIn = useCallback(() => {
    void auth.signIn();
  }, [auth]);

  useEffect(() => {
    trackAnalyticsEvent("onboarding_step_viewed", {
      step: currentStep,
      platform: currentPlatform,
    });
  }, [currentPlatform, currentStep]);

  const handleFinish = useCallback(
    (sessionId: string) => {
      trackAnalyticsEvent("onboarding_step_completed", {
        step: "final",
        platform: currentPlatform,
      });
      void queryClient.invalidateQueries({ queryKey: ["onboarding-needed"] });
      onFinish(sessionId);
    },
    [currentPlatform, onFinish, queryClient],
  );

  return (
    <div className="bg-card relative flex h-full min-h-0 flex-col overflow-hidden">
      <div
        data-tauri-drag-region={headerDragRegion || undefined}
        className={cn([
          "relative z-10 flex shrink-0 items-center",
          headerClassName,
          showWindowControlsGutter ? "pl-[76px]" : "pl-12",
        ])}
      >
        <img
          src="/assets/session-echo-horizontal.svg"
          alt="Session Echo"
          className="h-9 w-auto dark:hidden"
        />
        <img
          src="/assets/session-echo-horizontal-dark.svg"
          alt=""
          aria-hidden="true"
          className="hidden h-9 w-auto dark:block"
        />
      </div>

      <div className="scroll-fade-y relative z-10 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-12 pb-16">
          <OnboardingSection
            title={<Trans>Start with permissions</Trans>}
            completedTitle={<Trans>Permissions granted</Trans>}
            description={
              currentPlatform === "macos" ? (
                <Trans>
                  Session Echo needs microphone and system audio to transcribe
                  your meetings, plus Accessibility to read meeting controls,
                  visible chat, and participant status.
                </Trans>
              ) : (
                <Trans>
                  Session Echo needs access to your microphone and system audio
                  to record and transcribe your meetings
                </Trans>
              )
            }
            status={getStepStatus("permissions", currentStep)}
            skippable={false}
            onBack={goBack}
            onNext={goNext}
          >
            <PermissionsSection onContinue={goNext} />
          </OnboardingSection>

          <OnboardingSection
            title={<Trans>Connect calendar</Trans>}
            description={
              <Trans>
                Session Echo will sync your calendar to get meeting reminders
              </Trans>
            }
            completedTitle={<Trans>Calendar connected</Trans>}
            status={getStepStatus("calendar", currentStep)}
            onBack={goBack}
            onNext={goNext}
            onSkip={skipCurrentStep}
          >
            <CalendarSection
              onContinue={goNext}
              onSignIn={handleCalendarSignIn}
            />
          </OnboardingSection>

          <OnboardingSection
            title={<Trans>Bring your meeting history</Trans>}
            description={
              <Trans>
                Import notes and transcripts from the meeting apps you already
                use.
              </Trans>
            }
            completedTitle={<Trans>Meeting history imported</Trans>}
            status={getStepStatus("imports", currentStep)}
            onBack={goBack}
            onNext={goNext}
            onSkip={skipCurrentStep}
          >
            <ImportSection onContinue={goNext} onSkip={skipCurrentStep} />
          </OnboardingSection>

          <OnboardingSection
            title={<Trans>Storage</Trans>}
            description={
              <Trans>Where your notes and recordings are stored</Trans>
            }
            completedTitle={<Trans>Storage configured</Trans>}
            status={getStepStatus("folder-location", currentStep)}
            onBack={goBack}
            onNext={goNext}
            onSkip={skipCurrentStep}
          >
            <FolderLocationSection onContinue={goNext} />
          </OnboardingSection>

          <OnboardingSection
            title={<Trans>Ready to go</Trans>}
            description={<FinalDescription />}
            status={getStepStatus("final", currentStep)}
            skippable={false}
            onBack={goBack}
            onNext={() => void finishOnboarding(handleFinish)}
          >
            <FinalSection onContinue={handleFinish} />
          </OnboardingSection>
        </div>
      </div>
    </div>
  );
}
