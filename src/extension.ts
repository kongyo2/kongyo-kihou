import * as vscode from "vscode";

import { KongyoCodeActionProvider } from "./extension/codeActions.ts";
import { KongyoCodeLensProvider } from "./extension/codeLens.ts";
import { registerCommands } from "./extension/commands.ts";
import { ConfigStore } from "./extension/config.ts";
import { DecorationController } from "./extension/decorations.ts";
import { DiagnosticsController } from "./extension/diagnostics.ts";
import { LedgerGuard } from "./extension/guardController.ts";
import { LedgerStore } from "./extension/ledger.ts";
import { Analyzer, KONGYO_LANGUAGE } from "./extension/model.ts";
import { PendingView } from "./extension/pendingView.ts";
import {
  KongyoCompletionProvider,
  KongyoDocumentSymbolProvider,
  KongyoFormattingProvider,
  KongyoHoverProvider,
  KongyoInlayHintsProvider,
} from "./extension/providers.ts";
import { StatusBar } from "./extension/statusBar.ts";
import { ViewProvider, VIEW_SCHEME } from "./extension/views.ts";

/** kongyo の行が現れうる言語。Markdown / プレーンテキストは ```kongyo フェンスの中だけを見る。 */
const SELECTOR: vscode.DocumentSelector = [
  { language: KONGYO_LANGUAGE },
  { language: "markdown" },
  { language: "plaintext" },
];

const STATUS_DEBOUNCE_MS = 800;

function debounce(fn: () => void, delayMs: number): { run: () => void; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    run: () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** 判定待ちビューの表示条件。kongyo を使っていないワークスペースにビューを出さない。 */
async function updateActiveContext(ledger: LedgerStore): Promise<void> {
  let active = vscode.workspace.textDocuments.some((document) => document.languageId === KONGYO_LANGUAGE);
  if (!active) {
    try {
      await vscode.workspace.fs.stat(ledger.ledgerUri());
      active = true;
    } catch {
      active = false;
    }
  }
  await vscode.commands.executeCommand("setContext", "kongyo.active", active);
}

/** 起動時、判定期日が到来した予測があれば一度だけ知らせる（§9「週一で末尾記号を置換する」）。 */
async function notifyDueOnStartup(statusBar: StatusBar): Promise<void> {
  const snapshot = await statusBar.snapshot();
  if (snapshot.tally.due === 0) return;
  const choice = await vscode.window.showInformationMessage(
    `判定日が来た予測が ${String(snapshot.tally.due)} 件ある。判定は記号一つ、理由は書かない。`,
    "判定する",
  );
  if (choice === "判定する") await vscode.commands.executeCommand("kongyo.judge");
}

export function activate(context: vscode.ExtensionContext): void {
  const config = new ConfigStore();
  const analyzer = new Analyzer(config.current);
  const ledger = new LedgerStore(context, config);
  const guard = new LedgerGuard(config, ledger);
  const views = new ViewProvider();
  const statusBar = new StatusBar(ledger, config);
  const diagnostics = new DiagnosticsController(analyzer, config);
  const decorations = new DecorationController(analyzer, config);
  const codeLens = new KongyoCodeLensProvider(analyzer, config);
  const pending = new PendingView(ledger, statusBar);

  const refreshSoon = debounce(() => {
    void statusBar.refresh();
    pending.refresh();
  }, STATUS_DEBOUNCE_MS);

  context.subscriptions.push(
    config,
    analyzer,
    guard,
    views,
    statusBar,
    diagnostics,
    decorations,
    codeLens,
    pending,
    { dispose: refreshSoon.dispose },

    vscode.workspace.registerTextDocumentContentProvider(VIEW_SCHEME, views),

    vscode.languages.registerCodeActionsProvider(
      SELECTOR,
      new KongyoCodeActionProvider(analyzer),
      KongyoCodeActionProvider.metadata,
    ),
    vscode.languages.registerCodeLensProvider(SELECTOR, codeLens),
    vscode.languages.registerHoverProvider(SELECTOR, new KongyoHoverProvider(analyzer)),
    vscode.languages.registerInlayHintsProvider(SELECTOR, new KongyoInlayHintsProvider(analyzer, config)),
    vscode.languages.registerCompletionItemProvider(SELECTOR, new KongyoCompletionProvider(analyzer), "=", " ", "P"),
    // 整形とアウトラインは .kongyo のみ。Markdown の機能を横取りしない。
    vscode.languages.registerDocumentFormattingEditProvider(
      { language: KONGYO_LANGUAGE },
      new KongyoFormattingProvider(analyzer, config),
    ),
    vscode.languages.registerDocumentSymbolProvider(
      { language: KONGYO_LANGUAGE },
      new KongyoDocumentSymbolProvider(analyzer),
    ),

    ...registerCommands({ analyzer, config, ledger, guard, statusBar, views, pending }),

    config.onDidChange((next) => {
      analyzer.setConfig(next);
      diagnostics.refreshAll();
      decorations.refreshAll();
      codeLens.refresh();
      refreshSoon.run();
      void updateActiveContext(ledger);
    }),
    diagnostics.onDidRefresh((document) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === document.uri.toString()) decorations.refresh(editor);
      }
      refreshSoon.run();
    }),
    guard.onDidRecord(() => {
      codeLens.refresh();
      refreshSoon.run();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor !== undefined) decorations.refresh(editor);
      refreshSoon.run();
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => decorations.refreshAll()),
    vscode.workspace.onDidSaveTextDocument(() => {
      codeLens.refresh();
      refreshSoon.run();
      void updateActiveContext(ledger);
    }),
    vscode.workspace.onDidOpenTextDocument(() => void updateActiveContext(ledger)),
    vscode.workspace.onDidCloseTextDocument(() => void updateActiveContext(ledger)),
  );

  decorations.refreshAll();
  void statusBar.refresh();
  pending.refresh();
  void updateActiveContext(ledger);
  if (config.current.notifyDue) {
    void notifyDueOnStartup(statusBar).catch(() => {
      // 台帳がまだ無いだけなら、知らせることも無い。
    });
  }
}

export function deactivate(): void {
  // 後始末は context.subscriptions が持っている。
}
