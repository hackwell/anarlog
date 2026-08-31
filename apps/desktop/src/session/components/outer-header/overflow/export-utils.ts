import type { DateFormatter } from "~/i18n/date-format";

/**
 * An export used to be hardcoded to en-US, so a German note carried an English
 * date and a 12-hour clock whatever the app was set to. The formatter is passed
 * in rather than built here, so an export reads the way the app does.
 */
export function formatDate(
  isoString: string,
  dateFormatter: DateFormatter,
): string {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "" : dateFormatter.dateTime(date);
}

export function formatDuration(startMs: number, endMs: number): string {
  const durationMs = endMs - startMs;
  const minutes = Math.floor(durationMs / 60000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
}
