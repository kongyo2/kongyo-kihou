/**
 * コマンド群が共有する依存の束と、行を狙う小さな道具。
 *
 * commands.ts と wizard.ts の両方から使う。片方に置くと輪になる。
 */

import * as vscode from "vscode";

import type { ConfigStore } from "./config.ts";
import type { LedgerGuard } from "./guardController.ts";
import type { LedgerStore } from "./ledger.ts";
import type { Analyzer } from "./model.ts";
import type { PendingView } from "./pendingView.ts";
import type { StatusBar } from "./statusBar.ts";
import type { ViewProvider } from "./views.ts";

export interface CommandDeps {
  readonly analyzer: Analyzer;
  readonly config: ConfigStore;
  readonly ledger: LedgerStore;
  readonly guard: LedgerGuard;
  readonly statusBar: StatusBar;
  readonly views: ViewProvider;
  readonly pending: PendingView;
}

export interface LineTarget {
  readonly document: vscode.TextDocument;
  readonly editor: vscode.TextEditor | null;
  readonly lineNumber: number;
}

export async function resolveTarget(uri?: vscode.Uri, lineNumber?: number): Promise<LineTarget | null> {
  if (uri !== undefined) {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor =
      vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === uri.toString()) ??
      null;
    const line = lineNumber ?? editor?.selection.active.line ?? 0;
    return { document, editor, lineNumber: Math.min(line, Math.max(0, document.lineCount - 1)) };
  }
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) return null;
  return {
    document: editor.document,
    editor,
    lineNumber: lineNumber ?? editor.selection.active.line,
  };
}

export async function replaceLine(document: vscode.TextDocument, lineNumber: number, text: string): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, document.lineAt(lineNumber).range, text);
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) await document.save();
  return applied;
}

export async function showMarkdown(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  } catch {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: true });
  }
}

export async function revealLine(document: vscode.TextDocument, lineNumber: number): Promise<void> {
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const at = new vscode.Position(Math.min(lineNumber, Math.max(0, document.lineCount - 1)), 0);
  editor.selection = new vscode.Selection(at, at);
  editor.revealRange(new vscode.Range(at, at));
}
