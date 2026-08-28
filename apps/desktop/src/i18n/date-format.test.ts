import { describe, expect, it } from "vitest";

import { getDateFormatter } from "./date-format";

const NIGHT = new Date(2026, 7, 28, 22, 1, 0);
const MORNING = new Date(2026, 7, 28, 9, 5, 0);

describe("getDateFormatter", () => {
  it("keeps the 12-hour clock and month-first dates in English", () => {
    const formatter = getDateFormatter("en");

    expect(formatter.time(NIGHT)).toBe("10:01 PM");
    expect(formatter.time(MORNING)).toBe("9:05 AM");
    expect(formatter.dayMonth(NIGHT)).toBe("Aug 28");
    expect(formatter.date(NIGHT)).toBe("Aug 28, 2026");
    expect(formatter.dateTime(NIGHT)).toBe("Aug 28, 2026 10:01 PM");
  });

  it("uses the 24-hour clock and German day-first dates in German", () => {
    const formatter = getDateFormatter("de");

    expect(formatter.time(NIGHT)).toBe("22:01");
    expect(formatter.time(MORNING)).toBe("09:05");
    expect(formatter.dayMonth(NIGHT)).toBe("28. Aug.");
    expect(formatter.date(NIGHT)).toBe("28. Aug. 2026");
    expect(formatter.dateTime(NIGHT)).toBe("28. Aug. 2026, 22:01");
  });

  it("never leaks an AM/PM suffix or an English month into German output", () => {
    const formatter = getDateFormatter("de");

    for (const rendered of [
      formatter.time(NIGHT),
      formatter.dayMonth(NIGHT),
      formatter.date(NIGHT),
      formatter.dateTime(NIGHT),
    ]) {
      expect(rendered).not.toMatch(/\b[AP]M\b/);
      expect(rendered).not.toContain("August 28");
    }
  });

  it("returns an empty string for an invalid date instead of throwing", () => {
    for (const locale of ["en", "de"] as const) {
      const formatter = getDateFormatter(locale);
      expect(formatter.time(new Date(Number.NaN))).toBe("");
      expect(formatter.dateTime(new Date(Number.NaN))).toBe("");
    }
  });
});
