import { useRouteContext } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { useLanguageModel, useLLMConnection } from "~/ai/hooks";
import { searchCalendarEvents } from "~/calendar/queries";
import { useSessionTab } from "~/chat/components/use-session-tab";
import { buildChatTools } from "~/chat/tools";
import { searchContacts } from "~/contacts/queries";
import { useRegisterTools } from "~/contexts/tool";
import { takePendingOnboardingSession } from "~/onboarding/pending-session";
import { useSearchEngine } from "~/search/contexts/engine";
import { initEnhancerService } from "~/services/enhancer";
import { useConfigValue } from "~/shared/config";
import { useDesktopTabLifecycle } from "~/shared/desktop-tab-lifecycle";
import { useTabs } from "~/store/zustand/tabs";
import { LiveCaptureRecovery } from "~/stt/live-capture-recovery";
import { ScheduledMeetingAutoStart } from "~/stt/scheduled-auto-start";
import { MainListenerControlBridge } from "~/stt/window-control";
import { sessionHasTags, useTagSuggestions } from "~/tags/suggestion-store";

export function useClassicMainLifecycle() {
  const openNew = useTabs((state) => state.openNew);

  const openDefaultEmptyTab = useCallback(() => {
    openNew({ type: "empty" });
  }, [openNew]);

  const openPendingOnboardingTab = useCallback(() => {
    const sessionId = takePendingOnboardingSession();
    if (sessionId) {
      openNew({ type: "sessions", id: sessionId });
    }
  }, [openNew]);

  useDesktopTabLifecycle({
    onEmpty: openDefaultEmptyTab,
    onInitialized: openPendingOnboardingTab,
    onZeroTabs: openDefaultEmptyTab,
  });
}

export function ClassicMainServices() {
  return (
    <>
      <LiveCaptureRecovery />
      <ScheduledMeetingAutoStart />
      <MainListenerControlBridge />
      <ToolRegistration />
      <EnhancerInit />
    </>
  );
}

function ToolRegistration() {
  const { search } = useSearchEngine();

  const getContactSearchResults = searchContacts;

  const getCalendarEventSearchResults = searchCalendarEvents;

  const { getSessionId, getEnhancedNoteId } = useSessionTab();
  const openEditTab = useCallback((requestId: string) => {
    useTabs.getState().openNew({ type: "edit", requestId });
  }, []);

  useRegisterTools(
    "chat-general",
    () =>
      buildChatTools({
        search,
        getContactSearchResults,
        getCalendarEventSearchResults,
        getSessionId,
        getEnhancedNoteId,
        openEditTab,
      }),
    [
      search,
      getContactSearchResults,
      getCalendarEventSearchResults,
      getSessionId,
      getEnhancedNoteId,
      openEditTab,
    ],
  );

  return null;
}

function EnhancerInit() {
  const { aiTaskStore } = useRouteContext({
    from: "__root__",
  });

  const model = useLanguageModel("enhance");
  const { conn: llmConn } = useLLMConnection();
  const selectedTemplateId = useConfigValue("selected_template_id");

  const modelRef = useRef(model);
  modelRef.current = model;
  const llmConnRef = useRef(llmConn);
  llmConnRef.current = llmConn;
  const templateIdRef = useRef(selectedTemplateId);
  templateIdRef.current = selectedTemplateId;

  useEffect(() => {
    if (!aiTaskStore) return;

    const service = initEnhancerService({
      aiTaskStore,
      getModel: () => modelRef.current,
      getLLMConn: () => llmConnRef.current,
      getSelectedTemplateId: () => templateIdRef.current || undefined,
    });
    // A finished summary is the moment the transcript is known to be worth
    // tagging; ask once, and only for recordings nobody has tagged by hand.
    const stopListening = service.on((event) => {
      if (event.type !== "enhance-completed" || !modelRef.current) return;
      const model = modelRef.current;
      void sessionHasTags(event.sessionId).then((tagged) => {
        if (!tagged) {
          void useTagSuggestions.getState().request(event.sessionId, model);
        }
      });
    });

    return () => {
      stopListening();
      service.dispose();
    };
  }, [aiTaskStore]);

  return null;
}
