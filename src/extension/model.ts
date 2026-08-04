import * as vscode from "vscode";

import { checkLine, type CompiledChecks, type Issue } from "../core/checks.ts";
import { type KongyoLine, parseLine } from "../core/parse.ts";
import type { KongyoConfig } from "./config.ts";

export const KONGYO_LANGUAGE = "kongyo";

/** 検査対象の行範囲。`end` は排他。 */
export interface Region {
  readonly start: number;
  readonly end: number;
}

export interface AnalyzedLine {
  readonly lineNumber: number;
  readonly text: string;
  readonly parsed: KongyoLine;
  readonly issues: readonly Issue[];
}

export interface AnalyzedDocument {
  readonly version: number;
  readonly regions: readonly Region[];
  readonly lines: readonly AnalyzedLine[];
  readonly byLine: ReadonlyMap<number, AnalyzedLine>;
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*kongyo\b/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

/** Markdown / プレーンテキスト中の ```kongyo フェンスを拾う。 */
function fencedRegions(document: vscode.TextDocument): readonly Region[] {
  const regions: Region[] = [];
  let open: number | null = null;
  for (let i = 0; i < document.lineCount; i += 1) {
    const text = document.lineAt(i).text;
    if (open === null) {
      if (FENCE_OPEN.test(text)) open = i + 1;
      continue;
    }
    if (FENCE_CLOSE.test(text)) {
      if (i > open) regions.push({ start: open, end: i });
      open = null;
    }
  }
  if (open !== null && open < document.lineCount) {
    regions.push({ start: open, end: document.lineCount });
  }
  return regions;
}

export function regionsOf(document: vscode.TextDocument, config: KongyoConfig): readonly Region[] {
  if (document.languageId === KONGYO_LANGUAGE) return [{ start: 0, end: document.lineCount }];
  if (!config.markdownEnabled) return [];
  if (document.languageId !== "markdown" && document.languageId !== "plaintext") return [];
  return fencedRegions(document);
}

export function isRelevant(document: vscode.TextDocument, config: KongyoConfig): boolean {
  if (document.uri.scheme === "output" || document.uri.scheme === "kongyo-view") return false;
  return regionsOf(document, config).length > 0;
}

/** 行の解析結果。行番号を含まないので、行がずれても使い回せる。 */
interface LineAnalysis {
  readonly parsed: KongyoLine;
  readonly issues: readonly Issue[];
}

/**
 * 行文字列 → 解析結果の控え。
 *
 * 検査は一行で閉じているので、打鍵で動くのは一行だけ。文書全体を作り直しても、
 * 実際に走る検査は変わった行の分だけで済む。千行の台帳で打鍵ごとに全行を検査すると、
 * 検査の費用が拘束を諦める理由になる。
 */
const LINE_CACHE_LIMIT = 4000;

function analyzeDocument(
  document: vscode.TextDocument,
  config: KongyoConfig,
  nowMs: number,
  cache: Map<string, LineAnalysis>,
): AnalyzedDocument {
  const regions = regionsOf(document, config);
  const lines: AnalyzedLine[] = [];
  const byLine = new Map<number, AnalyzedLine>();
  const checks: CompiledChecks = config.checks;

  for (const region of regions) {
    for (let i = region.start; i < Math.min(region.end, document.lineCount); i += 1) {
      const text = document.lineAt(i).text;
      let analysis = cache.get(text);
      if (analysis === undefined) {
        const parsed = parseLine(text);
        const issues = parsed.kind === "blank" || parsed.kind === "comment" ? [] : checkLine(parsed, checks, nowMs);
        analysis = { parsed, issues };
        if (cache.size >= LINE_CACHE_LIMIT) cache.clear();
        cache.set(text, analysis);
      }
      const entry: AnalyzedLine = {
        lineNumber: i,
        text,
        parsed: analysis.parsed,
        issues: analysis.issues,
      };
      lines.push(entry);
      byLine.set(i, entry);
    }
  }
  return { version: document.version, regions, lines, byLine };
}

/**
 * 解析結果の保持。打鍵ごとに走るので、同じ version は使い回す。
 * 「いま」は検査の入力なので、日付が変わっても古い結果を返さないよう、日単位で無効化する。
 */
export class Analyzer implements vscode.Disposable {
  readonly #cache = new Map<string, AnalyzedDocument>();
  readonly #lineCache = new Map<string, LineAnalysis>();
  readonly #day = new Map<string, number>();
  #configVersion = 0;
  readonly #configVersions = new Map<string, number>();
  #config: KongyoConfig;
  #lineCacheDay = -1;
  readonly #subscriptions: vscode.Disposable[] = [];

  constructor(config: KongyoConfig) {
    this.#config = config;
    this.#subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        const key = document.uri.toString();
        this.#cache.delete(key);
        this.#day.delete(key);
        this.#configVersions.delete(key);
      }),
    );
  }

  setConfig(config: KongyoConfig): void {
    this.#config = config;
    this.#configVersion += 1;
    this.#cache.clear();
    this.#lineCache.clear();
  }

  get config(): KongyoConfig {
    return this.#config;
  }

  analyze(document: vscode.TextDocument, nowMs: number = Date.now()): AnalyzedDocument {
    const key = document.uri.toString();
    const today = Math.floor(nowMs / 86_400_000);
    // C1 と期日到来は「いま」に依存する。日が変われば行の控えも捨てる。
    if (this.#lineCacheDay !== today) {
      this.#lineCache.clear();
      this.#lineCacheDay = today;
    }
    const cached = this.#cache.get(key);
    if (
      cached !== undefined &&
      cached.version === document.version &&
      this.#day.get(key) === today &&
      this.#configVersions.get(key) === this.#configVersion
    ) {
      return cached;
    }
    const analyzed = analyzeDocument(document, this.#config, nowMs, this.#lineCache);
    this.#cache.set(key, analyzed);
    this.#day.set(key, today);
    this.#configVersions.set(key, this.#configVersion);
    return analyzed;
  }

  lineAt(document: vscode.TextDocument, lineNumber: number): AnalyzedLine | null {
    return this.analyze(document).byLine.get(lineNumber) ?? null;
  }

  dispose(): void {
    for (const item of this.#subscriptions) item.dispose();
    this.#lineCache.clear();
    this.#cache.clear();
  }
}

export function toRange(lineNumber: number, start: number, end: number): vscode.Range {
  return new vscode.Range(lineNumber, start, lineNumber, end);
}
