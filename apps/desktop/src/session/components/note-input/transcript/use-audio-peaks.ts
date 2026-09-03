import { useQuery } from "@tanstack/react-query";

import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";
import { commands as transcriptionCommands } from "@anlg/plugin-transcription";

export const WAVEFORM_BUCKETS = 56;

// The outline is decoded from the whole recording once; nothing about it
// changes while a batch runs, so it is cached for the session's lifetime.
export function useAudioPeaks(sessionId: string, enabled: boolean) {
  const { data = null } = useQuery({
    queryKey: ["audio-peaks", sessionId, WAVEFORM_BUCKETS],
    queryFn: async () => {
      const path = await fsSyncCommands.audioPath(sessionId);
      if (path.status === "error") return null;
      const peaks = await transcriptionCommands.audioPeaks(
        path.data,
        WAVEFORM_BUCKETS,
      );
      return peaks.status === "ok" ? peaks.data : null;
    },
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return data;
}
