/**
 * 鋳造ウィザード。一項ずつ訊き、打鍵ごとに検査し、通らない値では次へ進めない。
 *
 * 検査はエディタと同じ validateFieldValue を使う。ウィザードとエディタで
 * 別の実装を持つと、片方だけが緩む。
 */

import * as vscode from "vscode";

import { validateFieldValue } from "../core/checks.ts";
import { addDays, formatDate } from "../core/datetime.ts";
import { isEasy, parseLine } from "../core/parse.ts";
import { type FieldKey, FIELD_META, type PatternId, PATTERN_IDS, PATTERNS } from "../core/patterns.ts";
import { renderAffirmation, renderFalsification, renderPrediction } from "../core/render.ts";
import { type CommandDeps, resolveTarget, revealLine } from "./context.ts";
import { KONGYO_LANGUAGE } from "./model.ts";
import { PLACEHOLDER } from "./providers.ts";

const BACK = Symbol("back");
type Answer = string | typeof BACK | undefined;

/** 鋳造で項を訊く順序。`p` は最後。主張が固まる前に確率を決めると、幅寄せが戻ってくる。 */
const ASK_ORDER: readonly FieldKey[] = ["D", "T", "E", "S", "S1", "S2", "O", "CMP", "C", "J", "p", "R"];

function placeholderFor(key: FieldKey, nowMs: number): string {
  if (key !== "D") return PLACEHOLDER[key];
  return `例：${formatDate(addDays(new Date(nowMs), 30))}（YYYY-MM-DD または YYYY-MM-DDThh:mm）`;
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
    input.placeholder = placeholderFor(key, nowMs);
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

export async function castCommand(deps: CommandDeps, uri?: vscode.Uri, lineNumber?: number): Promise<void> {
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

  await revealLine(document, firstLine);
  await deps.statusBar.refresh();
  deps.pending.refresh();

  const affirmation = describe(line).affirmation;
  void vscode.window.showInformationMessage(
    affirmation === null ? "台帳へ追記した。" : `台帳へ追記した。${affirmation}`,
  );
}
