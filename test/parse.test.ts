import { describe, expect, it } from "vitest";

import { bodyOf, fieldValue, isEasy, markerOf, parseLine, parseProbability } from "../src/core/parse.ts";

const EXAMPLE =
  "[2026-08-04] P1 p=0.35 D=2026-09-30 S=PR#412 O=mergedフラグ C=true J=GitHub API R=外れたら、見積もりを+2日側へ改訂  →";

describe("parseLine", () => {
  it("§6 のシリアライズ形式を読む", () => {
    const line = parseLine(EXAMPLE);
    expect(line.kind).toBe("prediction");
    if (line.kind !== "prediction") return;
    expect(line.stamp).toBe("2026-08-04");
    expect(line.pattern).toBe("P1");
    expect(line.verdict).toBe("pending");
    expect(fieldValue(line, "p")).toBe("0.35");
    expect(fieldValue(line, "D")).toBe("2026-09-30");
    expect(fieldValue(line, "S")).toBe("PR#412");
    expect(fieldValue(line, "O")).toBe("mergedフラグ");
    expect(fieldValue(line, "C")).toBe("true");
    expect(fieldValue(line, "J")).toBe("GitHub API");
    expect(fieldValue(line, "R")).toBe("外れたら、見積もりを+2日側へ改訂");
  });

  it("項の位置は元テキストの索引を指す", () => {
    const line = parseLine(EXAMPLE);
    if (line.kind !== "prediction") throw new Error("prediction であるはず");
    for (const field of line.fields) {
      expect(EXAMPLE.slice(field.valueSpan.start, field.valueSpan.end)).toBe(field.value);
    }
  });

  it("全角で書かれていても読むが、索引はずれない", () => {
    const text = "Ｐ１　ｐ＝０．３５　Ｄ＝２０２６－０９－３０";
    const line = parseLine(text);
    expect(line.kind).toBe("prediction");
    if (line.kind !== "prediction") return;
    expect(line.pattern).toBe("P1");
    expect(fieldValue(line, "p")).toBe("0.35");
    // 全角ハイフンは半角へ写るので、日付も絶対日付として読める。
    expect(fieldValue(line, "D")).toBe("2026-09-30");
    expect(line.fields.every((f) => f.valueSpan.end <= text.length)).toBe(true);
  });

  it("P4 の下付き記号を読む", () => {
    const line = parseLine("P4 p=0.70 D=2026-09-30 S₁=自分の提案 S₂=1件 O=採用数 比較=以下 J=議事録 R=候補から外す");
    if (line.kind !== "prediction") throw new Error("prediction であるはず");
    expect(fieldValue(line, "S1")).toBe("自分の提案");
    expect(fieldValue(line, "S2")).toBe("1件");
    expect(fieldValue(line, "CMP")).toBe("以下");
  });

  it("値の末尾の長音符を判定記号と誤らない", () => {
    const line = parseLine("P1 p=0.5 D=2026-09-30 S=x O=y C=1 J=タイマー R=閾値を変更");
    if (line.kind !== "prediction") throw new Error("prediction であるはず");
    expect(line.verdict).toBeNull();
    expect(fieldValue(line, "R")).toBe("閾値を変更");
  });

  it("末尾記号を置換した行も同じ本文を持つ", () => {
    const judged = EXAMPLE.replace(/→$/, "×");
    expect(bodyOf(judged)).toBe(bodyOf(EXAMPLE));
    expect(markerOf(judged)).toBe("miss");
    expect(markerOf(EXAMPLE)).toBe("pending");
  });

  it("[易] は値に混ざらない", () => {
    const line = parseLine("[2026-08-04] P1 [易] p=0.95 D=2026-09-30 S=x O=y C=1 J=API R=閾値を変更  →");
    if (line.kind !== "prediction") throw new Error("prediction であるはず");
    expect(line.easySpan).not.toBeNull();
    expect(fieldValue(line, "p")).toBe("0.95");
  });

  it("記法を通らない散文は unformalized", () => {
    expect(parseLine("このPRはたぶん今週中に通る").kind).toBe("unformalized");
    expect(parseLine("   ").kind).toBe("blank");
    expect(parseLine("# ただのコメント").kind).toBe("comment");
  });

  it("型と項のあいだの語は straySpans に載る", () => {
    const text = "P1 予備メモ p=0.5 D=2026-09-30";
    const line = parseLine(text);
    if (line.kind !== "prediction") throw new Error("prediction であるはず");
    expect(line.straySpans).toHaveLength(1);
    const stray = line.straySpans[0];
    if (stray === undefined) return;
    expect(text.slice(stray.start, stray.end)).toBe("予備メモ");
  });

  it("正しい行と [易] は straySpans を作らない", () => {
    const clean = parseLine(EXAMPLE);
    if (clean.kind !== "prediction") throw new Error("prediction であるはず");
    expect(clean.straySpans).toHaveLength(0);

    const easy = parseLine("[2026-08-04] P1 [易] p=0.95 D=2026-09-30 S=x O=y C=1 J=API R=閾値を変更  →");
    if (easy.kind !== "prediction") throw new Error("prediction であるはず");
    expect(easy.straySpans).toHaveLength(0);
  });

  it("[易] を挟む両側の語は、範囲が割れて [易] を含まない", () => {
    const text = "P1 前の語 [易] 後の語 p=0.95 D=2026-09-30";
    const line = parseLine(text);
    if (line.kind !== "prediction") throw new Error("prediction であるはず");
    expect(line.straySpans).toHaveLength(2);
    const words = line.straySpans.map((stray) => text.slice(stray.start, stray.end));
    expect(words).toEqual(["前の語", "後の語"]);
    // 削除の修正が有効な [易] を巻き込まないこと。
    expect(line.easySpan).not.toBeNull();
  });

  it("記録行を読む", () => {
    const line = parseLine('# kongyo-note at=2026-08-04T10:00 kind=解除 ref="[2026-08-01] P1 p=0.3" detail="行=12"');
    expect(line.kind).toBe("comment");
    if (line.kind !== "comment") return;
    expect(line.note?.kind).toBe("解除");
    expect(line.note?.at).toBe("2026-08-04T10:00");
    expect(line.note?.ref).toBe("[2026-08-01] P1 p=0.3");
    expect(line.note?.detail).toBe("行=12");
  });
});

describe("parseProbability", () => {
  it("0.00–1.00 の数値だけを受ける", () => {
    expect(parseProbability("0.35")).toBe(0.35);
    expect(parseProbability("0")).toBe(0);
    expect(parseProbability("1")).toBe(1);
    expect(parseProbability(".5")).toBe(0.5);
    expect(parseProbability("たぶん")).toBeNull();
    expect(parseProbability("60%")).toBeNull();
    expect(parseProbability("1.5")).toBeNull();
    expect(parseProbability("35")).toBeNull();
  });
});

describe("isEasy", () => {
  it("標示が無くても p だけで易問を判定する", () => {
    expect(isEasy(0.95, false)).toBe(true);
    expect(isEasy(0.05, false)).toBe(true);
    expect(isEasy(0.5, false)).toBe(false);
    expect(isEasy(0.5, true)).toBe(true);
    expect(isEasy(null, false)).toBe(false);
  });
});
