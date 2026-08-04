/**
 * 構造 → 一行、および反証文の生成。
 *
 * 反証文の生成器がここにあるのは、C3（「この予測が外れた世界」を一文で書けること）を
 * 機械化するため。生成できない行は C3 に落ちる。人の内心を推定せずに済む。
 */

import {
  CANONICAL_FIELD_ORDER,
  type Comparison,
  COMPARISON_NEGATION,
  type FieldKey,
  FIELD_META,
  isComparison,
  type PatternId,
  PATTERNS,
} from "./patterns.ts";
import {
  fieldValue,
  getField,
  hasField,
  type NoteKind,
  type PredictionLine,
  parseLine,
  type Verdict,
  VERDICT_MARKERS,
} from "./parse.ts";
import type { Span } from "./text.ts";

export interface PredictionDraft {
  readonly pattern: PatternId;
  readonly values: ReadonlyMap<FieldKey, string>;
  readonly stamp: string | null;
  readonly easy: boolean;
  readonly verdict: Verdict | null;
}

/** §6 のシリアライズ形式で一行を書き出す。 */
export function renderPrediction(draft: PredictionDraft): string {
  const parts: string[] = [];
  if (draft.stamp !== null) parts.push(`[${draft.stamp}]`);
  parts.push(draft.pattern);
  if (draft.easy) parts.push("[易]");
  for (const key of CANONICAL_FIELD_ORDER) {
    const value = draft.values.get(key);
    if (value === undefined || value.length === 0) continue;
    parts.push(`${FIELD_META[key].token}=${value}`);
  }
  const body = parts.join(" ");
  return draft.verdict === null ? body : `${body}  ${VERDICT_MARKERS[draft.verdict]}`;
}

/** 解析済みの行から下書きを組み直す。整形と確定で使う。 */
export function toDraft(line: PredictionLine): PredictionDraft | null {
  if (line.pattern === null) return null;
  const values = new Map<FieldKey, string>();
  for (const field of line.fields) {
    if (!values.has(field.key)) values.set(field.key, field.value);
  }
  return {
    pattern: line.pattern,
    values,
    stamp: line.stamp,
    easy: line.easySpan !== null,
    verdict: line.verdict,
  };
}

function comparisonPhrase(raw: string): { forward: string; negated: string } {
  if (isComparison(raw)) {
    const key: Comparison = raw;
    return { forward: raw, negated: COMPARISON_NEGATION[key] };
  }
  return { forward: raw, negated: `${raw}ではない` };
}

/**
 * 「この予測が外れた世界」を一文で書く。書けなければ null。
 * 書けないことは、その行が C3 を通っていないことと同義である。
 */
export function renderFalsification(line: PredictionLine): string | null {
  const pattern = line.pattern;
  if (pattern === null) return null;
  const spec = PATTERNS[pattern];
  for (const key of spec.required) {
    if (key === "p") continue;
    if (!hasField(line, key)) return null;
  }

  const d = fieldValue(line, "D");
  const s = fieldValue(line, "S");
  const o = fieldValue(line, "O");
  const c = fieldValue(line, "C");
  const j = fieldValue(line, "J");

  let core: string;
  switch (pattern) {
    case "P1":
      core = `${d} 時点で、${s} の ${o} が ${c} になっていない`;
      break;
    case "P2":
      core = `${fieldValue(line, "T")} が起きた後も、${d} 時点で ${s} の ${o} が ${c} にならない`;
      break;
    case "P3":
      core = `${d} までのどこかの時点で、${s} の ${o} が ${c} を外れる`;
      break;
    case "P4": {
      const cmp = comparisonPhrase(fieldValue(line, "CMP"));
      core = `${d} 時点で、${fieldValue(line, "S1")} の ${o} は ${fieldValue(line, "S2")} より ${cmp.negated}`;
      break;
    }
    case "P5":
      core = `${d} までに、${fieldValue(line, "E")} が起きる`;
      break;
    default:
      return null;
  }
  return `${core}。判定は ${j}。`;
}

/** 予測が当たった世界の一文。ホバーで反証文と並べると、両者の距離が見える。 */
export function renderAffirmation(line: PredictionLine): string | null {
  const pattern = line.pattern;
  if (pattern === null) return null;
  const spec = PATTERNS[pattern];
  for (const key of spec.required) {
    if (key === "p") continue;
    if (!hasField(line, key)) return null;
  }
  const d = fieldValue(line, "D");
  const s = fieldValue(line, "S");
  const o = fieldValue(line, "O");
  const c = fieldValue(line, "C");
  switch (pattern) {
    case "P1":
      return `${d} までに、${s} の ${o} が ${c} になる。`;
    case "P2":
      return `${fieldValue(line, "T")} が起きたとき、${s} の ${o} が ${c} になる。`;
    case "P3":
      return `${d} まで、${s} の ${o} は ${c} を保つ。`;
    case "P4": {
      const cmp = comparisonPhrase(fieldValue(line, "CMP"));
      return `${d} 時点で、${fieldValue(line, "S1")} の ${o} は ${fieldValue(line, "S2")} より ${cmp.forward}。`;
    }
    case "P5":
      return `${d} までに、${fieldValue(line, "E")} は起きない。`;
    default:
      return null;
  }
}

/** 項の値を差し替えた行を返す。項が無ければ末尾（末尾記号の手前）に足す。 */
export function withFieldValue(lineText: string, key: FieldKey, value: string): string {
  const line = parseLine(lineText);
  if (line.kind !== "prediction") return lineText;
  const field = getField(line, key);
  if (field !== null) {
    return lineText.slice(0, field.valueSpan.start) + value + lineText.slice(field.valueSpan.end);
  }
  const token = `${FIELD_META[key].token}=${value}`;
  if (line.verdictSpan !== null) {
    const head = lineText.slice(0, line.verdictSpan.start).trimEnd();
    return `${head} ${token}  ${lineText.slice(line.verdictSpan.start)}`;
  }
  return `${lineText.trimEnd()} ${token}`;
}

/** `p` の値を空にする。分割した二行に、改めて確率を振らせるため（§2）。 */
export function blankProbability(lineText: string): string {
  const line = parseLine(lineText);
  if (line.kind !== "prediction") return lineText;
  if (getField(line, "p") === null) return `${lineText.trimEnd()} p=`;
  return withFieldValue(lineText, "p", "");
}

/**
 * 項の値を、その中の一致位置で二行に割る。選言（文法違反）と連言（C4）の両方で使う。
 * 割った二行は `p` を空にする。前の確率をそのまま持ち越すのは、分割していないのと同じだから。
 */
export function splitFieldValue(lineText: string, valueSpan: Span, matchSpan: Span): readonly [string, string] {
  const left = lineText.slice(valueSpan.start, matchSpan.start).trim();
  const right = lineText.slice(matchSpan.end, valueSpan.end).trim();
  const head = lineText.slice(0, valueSpan.start);
  const tail = lineText.slice(valueSpan.end);
  return [blankProbability(head + left + tail), blankProbability(head + right + tail)];
}

/** 正規形に整える。未知の項・帰属の無い語を含む行はそのまま返す（情報を落とさないため）。 */
export function canonicalize(lineText: string): string {
  const line = parseLine(lineText);
  if (line.kind !== "prediction" || line.pattern === null) return lineText;
  // 正規形はどの項にも属さない語を保存できない。整形が語を消すのは整形ではない。
  if (line.straySpan !== null) return lineText;
  const spec = PATTERNS[line.pattern];
  const allowed = new Set<FieldKey>([...spec.required, ...spec.optional]);
  const seen = new Set<FieldKey>();
  for (const field of line.fields) {
    if (!allowed.has(field.key) || seen.has(field.key)) return lineText;
    seen.add(field.key);
  }
  const draft = toDraft(line);
  if (draft === null) return lineText;
  return renderPrediction(draft);
}

export function renderLedgerNote(kind: NoteKind, at: string, ref: string, detail: string): string {
  const quote = (value: string): string => `"${value.replace(/["\\]/g, "\\$&")}"`;
  return `# kongyo-note at=${at} kind=${kind} ref=${quote(ref.slice(0, 60))} detail=${quote(detail)}`;
}
