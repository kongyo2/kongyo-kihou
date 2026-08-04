import * as vscode from "vscode";

import { hasBlockingIssue } from "../core/checks.ts";
import { parseAbsoluteDate, daysUntil } from "../core/datetime.ts";
import { fieldValue } from "../core/parse.ts";
import type { ConfigStore } from "./config.ts";
import type { Analyzer } from "./model.ts";

/**
 * 行の上に、いま押せる手だけを出す。
 * 未確定なら「確定」、期日が来ていれば「○ × －」、記法を通っていなければ「鋳造／在庫」。
 */
export class KongyoCodeLensProvider implements vscode.CodeLensProvider {
  readonly #analyzer: Analyzer;
  readonly #config: ConfigStore;
  readonly #emitter = new vscode.EventEmitter<void>();

  constructor(analyzer: Analyzer, config: ConfigStore) {
    this.#analyzer = analyzer;
    this.#config = config;
  }

  get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.#emitter.event;
  }

  refresh(): void {
    this.#emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.#config.current.codeLensEnabled) return [];
    const nowMs = Date.now();
    const analyzed = this.#analyzer.analyze(document, nowMs);
    const lenses: vscode.CodeLens[] = [];

    for (const line of analyzed.lines) {
      const range = new vscode.Range(line.lineNumber, 0, line.lineNumber, 0);
      const args: [vscode.Uri, number] = [document.uri, line.lineNumber];

      if (line.parsed.kind === "unformalized") {
        lenses.push(
          new vscode.CodeLens(range, { title: "$(law) 鋳造する", command: "kongyo.cast", arguments: args }),
          new vscode.CodeLens(range, {
            title: "$(archive) 在庫へ落とす",
            command: "kongyo.toInventory",
            arguments: args,
          }),
        );
        continue;
      }

      if (line.parsed.kind !== "prediction") continue;

      if (line.parsed.stamp === null) {
        const blocked = hasBlockingIssue(line.issues);
        const errors = line.issues.filter((issue) => issue.severity === "error").length;
        lenses.push(
          new vscode.CodeLens(
            range,
            blocked
              ? { title: `$(error) ${String(errors)} 件の却下`, command: "" }
              : { title: "$(check-all) 確定して台帳へ", command: "kongyo.commitLine", arguments: args },
          ),
        );
        continue;
      }

      if (line.parsed.verdict !== "pending") continue;
      const deadline = parseAbsoluteDate(fieldValue(line.parsed, "D"));
      if (deadline === null) continue;
      const remaining = daysUntil(deadline.deadlineMs, nowMs);
      if (deadline.deadlineMs > nowMs) {
        lenses.push(new vscode.CodeLens(range, { title: `$(watch) あと ${String(remaining)} 日`, command: "" }));
        continue;
      }
      for (const [marker, label] of [
        ["○", "○ 当たり"],
        ["×", "× 外れ"],
        ["－", "－ 判定不能"],
      ] as const) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: label,
            command: "kongyo.judgeLine",
            arguments: [document.uri, line.lineNumber, marker],
          }),
        );
      }
    }
    return lenses;
  }

  dispose(): void {
    this.#emitter.dispose();
  }
}
