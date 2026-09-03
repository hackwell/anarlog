export const THUMBNAIL_SIZE = 32;

// A slide flip changes most of the window; webcam tiles and cursor movement
// change a few pixels by a lot or many pixels by a little. Counting only
// clear per-pixel changes on a coarse thumbnail separates the two.
const PIXEL_CHANGE_THRESHOLD = 24;

export function frameDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 1;
  }
  let changed = 0;
  for (let index = 0; index < a.length; index++) {
    if (Math.abs(a[index]! - b[index]!) > PIXEL_CHANGE_THRESHOLD) {
      changed++;
    }
  }
  return changed / a.length;
}

export async function decodeToGreyThumbnail(
  dataBase64: string,
  mimeType: string,
  size = THUMBNAIL_SIZE,
): Promise<Uint8Array> {
  const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  try {
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("2d context unavailable");
    }
    context.drawImage(bitmap, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);
    const grey = new Uint8Array(size * size);
    for (let pixel = 0; pixel < grey.length; pixel++) {
      const offset = pixel * 4;
      grey[pixel] = Math.round(
        0.299 * data[offset]! +
          0.587 * data[offset + 1]! +
          0.114 * data[offset + 2]!,
      );
    }
    return grey;
  } finally {
    bitmap.close();
  }
}

// Meeting UIs redraw a timer every second and OCR jitters on tiny glyphs
// ("•*", "v", "He" for "Heben"), so a frame counts as new text only when its
// readable words are not already contained in what the last kept frame showed.
export const MIN_NEW_TEXT_LETTERS = 12;
const TIME_TOKEN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

export function slideTextLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) =>
      line.toLowerCase().replace(TIME_TOKEN, " ").replace(/\s+/g, " ").trim(),
    )
    .filter((line) => letterCount(line) >= 3);
}

export function hasNewSlideText(
  previous: readonly string[] | null,
  current: readonly string[],
): boolean {
  const fresh = current.filter(
    (line) =>
      !previous?.some((known) => known.includes(line) || line.includes(known)),
  );
  return (
    fresh.reduce((sum, line) => sum + letterCount(line), 0) >=
    MIN_NEW_TEXT_LETTERS
  );
}

function letterCount(line: string) {
  return (line.match(/\p{L}/gu) ?? []).length;
}
