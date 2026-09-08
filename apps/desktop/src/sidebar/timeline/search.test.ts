import { describe, expect, test } from "vitest";

import { filterBucketsByParticipant, filterTimelineBuckets } from "./search";
import type { TimelineBucket } from "./utils";

const bucket = (
  label: string,
  items: Array<["session" | "event", string]>,
): TimelineBucket => ({
  label,
  precision: "time",
  items: items.map(([type, id]) =>
    type === "session"
      ? { type, id, data: { title: id, created_at: "2026-08-31T09:00:00Z" } }
      : { type, id, data: { title: id, has_recurrence_rules: false } },
  ),
});

describe("filterBucketsByParticipant", () => {
  test("keeps every bucket when nobody is selected", () => {
    const buckets = [
      bucket("Today", [
        ["session", "a"],
        ["event", "e"],
      ]),
    ];
    expect(filterBucketsByParticipant(buckets, null)).toBe(buckets);
  });

  test("keeps only the recordings that person took part in", () => {
    const buckets = [
      bucket("Today", [
        ["session", "a"],
        ["session", "b"],
      ]),
      bucket("Yesterday", [["session", "c"]]),
    ];
    const filtered = filterBucketsByParticipant(buckets, new Set(["a", "c"]));

    expect(filtered.map((entry) => entry.label)).toEqual([
      "Today",
      "Yesterday",
    ]);
    expect(filtered[0].items.map((item) => item.id)).toEqual(["a"]);
  });

  // A calendar slot has participants but no content, so it can never answer
  // "what did we talk about" - the question this filter exists for.
  test("drops calendar events even when their id matches", () => {
    const buckets = [
      bucket("Today", [
        ["event", "a"],
        ["session", "a"],
      ]),
    ];
    const filtered = filterBucketsByParticipant(buckets, new Set(["a"]));

    expect(filtered[0].items).toHaveLength(1);
    expect(filtered[0].items[0].type).toBe("session");
  });

  // An empty day heading with nothing under it reads as a bug, not a filter.
  test("removes a bucket that keeps nothing", () => {
    const buckets = [
      bucket("Today", [["session", "a"]]),
      bucket("Yesterday", [["session", "b"]]),
    ];
    const filtered = filterBucketsByParticipant(buckets, new Set(["a"]));

    expect(filtered.map((entry) => entry.label)).toEqual(["Today"]);
  });

  test("returns nothing when the person has no recordings", () => {
    const buckets = [bucket("Today", [["session", "a"]])];
    expect(filterBucketsByParticipant(buckets, new Set())).toEqual([]);
  });
});

describe("filterTimelineBuckets", () => {
  const meeting = (
    id: string,
    data: { organization_name?: string; locked?: boolean },
  ): TimelineBucket => ({
    label: "Today",
    precision: "time",
    items: [
      {
        type: "session",
        id,
        data: { title: id, created_at: "2026-08-31T09:00:00Z", ...data },
      },
    ],
  });

  test("finds a meeting by its title", () => {
    const filtered = filterTimelineBuckets(
      [meeting("Stackoverload Weekly", {})],
      "weekly",
    );

    expect(filtered[0]?.items.map((item) => item.id)).toEqual([
      "Stackoverload Weekly",
    ]);
  });

  test("finds a meeting by the customer it belongs to", () => {
    const filtered = filterTimelineBuckets(
      [meeting("Stackoverload Weekly", { organization_name: "Müller GmbH" })],
      "müller",
    );

    expect(filtered[0]?.items.map((item) => item.id)).toEqual([
      "Stackoverload Weekly",
    ]);
  });

  test("keeps a locked meeting's customer hidden", () => {
    expect(
      filterTimelineBuckets(
        [
          meeting("Stackoverload Weekly", {
            organization_name: "Müller GmbH",
            locked: true,
          }),
        ],
        "müller",
      ),
    ).toEqual([]);
  });

  test("does not match a meeting without a customer", () => {
    expect(
      filterTimelineBuckets([meeting("Stackoverload Weekly", {})], "müller"),
    ).toEqual([]);
  });
});
