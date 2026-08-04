/**
 * 実行の検査。`tsc` が通ることは、束ねた JS が読み込めることを意味しない。
 *
 * 拡張ホストの代わりに最小の `vscode` を差し込み、`dist/extension.js` を CommonJS として
 * 実際に require し、`activate` を呼んで登録が走り切ることまで見る。
 * バンドラの解決とランタイムの解決がずれていれば、ここで落ちる。
 */

import Module from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

type AnyFn = (...args: readonly unknown[]) => unknown;

const noop = (): undefined => undefined;
const disposable = { dispose: noop };
const asDisposable = (): typeof disposable => disposable;

class Uri {
  scheme: string;
  authority = "";
  path: string;
  query = "";
  fragment = "";
  constructor(scheme: string, path: string) {
    this.scheme = scheme;
    this.path = path;
  }
  get fsPath(): string {
    return this.path;
  }
  static from(parts: { scheme: string; path?: string }): Uri {
    return new Uri(parts.scheme, parts.path ?? "");
  }
  static parse(value: string): Uri {
    const index = value.indexOf(":");
    return new Uri(value.slice(0, index), value.slice(index + 1));
  }
  static file(path: string): Uri {
    return new Uri("file", path.replace(/\\/g, "/"));
  }
  static joinPath(base: Uri, ...segments: readonly string[]): Uri {
    return new Uri(base.scheme, [base.path, ...segments].join("/"));
  }
  toString(): string {
    return `${this.scheme}:${this.path}`;
  }
}

class Position {
  line: number;
  character: number;
  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  start: Position;
  end: Position;
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    if (typeof a === "number" && typeof b === "number") {
      this.start = new Position(a, b);
      this.end = new Position(c ?? a, d ?? b);
    } else if (typeof a !== "number" && typeof b !== "number") {
      this.start = a;
      this.end = b;
    } else {
      throw new TypeError("Range は (line, character, ...) か (Position, Position) を取る");
    }
  }
  get isEmpty(): boolean {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

class Selection extends Range {}

class EventEmitter {
  event = asDisposable;
  fire = noop;
  dispose = noop;
}

class MarkdownString {
  value = "";
  supportThemeIcons = false;
  appendMarkdown(text: string): MarkdownString {
    this.value += text;
    return this;
  }
}

/** 引数を保持するだけの器。拡張は `new vscode.Diagnostic(...)` の形でしか触らない。 */
class Passthrough {
  readonly args: readonly unknown[];
  constructor(...args: readonly unknown[]) {
    this.args = args;
  }
}

const vscode = {
  Uri,
  Position,
  Range,
  Selection,
  EventEmitter,
  MarkdownString,
  ThemeColor: Passthrough,
  Diagnostic: Passthrough,
  CodeAction: Passthrough,
  CodeLens: Passthrough,
  CompletionItem: Passthrough,
  SnippetString: Passthrough,
  Hover: Passthrough,
  InlayHint: Passthrough,
  WorkspaceEdit: class {
    replace = noop;
    insert = noop;
    delete = noop;
  },
  TextEdit: { replace: noop },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  CodeActionKind: { QuickFix: "quickfix", RefactorRewrite: "refactor.rewrite" },
  CompletionItemKind: { Text: 0, Field: 4, Value: 11, EnumMember: 19, Snippet: 14 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  DecorationRangeBehavior: { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 },
  QuickInputButtons: { Back: {} },
  workspace: {
    workspaceFolders: undefined,
    textDocuments: [] as readonly unknown[],
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    onDidChangeConfiguration: asDisposable,
    onDidOpenTextDocument: asDisposable,
    onDidCloseTextDocument: asDisposable,
    onDidChangeTextDocument: asDisposable,
    onDidSaveTextDocument: asDisposable,
    registerTextDocumentContentProvider: asDisposable,
    applyEdit: async (): Promise<boolean> => true,
    openTextDocument: async (): Promise<unknown> => ({ languageId: "kongyo", lineCount: 0 }),
    fs: {
      stat: async (): Promise<unknown> => ({}),
      readFile: async (): Promise<Uint8Array> => new Uint8Array(),
      writeFile: async (): Promise<void> => undefined,
      createDirectory: async (): Promise<void> => undefined,
    },
  },
  window: {
    activeTextEditor: undefined,
    visibleTextEditors: [] as readonly unknown[],
    createStatusBarItem: () => ({
      show: noop,
      hide: noop,
      dispose: noop,
      text: "",
      name: "",
      command: "",
      tooltip: undefined as unknown,
    }),
    createTextEditorDecorationType: () => ({ dispose: noop }),
    createInputBox: () => ({
      show: noop,
      dispose: noop,
      onDidChangeValue: asDisposable,
      onDidAccept: asDisposable,
      onDidHide: asDisposable,
      onDidTriggerButton: asDisposable,
    }),
    onDidChangeActiveTextEditor: asDisposable,
    onDidChangeVisibleTextEditors: asDisposable,
    showInformationMessage: async (): Promise<undefined> => undefined,
    showWarningMessage: async (): Promise<undefined> => undefined,
    showErrorMessage: async (): Promise<undefined> => undefined,
    showQuickPick: async (): Promise<undefined> => undefined,
    showTextDocument: async (): Promise<unknown> => ({}),
  },
  languages: {
    createDiagnosticCollection: () => ({ set: noop, delete: noop, dispose: noop }),
    registerCodeActionsProvider: asDisposable,
    registerCodeLensProvider: asDisposable,
    registerHoverProvider: asDisposable,
    registerInlayHintsProvider: asDisposable,
    registerCompletionItemProvider: asDisposable,
    registerDocumentFormattingEditProvider: asDisposable,
    setTextDocumentLanguage: async (document: unknown): Promise<unknown> => document,
  },
  commands: {
    registerCommand: asDisposable,
    executeCommand: async (): Promise<undefined> => undefined,
  },
};

/**
 * Node のローダを差し替えて `require("vscode")` だけを横取りする。
 * `_load` は Node 自身の API 名なので、先頭のアンダースコアはこちらでは変えられない。
 */
// oxlint-disable no-underscore-dangle
interface LoaderModule {
  // createRequire は「本物の Module を渡している」ことを型で示すためだけに置く。
  // これが無いと、任意項だけの型への代入が弱い型として弾かれる（TS2559）。
  createRequire: typeof Module.createRequire;
  _load?: (request: string, parent: unknown, isMain: boolean) => unknown;
}

const loader: LoaderModule = Module;
const originalLoad = loader._load;
if (originalLoad === undefined) {
  throw new Error("Node のモジュールローダを差し替えられない");
}
loader._load = (request, parent, isMain): unknown =>
  request === "vscode" ? vscode : originalLoad(request, parent, isMain);
// oxlint-enable no-underscore-dangle

function isCallable(value: unknown): value is AnyFn {
  return typeof value === "function";
}

const bundlePath = resolve(process.cwd(), "dist/extension.js");
const require = Module.createRequire(pathToFileURL(bundlePath));
const loaded: unknown = require("./extension.js");
if (typeof loaded !== "object" || loaded === null) {
  throw new Error("dist/extension.js が何も輸出していない");
}

const activate: unknown = Reflect.get(loaded, "activate");
const deactivate: unknown = Reflect.get(loaded, "deactivate");
if (!isCallable(activate)) throw new Error("dist/extension.js は activate を輸出していない");
if (!isCallable(deactivate)) throw new Error("dist/extension.js は deactivate を輸出していない");

const subscriptions: { dispose: () => unknown }[] = [];
const context = {
  subscriptions,
  globalStorageUri: Uri.file(resolve(process.cwd(), "node_modules/.cache/kongyo-probe")),
  extensionUri: Uri.file(process.cwd()),
};

activate(context);

if (subscriptions.length === 0) {
  throw new Error("activate が何も登録していない");
}

await new Promise((done) => setTimeout(done, 150));
deactivate();
for (const item of subscriptions) {
  try {
    item.dispose();
  } catch {
    // 差し込んだ vscode は本物ではない。後始末の失敗は検査対象ではない。
  }
}

console.log(`[kongyo] runtime probe ok — ${String(subscriptions.length)} 件を登録`);
process.exit(0);
