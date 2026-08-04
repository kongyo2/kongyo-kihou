/**
 * §5 禁止語彙と、その周辺の語彙表。
 *
 * すべて「正規表現ソースの配列」で持つ。利用者が設定で足せるようにするためで、
 * 既定を消す道は用意しない。既定を消せる拘束は拘束ではない。
 */

import type { ExcuseKind } from "./rules.ts";

export interface VocabularyEntry {
  readonly id: string;
  /** 正規表現ソース（フラグなし）。 */
  readonly source: string;
  /** §5 の「代替」欄。何に鋳造するか。 */
  readonly replacement: string;
  /** 塞ぐ言い訳の型（§4）。 */
  readonly excuse: ExcuseKind;
  /** 機械的に置換できる文字列。無い（＝削除するしかない）場合は null。 */
  readonly fixText: string | null;
}

/** §5 の表。左を書いたら右に鋳造する。 */
export const BANNED_VOCABULARY: readonly VocabularyEntry[] = [
  {
    id: "hedge-adverb",
    source: "たぶん|多分|おそらく|恐らく|大方|まあ|一応",
    replacement: "`p` の数値",
    excuse: "幅寄せ",
    fixText: null,
  },
  {
    id: "essentialize",
    source: "基本的に|本質的に|根本的に|要するに|そもそも|原理的に",
    replacement: "削除（削除して成立しないなら却下）",
    excuse: "本質化",
    fixText: "",
  },
  {
    id: "degree",
    source:
      "ある程度|かなり|大きく|大幅に|相当に|やや|若干|概ね|おおむね|ほぼ|だいたい|大体|(?<![一二三四五六七八九十百千])十分|非常に|とても|すごく|極めて|多少|わりと|割と|それなりに",
    replacement: "閾値の数値",
    excuse: "幅寄せ",
    fixText: null,
  },
  {
    id: "direction",
    source:
      "うまくいく|上手くいく|うまく行く|良くなる|よくなる|改善する|向上する|悪化する|成功する|失敗する|問題ない|問題無い|安定する|スケールする|健全|順調",
    replacement: "観測量と方向",
    excuse: "定義ずらし",
    fixText: null,
  },
  {
    id: "opinion",
    source:
      "と思う|と思われる|な気がする|気がする|かもしれない|かも知れない|でしょう|だろう|はずだ|はずです|ように見える|印象では",
    replacement: "削除（`p` に吸収）",
    excuse: "幅寄せ",
    fixText: "",
  },
  {
    id: "escape-hatch",
    source:
      "状況次第|場合によって|状況によって|必要に応じて|適宜|できれば|なるべく|可能な限り|余裕があれば|原則として|基本は",
    replacement: "C6 に従い列挙、できないなら削除",
    excuse: "逃げ道",
    fixText: null,
  },
  {
    id: "soon",
    source: "まもなく|間もなく|近いうち|近日|近々|そのうち|いずれ|早めに|順次|追って|将来的に",
    replacement: "日付",
    excuse: "無期限",
    fixText: null,
  },
];

/** C7 に落ちる `R`。書き換え対象を指していない処置。 */
export const VAGUE_REMEDY: readonly VocabularyEntry[] = [
  {
    id: "remedy-attitude",
    source:
      "気をつける|気を付ける|注意する|意識する|反省|自戒|考え直す|善処|前向きに|しっかり|ちゃんと|きちんと|頑張る|がんばる|努力する|教訓|学ぶ|覚えておく|次に活かす|肝に銘",
    replacement: "書き換える対象と方向（例：見積もりを +2 日側へ改訂）",
    excuse: "本質化",
    fixText: null,
  },
  {
    id: "remedy-interpretation",
    source: "解釈を改める|見方を変える|捉え方|認識を改める|理解を深める|再考する",
    replacement: "書き換える対象と方向",
    excuse: "本質化",
    fixText: null,
  },
  {
    id: "remedy-vague-review",
    source: "(?<![をに])見直す|検討する|様子を見る|保留",
    replacement: "書き換える対象と方向",
    excuse: "本質化",
    fixText: null,
  },
];

/** 選言。§2「選言は文法に存在しない」。 */
export const DISJUNCTION_SOURCES: readonly string[] = [
  "または",
  "又は",
  "もしくは",
  "若しくは",
  "あるいは",
  "或いは",
  "どちらか",
  "いずれか",
  "\\bor\\b",
];

/** 連言。C4「`O` はただ一つ」。 */
export const CONJUNCTION_SOURCES: readonly string[] = [
  "かつ",
  "且つ",
  "および",
  "及び",
  "ならびに",
  "並びに",
  "と同時に",
  "\\s&\\s",
];

/** C6 の「ただし」節を開く語。 */
export const EXCEPTION_SOURCES: readonly string[] = [
  "ただし",
  "但し",
  "ただ、",
  "を除く",
  "を除き",
  "except",
  "例外的に",
];

/** C3 の近似：`C` に一つは含まれていなければならない、判定可能な閾値・状態。 */
export const DEFINITE_CONDITION_SOURCES: readonly string[] = [
  "\\d",
  "[<>≤≥=＝]",
  "以上",
  "以下",
  "未満",
  "超過",
  "を超え",
  "より大",
  "より小",
  "より多",
  "より少",
  "true",
  "false",
  "TRUE",
  "FALSE",
  "真",
  "偽",
  "有り",
  "無し",
  "あり",
  "なし",
  "存在する",
  "存在しない",
  "完了",
  "未完了",
  "成立",
  "不成立",
  "合格",
  "不合格",
  "通過",
  "未通過",
  "マージ",
  "クローズ",
  "オープン",
  "発生",
  "未発生",
  "公開",
  "非公開",
  "到達",
  "未到達",
  "空",
  "null",
];

/** C2：`J` が自分であることを示す語。 */
export const SELF_JUDGE_SOURCES: readonly string[] = [
  "自分",
  "自身",
  "自己",
  "私",
  "僕",
  "俺",
  "わたし",
  "ぼく",
  "おれ",
  "ワイ",
  "\\bself\\b",
  "\\bme\\b",
  "\\bmyself\\b",
];

/** C2：手順に裁量が入ることを示す語。`J` にこれがあれば、自分かどうかを問わず却下。 */
export const DISCRETION_SOURCES: readonly string[] = [
  "判断",
  "裁量",
  "主観",
  "感覚",
  "印象",
  "総合的",
  "適宜",
  "適切に",
  "見て決め",
  "納得",
  "手応え",
  "肌感",
  "所感",
  "思ったら",
  "気持ち",
  "空気",
  "雰囲気",
];

/** C2：固定された判定手順を示す語。`J` が自分でも、これがあれば通る。 */
export const PROCEDURE_SOURCES: readonly string[] = [
  "://",
  "API",
  "\\bapi\\b",
  "ログ",
  "\\blog\\b",
  "議事録",
  "スクリプト",
  "\\bscript\\b",
  "テスト",
  "\\btest\\b",
  "\\bCI\\b",
  "計測",
  "測定",
  "出力",
  "コマンド",
  "クエリ",
  "ダッシュボード",
  "明細",
  "請求",
  "記録",
  "カウンタ",
  "集計",
  "レポート",
  "監査",
  "検査",
  "センサ",
  "メータ",
  "タイマ",
  "カレンダー",
  "GitHub",
  "GitLab",
  "Jira",
  "Slack",
  "Notion",
  "スプレッドシート",
  "Excel",
  "CSV",
  "SQL",
  "\\bnpm\\b",
  "\\bgit\\b",
  "\\bcurl\\b",
  "第三者",
  "他者",
  "スコア",
  "成績",
  "手順[:：]",
  "\\.(?:sh|ps1|py|ts|js|json|csv|sql|md)\\b",
];

/** C7：具体的な書き換えを示す語。 */
export const REWRITE_VERB_SOURCES: readonly string[] = [
  "改訂",
  "改定",
  "修正",
  "変更",
  "差し替え",
  "置き換え",
  "置換",
  "格上げ",
  "格下げ",
  "昇格",
  "降格",
  "外す",
  "除外",
  "廃止",
  "破棄",
  "撤回",
  "採用",
  "中止",
  "停止",
  "削除",
  "追加",
  "移す",
  "移行",
  "切り替え",
  "切替",
  "引き上げ",
  "引き下げ",
  "上方修正",
  "下方修正",
  "第一候補",
  "候補から",
  "優先度",
  "閾値",
  "見積",
  "やめる",
  "止める",
  "取り下げ",
  "へ寄せ",
  "に寄せ",
  "[+＋]\\s?\\d",
  "[-−]\\s?\\d",
];
