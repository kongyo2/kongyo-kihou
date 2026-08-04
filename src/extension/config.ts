import * as vscode from "vscode";

import { type CheckOptions, type CompiledChecks, compileChecks, DEFAULT_CHECK_OPTIONS } from "../core/checks.ts";
import type { VocabularyEntry } from "../core/vocabulary.ts";

export type GuardMode = "revert" | "warn" | "off";

export interface KongyoConfig {
  readonly ledgerPath: string;
  readonly inventoryPath: string;
  readonly guard: GuardMode;
  readonly delayMs: number;
  readonly markdownEnabled: boolean;
  readonly autoInsertEasyMarker: boolean;
  readonly decorationsEnabled: boolean;
  readonly inlayHintsEnabled: boolean;
  readonly codeLensEnabled: boolean;
  readonly statusBarEnabled: boolean;
  readonly notifyDue: boolean;
  readonly checkOptions: CheckOptions;
  readonly checks: CompiledChecks;
}

interface RawVocabulary {
  readonly pattern?: unknown;
  readonly replacement?: unknown;
  readonly fixText?: unknown;
}

function readExtraVocabulary(raw: readonly unknown[]): readonly VocabularyEntry[] {
  const out: VocabularyEntry[] = [];
  raw.forEach((item, index) => {
    if (typeof item !== "object" || item === null) return;
    const entry = item as RawVocabulary;
    if (typeof entry.pattern !== "string" || entry.pattern.length === 0) return;
    out.push({
      id: `user-${String(index)}`,
      source: entry.pattern,
      replacement: typeof entry.replacement === "string" ? entry.replacement : "削除",
      excuse: "幅寄せ",
      fixText: typeof entry.fixText === "string" ? entry.fixText : null,
    });
  });
  return out;
}

function readStringArray(section: vscode.WorkspaceConfiguration, key: string): readonly string[] {
  return section.get<string[]>(key, []).filter((item) => typeof item === "string" && item.length > 0);
}

export function readConfig(scope?: vscode.Uri): KongyoConfig {
  const section = vscode.workspace.getConfiguration("kongyo", scope ?? null);
  const checkOptions: CheckOptions = {
    ...DEFAULT_CHECK_OPTIONS,
    vocabularyEnforcement: section.get<"oc" | "all">("vocabulary.enforcement", "oc"),
    extraVocabulary: readExtraVocabulary(section.get<unknown[]>("vocabulary.additional", [])),
    selfPatterns: readStringArray(section, "checks.c2.selfPatterns"),
    discretionPatterns: readStringArray(section, "checks.c2.discretionPatterns"),
    procedurePatterns: readStringArray(section, "checks.c2.procedurePatterns"),
    rewriteVerbs: readStringArray(section, "checks.c7.rewriteVerbs"),
    requireRewriteVerb: section.get<boolean>("checks.c7.requireRewriteVerb", true),
    requireDefiniteCondition: section.get<boolean>("checks.c3.requireDefiniteCondition", true),
  };

  return {
    ledgerPath: section.get<string>("ledger.path", "kongyo/予測台帳.kongyo"),
    inventoryPath: section.get<string>("inventory.path", "kongyo/未形式化在庫.md"),
    guard: section.get<GuardMode>("ledger.guard", "revert"),
    delayMs: Math.max(0, Math.min(2000, section.get<number>("diagnostics.delay", 60))),
    markdownEnabled: section.get<boolean>("markdown.enable", true),
    autoInsertEasyMarker: section.get<boolean>("checks.c8.autoInsertEasyMarker", true),
    decorationsEnabled: section.get<boolean>("decorations.enable", true),
    inlayHintsEnabled: section.get<boolean>("inlayHints.enable", true),
    codeLensEnabled: section.get<boolean>("codeLens.enable", true),
    statusBarEnabled: section.get<boolean>("statusBar.enable", true),
    notifyDue: section.get<boolean>("notifications.due", true),
    checkOptions,
    checks: compileChecks(checkOptions),
  };
}

/** 設定は一度読んで束ねておく。行ごとに正規表現を組み直すと打鍵ごとの検査が重くなる。 */
export class ConfigStore implements vscode.Disposable {
  #current: KongyoConfig;
  readonly #emitter = new vscode.EventEmitter<KongyoConfig>();
  readonly #subscription: vscode.Disposable;

  constructor() {
    this.#current = readConfig();
    this.#subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("kongyo")) return;
      this.#current = readConfig();
      this.#emitter.fire(this.#current);
    });
  }

  get current(): KongyoConfig {
    return this.#current;
  }

  get onDidChange(): vscode.Event<KongyoConfig> {
    return this.#emitter.event;
  }

  dispose(): void {
    this.#subscription.dispose();
    this.#emitter.dispose();
  }
}
