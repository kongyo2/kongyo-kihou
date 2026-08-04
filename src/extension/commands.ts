import * as vscode from "vscode";

import { hasBlockingIssue, probabilityOf } from "../core/checks.ts";
import { isEasy, type Verdict, VERDICT_MARKERS } from "../core/parse.ts";
import { renderFalsification, renderPrediction, toDraft } from "../core/render.ts";
import { dueEntries, pendingEntries } from "../core/scoring.ts";
import { type CommandDeps, replaceLine, resolveTarget, revealLine, showMarkdown } from "./context.ts";
import { KONGYO_LANGUAGE } from "./model.ts";
import { isPendingEntryNode } from "./pendingView.ts";
import { RULES_URI, renderTallyMarkdown, TALLY_URI } from "./views.ts";
import { castCommand } from "./wizard.ts";

export type { CommandDeps } from "./context.ts";

async function commitLineCommand(deps: CommandDeps, uri?: vscode.Uri, lineNumber?: number): Promise<void> {
  const target = await resolveTarget(uri, lineNumber);
  if (target === null) return;
  const analyzed = deps.analyzer.analyze(target.document).byLine.get(target.lineNumber);
  if (analyzed === undefined) {
    void vscode.window.showWarningMessage("この行は kongyo の検査対象ではない。");
    return;
  }

  if (analyzed.parsed.kind === "unformalized") {
    await castCommand(deps, target.document.uri, target.lineNumber);
    return;
  }
  if (analyzed.parsed.kind !== "prediction") {
    void vscode.window.showWarningMessage("この行は予測ではない。");
    return;
  }
  if (analyzed.parsed.stamp !== null) {
    void vscode.window.showInformationMessage("この行は確定済み。末尾記号の置換だけができる。");
    return;
  }
  if (hasBlockingIssue(analyzed.issues)) {
    const first = analyzed.issues.find((issue) => issue.severity === "error");
    if (target.editor !== null && first !== undefined) {
      const at = new vscode.Position(target.lineNumber, first.span.start);
      target.editor.selection = new vscode.Selection(at, at);
      target.editor.revealRange(new vscode.Range(at, at));
    }
    void vscode.window.showErrorMessage(`確定できない。${first?.message ?? "却下されている項がある。"}`);
    return;
  }

  const draft = toDraft(analyzed.parsed);
  if (draft === null) return;
  const probability = probabilityOf(analyzed.parsed);
  const easy =
    draft.easy || (deps.config.current.autoInsertEasyMarker && probability !== null && isEasy(probability, false));
  const committed = renderPrediction({
    ...draft,
    stamp: deps.ledger.today(),
    easy,
    verdict: "pending",
  });

  if (target.document.languageId === KONGYO_LANGUAGE) {
    await replaceLine(target.document, target.lineNumber, committed);
    deps.guard.reseal(target.document);
    await deps.statusBar.refresh();
    deps.pending.refresh();
    void vscode.window.showInformationMessage("確定した。この行はもう書き換えられない。");
    return;
  }

  const { document } = await deps.ledger.appendPredictions([committed]);
  deps.guard.reseal(document);
  await replaceLine(target.document, target.lineNumber, committed);
  await deps.statusBar.refresh();
  deps.pending.refresh();
  const choice = await vscode.window.showInformationMessage(
    "台帳へ追記した。この文書の行は控えで、拘束がかかるのは台帳の方。",
    "台帳を開く",
  );
  if (choice === "台帳を開く") await vscode.window.showTextDocument(document, { preview: false });
}

async function judgeLineCommand(deps: CommandDeps, uri: vscode.Uri, lineNumber: number, marker: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const analyzed = deps.analyzer.analyze(document).byLine.get(lineNumber);
  if (analyzed === undefined || analyzed.parsed.kind !== "prediction") return;

  const text = document.lineAt(lineNumber).text;
  const next =
    analyzed.parsed.verdictSpan === null
      ? `${text.trimEnd()}  ${marker}`
      : text.slice(0, analyzed.parsed.verdictSpan.start) + marker + text.slice(analyzed.parsed.verdictSpan.end);
  await replaceLine(document, lineNumber, next);
  deps.guard.reseal(document);
  await deps.statusBar.refresh();
  deps.pending.refresh();
}

async function judgeFromTree(deps: CommandDeps, node: unknown, verdict: Verdict): Promise<void> {
  if (!isPendingEntryNode(node)) return;
  await judgeLineCommand(deps, node.uri, node.lineNumber, VERDICT_MARKERS[verdict]);
}

/**
 * 期日が来た予測を、無くなるまで続けて判定する（§9「週一で末尾記号を置換する」）。
 * 期日到来が無ければ、期日前の未判定を一件だけ選んで判定できる。
 */
async function judgeCommand(deps: CommandDeps): Promise<void> {
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(deps.statusBar.targetUri());
  } catch {
    document = await deps.ledger.openLedger();
  }

  const verdicts: readonly { label: string; value: Verdict }[] = [
    { label: `${VERDICT_MARKERS.hit}　当たり`, value: "hit" },
    { label: `${VERDICT_MARKERS.miss}　外れ`, value: "miss" },
    { label: `${VERDICT_MARKERS.undecidable}　判定不能（射程を書き損ねた）`, value: "undecidable" },
  ];

  let lastJudged: number | null = null;
  // 一件ずつ選んで置換する。画面は一つなので、この await は直列でなければならない。
  // oxlint-disable no-await-in-loop
  for (;;) {
    const lines = document.getText().split(/\r?\n/);
    const nowMs = Date.now();
    const due = dueEntries(lines, nowMs);
    const entries = due.length > 0 ? due : pendingEntries(lines);

    if (entries.length === 0) {
      if (lastJudged === null) void vscode.window.showInformationMessage("判定を待っている予測は無い。");
      break;
    }

    const picked = await vscode.window.showQuickPick(
      entries.map((entry) => ({
        label: `${String(entry.lineNumber + 1)}: ${entry.text.trim().slice(0, 90)}`,
        detail: renderFalsification(entry.line) ?? "",
        description: due.length > 0 ? "期日到来" : "期日前",
        lineNumber: entry.lineNumber,
      })),
      {
        title: due.length > 0 ? "kongyo 判定 — 期日が来た予測" : "kongyo 判定 — 未判定の予測（期日前）",
        placeHolder: "判定は記号一つ。理由は書かない（§9）。",
        ignoreFocusOut: true,
      },
    );
    if (picked === undefined) break;

    const verdict = await vscode.window.showQuickPick(verdicts, {
      title: "kongyo 判定 — 記号を置換する",
      placeHolder: "外れは負債ではない。外れを含む記録が履歴である。",
      ignoreFocusOut: true,
    });
    // 記号の取消は一覧へ戻す。ここで終えると、選んだ行が宙に浮く。
    if (verdict === undefined) continue;

    await judgeLineCommand(deps, document.uri, picked.lineNumber, VERDICT_MARKERS[verdict.value]);
    lastJudged = picked.lineNumber;

    // 期日到来を捌き切ったら閉じる。期日前まで続けて訊くのは判定の催促になる。
    if (due.length <= 1) break;
  }
  // oxlint-enable no-await-in-loop

  if (lastJudged !== null) await revealLine(document, lastJudged);
}

async function tallyCommand(deps: CommandDeps): Promise<void> {
  const snapshot = await deps.statusBar.snapshot();
  const lines = await deps.ledger.readLines(snapshot.source);
  const due = dueEntries(lines, Date.now());
  deps.views.setTally(
    renderTallyMarkdown(snapshot.tally, {
      source: snapshot.source.path.split("/").pop() ?? snapshot.source.toString(),
      inventoryTotal: snapshot.inventoryTotal,
      inventoryLast30Days: snapshot.inventoryLast30Days,
      due: due.map((entry) => ({ lineNumber: entry.lineNumber + 1, text: entry.text.trim() })),
    }),
  );
  await showMarkdown(TALLY_URI);
}

async function toInventoryCommand(deps: CommandDeps, uri?: vscode.Uri, lineNumber?: number): Promise<void> {
  const target = await resolveTarget(uri, lineNumber);
  if (target === null) return;

  const selection = target.editor?.selection;
  const from = selection !== undefined && !selection.isEmpty ? selection.start.line : target.lineNumber;
  const to = selection !== undefined && !selection.isEmpty ? selection.end.line : target.lineNumber;
  const original: string[] = [];
  for (let i = from; i <= to; i += 1) original.push(target.document.lineAt(i).text);
  if (original.every((line) => line.trim().length === 0)) return;

  const sealedHere = Array.from({ length: to - from + 1 }, (_, offset) =>
    deps.guard.isSealed(target.document, from + offset),
  ).some(Boolean);

  await deps.ledger.appendInventory(original);

  if (target.document.languageId === KONGYO_LANGUAGE && !sealedHere) {
    const edit = new vscode.WorkspaceEdit();
    edit.delete(
      target.document.uri,
      new vscode.Range(new vscode.Position(from, 0), target.document.lineAt(to).rangeIncludingLineBreak.end),
    );
    await vscode.workspace.applyEdit(edit);
    await target.document.save();
    deps.guard.reseal(target.document);
  }

  await deps.statusBar.refresh();
  const choice = await vscode.window.showInformationMessage(
    "未形式化在庫へ落とした。在庫を減らすことは目標ではない（§7）。",
    "在庫を開く",
  );
  if (choice === "在庫を開く") {
    await vscode.window.showTextDocument(await deps.ledger.openInventory(), { preview: false });
  }
}

async function unlockLineCommand(deps: CommandDeps, uri?: vscode.Uri, lineNumber?: number): Promise<void> {
  const target = await resolveTarget(uri, lineNumber);
  if (target === null) return;
  if (target.document.languageId !== KONGYO_LANGUAGE) {
    void vscode.window.showWarningMessage("拘束がかかるのは .kongyo の台帳だけ。");
    return;
  }
  if (!deps.guard.isSealed(target.document, target.lineNumber)) {
    void vscode.window.showInformationMessage("この行はまだ確定していない。自由に書き換えられる。");
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    "この行の拘束を外す。外したことは台帳に一行残り、集計に数として出る。罰は無い。",
    { modal: true, detail: target.document.lineAt(target.lineNumber).text.trim() },
    "解除する",
  );
  if (choice !== "解除する") return;

  const unlocked = await deps.guard.unlock(target.document, target.lineNumber);
  await deps.statusBar.refresh();
  if (!unlocked) {
    void vscode.window.showWarningMessage("解除できなかった。");
    return;
  }
  void vscode.window.showInformationMessage("この行の拘束を外した。保存すると再び封がかかる。");
}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("kongyo.cast", (uri?: vscode.Uri, lineNumber?: number) =>
      castCommand(deps, uri, lineNumber),
    ),
    vscode.commands.registerCommand("kongyo.commitLine", (uri?: vscode.Uri, lineNumber?: number) =>
      commitLineCommand(deps, uri, lineNumber),
    ),
    vscode.commands.registerCommand("kongyo.judge", () => judgeCommand(deps)),
    vscode.commands.registerCommand("kongyo.judgeLine", (uri: vscode.Uri, lineNumber: number, marker: string) =>
      judgeLineCommand(deps, uri, lineNumber, marker),
    ),
    vscode.commands.registerCommand("kongyo.tree.hit", (node: unknown) => judgeFromTree(deps, node, "hit")),
    vscode.commands.registerCommand("kongyo.tree.miss", (node: unknown) => judgeFromTree(deps, node, "miss")),
    vscode.commands.registerCommand("kongyo.tree.undecidable", (node: unknown) =>
      judgeFromTree(deps, node, "undecidable"),
    ),
    vscode.commands.registerCommand("kongyo.tally", () => tallyCommand(deps)),
    vscode.commands.registerCommand("kongyo.openLedger", async () => {
      const document = await deps.ledger.openLedger();
      await vscode.window.showTextDocument(document, { preview: false });
    }),
    vscode.commands.registerCommand("kongyo.openInventory", async () => {
      const document = await deps.ledger.openInventory();
      await vscode.window.showTextDocument(document, { preview: false });
    }),
    vscode.commands.registerCommand("kongyo.toInventory", (uri?: vscode.Uri, lineNumber?: number) =>
      toInventoryCommand(deps, uri, lineNumber),
    ),
    vscode.commands.registerCommand("kongyo.unlockLine", (uri?: vscode.Uri, lineNumber?: number) =>
      unlockLineCommand(deps, uri, lineNumber),
    ),
    vscode.commands.registerCommand("kongyo.showRules", () => showMarkdown(RULES_URI)),
  ];
}
