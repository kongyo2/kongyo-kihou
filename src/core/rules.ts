/**
 * 規則の台帳。診断メッセージとホバーは、すべてここを唯一の出典とする。
 *
 * 「§n」は kongyo記法 の節番号。規則本文を検査コードから分離しておくのは、
 * 文言が二か所に散らばると片方が腐るからで、腐った文言は規則ではなくなる。
 */

/** §4 の「事前の言い訳の型」。塞がる経路は八つ。 */
export const EXCUSE_KINDS = [
  "幅寄せ",
  "両張り",
  "無期限",
  "逃げ道",
  "自判",
  "定義ずらし",
  "本質化",
  "易問偏重",
] as const;
export type ExcuseKind = (typeof EXCUSE_KINDS)[number];

export const RULE_IDS = [
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
  "C7",
  "C8",
  "F-MISSING",
  "F-EMPTY",
  "F-UNKNOWN",
  "F-DUPLICATE",
  "G-TYPE",
  "G-DISJUNCTION",
  "G-VOCABULARY",
  "G-STRAY",
  "G-MARKER",
  "G-UNFORMALIZED",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export interface RuleDoc {
  readonly id: RuleId;
  readonly title: string;
  /** 規則の本文。原文の言い回しを保つ。 */
  readonly text: string;
  /** その規則が塞ぐ、事前の言い訳の型（§4）。塞がないものは null。 */
  readonly closes: ExcuseKind | null;
}

export const RULES: Readonly<Record<RuleId, RuleDoc>> = {
  C1: {
    id: "C1",
    title: "前後性",
    text: "記述時刻 < `D`。判定が返った後に書かれた文は予測ではない。不合格なら却下。",
    closes: null,
  },
  C2: {
    id: "C2",
    title: "外部判定",
    text: "`J` が自分の場合、判定手順を `J` 欄に固定し、その手順に裁量が入らないこと。不合格なら却下。",
    closes: "自判",
  },
  C3: {
    id: "C3",
    title: "反証形",
    text: "「この予測が外れた世界」を一文で書けること。書けないなら却下。",
    closes: "本質化",
  },
  C4: {
    id: "C4",
    title: "単一観測",
    text: "`O` はただ一つ。連言があるなら分割して複数行にする。",
    closes: "定義ずらし",
  },
  C5: {
    id: "C5",
    title: "数値確率",
    text: "`p` は数値のみ。0.00–1.00。語で幅を寄せることはできない。",
    closes: "幅寄せ",
  },
  C6: {
    id: "C6",
    title: "例外閉包",
    text: "「ただし」節は記述時にゼロ個または有限個。各節に判定可能な観測を持つ。事後追加は不可。",
    closes: "逃げ道",
  },
  C7: {
    id: "C7",
    title: "停止条件",
    text: "`R` が具体的な書き換え対象を指すこと。「解釈を改める」「気をつける」は不可。",
    closes: "本質化",
  },
  C8: {
    id: "C8",
    title: "難度標示",
    text: "`p ≥ 0.90` または `p ≤ 0.10` は `[易]` を付す。付さなくても集計の主成分からは除外される。",
    closes: "易問偏重",
  },
  "F-MISSING": {
    id: "F-MISSING",
    title: "必須項の欠落",
    text: "判定文は七項をすべて持つ。一つでも空なら、それは予測ではない。",
    closes: "無期限",
  },
  "F-EMPTY": {
    id: "F-EMPTY",
    title: "空の項",
    text: "項の記号だけがあって中身が無い。空は「書いた」に数えない。",
    closes: null,
  },
  "F-UNKNOWN": {
    id: "F-UNKNOWN",
    title: "未知の項",
    text: "この型の構文に存在しない項。§2 の五型のみ、複合は連言に限る。",
    closes: null,
  },
  "F-DUPLICATE": {
    id: "F-DUPLICATE",
    title: "項の重複",
    text: "同じ項が二度書かれている。どちらが読まれるかが決まらない文は、判定できない。",
    closes: null,
  },
  "G-TYPE": {
    id: "G-TYPE",
    title: "型の欠落",
    text: "五型（P1 期日 / P2 事象 / P3 継続 / P4 比較 / P5 不発）のいずれかを先頭に置く。",
    closes: null,
  },
  "G-DISJUNCTION": {
    id: "G-DISJUNCTION",
    title: "選言",
    text: "選言は文法に存在しない。「A または B になる」は非文であり、二行に分割して各々に `p` を振る。",
    closes: "両張り",
  },
  "G-VOCABULARY": {
    id: "G-VOCABULARY",
    title: "禁止語彙",
    text: "§5 の語は `O`・`C` の欄で使用不可。左を書いたら右に鋳造する。",
    closes: "幅寄せ",
  },
  "G-STRAY": {
    id: "G-STRAY",
    title: "帰属の無い語",
    text: "型と項のあいだに、どの項にも属さない語がある。一行は型と項の列であり、それ以外の語は確定でも整形でも保存されない。項の値に入れるか、削除する。",
    closes: null,
  },
  "G-MARKER": {
    id: "G-MARKER",
    title: "末尾記号",
    text: "確定行は `→`（未判定）で終わり、判定日に `○` `×` `－` へ置換される。追記ではなく置換なのはここだけ。",
    closes: null,
  },
  "G-UNFORMALIZED": {
    id: "G-UNFORMALIZED",
    title: "未形式化",
    text: "この行は記法を通っていない。捨てず、原文のまま `未形式化在庫` に落とす（§7）。",
    closes: null,
  },
};

/** §4 の対応表。言い訳の型 → 例 → 閉じる規則。ホバーと規則一覧で使う。 */
export interface ExcuseRow {
  readonly kind: ExcuseKind;
  readonly example: string;
  readonly closedBy: string;
}

export const EXCUSE_TABLE: readonly ExcuseRow[] = [
  { kind: "幅寄せ", example: "「たぶん通る」", closedBy: "C5" },
  { kind: "両張り", example: "「AかBになる」", closedBy: "文法（選言なし）" },
  { kind: "無期限", example: "「いずれそうなる」", closedBy: "必須項 D" },
  { kind: "逃げ道", example: "「ただし状況が変わらなければ」", closedBy: "C6" },
  { kind: "自判", example: "「うまくいったかは自分が判断する」", closedBy: "C2" },
  { kind: "定義ずらし", example: "「成功する」", closedBy: "C4 ＋ 操作的定義" },
  { kind: "本質化", example: "「本質的にそういう構造だ」", closedBy: "C3・C7" },
  { kind: "易問偏重", example: "当たる予測ばかり書く", closedBy: "C8" },
];
