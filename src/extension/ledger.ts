import * as vscode from "vscode";

import { formatDate, formatDateTimeMinutes } from "../core/datetime.ts";
import type { NoteKind } from "../core/parse.ts";
import { renderLedgerNote } from "../core/render.ts";
import type { ConfigStore } from "./config.ts";
import { KONGYO_LANGUAGE } from "./model.ts";

const LEDGER_HEADER = [
  "# kongyo記法 予測台帳",
  "# 一行一予測。追記のみ。編集不可。末尾の → を判定日に ○ × － へ置換する。",
  "# 事後に要求するのは記号一つの記入だけで、理由は書かない。",
  "",
].join("\n");

const INVENTORY_HEADER = [
  "# 未形式化在庫",
  "",
  "記法を通らなかった文を、原文のまま落とす場所（§7）。",
  "在庫を減らすことは目標ではない。減らそうとすると、鋳造できる思考だけが生き残る。",
  "",
].join("\n");

const ABSOLUTE = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export class LedgerStore {
  readonly #context: vscode.ExtensionContext;
  readonly #config: ConfigStore;

  constructor(context: vscode.ExtensionContext, config: ConfigStore) {
    this.#context = context;
    this.#config = config;
  }

  #base(): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder?.uri ?? this.#context.globalStorageUri;
  }

  #resolve(configured: string): vscode.Uri {
    const trimmed = configured.trim();
    if (trimmed.length === 0) return vscode.Uri.joinPath(this.#base(), "kongyo", "予測台帳.kongyo");
    if (ABSOLUTE.test(trimmed)) return vscode.Uri.file(trimmed);
    return vscode.Uri.joinPath(this.#base(), ...trimmed.split(/[\\/]+/).filter((s) => s.length > 0));
  }

  ledgerUri(): vscode.Uri {
    return this.#resolve(this.#config.current.ledgerPath);
  }

  inventoryUri(): vscode.Uri {
    return this.#resolve(this.#config.current.inventoryPath);
  }

  async ensure(uri: vscode.Uri, header: string): Promise<void> {
    try {
      await vscode.workspace.fs.stat(uri);
      return;
    } catch {
      // 未作成。以下で作る。
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    await vscode.workspace.fs.writeFile(uri, encode(header));
  }

  async openLedger(): Promise<vscode.TextDocument> {
    const uri = this.ledgerUri();
    await this.ensure(uri, LEDGER_HEADER);
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.languageId !== KONGYO_LANGUAGE) {
      await vscode.languages.setTextDocumentLanguage(document, KONGYO_LANGUAGE);
    }
    return document;
  }

  async openInventory(): Promise<vscode.TextDocument> {
    const uri = this.inventoryUri();
    await this.ensure(uri, INVENTORY_HEADER);
    return vscode.workspace.openTextDocument(uri);
  }

  /** 開いていれば編集中の内容、開いていなければディスクの内容。集計は未保存も見る。 */
  async readText(uri: vscode.Uri): Promise<string> {
    const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    if (open !== undefined) return open.getText();
    try {
      return decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return "";
    }
  }

  async readLines(uri: vscode.Uri): Promise<readonly string[]> {
    return (await this.readText(uri)).split(/\r?\n/);
  }

  /** 末尾へ追記する。追記は台帳が唯一許す書き込みなので、ここだけが書き込み口になる。 */
  async append(
    uri: vscode.Uri,
    header: string,
    lines: readonly string[],
  ): Promise<{ document: vscode.TextDocument; firstLine: number }> {
    await this.ensure(uri, header);
    const document = await vscode.workspace.openTextDocument(uri);
    const lastLine = Math.max(0, document.lineCount - 1);
    const end = document.lineAt(lastLine).range.end;
    const needsBreak = document.lineAt(lastLine).text.trim().length > 0;
    const insertion = `${needsBreak ? "\n" : ""}${lines.join("\n")}\n`;

    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, end, insertion);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) throw new Error(`台帳へ追記できなかった：${uri.fsPath}`);
    await document.save();
    return { document, firstLine: needsBreak ? lastLine + 1 : lastLine };
  }

  async appendPredictions(lines: readonly string[]): Promise<{
    document: vscode.TextDocument;
    firstLine: number;
  }> {
    return this.append(this.ledgerUri(), LEDGER_HEADER, lines);
  }

  /**
   * 記録行を台帳へ足す。破ったことは罰しないが、回数は残す（§3）。
   * 対象文書が台帳でなくても、その文書自身に足す。違反は起きた場所に残るのが正しい。
   */
  async appendNote(target: vscode.Uri, kind: NoteKind, ref: string, detail: string): Promise<void> {
    const at = formatDateTimeMinutes(new Date());
    await this.append(target, LEDGER_HEADER, [renderLedgerNote(kind, at, ref, detail)]);
  }

  /** §7 のとおり、原文のまま落とす。整形も要約もしない。 */
  async appendInventory(originalLines: readonly string[]): Promise<vscode.TextDocument> {
    const stamp = formatDateTimeMinutes(new Date());
    const body = originalLines.map((line) => `> ${line}`);
    const { document } = await this.append(this.inventoryUri(), INVENTORY_HEADER, [`## ${stamp}`, "", ...body, ""]);
    return document;
  }

  today(): string {
    return formatDate(new Date());
  }
}
