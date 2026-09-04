// A session's audio timeline starts at zero at the earliest transcript that actually
// has words. A leading transcript row can exist with no words yet (the first seconds
// of a live capture, or a resumed session's placeholder row) — that row's start would
// misplace every later anchor, so it only becomes the base when nothing else qualifies.
export function sessionTimelineBaseMs(
  transcripts: ReadonlyArray<{ startedAt: number; hasWords: boolean }>,
): number | null {
  const candidates = transcripts.filter(
    (transcript) =>
      Number.isFinite(transcript.startedAt) && transcript.startedAt > 0,
  );
  const withWords = candidates.filter((transcript) => transcript.hasWords);
  const pool = withWords.length > 0 ? withWords : candidates;
  if (pool.length === 0) {
    return null;
  }

  const base = Math.min(...pool.map((transcript) => transcript.startedAt));
  return Number.isFinite(base) ? base : null;
}
