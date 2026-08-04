/**
 * 文字列ユーティリティ。
 *
 * 解析側は「全角で書かれても読める」が「正規形は半角」という方針をとる。
 * 位置（span）は元テキストの索引で返す必要があるため、正規化は必ず長さを保存する。
 */

/** 行内の索引範囲。`end` は排他。 */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export function span(start: number, end: number): Span {
  return { start, end };
}

/**
 * 全角で書かれた「構文に使う文字」だけを半角へ写す。
 *
 * 全角 ASCII を一括で写さないのは、`（）` や `％` のような本文の記号まで書き換わると、
 * ホバーや反証文に出る値が、書いたものと違う姿になるため。
 * 写像はすべて 1 文字 → 1 文字なので、索引は元テキストとそのまま対応する。
 */
export function normalizeWidth(text: string): string {
  return text.replace(/[Ａ-Ｚａ-ｚ０-９＝－／．：＜＞［］＃　]/g, (ch) => {
    if (ch === "　") return " ";
    const mapped = WIDE_TO_ASCII[ch];
    if (mapped !== undefined) return mapped;
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
  });
}

const WIDE_TO_ASCII: Readonly<Record<string, string>> = {
  "＝": "=",
  "－": "-",
  "／": "/",
  "．": ".",
  "：": ":",
  "＜": "<",
  "＞": ">",
  "［": "[",
  "］": "]",
  "＃": "#",
};

/** 末尾の空白を落とした長さ（＝ trimEnd 後の排他終端）。 */
export function trimmedEnd(text: string): number {
  let end = text.length;
  while (end > 0) {
    const ch = text[end - 1];
    if (ch === undefined || !/\s/.test(ch)) break;
    end -= 1;
  }
  return end;
}

/** 先頭の空白を飛ばした索引。 */
export function trimmedStart(text: string): number {
  let start = 0;
  while (start < text.length) {
    const ch = text[start];
    if (ch === undefined || !/\s/.test(ch)) break;
    start += 1;
  }
  return start;
}

/**
 * 正規表現の全ての一致を、行内の索引つきで返す。
 * `re` は `g` フラグを持つこと。呼び出しごとに `lastIndex` を戻すので使い回して安全。
 */
export function findAll(re: RegExp, text: string): readonly Span[] {
  const found: Span[] = [];
  re.lastIndex = 0;
  let m = re.exec(text);
  while (m !== null) {
    found.push(span(m.index, m.index + m[0].length));
    if (m[0].length === 0) re.lastIndex += 1;
    m = re.exec(text);
  }
  re.lastIndex = 0;
  return found;
}

/** 複数の代替パターンを 1 本の `g` 付き正規表現に束ねる。空配列なら決して一致しないものを返す。 */
export function unionRegex(sources: readonly string[]): RegExp {
  if (sources.length === 0) return /(?!)/g;
  return new RegExp(sources.map((s) => `(?:${s})`).join("|"), "g");
}
