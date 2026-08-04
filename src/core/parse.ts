/**
 * 一行 → 構造。§6「一行一予測」。
 *
 * 解析は寛容、検査は非寛容。書きかけの行も「予測（項が欠けている）」として読み、
 * 欠けを検査側が却下する。書きかけを解析エラーで黙らせると、打鍵中の拘束にならない。
 */

import { type FieldKey, isPatternId, type PatternId } from "./patterns.ts";
import { normalizeWidth, type Span, span, trimmedEnd, trimmedStart } from "./text.ts";

export type Verdict = "pending" | "hit" | "miss" | "undecidable";

/** §6 の末尾記号。`hit`（○）は集計に出さないが、ブライアスコアの計算には要る。 */
export const VERDICT_MARKERS: Readonly<Record<Verdict, string>> = {
  pending: "→",
  hit: "○",
  miss: "×",
  undecidable: "－",
};

/**
 * 受理する末尾記号。
 * `ー`(U+30FC 長音符) は入れない。`J=タイマー` を判定済みと誤読するため。
 */
const MARKER_TABLE: Readonly<Record<string, Verdict>> = {
  "→": "pending",
  "⇒": "pending",
  "○": "hit",
  〇: "hit",
  "◯": "hit",
  "×": "miss",
  "✕": "miss",
  "✖": "miss",
  "－": "undecidable",
  "—": "undecidable",
  "―": "undecidable",
};

/** 前に空白を要求する記号。単独では値の末尾と紛れるもの。 */
const MARKERS_NEEDING_SPACE = new Set(["－", "—", "―"]);

export interface FieldToken {
  readonly key: FieldKey;
  /** 書かれたままの記号（`S₁` `比較` など）。 */
  readonly writtenKey: string;
  readonly keySpan: Span;
  /** 前後の空白と `[易]` を除いた値。 */
  readonly value: string;
  readonly valueSpan: Span;
}

export interface PredictionLine {
  readonly kind: "prediction";
  readonly text: string;
  /** `[YYYY-MM-DD]` の刻印。台帳へ確定した印。 */
  readonly stamp: string | null;
  readonly stampSpan: Span | null;
  readonly pattern: PatternId | null;
  readonly patternSpan: Span | null;
  readonly easySpan: Span | null;
  /**
   * 型と最初の項のあいだにある、どの項にも属さない語の範囲。
   * 正規形はこれを保存しない。黙って消える語は、書けないと言うのが正しい（G-STRAY）。
   * `[易]` は正規の位置なので範囲に含めない。挟まれていれば範囲は複数に割れる。
   */
  readonly straySpans: readonly Span[];
  readonly fields: readonly FieldToken[];
  readonly verdict: Verdict | null;
  readonly verdictSpan: Span | null;
}

export const NOTE_KINDS = ["解除", "C6事後追加", "判定書換", "在庫"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** 台帳に追記される記録行。破ったことは罰しない。回数を数えるためだけにある（§3）。 */
export interface LedgerNote {
  readonly kind: NoteKind;
  readonly at: string;
  readonly ref: string;
  readonly detail: string;
}

export interface CommentLine {
  readonly kind: "comment";
  readonly text: string;
  readonly note: LedgerNote | null;
}

export interface BlankLine {
  readonly kind: "blank";
  readonly text: string;
}

/** 記法を通っていない行。§7 のとおり、捨てずに在庫へ落とす対象。 */
export interface UnformalizedLine {
  readonly kind: "unformalized";
  readonly text: string;
}

export type KongyoLine = PredictionLine | CommentLine | BlankLine | UnformalizedLine;

const STAMP_AT = /^\s*\[(\d{4}-\d{2}-\d{2})\]/;
const PATTERN_AT = /^\s*(P[1-5])(?![0-9])/;
const EASY_ANYWHERE = /\[\s*易\s*\]/g;
const FIELD_AT = /(?:^|[\s,、，])(S₁|S1|S₂|S2|比較|[DSOCJpPRTE])[ \t]*=/g;
const NOTE_AT = /^\s*#\s*kongyo-note\b(.*)$/;
const NOTE_PAIR = /(\w+)=("(?:[^"\\]|\\.)*"|\S*)/g;

function writtenKeyToFieldKey(written: string): FieldKey | null {
  switch (written) {
    case "S₁":
    case "S1":
      return "S1";
    case "S₂":
    case "S2":
      return "S2";
    case "比較":
      return "CMP";
    case "p":
    case "P":
      return "p";
    case "D":
    case "S":
    case "O":
    case "C":
    case "J":
    case "R":
    case "T":
    case "E":
      return written;
    default:
      return null;
  }
}

/**
 * 末尾記号は必ず元テキストの側で見る。
 * `－`(U+FF0D) は幅の正規化で `-` へ写るので、正規化後に探すと判定不能の行が未判定に化ける。
 */
function findVerdict(raw: string): { verdict: Verdict; span: Span } | null {
  const end = trimmedEnd(raw);
  if (end === 0) return null;
  const ch = raw[end - 1];
  if (ch === undefined) return null;
  const verdict = MARKER_TABLE[ch];
  if (verdict === undefined) return null;
  if (MARKERS_NEEDING_SPACE.has(ch)) {
    const before = raw[end - 2];
    if (before !== undefined && !/\s/.test(before)) return null;
  }
  return { verdict, span: span(end - 1, end) };
}

function findEasy(norm: string): Span | null {
  EASY_ANYWHERE.lastIndex = 0;
  const m = EASY_ANYWHERE.exec(norm);
  EASY_ANYWHERE.lastIndex = 0;
  return m === null ? null : span(m.index, m.index + m[0].length);
}

/**
 * 型（無ければ刻印）と最初の項のあいだに残る、どの項にも属さない語の範囲を探す。
 *
 * `[易]` はこの位置が正規なので語には数えない。範囲にも含めない——含めると、
 * 削除の修正が有効な標示まで巻き込んで消す。`[易]` を挟む両側に語があるときは、
 * 範囲を割って各々を返す。
 */
function findStrays(norm: string, from: number, to: number): readonly Span[] {
  if (to <= from) return [];
  const gap = norm.slice(from, to);

  // [易] を区切りとして区間に割る。
  const cuts: Span[] = [];
  let cursor = 0;
  EASY_ANYWHERE.lastIndex = 0;
  let m = EASY_ANYWHERE.exec(gap);
  while (m !== null) {
    cuts.push(span(cursor, m.index));
    cursor = m.index + m[0].length;
    m = EASY_ANYWHERE.exec(gap);
  }
  EASY_ANYWHERE.lastIndex = 0;
  cuts.push(span(cursor, gap.length));

  const out: Span[] = [];
  for (const cut of cuts) {
    const text = gap.slice(cut.start, cut.end);
    const start = trimmedStart(text);
    const end = trimmedEnd(text);
    if (end > start) out.push(span(from + cut.start + start, from + cut.start + end));
  }
  return out;
}

interface RawFieldHit {
  readonly key: FieldKey;
  readonly writtenKey: string;
  readonly keySpan: Span;
  /** `=` の直後。 */
  readonly valueFrom: number;
  /** この一致の先頭（区切り文字を含む）。前の項の値の終端になる。 */
  readonly hitFrom: number;
}

function findFieldHits(norm: string, limit: number): readonly RawFieldHit[] {
  const hits: RawFieldHit[] = [];
  FIELD_AT.lastIndex = 0;
  let m = FIELD_AT.exec(norm);
  while (m !== null) {
    const written = m[1];
    if (written !== undefined && m.index + m[0].length <= limit) {
      const key = writtenKeyToFieldKey(written);
      if (key !== null) {
        const keyOffset = m.index + m[0].indexOf(written);
        hits.push({
          key,
          writtenKey: written,
          keySpan: span(keyOffset, keyOffset + written.length),
          valueFrom: m.index + m[0].length,
          hitFrom: m.index,
        });
      }
    }
    // 区切り文字を食べているので、次の探索は一致の末尾から。
    m = FIELD_AT.exec(norm);
  }
  FIELD_AT.lastIndex = 0;
  return hits;
}

function sliceValue(source: string, from: number, to: number): { value: string; valueSpan: Span } {
  const raw = source.slice(from, to);
  const leading = trimmedStart(raw);
  const trailing = trimmedEnd(raw);
  const start = from + leading;
  const end = from + Math.max(leading, trailing);
  const value = source.slice(start, end).replace(EASY_ANYWHERE, "").trim();
  return { value, valueSpan: span(start, end) };
}

export function isNoteKind(value: string): value is NoteKind {
  return (NOTE_KINDS as readonly string[]).includes(value);
}

function parseNote(rest: string): LedgerNote | null {
  const pairs = new Map<string, string>();
  NOTE_PAIR.lastIndex = 0;
  let m = NOTE_PAIR.exec(rest);
  while (m !== null) {
    const key = m[1];
    const rawValue = m[2] ?? "";
    if (key !== undefined) {
      const value = rawValue.startsWith('"') ? rawValue.slice(1, -1).replace(/\\(.)/g, "$1") : rawValue;
      pairs.set(key, value);
    }
    m = NOTE_PAIR.exec(rest);
  }
  NOTE_PAIR.lastIndex = 0;
  const kind = pairs.get("kind");
  if (kind === undefined || !isNoteKind(kind)) return null;
  return {
    kind,
    at: pairs.get("at") ?? "",
    ref: pairs.get("ref") ?? "",
    detail: pairs.get("detail") ?? "",
  };
}

/** 一行を解析する。全角で書かれていても読むが、索引は元テキストのもの。 */
export function parseLine(text: string): KongyoLine {
  if (text.trim().length === 0) return { kind: "blank", text };

  const norm = normalizeWidth(text);
  const trimmed = norm.trimStart();
  if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
    const m = NOTE_AT.exec(norm);
    return { kind: "comment", text, note: m === null ? null : parseNote(m[1] ?? "") };
  }

  const stampMatch = STAMP_AT.exec(norm);
  const stamp = stampMatch?.[1] ?? null;
  const stampSpan =
    stampMatch === null ? null : span(stampMatch[0].length - stampMatch[0].trimStart().length, stampMatch[0].length);
  const afterStamp = stampMatch === null ? 0 : stampMatch[0].length;

  const patternMatch = PATTERN_AT.exec(norm.slice(afterStamp));
  const patternText = patternMatch?.[1];
  const pattern = patternText !== undefined && isPatternId(patternText) ? patternText : null;
  const patternSpan =
    patternMatch === null || patternText === undefined
      ? null
      : span(afterStamp + patternMatch[0].length - patternText.length, afterStamp + patternMatch[0].length);

  const marker = findVerdict(text);
  const bodyEnd = marker === null ? trimmedEnd(norm) : marker.span.start;
  const hits = findFieldHits(norm, bodyEnd);

  if (pattern === null && hits.length === 0) {
    return { kind: "unformalized", text };
  }

  const fields: FieldToken[] = hits.map((hit, index) => {
    const next = hits[index + 1];
    const to = next === undefined ? bodyEnd : next.hitFrom;
    const { value, valueSpan } = sliceValue(norm, hit.valueFrom, Math.max(hit.valueFrom, to));
    return {
      key: hit.key,
      writtenKey: hit.writtenKey,
      keySpan: hit.keySpan,
      value,
      valueSpan,
    };
  });

  const strayFrom = patternSpan?.end ?? stampSpan?.end ?? trimmedStart(norm);
  const strayTo = hits[0]?.hitFrom ?? bodyEnd;

  return {
    kind: "prediction",
    text,
    stamp,
    stampSpan,
    pattern,
    patternSpan,
    easySpan: findEasy(norm),
    straySpans: findStrays(norm, strayFrom, strayTo),
    fields,
    verdict: marker?.verdict ?? null,
    verdictSpan: marker?.span ?? null,
  };
}

export function getField(line: PredictionLine, key: FieldKey): FieldToken | null {
  return line.fields.find((f) => f.key === key) ?? null;
}

export function fieldValue(line: PredictionLine, key: FieldKey): string {
  return getField(line, key)?.value ?? "";
}

/** §1 の意味での「書かれている」＝記号があり、値が空でない。 */
export function hasField(line: PredictionLine, key: FieldKey): boolean {
  const field = getField(line, key);
  return field !== null && field.value.length > 0;
}

const PROBABILITY = /^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?|\.\d{1,4})$/;

/** `p` を数値として読む。読めなければ null（C5 却下）。 */
export function parseProbability(raw: string): number | null {
  const text = raw.trim();
  if (!PROBABILITY.test(text)) return null;
  const value = Number.parseFloat(text);
  if (Number.isNaN(value) || value < 0 || value > 1) return null;
  return value;
}

/** §6「`[易]` を除外して算出」の判定。標示の有無ではなく `p` で決める。標示漏れで抜け道を作らない。 */
export function isEasy(probability: number | null, hasEasyMarker: boolean): boolean {
  if (hasEasyMarker) return true;
  if (probability === null) return false;
  return probability >= 0.9 || probability <= 0.1;
}

/** 刻印を持つ行＝台帳に確定した行。拘束の対象。 */
export function isStamped(line: KongyoLine): boolean {
  return line.kind === "prediction" && line.stamp !== null;
}

/** 末尾記号を取り除いた本文。確定行の同一性はこれで見る（記号の置換は許されるため）。 */
export function bodyOf(text: string): string {
  const marker = findVerdict(text);
  const end = marker === null ? trimmedEnd(text) : marker.span.start;
  return normalizeWidth(text.slice(0, end)).trimEnd();
}

/** 末尾記号だけを取り出す。無ければ null。 */
export function markerOf(text: string): Verdict | null {
  return findVerdict(text)?.verdict ?? null;
}
