import { describe, expect, it } from "vitest";

import { classifyChange, restorePatch, sealedBodies } from "../src/core/guard.ts";

const A = "[2026-08-04] P1 p=0.35 D=2026-09-30 S=a O=b C=1 J=API R=閾値を変更  →";
const B = "[2026-08-05] P1 p=0.60 D=2026-10-31 S=c O=d C=2 J=API R=閾値を変更  →";
const DRAFT = "P1 p=0.50 D=2026-11-30 S=e O=f C=3 J=API R=閾値を変更";

const LEDGER = ["# 台帳", A, B, DRAFT].join("\n");
const SEALED = sealedBodies(LEDGER);

describe("sealedBodies", () => {
  it("刻印を持つ行だけを封じる", () => {
    expect(SEALED.size).toBe(2);
  });
});

describe("classifyChange", () => {
  it("末尾への追記は許す", () => {
    const next = `${LEDGER}\n[2026-08-06] P1 p=0.20 D=2026-12-31 S=g O=h C=4 J=API R=閾値を変更  →`;
    expect(classifyChange(LEDGER, next, SEALED).legal).toBe(true);
  });

  it("確定行の間への挿入も許す（追記のみの規則は本文の不変を意味する）", () => {
    const next = ["# 台帳", A, "P1 p=0.1 D=2027-01-01 S=x O=y C=1 J=API R=閾値を変更", B, DRAFT].join("\n");
    expect(classifyChange(LEDGER, next, SEALED).legal).toBe(true);
  });

  it("未確定の行は自由に書き換えられる", () => {
    const next = LEDGER.replace(DRAFT, "P1 p=0.99 D=2026-11-30 S=e O=f C=3 J=API R=閾値を変更");
    expect(classifyChange(LEDGER, next, SEALED).legal).toBe(true);
  });

  it("末尾記号の置換は許し、判定として記録する", () => {
    const next = LEDGER.replace(A, A.replace(/→$/, "×"));
    const result = classifyChange(LEDGER, next, SEALED);
    expect(result.legal).toBe(true);
    expect(result.verdictRewrites).toHaveLength(1);
    expect(result.verdictRewrites[0]?.from).toBe("pending");
    expect(result.verdictRewrites[0]?.to).toBe("miss");
  });

  it("判定済みの記号の書き換えも許すが、書き換えとして残る", () => {
    const judged = LEDGER.replace(A, A.replace(/→$/, "×"));
    const sealed = sealedBodies(judged);
    const next = judged.replace(A.replace(/→$/, "×"), A.replace(/→$/, "○"));
    const result = classifyChange(judged, next, sealed);
    expect(result.legal).toBe(true);
    expect(result.verdictRewrites[0]?.from).toBe("miss");
    expect(result.verdictRewrites[0]?.to).toBe("hit");
  });

  it("確定行の本文の書き換えは許さない", () => {
    const next = LEDGER.replace("p=0.35", "p=0.90");
    const result = classifyChange(LEDGER, next, SEALED);
    expect(result.legal).toBe(false);
    expect(result.violation).toBe("body-edit");
    expect(result.offendingBody).toContain("p=0.35");
  });

  it("確定行の削除は許さない", () => {
    const next = LEDGER.split("\n")
      .filter((line) => line !== B)
      .join("\n");
    const result = classifyChange(LEDGER, next, SEALED);
    expect(result.legal).toBe(false);
    expect(result.violation).toBe("deletion");
  });

  it("確定行の並べ替えは許さない", () => {
    const next = ["# 台帳", B, A, DRAFT].join("\n");
    const result = classifyChange(LEDGER, next, SEALED);
    expect(result.legal).toBe(false);
    expect(result.violation).toBe("reorder");
  });

  it("確定行への「ただし」節の追加は C6 の事後追加として印が付く", () => {
    const next = LEDGER.replace("C=1 J=API", "C=1 ただし状況次第 J=API");
    const result = classifyChange(LEDGER, next, SEALED);
    expect(result.legal).toBe(false);
    expect(result.addedException).toBe(true);
  });

  it("封が無ければ何をしても通る", () => {
    expect(classifyChange(LEDGER, "", new Set()).legal).toBe(true);
  });
});

describe("restorePatch", () => {
  it("差し戻しは変わった範囲だけを置き換える", () => {
    const next = LEDGER.replace("p=0.35", "p=0.90");
    const patch = restorePatch(LEDGER, next);
    expect(patch).not.toBeNull();
    if (patch === null) return;
    const restored = next.slice(0, patch.start) + patch.text + next.slice(patch.end);
    expect(restored).toBe(LEDGER);
    // 行全体ではなく、変わった数文字だけを置き換える。
    expect(patch.end - patch.start).toBeLessThan(8);
  });

  it("同一なら何もしない", () => {
    expect(restorePatch(LEDGER, LEDGER)).toBeNull();
  });

  it("行の削除も戻せる", () => {
    const next = LEDGER.split("\n")
      .filter((line) => line !== B)
      .join("\n");
    const patch = restorePatch(LEDGER, next);
    if (patch === null) throw new Error("patch があるはず");
    expect(next.slice(0, patch.start) + patch.text + next.slice(patch.end)).toBe(LEDGER);
  });
});
