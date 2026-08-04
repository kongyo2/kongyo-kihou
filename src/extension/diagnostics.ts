import * as vscode from "vscode";

import type { Issue, Severity } from "../core/checks.ts";
import { RULES } from "../core/rules.ts";
import type { ConfigStore } from "./config.ts";
import { type Analyzer, isRelevant, KONGYO_LANGUAGE, toRange } from "./model.ts";
import { RULES_URI } from "./views.ts";

const SEVERITY: Readonly<Record<Severity, vscode.DiagnosticSeverity>> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

/** 期日到来を放置しないための再検査。日付が変わっても診断が古いままにならない。 */
const REFRESH_INTERVAL_MS = 300_000;

const WATCHED_LANGUAGES = new Set([KONGYO_LANGUAGE, "markdown", "plaintext"]);

function toDiagnostic(lineNumber: number, issue: Issue): vscode.Diagnostic {
  const doc = RULES[issue.ruleId];
  const message = issue.excuse === null ? issue.message : `${issue.message}（塞ぐ言い訳：${issue.excuse}）`;
  const diagnostic = new vscode.Diagnostic(
    toRange(lineNumber, issue.span.start, Math.max(issue.span.start + 1, issue.span.end)),
    message,
    SEVERITY[issue.severity],
  );
  diagnostic.source = "kongyo";
  diagnostic.code = { value: `${doc.id} ${doc.title}`, target: RULES_URI };
  return diagnostic;
}

export class DiagnosticsController implements vscode.Disposable {
  readonly #collection = vscode.languages.createDiagnosticCollection("kongyo");
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #subscriptions: vscode.Disposable[] = [];
  readonly #analyzer: Analyzer;
  readonly #config: ConfigStore;
  readonly #interval: ReturnType<typeof setInterval>;
  readonly #onDidRefresh = new vscode.EventEmitter<vscode.TextDocument>();

  constructor(analyzer: Analyzer, config: ConfigStore) {
    this.#analyzer = analyzer;
    this.#config = config;

    this.#subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => this.schedule(document, 0)),
      vscode.workspace.onDidChangeTextDocument((event) => this.schedule(event.document, this.#config.current.delayMs)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.#collection.delete(document.uri);
        this.#cancel(document.uri.toString());
      }),
      config.onDidChange(() => this.refreshAll()),
    );

    this.#interval = setInterval(() => this.refreshAll(), REFRESH_INTERVAL_MS);
    this.refreshAll();
  }

  get onDidRefresh(): vscode.Event<vscode.TextDocument> {
    return this.#onDidRefresh.event;
  }

  refreshAll(): void {
    for (const document of vscode.workspace.textDocuments) this.refresh(document);
  }

  schedule(document: vscode.TextDocument, delayMs: number): void {
    // 打鍵はどの文書でも飛んでくる。関係のない言語はここで落とす。
    if (!WATCHED_LANGUAGES.has(document.languageId)) return;
    const key = document.uri.toString();
    this.#cancel(key);
    if (delayMs === 0) {
      this.refresh(document);
      return;
    }
    this.#timers.set(
      key,
      setTimeout(() => {
        this.#timers.delete(key);
        this.refresh(document);
      }, delayMs),
    );
  }

  refresh(document: vscode.TextDocument): void {
    if (!isRelevant(document, this.#config.current)) {
      this.#collection.delete(document.uri);
      return;
    }
    const analyzed = this.#analyzer.analyze(document);
    const diagnostics: vscode.Diagnostic[] = [];
    for (const line of analyzed.lines) {
      for (const issue of line.issues) diagnostics.push(toDiagnostic(line.lineNumber, issue));
    }
    this.#collection.set(document.uri, diagnostics);
    this.#onDidRefresh.fire(document);
  }

  #cancel(key: string): void {
    const timer = this.#timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(key);
    }
  }

  dispose(): void {
    clearInterval(this.#interval);
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    for (const item of this.#subscriptions) item.dispose();
    this.#collection.dispose();
    this.#onDidRefresh.dispose();
  }
}
