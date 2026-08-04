import * as vscode from "vscode";

import { hasBlockingIssue, probabilityOf, validateFieldValue } from "../core/checks.ts";
import { type FieldKey, FIELD_META, type PatternId, PATTERN_IDS, PATTERNS } from "../core/patterns.ts";
import { isEasy, parseLine, type Verdict, VERDICT_MARKERS } from "../core/parse.ts";
import { renderAffirmation, renderFalsification, renderPrediction, toDraft } from "../core/render.ts";
import { dueEntries, pendingEntries } from "../core/scoring.ts";
import type { ConfigStore } from "./config.ts";
import type { LedgerGuard } from "./guardController.ts";
import type { LedgerStore } from "./ledger.ts";
import { type Analyzer, KONGYO_LANGUAGE } from "./model.ts";
import { PLACEHOLDER } from "./providers.ts";
import type { StatusBar } from "./statusBar.ts";
import { RULES_URI, renderTallyMarkdown, TALLY_URI, type ViewProvider } from "./views.ts";

const BACK = Symbol("back");
type Answer = string | typeof BACK | undefined;

/** 鋳造で項を訊く順序。`p` は最後。主張が固まる前に確率を決めると、幅寄せが戻ってくる。 */
const ASK_ORDER: readonly FieldKey[] = ["D", "T", "E", "S", "S1", "S2", "O", "CMP", "C", "J", "p", "R"];

export interface CommandDeps {
  readonly analyzer: Analyzer;
  readonly config: ConfigStore;
  readonly ledger: LedgerStore;
  readonly guard: LedgerGuard;
  readonly statusBar: StatusBar;
  readonly views: ViewProvider;
}

interface LineTarget {
  readonly document: vscode.TextDocument;
  readonly editor: vscode.TextEditor | null;
  readonly lineNumber: number;
}

async function resolveTarget(uri?: vscode.Uri, lineNumber?: number): Promise<LineTarget | null> {
  if (uri !== undefined) {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor =
      vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === uri.toString()) ??
      null;
    const line = lineNumber ?? editor?.selection.active.line ?? 0;
    return { document, editor, lineNumber: Math.min(line, Math.max(0, document.lineCount - 1)) };
  }
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) return null;
  return {
    document: editor.document,
    editor,
    lineNumber: lineNumber ?? editor.selection.active.line,
  };
}

async function replaceLine(document: vscode.TextDocument, lineNumber: number, text: string): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, document.lineAt(lineNumber).range, text);
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) await document.save();
  return applied;
}

async function showMarkdown(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  } catch {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: true });
  }
}

function askField(
  pattern: PatternId,
  key: FieldKey,
  initial: string,
  deps: CommandDeps,
  step: number,
  total: number,
  canGoBack: boolean,
): Promise<Answer> {
  const nowMs = Date.now();
  const checks = deps.config.current.checks;
  const meta = FIELD_META[key];

  return new Promise<Answer>((resolve) => {
    const input = vscode.window.createInputBox();
    let settled = false;
    const finish = (value: Answer): void => {
      if (settled) return;
      settled = true;
      resolve(value);
      input.dispose();
    };

    input.title = `kongyo 鋳造 — ${pattern} ${PATTERNS[pattern].name}`;
    input.step = step;
    input.totalSteps = total;
    input.prompt = `${meta.token}（${meta.label}）：${meta.description}`;
    input.placeholder = PLACEHOLDER[key];
    input.value = initial;
    input.ignoreFocusOut = true;
    if (canGoBack) input.buttons = [vscode.QuickInputButtons.Back];

    const validate = (value: string): void => {
      input.validationMessage = validateFieldValue(pattern, key, value, checks, nowMs) ?? "";
    };

    input.onDidChangeValue(validate);
    input.onDidTriggerButton(() => finish(BACK));
    input.onDidAccept(() => {
      const message = validateFieldValue(pattern, key, input.value, checks, nowMs);
      if (message !== null) {
        input.validationMessage = message;
        return;
      }
      finish(input.value.trim());
    });
    input.onDidHide(() => finish(undefined));
    input.show();
    validate(input.value);
  });
}

async function pickPattern(seed: string): Promise<PatternId | undefined> {
  const items = PATTERN_IDS.map((id) => {
    const spec = PATTERNS[id];
    return {
      label: `${id}　${spec.name}${spec.cheap ? "　（最も安い）" : ""}`,
      detail: spec.syntax.replace(/`/g, ""),
      id,
    };
  });
  const picked = await vscode.window.showQuickPick(items, {
    title: seed.length === 0 ? "kongyo 鋳造 — 型を選ぶ" : `kongyo 鋳造 — 「${seed.slice(0, 40)}」`,
    placeHolder: "五型のみ。P4 と P5 は閾値の議論が要らず、J の裁量が入りにくい。",
    ignoreFocusOut: true,
  });
  return picked?.id;
}

function describe(line: string): { falsification: string | null; affirmation: string | null } {
  const parsed = parseLine(line);
  if (parsed.kind !== "prediction") return { falsification: null, affirmation: null };
  return { falsification: renderFalsification(parsed), affirmation: renderAffirmation(parsed) };
}

async function castCommand(deps: CommandDeps, uri?: vscode.Uri, lineNumber?: number): Promise<void> {
  const target = await resolveTarget(uri, lineNumber);
  const seedLine = target === null ? undefined : deps.analyzer.analyze(target.document).byLine.get(target.lineNumber);
  const selection = target?.editor?.selection;
  const fromSelection =
    target !== null && selection !== undefined && !selection.isEmpty ? target.document.getText(selection).trim() : "";
  const fromLine = seedLine?.parsed.kind === "unformalized" ? seedLine.text.trim() : "";
  const seedText = fromSelection.length > 0 ? fromSelection : fromLine;

  const pattern = await pickPattern(seedText);
  if (pattern === undefined) return;

  const spec = PATTERNS[pattern];
  const order = ASK_ORDER.filter((key) => spec.required.includes(key));
  const values = new Map<FieldKey, string>();
  const total = order.length + 1;

  let index = 0;
  let line = "";
  // 一問ずつ順に訊く。並行に訊く画面は存在しないので、この await は直列でなければならない。
  // oxlint-disable no-await-in-loop
  for (;;) {
    if (index < order.length) {
      const key = order[index];
      if (key === undefined) return;
      const answer = await askField(pattern, key, values.get(key) ?? "", deps, index + 1, total, index > 0);
      if (answer === undefined) return;
      if (answer === BACK) {
        index = Math.max(0, index - 1);
        continue;
      }
      values.set(key, answer);
      index += 1;
      continue;
    }

    const probability = Number.parseFloat(values.get("p") ?? "");
    line = renderPrediction({
      pattern,
      values,
      stamp: deps.ledger.today(),
      easy: !Number.isNaN(probability) && isEasy(probability, false) && deps.config.current.autoInsertEasyMarker,
      verdict: "pending",
    });

    const confirm = await vscode.window.showQuickPick(
      [
        { label: "$(check-all) 確定して台帳へ追記する", detail: line, action: "commit" as const },
        { label: "$(arrow-left) 一つ戻る", action: "back" as const },
        { label: "$(trash) 破棄する", action: "discard" as const },
      ],
      {
        title: `kongyo 鋳造 — 確認（${String(total)}/${String(total)}）`,
        placeHolder: `外れる世界：${describe(line).falsification ?? "書けない"}`,
        ignoreFocusOut: true,
      },
    );
    if (confirm === undefined || confirm.action === "discard") return;
    if (confirm.action === "back") {
      index = order.length - 1;
      continue;
    }
    break;
  }
  // oxlint-enable no-await-in-loop

  const { document, firstLine } = await deps.ledger.appendPredictions([line]);
  deps.guard.reseal(document);

  // 鋳造の種になった未形式化の行は、鋳造できた時点で役目が終わる。
  if (target !== null && fromLine.length > 0 && target.document.languageId === KONGYO_LANGUAGE) {
    const edit = new vscode.WorkspaceEdit();
    edit.delete(target.document.uri, target.document.lineAt(target.lineNumber).rangeIncludingLineBreak);
    await vscode.workspace.applyEdit(edit);
    await target.document.save();
    deps.guard.reseal(target.document);
  }

  const shown = await vscode.window.showTextDocument(document, { preview: false });
  const at = new vscode.Position(Math.min(firstLine, Math.max(0, document.lineCount - 1)), 0);
  shown.selection = new vscode.Selection(at, at);
  shown.revealRange(new vscode.Range(at, at));
  await deps.statusBar.refresh();

  const affirmation = describe(line).affirmation;
  void vscode.window.showInformationMessage(
    affirmation === null ? "台帳へ追記した。" : `台帳へ追記した。${affirmation}`,
  );
}

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
    void vscode.window.showInformationMessage("確定した。この行はもう書き換えられない。");
    return;
  }

  const { document } = await deps.ledger.appendPredictions([committed]);
  deps.guard.reseal(document);
  await replaceLine(target.document, target.lineNumber, committed);
  await deps.statusBar.refresh();
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
}

async function judgeCommand(deps: CommandDeps): Promise<void> {
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(deps.statusBar.targetUri());
  } catch {
    document = await deps.ledger.openLedger();
  }
  const lines = document.getText().split(/\r?\n/);
  const nowMs = Date.now();
  const due = dueEntries(lines, nowMs);
  const entries = due.length > 0 ? due : pendingEntries(lines);

  if (entries.length === 0) {
    void vscode.window.showInformationMessage("判定を待っている予測は無い。");
    return;
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
  if (picked === undefined) return;

  const verdicts: readonly { label: string; value: Verdict }[] = [
    { label: `${VERDICT_MARKERS.hit}　当たり`, value: "hit" },
    { label: `${VERDICT_MARKERS.miss}　外れ`, value: "miss" },
    { label: `${VERDICT_MARKERS.undecidable}　判定不能（射程を書き損ねた）`, value: "undecidable" },
  ];
  const verdict = await vscode.window.showQuickPick(verdicts, {
    title: "kongyo 判定 — 記号を置換する",
    placeHolder: "外れは負債ではない。外れを含む記録が履歴である。",
    ignoreFocusOut: true,
  });
  if (verdict === undefined) return;

  await judgeLineCommand(deps, document.uri, picked.lineNumber, VERDICT_MARKERS[verdict.value]);

  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const at = new vscode.Position(picked.lineNumber, 0);
  editor.selection = new vscode.Selection(at, at);
  editor.revealRange(new vscode.Range(at, at));
}

async function tallyCommand(deps: CommandDeps): Promise<void> {
  const snapshot = await deps.statusBar.snapshot();
  deps.views.setTally(
    renderTallyMarkdown(snapshot.tally, {
      source: snapshot.source.path.split("/").pop() ?? snapshot.source.toString(),
      inventoryTotal: snapshot.inventoryTotal,
      inventoryLast30Days: snapshot.inventoryLast30Days,
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
