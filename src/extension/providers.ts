import * as vscode from "vscode";

import { missingFields, probabilityOf } from "../core/checks.ts";
import { addDays, addMonths, daysUntil, formatDate, parseAbsoluteDate } from "../core/datetime.ts";
import {
  CANONICAL_FIELD_ORDER,
  COMPARISONS,
  type FieldKey,
  FIELD_META,
  PATTERN_IDS,
  PATTERNS,
} from "../core/patterns.ts";
import { fieldValue, isEasy, type PredictionLine } from "../core/parse.ts";
import { canonicalize, renderAffirmation, renderFalsification } from "../core/render.ts";
import { RULES } from "../core/rules.ts";
import type { ConfigStore } from "./config.ts";
import { type AnalyzedLine, type Analyzer, isRelevant } from "./model.ts";

export const PLACEHOLDER: Readonly<Record<FieldKey, string>> = {
  D: "",
  S: "対象（個体／集団／件数）",
  S1: "対象₁",
  S2: "対象₂",
  O: "観測量（判定時に読む値）",
  C: "条件（閾値または状態）",
  J: "判定者（外部の手順）",
  p: "0.50",
  R: "外れたら、〜を〜へ改訂",
  T: "事象（期日つき）",
  E: "起きないと言う事象",
  CMP: "以下",
};

function snippetFor(patternId: (typeof PATTERN_IDS)[number], nowMs: number): string {
  const spec = PATTERNS[patternId];
  const ordered = CANONICAL_FIELD_ORDER.filter((key) => spec.required.includes(key));
  const parts: string[] = [patternId];
  let index = 1;
  for (const key of ordered) {
    const fallback = key === "D" ? formatDate(addDays(new Date(nowMs), 30)) : PLACEHOLDER[key];
    parts.push(`${FIELD_META[key].token}=\${${String(index)}:${fallback}}`);
    index += 1;
  }
  return parts.join(" ");
}

/** カーソルがどの項の値の中にいるか。補完の文脈判定に使う。 */
function activeField(line: AnalyzedLine, character: number): FieldKey | null {
  if (line.parsed.kind !== "prediction") return null;
  let found: FieldKey | null = null;
  for (const field of line.parsed.fields) {
    if (field.keySpan.end < character || field.valueSpan.start <= character) found = field.key;
  }
  return found;
}

function distinctValues(analyzer: Analyzer, document: vscode.TextDocument, key: FieldKey): string[] {
  const seen = new Set<string>();
  for (const line of analyzer.analyze(document).lines) {
    if (line.parsed.kind !== "prediction") continue;
    const value = fieldValue(line.parsed, key);
    if (value.length > 0) seen.add(value);
  }
  return [...seen].reverse().slice(0, 25);
}

export class KongyoCompletionProvider implements vscode.CompletionItemProvider {
  readonly #analyzer: Analyzer;

  constructor(analyzer: Analyzer) {
    this.#analyzer = analyzer;
  }

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const analyzed = this.#analyzer.analyze(document);
    const line = analyzed.byLine.get(position.line);
    if (line === undefined) return [];
    const nowMs = Date.now();

    const key = activeField(line, position.character);
    if (key !== null) return this.#valueItems(document, key, nowMs);

    if (line.parsed.kind === "prediction" && line.parsed.pattern !== null) {
      // 型は既にある。残っている必須項だけを足せるようにする。
      return missingFields(line.parsed).map((missing) => {
        const item = new vscode.CompletionItem(`${FIELD_META[missing].token}=`, vscode.CompletionItemKind.Field);
        item.detail = `${FIELD_META[missing].label}：${FIELD_META[missing].description}`;
        item.insertText = new vscode.SnippetString(`${FIELD_META[missing].token}=\${1:${PLACEHOLDER[missing]}}`);
        item.sortText = `0${missing}`;
        return item;
      });
    }

    return PATTERN_IDS.map((id) => {
      const spec = PATTERNS[id];
      const item = new vscode.CompletionItem(`${id} ${spec.name}`, vscode.CompletionItemKind.Snippet);
      item.detail = spec.cheap ? `${spec.syntax}（最も安い）` : spec.syntax;
      item.documentation = new vscode.MarkdownString(
        `必須項：\`${spec.required.map((f) => FIELD_META[f].token).join(" ")}\``,
      );
      item.insertText = new vscode.SnippetString(snippetFor(id, nowMs));
      item.filterText = id;
      item.sortText = spec.cheap ? `0${id}` : `1${id}`;
      return item;
    });
  }

  #valueItems(document: vscode.TextDocument, key: FieldKey, nowMs: number): vscode.CompletionItem[] {
    const now = new Date(nowMs);
    if (key === "D") {
      const candidates: readonly [string, string][] = [
        [formatDate(addDays(now, 7)), "7日後"],
        [formatDate(addDays(now, 14)), "14日後"],
        [formatDate(addDays(now, 30)), "30日後"],
        [formatDate(addDays(now, 90)), "90日後"],
        [formatDate(addDays(addMonths(now, 1), -now.getDate())), "今月末"],
        [`${formatDate(addDays(now, 30))}T23:59`, "30日後の 23:59"],
      ];
      return candidates.map(([value, label], index) => {
        const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
        item.detail = label;
        item.sortText = String(index);
        return item;
      });
    }

    if (key === "p") {
      const values = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
      return values.map((value, index) => {
        const text = value.toFixed(2);
        const item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Value);
        item.detail = isEasy(value, false) ? "[易]（集計の主成分から除外される）" : "";
        item.sortText = String(index).padStart(2, "0");
        return item;
      });
    }

    if (key === "CMP") {
      return COMPARISONS.map((value) => new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember));
    }

    if (key === "R") {
      const templates = [
        "外れたら、見積もりを +2 日側へ改訂",
        "外れたら、この方式を第一候補から外す",
        "外れたら、原因の帰属先を「相性」から外す",
        "外れたら、閾値を 1 段引き下げ",
      ];
      return templates.map((value, index) => {
        const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Text);
        item.sortText = String(index);
        item.detail = "C7：具体的な書き換え対象を指すこと";
        return item;
      });
    }

    return distinctValues(this.#analyzer, document, key).map((value) => {
      const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Text);
      item.detail = "この文書で既に使った値";
      return item;
    });
  }
}

export class KongyoHoverProvider implements vscode.HoverProvider {
  readonly #analyzer: Analyzer;

  constructor(analyzer: Analyzer) {
    this.#analyzer = analyzer;
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
    const line = this.#analyzer.analyze(document).byLine.get(position.line);
    if (line === undefined || line.parsed.kind !== "prediction") return null;
    const parsed: PredictionLine = line.parsed;
    const at = position.character;
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;

    for (const field of parsed.fields) {
      if (at < field.keySpan.start || at > field.keySpan.end) continue;
      const meta = FIELD_META[field.key];
      md.appendMarkdown(`**${meta.token}** — ${meta.label}\n\n${meta.description}\n`);
      return new vscode.Hover(md);
    }

    if (parsed.patternSpan !== null && at >= parsed.patternSpan.start && at <= parsed.patternSpan.end) {
      const spec = PATTERNS[parsed.pattern ?? "P1"];
      md.appendMarkdown(`**${spec.id} ${spec.name}**\n\n${spec.syntax}\n\n`);
      md.appendMarkdown(`必須項：\`${spec.required.map((key) => FIELD_META[key].token).join(" ")}\`\n`);
      if (spec.cheap) md.appendMarkdown("\n最も安い型。閾値の議論が要らず、`J` の裁量が入りにくい。\n");
      return new vscode.Hover(md);
    }

    if (parsed.easySpan !== null && at >= parsed.easySpan.start && at <= parsed.easySpan.end) {
      md.appendMarkdown(`**[易]** — ${RULES.C8.text}\n`);
      return new vscode.Hover(md);
    }

    const falsification = renderFalsification(parsed);
    const affirmation = renderAffirmation(parsed);
    if (falsification === null || affirmation === null) {
      md.appendMarkdown("**C3 反証形が立っていない。** 必須項が揃っていないため、外れた世界を書けない。\n");
      const missing = missingFields(parsed);
      if (missing.length > 0) {
        md.appendMarkdown(`\n欠落：\`${missing.map((key) => FIELD_META[key].token).join(" ")}\`\n`);
      }
      return new vscode.Hover(md);
    }

    const probability = probabilityOf(parsed);
    md.appendMarkdown(`**当たる世界**\n\n${affirmation}\n\n`);
    md.appendMarkdown(`**外れる世界**\n\n${falsification}\n\n`);
    if (probability !== null) {
      md.appendMarkdown(
        `p = ${probability.toFixed(2)}${isEasy(probability, parsed.easySpan !== null) ? "（[易]：集計の主成分から除外）" : ""}\n\n`,
      );
    }
    const deadline = parseAbsoluteDate(fieldValue(parsed, "D"));
    if (deadline !== null) {
      const remaining = daysUntil(deadline.deadlineMs, Date.now());
      md.appendMarkdown(
        remaining >= 0 ? `判定まで あと ${String(remaining)} 日\n` : `期日を ${String(-remaining)} 日超過\n`,
      );
    }
    return new vscode.Hover(md);
  }
}

export class KongyoInlayHintsProvider implements vscode.InlayHintsProvider {
  readonly #analyzer: Analyzer;
  readonly #config: ConfigStore;

  constructor(analyzer: Analyzer, config: ConfigStore) {
    this.#analyzer = analyzer;
    this.#config = config;
  }

  provideInlayHints(document: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
    if (!this.#config.current.inlayHintsEnabled) return [];
    const analyzed = this.#analyzer.analyze(document);
    const hints: vscode.InlayHint[] = [];

    for (const line of analyzed.lines) {
      if (line.lineNumber < range.start.line || line.lineNumber > range.end.line) continue;
      if (line.parsed.kind !== "prediction" || line.parsed.stamp !== null) continue;
      const missing = missingFields(line.parsed);
      const labels: string[] = [];
      if (missing.length > 0) {
        labels.push(`欠落 ${missing.map((key) => FIELD_META[key].token).join("・")}`);
      }
      const probability = probabilityOf(line.parsed);
      if (probability !== null && isEasy(probability, false) && line.parsed.easySpan === null) {
        labels.push("易");
      }
      if (labels.length === 0) continue;
      const hint = new vscode.InlayHint(
        new vscode.Position(line.lineNumber, line.text.length),
        `  ⟨${labels.join(" / ")}⟩`,
      );
      hint.paddingLeft = true;
      hints.push(hint);
    }
    return hints;
  }
}

export class KongyoFormattingProvider implements vscode.DocumentFormattingEditProvider {
  readonly #analyzer: Analyzer;
  readonly #config: ConfigStore;

  constructor(analyzer: Analyzer, config: ConfigStore) {
    this.#analyzer = analyzer;
    this.#config = config;
  }

  provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
    if (!isRelevant(document, this.#config.current)) return [];
    const edits: vscode.TextEdit[] = [];
    for (const line of this.#analyzer.analyze(document).lines) {
      // 確定行は触らない。整形であっても書き換えは書き換えである。
      if (line.parsed.kind !== "prediction" || line.parsed.stamp !== null) continue;
      const formatted = canonicalize(line.text);
      if (formatted === line.text) continue;
      edits.push(vscode.TextEdit.replace(document.lineAt(line.lineNumber).range, formatted));
    }
    return edits;
  }
}
