import { useLingui } from "@lingui/react";
import { format, isValid, type Locale } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { useMemo } from "react";

import { type DisplayLocale, resolveDisplayLocale } from "./locales";

// German reads a 24-hour clock and day-first dates; English keeps the 12-hour
// clock and month-first dates the UI was originally written against.
const PATTERNS: Record<
  DisplayLocale,
  {
    locale: Locale;
    time: string;
    dayMonth: string;
    date: string;
    dateTime: string;
  }
> = {
  en: {
    locale: enUS,
    time: "h:mm a",
    dayMonth: "MMM d",
    date: "MMM d, yyyy",
    dateTime: "MMM d, yyyy h:mm a",
  },
  de: {
    locale: de,
    time: "HH:mm",
    dayMonth: "d. MMM",
    date: "d. MMM yyyy",
    dateTime: "d. MMM yyyy, HH:mm",
  },
};

export type DateFormatter = {
  /** Clock time alone, e.g. `10:01 PM` / `22:01`. */
  time: (value: Date) => string;
  /** Day and month without a year, e.g. `Aug 28` / `28. Aug.`. */
  dayMonth: (value: Date) => string;
  /** Full date without a time, e.g. `Aug 28, 2026` / `28. Aug. 2026`. */
  date: (value: Date) => string;
  /** Full date and clock time, e.g. `Aug 28, 2026 10:01 PM` / `28. Aug. 2026, 22:01`. */
  dateTime: (value: Date) => string;
};

export function getDateFormatter(locale: DisplayLocale): DateFormatter {
  const patterns = PATTERNS[locale];
  const apply = (pattern: string) => (value: Date) => {
    if (!isValid(value)) {
      return "";
    }
    try {
      return format(value, pattern, { locale: patterns.locale });
    } catch {
      return "";
    }
  };

  return {
    time: apply(patterns.time),
    dayMonth: apply(patterns.dayMonth),
    date: apply(patterns.date),
    dateTime: apply(patterns.dateTime),
  };
}

export function useDateFormatter(): DateFormatter {
  const { i18n } = useLingui();
  return useMemo(
    () => getDateFormatter(resolveDisplayLocale(i18n.locale)),
    [i18n.locale],
  );
}
