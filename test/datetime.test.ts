import { describe, expect, it } from "vitest";

import { calendarDaysUntil, looksRelative, parseAbsoluteDate } from "../src/core/datetime.ts";

describe("parseAbsoluteDate", () => {
  it("日付だけの D はその日の終わりが期日", () => {
    const parsed = parseAbsoluteDate("2026-09-30");
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    expect(parsed.iso).toBe("2026-09-30");
    expect(parsed.hasTime).toBe(false);
    expect(parsed.deadlineMs).toBe(new Date(2026, 8, 30, 23, 59, 59, 999).getTime());
  });

  it("時刻つきの D はその時刻が期日", () => {
    const parsed = parseAbsoluteDate("2026-09-30T09:30");
    expect(parsed?.iso).toBe("2026-09-30T09:30");
    expect(parsed?.deadlineMs).toBe(new Date(2026, 8, 30, 9, 30, 0, 0).getTime());
  });

  it("存在しない暦日は読めない", () => {
    expect(parseAbsoluteDate("2026-02-30")).toBeNull();
    expect(parseAbsoluteDate("2026-13-01")).toBeNull();
  });

  it("相対表現は読めない", () => {
    expect(parseAbsoluteDate("来週")).toBeNull();
    expect(looksRelative("来週")).toBe(true);
    expect(looksRelative("3日後")).toBe(true);
  });
});

describe("calendarDaysUntil", () => {
  const noon = new Date(2026, 7, 4, 12, 0, 0).getTime();

  it("今日は 0", () => {
    const endOfToday = new Date(2026, 7, 4, 23, 59, 59, 999).getTime();
    expect(calendarDaysUntil(endOfToday, noon)).toBe(0);
  });

  it("明日は 1（時刻に依らない）", () => {
    const earlyTomorrow = new Date(2026, 7, 5, 0, 30, 0).getTime();
    expect(calendarDaysUntil(earlyTomorrow, noon)).toBe(1);
  });

  it("昨日は -1", () => {
    const lateYesterday = new Date(2026, 7, 3, 23, 0, 0).getTime();
    expect(calendarDaysUntil(lateYesterday, noon)).toBe(-1);
  });

  it("30 日後は 30", () => {
    const later = new Date(2026, 8, 3, 6, 0, 0).getTime();
    expect(calendarDaysUntil(later, noon)).toBe(30);
  });
});
