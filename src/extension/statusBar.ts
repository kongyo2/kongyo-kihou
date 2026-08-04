import * as vscode from "vscode";

import { inventoryStats, type Tally, tally } from "../core/scoring.ts";
import type { ConfigStore } from "./config.ts";
import type { LedgerStore } from "./ledger.ts";
import { KONGYO_LANGUAGE } from "./model.ts";

export interface TallySnapshot {
  readonly tally: Tally;
  readonly source: vscode.Uri;
  readonly inventoryTotal: number;
  readonly inventoryLast30Days: number;
}

/**
 * いま見ている台帳の集計を出す。出すのは `×` `－` ブライアスコアと未判定の数だけ。
 * `○` の数はここにも無い（§6）。
 */
export class StatusBar implements vscode.Disposable {
  readonly #item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  readonly #ledger: LedgerStore;
  readonly #config: ConfigStore;

  constructor(ledger: LedgerStore, config: ConfigStore) {
    this.#ledger = ledger;
    this.#config = config;
    this.#item.command = "kongyo.tally";
    this.#item.name = "kongyo記法";
  }

  /** 集計の対象。開いている .kongyo があればそれ、無ければ設定の台帳。 */
  targetUri(): vscode.Uri {
    const active = vscode.window.activeTextEditor?.document;
    if (active !== undefined && active.languageId === KONGYO_LANGUAGE) return active.uri;
    const visible = vscode.window.visibleTextEditors.find((editor) => editor.document.languageId === KONGYO_LANGUAGE);
    return visible?.document.uri ?? this.#ledger.ledgerUri();
  }

  async snapshot(uri: vscode.Uri = this.targetUri()): Promise<TallySnapshot> {
    const nowMs = Date.now();
    const lines = await this.#ledger.readLines(uri);
    const inventory = inventoryStats(await this.#ledger.readText(this.#ledger.inventoryUri()), nowMs);
    return {
      tally: tally(lines, nowMs),
      source: uri,
      inventoryTotal: inventory.total,
      inventoryLast30Days: inventory.last30Days,
    };
  }

  async refresh(): Promise<void> {
    if (!this.#config.current.statusBarEnabled) {
      this.#item.hide();
      return;
    }
    let snapshot: TallySnapshot;
    try {
      snapshot = await this.snapshot();
    } catch {
      this.#item.hide();
      return;
    }
    const { tally: counts } = snapshot;
    const brier = counts.brier === null ? "—" : counts.brier.toFixed(3);
    const due = counts.due > 0 ? ` $(bell) ${String(counts.due)}` : "";
    this.#item.text = `$(law) ×${String(counts.miss)} －${String(counts.undecidable)} B=${brier}${due}`;

    const tooltip = new vscode.MarkdownString();
    tooltip.supportThemeIcons = true;
    tooltip.appendMarkdown(`**kongyo 集計** — \`${snapshot.source.path.split("/").pop() ?? ""}\`\n\n`);
    tooltip.appendMarkdown(`- \`×\` の絶対数：**${String(counts.miss)}**\n`);
    tooltip.appendMarkdown(`- \`－\` の絶対数：**${String(counts.undecidable)}**\n`);
    tooltip.appendMarkdown(`- ブライアスコア：**${brier}**（n=${String(counts.brierCount)}、\`[易]\` 除外）\n`);
    tooltip.appendMarkdown(`- 未判定：${String(counts.pending)}（うち期日到来 ${String(counts.due)}）\n`);
    tooltip.appendMarkdown(
      `- 未形式化在庫：${String(snapshot.inventoryTotal)} 件（直近30日 ${String(snapshot.inventoryLast30Days)}）\n\n`,
    );
    tooltip.appendMarkdown("`○` の数は集計しない（§6）。\n");
    this.#item.tooltip = tooltip;
    this.#item.show();
  }

  dispose(): void {
    this.#item.dispose();
  }
}
