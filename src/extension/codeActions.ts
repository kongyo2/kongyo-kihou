import * as vscode from "vscode";

import { hasBlockingIssue, type IssueFix } from "../core/checks.ts";
import type { AnalyzedLine, Analyzer } from "./model.ts";

function editForFix(document: vscode.TextDocument, line: AnalyzedLine, fix: IssueFix): vscode.WorkspaceEdit | null {
  const edit = new vscode.WorkspaceEdit();
  switch (fix.kind) {
    case "replace":
      edit.replace(
        document.uri,
        new vscode.Range(line.lineNumber, fix.span.start, line.lineNumber, fix.span.end),
        fix.text,
      );
      return edit;
    case "split":
      edit.replace(document.uri, document.lineAt(line.lineNumber).range, fix.lines.join("\n"));
      return edit;
    case "command":
      return null;
    default:
      return null;
  }
}

export class KongyoCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite],
  };

  readonly #analyzer: Analyzer;

  constructor(analyzer: Analyzer) {
    this.#analyzer = analyzer;
  }

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction[] {
    const analyzed = this.#analyzer.analyze(document);
    const actions: vscode.CodeAction[] = [];

    for (let lineNumber = range.start.line; lineNumber <= range.end.line; lineNumber += 1) {
      const line = analyzed.byLine.get(lineNumber);
      if (line === undefined) continue;

      for (const issue of line.issues) {
        for (const fix of issue.fixes) {
          const action = new vscode.CodeAction(`${issue.ruleId}: ${fix.title}`, vscode.CodeActionKind.QuickFix);
          if (fix.kind === "command") {
            action.command = { command: fix.command, title: fix.title, arguments: [document.uri, lineNumber] };
          } else {
            const edit = editForFix(document, line, fix);
            if (edit === null) continue;
            action.edit = edit;
          }
          actions.push(action);
        }
      }

      if (line.parsed.kind === "prediction" && line.parsed.stamp === null) {
        if (!hasBlockingIssue(line.issues)) {
          const commit = new vscode.CodeAction("この行を確定して台帳へ追記する", vscode.CodeActionKind.QuickFix);
          commit.command = {
            command: "kongyo.commitLine",
            title: "確定",
            arguments: [document.uri, lineNumber],
          };
          commit.isPreferred = true;
          actions.push(commit);
        }
        const inventory = new vscode.CodeAction("未形式化在庫へ落とす", vscode.CodeActionKind.RefactorRewrite);
        inventory.command = {
          command: "kongyo.toInventory",
          title: "在庫へ",
          arguments: [document.uri, lineNumber],
        };
        actions.push(inventory);
      }
    }

    return actions;
  }
}
