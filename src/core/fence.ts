/**
 * Markdown / プレーンテキスト中の ```kongyo フェンスの検出。
 *
 * TextMate の注入文法（kongyo.markdown-injection.json）と同じものを認識しなければならない。
 * 色は付くのに検査されないフェンスは、拘束の穴になる。ゆえに：
 * - `kongyo` と `kgy` の両方を、大文字小文字を問わず読む
 * - 閉じフェンスは開きと同じ文字で、同じ長さ以上（CommonMark と同じ）
 */

/** 検査対象の行範囲。`end` は排他。 */
export interface Region {
  readonly start: number;
  readonly end: number;
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*(?:kongyo|kgy)\b/i;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

interface OpenFence {
  /** フェンス本文の開始行（開き記号の次）。 */
  readonly bodyStart: number;
  readonly char: string;
  readonly length: number;
}

/**
 * kongyo フェンスの本文範囲を返す。閉じられていないフェンスは文書末尾まで。
 * 行の取得を関数で受けるのは、VS Code の TextDocument と素の配列の両方から使うため。
 */
export function kongyoFencedRegions(lineCount: number, lineAt: (index: number) => string): readonly Region[] {
  const regions: Region[] = [];
  let open: OpenFence | null = null;

  for (let i = 0; i < lineCount; i += 1) {
    const text = lineAt(i);
    if (open === null) {
      const m = FENCE_OPEN.exec(text);
      const fence = m?.[1];
      if (fence !== undefined) {
        open = { bodyStart: i + 1, char: fence[0] ?? "`", length: fence.length };
      }
      continue;
    }
    const m = FENCE_CLOSE.exec(text);
    const fence = m?.[1];
    if (fence !== undefined && fence[0] === open.char && fence.length >= open.length) {
      if (i > open.bodyStart) regions.push({ start: open.bodyStart, end: i });
      open = null;
    }
  }

  if (open !== null && open.bodyStart < lineCount) {
    regions.push({ start: open.bodyStart, end: lineCount });
  }
  return regions;
}
