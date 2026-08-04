import { describe, expect, it } from "vitest";

import { parseLine, type PredictionLine } from "../src/core/parse.ts";
import {
  blankProbability,
  canonicalize,
  renderAffirmation,
  renderFalsification,
  renderLedgerNote,
  renderPrediction,
  splitFieldValue,
  toDraft,
} from "../src/core/render.ts";

function prediction(text: string): PredictionLine {
  const line = parseLine(text);
  if (line.kind !== "prediction") throw new Error("prediction であるはず");
  return line;
}

describe("renderPrediction", () => {
  it("§6 の順序で書き出す", () => {
    const line = renderPrediction({
      pattern: "P1",
      values: new Map([
        ["R", "見積もりを+2日側へ改訂"],
        ["J", "GitHub API"],
        ["C", "true"],
        ["O", "mergedフラグ"],
        ["S", "PR#412"],
        ["D", "2026-09-30"],
        ["p", "0.35"],
      ]),
      stamp: "2026-08-04",
      easy: false,
      verdict: "pending",
    });
    expect(line).toBe(
      "[2026-08-04] P1 p=0.35 D=2026-09-30 S=PR#412 O=mergedフラグ C=true J=GitHub API R=見積もりを+2日側へ改訂  →",
    );
  });

  it("往復しても同じ行になる", () => {
    const text = "[2026-08-04] P1 [易] p=0.95 D=2026-09-30 S=a O=b C=1 J=API R=閾値を変更  ×";
    const draft = toDraft(prediction(text));
    expect(draft).not.toBeNull();
    if (draft === null) return;
    expect(renderPrediction(draft)).toBe(text);
  });
});

describe("canonicalize", () => {
  it("順序と間隔を正規形へ寄せる", () => {
    expect(canonicalize("P1   D=2026-09-30 R=閾値を変更 p=0.4 S=a O=b C=1 J=API")).toBe(
      "P1 p=0.4 D=2026-09-30 S=a O=b C=1 J=API R=閾値を変更",
    );
  });

  it("未知の項を含む行は触らない（情報を落とさない）", () => {
    const text = "P1 p=0.4 D=2026-09-30 S=a O=b C=1 J=API R=閾値を変更 E=余計な項";
    expect(canonicalize(text)).toBe(text);
  });
});

describe("反証文", () => {
  it("P1 の外れた世界を一文で書く", () => {
    const text = "P1 p=0.6 D=2026-08-11 S=PR#412 O=mergedフラグ C=true J=GitHub API R=閾値を変更";
    expect(renderFalsification(prediction(text))).toBe(
      "2026-08-11 時点で、PR#412 の mergedフラグ が true になっていない。判定は GitHub API。",
    );
    expect(renderAffirmation(prediction(text))).toBe("2026-08-11 までに、PR#412 の mergedフラグ が true になる。");
  });

  it("P4 は比較の向きを反転させる", () => {
    const text = "P4 p=0.7 D=2026-09-30 S₁=自分の提案 S₂=1件 O=採用数 比較=以下 J=議事録 R=候補から外す";
    expect(renderFalsification(prediction(text))).toContain("より 超過");
  });

  it("P5 は起きる側が反証になる", () => {
    const text = "P5 p=0.2 D=2026-12-31 E=全断 J=監視ログ R=冗長化を第一候補に格上げ";
    expect(renderFalsification(prediction(text))).toBe("2026-12-31 までに、全断 が起きる。判定は 監視ログ。");
  });

  it("必須項が欠けていれば書けない（＝C3 に落ちる）", () => {
    expect(renderFalsification(prediction("P1 p=0.6 D=2026-08-11"))).toBeNull();
  });
});

describe("splitFieldValue", () => {
  it("選言を二行に割り、確率を空にする", () => {
    const text = "P1 p=0.5 D=2026-09-30 S=a O=b C=通る または 落ちる J=API R=閾値を変更";
    const line = prediction(text);
    const field = line.fields.find((f) => f.key === "C");
    if (field === undefined) throw new Error("C があるはず");
    const at = text.indexOf("または");
    const [first, second] = splitFieldValue(text, field.valueSpan, {
      start: at,
      end: at + "または".length,
    });
    expect(first).toContain("C=通る");
    expect(second).toContain("C=落ちる");
    expect(first).toContain("p= ");
    expect(second).toContain("p= ");
  });
});

describe("blankProbability", () => {
  it("p が無ければ足す", () => {
    expect(blankProbability("P1 D=2026-09-30")).toBe("P1 D=2026-09-30 p=");
  });
});

describe("renderLedgerNote", () => {
  it("読み戻せる形で書く", () => {
    const note = renderLedgerNote("解除", "2026-08-04T10:00", "[2026-08-01] P1 p=0.3", "行=12");
    const parsed = parseLine(note);
    expect(parsed.kind).toBe("comment");
    if (parsed.kind !== "comment") return;
    expect(parsed.note?.kind).toBe("解除");
    expect(parsed.note?.ref).toBe("[2026-08-01] P1 p=0.3");
    expect(parsed.note?.detail).toBe("行=12");
  });
});
