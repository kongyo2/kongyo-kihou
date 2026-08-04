/**
 * §6 の集計。
 *
 * 集計するのは三つだけ：`×` の絶対数、`－` の絶対数、`[易]` を除いたブライアスコア。
 * `○` の数は返り値の型に存在しない。「集計した瞬間、当たりやすい予測ばかりが選抜される」ため、
 * うっかり表示できるようにしておくこと自体が設計の穴になる。
 */

import { parseAbsoluteDate } from "./datetime.ts";
import {
  fieldValue,
  isEasy,
  type KongyoLine,
  type NoteKind,
  NOTE_KINDS,
  parseLine,
  parseProbability,
  type PredictionLine,
} from "./parse.ts";

export interface Tally {
  /** 予測として読める行の総数（刻印の有無を問わない）。 */
  readonly total: number;
  /** 刻印を持つ行＝台帳に確定した行。 */
  readonly sealed: number;
  /** 未判定（→）。 */
  readonly pending: number;
  /** 未判定のうち、期日が到来しているもの。 */
  readonly due: number;
  /** × の絶対数。 */
  readonly miss: number;
  /** － の絶対数。＝射程を書き損ねた率の分子。 */
  readonly undecidable: number;
  /** Σ(p − o)² / n。対象が無ければ null。 */
  readonly brier: number | null;
  /** ブライアスコアの n。 */
  readonly brierCount: number;
  /** 易問として除外した件数。 */
  readonly easyExcluded: number;
  /** p を数値として読めなかったため除外した件数。 */
  readonly unscorable: number;
  /** 台帳に追記された記録の数。破ったことは罰しないが、回数は残る（§3）。 */
  readonly notes: Readonly<Record<NoteKind, number>>;
}

const EMPTY_NOTES: Readonly<Record<NoteKind, number>> = {
  解除: 0,
  C6事後追加: 0,
  判定書換: 0,
  在庫: 0,
};

function deadlineOf(line: PredictionLine): number | null {
  const raw = fieldValue(line, "D");
  if (raw.length === 0) return null;
  return parseAbsoluteDate(raw)?.deadlineMs ?? null;
}

export interface DueEntry {
  readonly lineNumber: number;
  readonly text: string;
  readonly line: PredictionLine;
  /** `D` を読めない行は {@link NO_DEADLINE}。並びの最後に落ちる。 */
  readonly deadlineMs: number;
}

/** `D` を絶対日付として読めない確定行の期日。到来はしないが、一覧からは消さない。 */
export const NO_DEADLINE: number = Number.MAX_SAFE_INTEGER;

/** 未判定（`→` のまま）の行すべて。期日の早い順、`D` を読めない行は最後。 */
export function pendingEntries(lines: readonly string[]): readonly DueEntry[] {
  const out: DueEntry[] = [];
  lines.forEach((text, lineNumber) => {
    const parsed = parseLine(text);
    if (parsed.kind !== "prediction") return;
    if (parsed.stamp === null || parsed.verdict !== "pending") return;
    out.push({ lineNumber, text, line: parsed, deadlineMs: deadlineOf(parsed) ?? NO_DEADLINE });
  });
  return out.sort((a, b) => a.deadlineMs - b.deadlineMs);
}

/** 期日が到来し、まだ `→` のままの行。判定待ちの実測値。 */
export function dueEntries(lines: readonly string[], nowMs: number): readonly DueEntry[] {
  return pendingEntries(lines).filter((entry) => entry.deadlineMs <= nowMs);
}

export function tally(lines: readonly string[], nowMs: number): Tally {
  let total = 0;
  let sealed = 0;
  let pending = 0;
  let due = 0;
  let miss = 0;
  let undecidable = 0;
  let easyExcluded = 0;
  let unscorable = 0;
  let squaredSum = 0;
  let brierCount = 0;
  const notes: Record<NoteKind, number> = { ...EMPTY_NOTES };

  for (const text of lines) {
    const parsed: KongyoLine = parseLine(text);
    if (parsed.kind === "comment") {
      if (parsed.note !== null && (NOTE_KINDS as readonly string[]).includes(parsed.note.kind)) {
        notes[parsed.note.kind] += 1;
      }
      continue;
    }
    if (parsed.kind !== "prediction") continue;

    total += 1;
    if (parsed.stamp === null) continue;
    sealed += 1;

    if (parsed.verdict === "pending" || parsed.verdict === null) {
      pending += 1;
      const deadlineMs = deadlineOf(parsed);
      if (deadlineMs !== null && deadlineMs <= nowMs) due += 1;
      continue;
    }

    if (parsed.verdict === "undecidable") {
      undecidable += 1;
      continue;
    }
    if (parsed.verdict === "miss") miss += 1;

    const probability = parseProbability(fieldValue(parsed, "p"));
    if (isEasy(probability, parsed.easySpan !== null)) {
      easyExcluded += 1;
      continue;
    }
    if (probability === null) {
      unscorable += 1;
      continue;
    }
    const outcome = parsed.verdict === "miss" ? 0 : 1;
    squaredSum += (probability - outcome) ** 2;
    brierCount += 1;
  }

  return {
    total,
    sealed,
    pending,
    due,
    miss,
    undecidable,
    brier: brierCount === 0 ? null : squaredSum / brierCount,
    brierCount,
    easyExcluded,
    unscorable,
    notes,
  };
}

/** 未形式化在庫の見出し行（`## <ISO>`）を数える。§7 の「在庫の増加率」の分子。 */
export function inventoryStats(text: string, nowMs: number): { readonly total: number; readonly last30Days: number } {
  const heading = /^##\s+(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2})?\s*$/;
  let total = 0;
  let last30Days = 0;
  const threshold = nowMs - 30 * 86_400_000;
  for (const line of text.split(/\r?\n/)) {
    const m = heading.exec(line.trim());
    if (m === null) continue;
    total += 1;
    const parsed = parseAbsoluteDate(m[1] ?? "");
    if (parsed !== null && parsed.startMs >= threshold) last30Days += 1;
  }
  return { total, last30Days };
}
