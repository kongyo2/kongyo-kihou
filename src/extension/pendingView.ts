/**
 * 判定待ちの予測を並べるツリー。エクスプローラに「期日到来」と「期日前」を出す。
 *
 * 出すのは未判定の行だけで、判定済みの一覧は作らない。並べた瞬間に成績表になり、
 * 成績表は当たりやすい予測を選抜する（§6）。ここにあるのは、まだ世界が答えを
 * 書いていない行の一覧である。
 */

import * as vscode from "vscode";

import { calendarDaysUntil } from "../core/datetime.ts";
import { fieldValue } from "../core/parse.ts";
import { renderAffirmation, renderFalsification } from "../core/render.ts";
import { type DueEntry, NO_DEADLINE, pendingEntries } from "../core/scoring.ts";
import type { LedgerStore } from "./ledger.ts";
import type { StatusBar } from "./statusBar.ts";

export interface PendingEntryNode {
  readonly kind: "entry";
  readonly uri: vscode.Uri;
  readonly lineNumber: number;
  readonly due: boolean;
  readonly entry: DueEntry;
}

interface GroupNode {
  readonly kind: "group";
  readonly id: "due" | "upcoming";
  readonly label: string;
  readonly children: readonly PendingEntryNode[];
}

export type PendingNode = GroupNode | PendingEntryNode;

/** ツリーから渡ってくる引数の検め。コマンドはどこからでも呼べるので、形は信用しない。 */
export function isPendingEntryNode(value: unknown): value is PendingEntryNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as { kind?: unknown; lineNumber?: unknown; uri?: unknown };
  return node.kind === "entry" && typeof node.lineNumber === "number" && node.uri instanceof vscode.Uri;
}

function subjectOf(entry: DueEntry): string {
  const subject =
    fieldValue(entry.line, "S") || fieldValue(entry.line, "E") || fieldValue(entry.line, "S1") || entry.text.trim();
  return subject.slice(0, 60);
}

interface PendingModel {
  readonly due: readonly PendingEntryNode[];
  readonly upcoming: readonly PendingEntryNode[];
}

export class PendingView implements vscode.TreeDataProvider<PendingNode>, vscode.Disposable {
  readonly #emitter = new vscode.EventEmitter<PendingNode | undefined>();
  readonly #view: vscode.TreeView<PendingNode>;
  readonly #ledger: LedgerStore;
  readonly #statusBar: StatusBar;

  constructor(ledger: LedgerStore, statusBar: StatusBar) {
    this.#ledger = ledger;
    this.#statusBar = statusBar;
    this.#view = vscode.window.createTreeView("kongyo-pending", { treeDataProvider: this });
  }

  get onDidChangeTreeData(): vscode.Event<PendingNode | undefined> {
    return this.#emitter.event;
  }

  refresh(): void {
    this.#emitter.fire(undefined);
    void this.#updateBadge();
  }

  async #load(): Promise<PendingModel> {
    const uri = this.#statusBar.targetUri();
    const nowMs = Date.now();
    let lines: readonly string[];
    try {
      lines = await this.#ledger.readLines(uri);
    } catch {
      lines = [];
    }
    const due: PendingEntryNode[] = [];
    const upcoming: PendingEntryNode[] = [];
    for (const entry of pendingEntries(lines)) {
      const isDue = entry.deadlineMs <= nowMs;
      (isDue ? due : upcoming).push({ kind: "entry", uri, lineNumber: entry.lineNumber, due: isDue, entry });
    }
    return { due, upcoming };
  }

  async #updateBadge(): Promise<void> {
    const { due } = await this.#load();
    this.#view.badge =
      due.length === 0 ? undefined : { value: due.length, tooltip: `判定期日が到来した予測 ${String(due.length)} 件` };
  }

  async getChildren(node?: PendingNode): Promise<PendingNode[]> {
    if (node !== undefined) {
      return node.kind === "group" ? [...node.children] : [];
    }
    const { due, upcoming } = await this.#load();
    const groups: PendingNode[] = [];
    if (due.length > 0) {
      groups.push({ kind: "group", id: "due", label: `期日到来（${String(due.length)}）`, children: due });
    }
    if (upcoming.length > 0) {
      groups.push({ kind: "group", id: "upcoming", label: `期日前（${String(upcoming.length)}）`, children: upcoming });
    }
    return groups;
  }

  getTreeItem(node: PendingNode): vscode.TreeItem {
    if (node.kind === "group") {
      const state =
        node.id === "due" ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
      const item = new vscode.TreeItem(node.label, state);
      // 件数が変わっても同じ節として扱われるよう、識別子は固定する。
      item.id = `kongyo-group-${node.id}`;
      item.iconPath = new vscode.ThemeIcon(node.id === "due" ? "bell" : "watch");
      item.contextValue = "kongyoGroup";
      return item;
    }

    const entry = node.entry;
    const item = new vscode.TreeItem(subjectOf(entry), vscode.TreeItemCollapsibleState.None);
    item.id = `${node.uri.toString()}#${String(node.lineNumber)}`;
    const deadline = fieldValue(entry.line, "D");
    if (entry.deadlineMs === NO_DEADLINE) {
      item.description = deadline.length === 0 ? "D が無い" : `${deadline}（D を読めない）`;
    } else {
      const days = calendarDaysUntil(entry.deadlineMs, Date.now());
      if (node.due) {
        item.description = days < 0 ? `${deadline}（${String(-days)} 日超過）` : `${deadline}（今日）`;
      } else {
        item.description = days <= 0 ? `${deadline}（今日）` : `${deadline}（あと ${String(days)} 日）`;
      }
    }

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`\`${entry.text.trim()}\`\n\n`);
    const affirmation = renderAffirmation(entry.line);
    const falsification = renderFalsification(entry.line);
    if (affirmation !== null) tooltip.appendMarkdown(`**当たる世界** — ${affirmation}\n\n`);
    if (falsification !== null) tooltip.appendMarkdown(`**外れる世界** — ${falsification}\n`);
    item.tooltip = tooltip;

    item.iconPath = new vscode.ThemeIcon(node.due ? "bell" : "circle-outline");
    item.contextValue = node.due ? "kongyoDueEntry" : "kongyoUpcomingEntry";
    item.command = {
      command: "vscode.open",
      title: "行へ移動",
      arguments: [node.uri, { selection: new vscode.Range(node.lineNumber, 0, node.lineNumber, 0) }],
    };
    return item;
  }

  dispose(): void {
    this.#view.dispose();
    this.#emitter.dispose();
  }
}
