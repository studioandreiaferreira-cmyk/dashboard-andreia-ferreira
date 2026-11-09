import { describe, expect, it } from "vitest";
import { DEFAULT_BUSINESS_HOURS } from "../../src/config";
import { businessMinutesBetween, dayRange, daysBetweenSP, isoWeekday, toDaySP } from "../../src/lib/time";

// 2026-10-09 is a Friday; 2026-10-12 is a Monday. São Paulo is UTC-3.
const sp = (local: string) => new Date(`${local}-03:00`).toISOString();

describe("time helpers", () => {
  it("buckets days in São Paulo time", () => {
    expect(toDaySP("2026-10-11T02:30:00Z")).toBe("2026-10-10");
    expect(toDaySP("2026-10-11T03:00:00Z")).toBe("2026-10-11");
  });

  it("builds inclusive day ranges", () => {
    expect(dayRange("2026-10-01", "2026-10-03")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(dayRange("2026-09-30", "2026-10-01")).toHaveLength(2);
  });

  it("knows weekdays", () => {
    expect(isoWeekday("2026-10-09")).toBe(5);
    expect(isoWeekday("2026-10-11")).toBe(7);
  });

  it("counts calendar days between dates in SP", () => {
    expect(daysBetweenSP(sp("2026-10-01T23:00:00"), new Date(sp("2026-10-11T08:00:00")))).toBe(10);
    expect(daysBetweenSP(sp("2026-10-11T00:10:00"), new Date(sp("2026-10-11T23:00:00")))).toBe(0);
  });

  describe("businessMinutesBetween (Mon–Fri 09:00–18:00)", () => {
    const bh = DEFAULT_BUSINESS_HOURS;
    it("Fri 17:30 → Mon 09:29 = 59", () => {
      expect(businessMinutesBetween(sp("2026-10-09T17:30:00"), sp("2026-10-12T09:29:00"), bh)).toBe(59);
    });
    it("Fri 17:30 → Mon 09:31 = 61", () => {
      expect(businessMinutesBetween(sp("2026-10-09T17:30:00"), sp("2026-10-12T09:31:00"), bh)).toBe(61);
    });
    it("Sat 10:00 → Mon 10:00 = 60", () => {
      expect(businessMinutesBetween(sp("2026-10-10T10:00:00"), sp("2026-10-12T10:00:00"), bh)).toBe(60);
    });
    it("same day 10:00 → 10:45 = 45", () => {
      expect(businessMinutesBetween(sp("2026-10-12T10:00:00"), sp("2026-10-12T10:45:00"), bh)).toBe(45);
    });
    it("returns 0 when end <= start", () => {
      expect(businessMinutesBetween(sp("2026-10-12T10:00:00"), sp("2026-10-12T09:00:00"), bh)).toBe(0);
    });
  });
});
