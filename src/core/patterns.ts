/** §1（必須項）と §2（パターン）の定義。 */

export const FIELD_KEYS = ["D", "S", "S1", "S2", "O", "C", "J", "p", "R", "T", "E", "CMP"] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export interface FieldMeta {
  readonly key: FieldKey;
  /** 正規形として書き出すときの記号。 */
  readonly token: string;
  readonly label: string;
  /** §1 の「内容」欄。 */
  readonly description: string;
}

export const FIELD_META: Readonly<Record<FieldKey, FieldMeta>> = {
  D: { key: "D", token: "D", label: "期日", description: "判定が返る日時。相対表現不可" },
  S: {
    key: "S",
    token: "S",
    label: "対象",
    description: "何について言うか。集計の水準を明示（個体／集団／件数）",
  },
  S1: { key: "S1", token: "S₁", label: "対象₁", description: "比較の左辺。集計の水準を明示" },
  S2: { key: "S2", token: "S₂", label: "対象₂", description: "比較の右辺。値でも対象でもよい" },
  O: { key: "O", token: "O", label: "観測量", description: "判定時に読む値。操作的定義であること" },
  C: { key: "C", token: "C", label: "条件", description: "`O` が満たすべき閾値または状態" },
  J: { key: "J", token: "J", label: "判定者", description: "`O` を読む主体または手続き" },
  p: { key: "p", token: "p", label: "確率", description: "0.00–1.00 の数値" },
  R: { key: "R", token: "R", label: "処置", description: "外れたときに何を書き換えるか" },
  T: { key: "T", token: "T", label: "事象", description: "引き金となる事象。期日を付すこと" },
  E: { key: "E", token: "E", label: "不発事象", description: "起きないと主張する事象" },
  CMP: { key: "CMP", token: "比較", label: "比較", description: "大 ／ 小 ／ 以上 ／ 以下" },
};

export const PATTERN_IDS = ["P1", "P2", "P3", "P4", "P5"] as const;
export type PatternId = (typeof PATTERN_IDS)[number];

export interface PatternSpec {
  readonly id: PatternId;
  readonly name: string;
  /** §2 の構文欄。 */
  readonly syntax: string;
  readonly required: readonly FieldKey[];
  readonly optional: readonly FieldKey[];
  /** §2「P4 と P5 は最も安い」。 */
  readonly cheap: boolean;
}

export const PATTERNS: Readonly<Record<PatternId, PatternSpec>> = {
  P1: {
    id: "P1",
    name: "期日型",
    syntax: "`D` までに、`S` の `O` が `C` になる",
    required: ["D", "S", "O", "C", "J", "p", "R"],
    optional: [],
    cheap: false,
  },
  P2: {
    id: "P2",
    name: "事象型",
    syntax: "`T` が起きたとき、`S` の `O` が `C` になる（`T` に期日を付す）",
    required: ["T", "D", "S", "O", "C", "J", "p", "R"],
    optional: [],
    cheap: false,
  },
  P3: {
    id: "P3",
    name: "継続型",
    syntax: "`D` まで、`S` の `O` は `C` を保つ",
    required: ["D", "S", "O", "C", "J", "p", "R"],
    optional: [],
    cheap: false,
  },
  P4: {
    id: "P4",
    name: "比較型",
    syntax: "`D` 時点で、`S₁` の `O` は `S₂` より大／小",
    required: ["D", "S1", "S2", "O", "CMP", "J", "p", "R"],
    optional: ["S"],
    cheap: true,
  },
  P5: {
    id: "P5",
    name: "不発型",
    syntax: "`D` までに、`E` は起きない",
    required: ["D", "E", "J", "p", "R"],
    optional: ["S", "O", "C"],
    cheap: true,
  },
};

/** 書き出すときの項の順序。§6 のシリアライズ例に合わせる。 */
export const CANONICAL_FIELD_ORDER: readonly FieldKey[] = [
  "p",
  "D",
  "T",
  "S",
  "S1",
  "S2",
  "E",
  "O",
  "CMP",
  "C",
  "J",
  "R",
];

/** `比較` に書ける値。閾値の議論を持ち込ませないため、閉じた集合にする。 */
export const COMPARISONS = ["大", "小", "以上", "以下"] as const;
export type Comparison = (typeof COMPARISONS)[number];

/** 反証文を作るときに向きを反転させる。 */
export const COMPARISON_NEGATION: Readonly<Record<Comparison, string>> = {
  大: "大きくない",
  小: "小さくない",
  以上: "未満",
  以下: "超過",
};

export function isComparison(value: string): value is Comparison {
  return (COMPARISONS as readonly string[]).includes(value);
}

export function isPatternId(value: string): value is PatternId {
  return (PATTERN_IDS as readonly string[]).includes(value);
}
