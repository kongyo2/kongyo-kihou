import * as vscode from "vscode";

import { parseAbsoluteDate } from "../core/datetime.ts";
import { fieldValue } from "../core/parse.ts";
import type { ConfigStore } from "./config.ts";
import { type Analyzer, isRelevant, toRange } from "./model.ts";

/**
 * 診断の波線とは別に、視界に入るだけで効く印を置く。
 * 禁止語には打ち消し線、確定行には背景、期日が来た行には枠。読む前に分かるのが望ましい。
 */
export class DecorationController implements vscode.Disposable {
  readonly #banned = vscode.window.createTextEditorDecorationType({
    textDecoration: "line-through solid",
    opacity: "0.6",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });

  readonly #sealed = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("kongyo.sealedLineBackground"),
  });

  readonly #due = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    border: "1px solid",
    borderColor: new vscode.ThemeColor("kongyo.dueLineBorder"),
    overviewRulerColor: new vscode.ThemeColor("kongyo.dueLineBorder"),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });

  readonly #analyzer: Analyzer;
  readonly #config: ConfigStore;

  constructor(analyzer: Analyzer, config: ConfigStore) {
    this.#analyzer = analyzer;
    this.#config = config;
  }

  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) this.refresh(editor);
  }

  refresh(editor: vscode.TextEditor): void {
    const config = this.#config.current;
    if (!isRelevant(editor.document, config)) {
      editor.setDecorations(this.#banned, []);
      editor.setDecorations(this.#sealed, []);
      editor.setDecorations(this.#due, []);
      return;
    }

    const nowMs = Date.now();
    const analyzed = this.#analyzer.analyze(editor.document, nowMs);
    const banned: vscode.Range[] = [];
    const sealed: vscode.Range[] = [];
    const due: vscode.Range[] = [];

    for (const line of analyzed.lines) {
      if (config.decorationsEnabled) {
        for (const issue of line.issues) {
          if (issue.ruleId !== "G-VOCABULARY") continue;
          banned.push(toRange(line.lineNumber, issue.span.start, issue.span.end));
        }
      }
      if (line.parsed.kind !== "prediction" || line.parsed.stamp === null) continue;
      sealed.push(toRange(line.lineNumber, 0, line.text.length));
      if (line.parsed.verdict !== "pending") continue;
      const deadline = parseAbsoluteDate(fieldValue(line.parsed, "D"));
      if (deadline !== null && deadline.deadlineMs <= nowMs) {
        due.push(toRange(line.lineNumber, 0, line.text.length));
      }
    }

    editor.setDecorations(this.#banned, banned);
    editor.setDecorations(this.#sealed, sealed);
    editor.setDecorations(this.#due, due);
  }

  dispose(): void {
    this.#banned.dispose();
    this.#sealed.dispose();
    this.#due.dispose();
  }
}
