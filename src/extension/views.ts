import * as vscode from "vscode";

import { type FieldKey, FIELD_META, PATTERN_IDS, PATTERNS } from "../core/patterns.ts";
import { EXCUSE_TABLE, RULE_IDS, RULES } from "../core/rules.ts";
import type { Tally } from "../core/scoring.ts";
import { BANNED_VOCABULARY, VAGUE_REMEDY } from "../core/vocabulary.ts";

/** §1 の七項。規則ビューの主表はこの順で出す。 */
const CORE_FIELDS: readonly FieldKey[] = ["D", "S", "O", "C", "J", "p", "R"];
/** P2 / P4 / P5 が使う追加の項。 */
const EXTRA_FIELDS: readonly FieldKey[] = ["T", "E", "S1", "S2", "CMP"];

export const VIEW_SCHEME = "kongyo-view";

export const RULES_URI: vscode.Uri = vscode.Uri.from({
  scheme: VIEW_SCHEME,
  path: "/kongyo記法の規則.md",
});
export const TALLY_URI: vscode.Uri = vscode.Uri.from({
  scheme: VIEW_SCHEME,
  path: "/kongyo集計.md",
});

function renderRules(): string {
  const lines: string[] = [];
  lines.push("# kongyo記法");
  lines.push("");
  lines.push("事前の言い訳を構文で落とすための記法。");
  lines.push("");
  lines.push("**目的**：書いた瞬間に、判定不能な文を落とす。");
  lines.push("");
  lines.push("**非目的**：当てること。反省すること。事後の態度を規定すること。");
  lines.push("");
  lines.push(
    "本記法は事前だけを縛る。事後に要求するのは記号一つ（○/×/－）の記入のみで、外れた理由の説明、更新、後悔、いずれも要求しない。",
  );
  lines.push("");

  lines.push("## 1　必須項");
  lines.push("");
  lines.push("判定文は七項をすべて持つ。一つでも空なら、それは予測ではない。");
  lines.push("");
  lines.push("| 記号 | 項 | 内容 |");
  lines.push("|---|---|---|");
  for (const key of CORE_FIELDS) {
    const meta = FIELD_META[key];
    lines.push(`| \`${meta.token}\` | ${meta.label} | ${meta.description} |`);
  }
  lines.push("");
  lines.push("P2 / P4 / P5 の型が使う追加の項：");
  lines.push("");
  for (const key of EXTRA_FIELDS) {
    const meta = FIELD_META[key];
    lines.push(`- \`${meta.token}\`（${meta.label}）：${meta.description}`);
  }
  lines.push("");

  lines.push("## 2　パターン");
  lines.push("");
  lines.push("五型のみ。複合は連言に限る。**選言は文法に存在しない。**");
  lines.push("");
  lines.push("| 型 | 名 | 構文 | 必須項 |");
  lines.push("|---|---|---|---|");
  for (const id of PATTERN_IDS) {
    const spec = PATTERNS[id];
    const required = spec.required.map((key) => FIELD_META[key].token).join(" ");
    lines.push(`| **${id}**${spec.cheap ? "（安い）" : ""} | ${spec.name} | ${spec.syntax} | \`${required}\` |`);
  }
  lines.push("");
  lines.push("P4 と P5 は最も安い。閾値の議論が要らず、`J` の裁量が入りにくい。");
  lines.push("");

  lines.push("## 3　静的検査（書いた時点で走る）");
  lines.push("");
  lines.push("| 規則 | 内容 |");
  lines.push("|---|---|");
  for (const id of RULE_IDS) {
    const rule = RULES[id];
    lines.push(`| **${rule.id}** ${rule.title} | ${rule.text} |`);
  }
  lines.push("");

  lines.push("## 4　事前の言い訳と、それを閉じる規則");
  lines.push("");
  lines.push("| 言い訳の型 | 例 | 閉じる規則 |");
  lines.push("|---|---|---|");
  for (const row of EXCUSE_TABLE) {
    lines.push(`| ${row.kind} | ${row.example} | ${row.closedBy} |`);
  }
  lines.push("");
  lines.push("八つの経路が塞がる。塞がらないのは事後の語りだけで、それは設計上、放置する。");
  lines.push("");

  lines.push("## 5　禁止語彙");
  lines.push("");
  lines.push("`O`・`C` の欄で使用不可。左を書いたら右に鋳造する。");
  lines.push("");
  lines.push("| 禁止 | 代替 | 言い訳の型 |");
  lines.push("|---|---|---|");
  for (const entry of BANNED_VOCABULARY) {
    lines.push(`| ${entry.source.split("|").join("・")} | ${entry.replacement} | ${entry.excuse} |`);
  }
  lines.push("");
  lines.push("`R`（処置）で使えない語：");
  lines.push("");
  for (const entry of VAGUE_REMEDY) {
    lines.push(`- ${entry.source.split("|").join("・")} → ${entry.replacement}`);
  }
  lines.push("");

  lines.push("## 6　シリアライズ形式");
  lines.push("");
  lines.push("一行一予測。追記のみ。編集不可。");
  lines.push("");
  lines.push("```kongyo");
  lines.push("[2026-08-04] P1 p=0.35 D=2026-09-30 S=<対象> O=<観測量> C=<条件> J=<判定者> R=<処置>  →");
  lines.push("```");
  lines.push("");
  lines.push("末尾の `→` を、判定日に `○` `×` `－`（判定不能）へ置換する。追記ではなく置換なのはここだけ。");
  lines.push("");
  lines.push("**集計するのは三つ。**");
  lines.push("");
  lines.push("- `×` の絶対数");
  lines.push("- `－` の絶対数（＝射程を書き損ねた率）");
  lines.push("- ブライアスコア `Σ(p − o)² / n`、`[易]` を除外して算出");
  lines.push("");
  lines.push("`○` の数は集計しない。集計した瞬間、当たりやすい予測ばかりが選抜される。");
  lines.push("");

  lines.push("## 7　健全性と不完全性");
  lines.push("");
  lines.push("- **健全**：この記法を通った文は判定可能である。");
  lines.push("- **不完全**：判定可能な思考のすべてがこの記法を通るわけではない。");
  lines.push("");
  lines.push(
    "通らなかったものは捨てず、`未形式化在庫` に原文のまま落とす。在庫の増加率は、自分の中で終わらない文がどれだけ走っているかの実測値になる。在庫を減らすことは目標ではない。",
  );
  lines.push("");

  lines.push("## 8　運用の最小形");
  lines.push("");
  lines.push("1. 判定が数日〜数月で返る場面（送信前・開始前・会う前）でのみ発火");
  lines.push("2. 一行書く。書けなければ在庫へ落とす");
  lines.push("3. 週一で末尾記号を置換する。理由は書かない");
  lines.push("4. 月一で `×` `－` の数とブライアスコアを見る");
  lines.push("");
  lines.push("以上。事後に何を思うかは、この記法の管轄外である。");
  lines.push("");

  return lines.join("\n");
}

export interface TallyContext {
  readonly source: string;
  readonly inventoryTotal: number;
  readonly inventoryLast30Days: number;
  /** 期日が到来した未判定の行。§9「週一で末尾記号を置換する」の対象。 */
  readonly due: readonly { readonly lineNumber: number; readonly text: string }[];
}

const DUE_LIST_LIMIT = 20;

export function renderTallyMarkdown(tally: Tally, context: TallyContext): string {
  const lines: string[] = [];
  const brier = tally.brier === null ? "—" : tally.brier.toFixed(4);

  lines.push("# kongyo 集計");
  lines.push("");
  lines.push(`対象：\`${context.source}\``);
  lines.push("");
  lines.push("## 集計する三つ（§6）");
  lines.push("");
  lines.push("| 指標 | 値 |");
  lines.push("|---|---|");
  lines.push(`| \`×\` の絶対数 | **${String(tally.miss)}** |`);
  lines.push(`| \`－\` の絶対数（射程を書き損ねた数） | **${String(tally.undecidable)}** |`);
  lines.push(`| ブライアスコア Σ(p − o)² / n | **${brier}** （n=${String(tally.brierCount)}） |`);
  lines.push("");
  lines.push("> `○` の数は集計しない。集計した瞬間、当たりやすい予測ばかりが選抜される。");
  lines.push("");

  lines.push("## 母数");
  lines.push("");
  lines.push("| 項目 | 件数 |");
  lines.push("|---|---|");
  lines.push(`| 確定した予測 | ${String(tally.sealed)} |`);
  lines.push(`| 未判定（\`→\`） | ${String(tally.pending)} |`);
  lines.push(`| うち期日到来 | ${String(tally.due)} |`);
  lines.push(`| \`[易]\` として除外 | ${String(tally.easyExcluded)} |`);
  lines.push(`| \`p\` を読めず除外 | ${String(tally.unscorable)} |`);
  lines.push("");

  if (context.due.length > 0) {
    lines.push("## 判定待ち（期日到来）");
    lines.push("");
    lines.push("末尾の `→` を `○` `×` `－` へ置換する。理由は書かない（§9）。");
    lines.push("");
    for (const entry of context.due.slice(0, DUE_LIST_LIMIT)) {
      lines.push(`- 行 ${String(entry.lineNumber)}：\`${entry.text}\``);
    }
    if (context.due.length > DUE_LIST_LIMIT) {
      lines.push(`- …他 ${String(context.due.length - DUE_LIST_LIMIT)} 件`);
    }
    lines.push("");
  }

  lines.push("## 破った回数（§3「破ったこと自体は罰しない。破った回数を数える欄を持つだけでよい」）");
  lines.push("");
  lines.push("| 記録 | 回数 |");
  lines.push("|---|---|");
  lines.push(`| 拘束の一時解除 | ${String(tally.notes.解除)} |`);
  lines.push(`| C6 事後追加 | ${String(tally.notes.C6事後追加)} |`);
  lines.push(`| 判定の書き換え | ${String(tally.notes.判定書換)} |`);
  lines.push("");

  lines.push("## 未形式化在庫（§7）");
  lines.push("");
  lines.push(`- 総数：${String(context.inventoryTotal)}`);
  lines.push(`- 直近 30 日：${String(context.inventoryLast30Days)}`);
  lines.push("");
  lines.push("在庫の増加率は、自分の中で終わらない文がどれだけ走っているかの実測値になる。減らすことは目標ではない。");
  lines.push("");

  return lines.join("\n");
}

export class ViewProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  readonly #emitter = new vscode.EventEmitter<vscode.Uri>();
  #tally = "# kongyo 集計\n\n（まだ集計していない）\n";

  get onDidChange(): vscode.Event<vscode.Uri> {
    return this.#emitter.event;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    if (uri.path === TALLY_URI.path) return this.#tally;
    return renderRules();
  }

  setTally(markdown: string): void {
    this.#tally = markdown;
    this.#emitter.fire(TALLY_URI);
  }

  dispose(): void {
    this.#emitter.dispose();
  }
}
