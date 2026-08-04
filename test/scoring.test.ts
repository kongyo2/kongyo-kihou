import { describe, expect, it } from "vitest";

import { dueEntries, inventoryStats, pendingEntries, tally } from "../src/core/scoring.ts";

const NOW = new Date(2026, 7, 4, 12, 0, 0).getTime();

const LEDGER = [
  "# 台帳",
  "[2026-06-01] P1 p=0.30 D=2026-07-01 S=a O=b C=1 J=API R=閾値を変更  ○",
  "[2026-06-01] P1 p=0.80 D=2026-07-01 S=c O=d C=1 J=API R=閾値を変更  ×",
  "[2026-06-01] P1 p=0.50 D=2026-07-01 S=e O=f C=1 J=API R=閾値を変更  －",
  "[2026-06-01] P1 [易] p=0.95 D=2026-07-01 S=g O=h C=1 J=API R=閾値を変更  ○",
  "[2026-06-01] P1 p=0.05 D=2026-07-01 S=i O=j C=1 J=API R=閾値を変更  ×",
  "[2026-08-01] P1 p=0.40 D=2026-08-02 S=k O=l C=1 J=API R=閾値を変更  →",
  "[2026-08-01] P1 p=0.40 D=2026-12-31 S=m O=n C=1 J=API R=閾値を変更  →",
  "P1 p=0.40 D=2026-12-31 S=o O=p C=1 J=API R=閾値を変更",
  '# kongyo-note at=2026-08-03T09:00 kind=解除 ref="x" detail="行=3"',
  '# kongyo-note at=2026-08-03T09:05 kind=C6事後追加 ref="x" detail=""',
].join("\n");

const LINES = LEDGER.split("\n");

describe("tally", () => {
  const counts = tally(LINES, NOW);

  it("× と － の絶対数を数える", () => {
    expect(counts.miss).toBe(2);
    expect(counts.undecidable).toBe(1);
  });

  it("○ の数は型に存在しない（§6）", () => {
    expect(Object.keys(counts)).not.toContain("hit");
  });

  it("[易] をブライアスコアから除外する", () => {
    // 除外されるのは p=0.95（標示あり）と p=0.05（標示無しでも p で易問）。
    expect(counts.easyExcluded).toBe(2);
    expect(counts.brierCount).toBe(2);
    // (0.30-1)^2 + (0.80-0)^2 = 0.49 + 0.64 = 1.13、n=2。
    expect(counts.brier).toBeCloseTo(0.565, 6);
  });

  it("確定と未確定を分ける", () => {
    expect(counts.total).toBe(8);
    expect(counts.sealed).toBe(7);
    expect(counts.pending).toBe(2);
    expect(counts.due).toBe(1);
  });

  it("破った回数を数える", () => {
    expect(counts.notes.解除).toBe(1);
    expect(counts.notes.C6事後追加).toBe(1);
    expect(counts.notes.判定書換).toBe(0);
  });

  it("判定対象が無ければブライアスコアは null", () => {
    expect(tally(["# 何も無い"], NOW).brier).toBeNull();
  });
});

describe("dueEntries / pendingEntries", () => {
  it("期日が来て未判定のものだけを返す", () => {
    const due = dueEntries(LINES, NOW);
    expect(due).toHaveLength(1);
    expect(due[0]?.text).toContain("S=k");
  });

  it("未判定は期日前も含めて期日順に並ぶ", () => {
    const pending = pendingEntries(LINES);
    expect(pending).toHaveLength(2);
    expect(pending[0]?.text).toContain("S=k");
    expect(pending[1]?.text).toContain("S=m");
  });
});

describe("inventoryStats", () => {
  it("見出しを数え、直近30日を分ける", () => {
    const text = [
      "# 未形式化在庫",
      "## 2026-08-03T10:00",
      "",
      "> あの人とは合わない",
      "",
      "## 2026-05-01T10:00",
      "",
      "> いずれ分かる",
    ].join("\n");
    const stats = inventoryStats(text, NOW);
    expect(stats.total).toBe(2);
    expect(stats.last30Days).toBe(1);
  });
});
