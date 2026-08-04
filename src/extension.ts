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
import {
  KongyoCompletionProvider,
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

  const refreshStatus = debounce(() => {
    void statusBar.refresh();
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
    { dispose: refreshStatus.dispose },

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
    // 整形は .kongyo のみ。Markdown の整形を横取りしない。
    vscode.languages.registerDocumentFormattingEditProvider(
      { language: KONGYO_LANGUAGE },
      new KongyoFormattingProvider(analyzer, config),
    ),

    ...registerCommands({ analyzer, config, ledger, guard, statusBar, views }),

    config.onDidChange((next) => {
      analyzer.setConfig(next);
      diagnostics.refreshAll();
      decorations.refreshAll();
      codeLens.refresh();
      refreshStatus.run();
    }),
    diagnostics.onDidRefresh((document) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === document.uri.toString()) decorations.refresh(editor);
      }
      refreshStatus.run();
    }),
    guard.onDidRecord(() => {
      codeLens.refresh();
      refreshStatus.run();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor !== undefined) decorations.refresh(editor);
      refreshStatus.run();
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => decorations.refreshAll()),
    vscode.workspace.onDidSaveTextDocument(() => {
      codeLens.refresh();
      refreshStatus.run();
    }),
  );

  decorations.refreshAll();
  void statusBar.refresh();
}

export function deactivate(): void {
  // 後始末は context.subscriptions が持っている。
}
