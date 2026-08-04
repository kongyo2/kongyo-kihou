/**
 * `D`（期日）の解析。
 *
 * §1 の必須項表：`D` は「判定が返る日時。相対表現不可」。
 * ゆえにここは寛容ではない。絶対日付として読めないものは、すべて `null` を返す。
 */

export interface AbsoluteDate {
  /** 正規形。時刻を持つなら `YYYY-MM-DDTHH:MM`、持たないなら `YYYY-MM-DD`。 */
  readonly iso: string;
  /** その日時の開始（時刻なしなら 00:00）をローカル時刻として解釈したエポックミリ秒。 */
  readonly startMs: number;
  /**
   * 判定が返り切る瞬間。時刻なしの `D` はその日の 23:59:59.999。
   * C1（前後性）と「期日到来」の判定はどちらもこちらを使う。
   */
  readonly deadlineMs: number;
  readonly hasTime: boolean;
}

const ABSOLUTE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** 相対表現の代表例。却下の理由を具体的に言うためだけに使う。 */
export const RELATIVE_DATE_HINTS: readonly string[] = [
  "今日",
  "明日",
  "明後日",
  "今週",
  "来週",
  "再来週",
  "今月",
  "来月",
  "再来月",
  "今期",
  "来期",
  "今年",
  "来年",
  "年内",
  "年度末",
  "次回",
  "次の",
  "近日",
  "後日",
  "随時",
  "いずれ",
  "そのうち",
  "まもなく",
  "間もなく",
  "近いうち",
  "数日後",
  "数週間後",
  "数ヶ月後",
];

const RELATIVE_NUMERIC = /\d+\s*(日|週間?|ヶ?月|年)\s*(後|以内|以降)/;

function toInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * 絶対日付として解析する。相対表現・不正な暦日・欠けた桁はすべて `null`。
 * `2026-02-30` のような存在しない日は Date への往復で弾く。
 */
export function parseAbsoluteDate(raw: string): AbsoluteDate | null {
  const text = raw.trim();
  const m = ABSOLUTE.exec(text);
  if (m === null) return null;

  const year = toInt(m[1]);
  const month = toInt(m[2]);
  const day = toInt(m[3]);
  if (year === null || month === null || day === null) return null;

  const hasTime = m[4] !== undefined;
  const hour = hasTime ? toInt(m[4]) : 0;
  const minute = hasTime ? toInt(m[5]) : 0;
  const second = hasTime ? (toInt(m[6]) ?? 0) : 0;
  if (hour === null || minute === null) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const start = new Date(year, month - 1, day, hour, minute, second, 0);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
    return null;
  }

  const deadline = hasTime ? start.getTime() : new Date(year, month - 1, day, 23, 59, 59, 999).getTime();

  const pad2 = (n: number): string => String(n).padStart(2, "0");
  const iso = hasTime
    ? `${String(year)}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`
    : `${String(year)}-${pad2(month)}-${pad2(day)}`;

  return { iso, startMs: start.getTime(), deadlineMs: deadline, hasTime };
}

/** 相対表現らしさ。却下メッセージを具体化するためだけに使う。 */
export function looksRelative(raw: string): boolean {
  const text = raw.trim();
  if (RELATIVE_NUMERIC.test(text)) return true;
  return RELATIVE_DATE_HINTS.some((hint) => text.includes(hint));
}

export function formatDate(when: Date): string {
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  return `${String(when.getFullYear())}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}`;
}

export function formatDateTimeMinutes(when: Date): string {
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  return `${formatDate(when)}T${pad2(when.getHours())}:${pad2(when.getMinutes())}`;
}

export function addDays(when: Date, days: number): Date {
  const next = new Date(when.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonths(when: Date, months: number): Date {
  const next = new Date(when.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

/** 残り日数（切り上げ）。負なら期日は過ぎている。 */
export function daysUntil(deadlineMs: number, nowMs: number): number {
  return Math.ceil((deadlineMs - nowMs) / 86_400_000);
}
