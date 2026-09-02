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
