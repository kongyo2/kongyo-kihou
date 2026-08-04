import { describe, expect, it } from "vitest";

import {
  checkLine,
  compileChecks,
  DEFAULT_CHECK_OPTIONS,
  hasBlockingIssue,
  type Issue,
  missingFields,
  validateFieldValue,
} from "../src/core/checks.ts";
import { parseLine, type PredictionLine } from "../src/core/parse.ts";

const CHECKS = compileChecks(DEFAULT_CHECK_OPTIONS);
const NOW = new Date(2026, 7, 4, 12, 0, 0).getTime(); // 2026-08-04 12:00 ローカル

function issues(text: string): readonly Issue[] {
  return checkLine(parseLine(text), CHECKS, NOW);
}

function rules(text: string): readonly string[] {
  return issues(text)
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.ruleId);
}

function prediction(text: string): PredictionLine {
  const line = parseLine(text);
  if (line.kind !== "prediction") throw new Error("prediction であるはず");
  return line;
}

describe("鋳造例（記法 §8）は却下されない", () => {
  it("例1：PR のマージ", () => {
    expect(
      rules(
        "P1 p=0.60 D=2026-08-11T23:59 S=PR#412 O=mergedフラグ C=true J=GitHub API R=外れたら、レビュー所要日数の見積もりを+2日側へ改訂",
      ),
    ).toEqual([]);
  });

  it("例2：負荷試験", () => {
    expect(
      rules(
        "P1 p=0.45 D=2026-10-01 S=v2API O=p95レイテンシ@同時接続1000 C=<300ms J=負荷試験スクリプトの出力 R=外れたら、キュー方式を第一候補に格上げ",
      ),
    ).toEqual([]);
  });

  it("例3：比較型（D を絶対日付へ直したもの）", () => {
    expect(
      rules(
        "P4 p=0.70 D=2026-09-30 S₁=自分の提案 S₂=1件 O=採用数 比較=以下 J=議事録 R=外れたら、対立の原因の帰属先を「相性」から外す",
      ),
    ).toEqual([]);
  });

  it("P5 は五項で足りる", () => {
    expect(
      rules("P5 p=0.20 D=2026-12-31 E=本番環境での全断 J=監視のアラート履歴 R=外れたら、冗長化を第一候補に格上げ"),
    ).toEqual([]);
  });
});

describe("必須項", () => {
  it("欠けた項は却下される", () => {
    expect(rules("P1 p=0.5")).toContain("F-MISSING");
    expect(missingFields(prediction("P1 p=0.5"))).toEqual(["D", "S", "O", "C", "J", "R"]);
  });

  it("記号だけあって値が空なら却下される", () => {
    expect(rules("P1 p=0.5 D= S=x O=y C=1 J=API R=閾値を変更")).toContain("F-EMPTY");
  });

  it("型に無い項は却下される", () => {
    expect(rules("P1 p=0.5 D=2026-09-30 S=x O=y C=1 J=API R=閾値を変更 E=何か")).toContain("F-UNKNOWN");
  });

  it("型が無ければ却下される", () => {
    expect(rules("p=0.5 D=2026-09-30")).toContain("G-TYPE");
  });
});

describe("C1 前後性 / D の相対表現", () => {
  it("相対表現は却下される（無期限の言い訳を塞ぐ）", () => {
    const found = issues("P1 p=0.5 D=来週 S=x O=y C=1 J=API R=閾値を変更").filter((issue) => issue.ruleId === "C1");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("相対表現不可");
    expect(found[0]?.fixes.length).toBeGreaterThan(0);
  });

  it("既に過ぎた期日は後知恵として却下される", () => {
    expect(rules("P1 p=0.5 D=2026-07-01 S=x O=y C=1 J=API R=閾値を変更")).toContain("C1");
  });

  it("当日の期日はその日の終わりまで有効", () => {
    expect(rules("P1 p=0.5 D=2026-08-04 S=x O=y C=1 J=API R=閾値を変更")).toEqual([]);
  });

  it("存在しない暦日は読めない", () => {
    expect(rules("P1 p=0.5 D=2026-02-30 S=x O=y C=1 J=API R=閾値を変更")).toContain("C1");
  });
});

describe("C5 数値確率", () => {
  it("語は却下される", () => {
    expect(rules("P1 p=たぶん D=2026-09-30 S=x O=y C=1 J=API R=閾値を変更")).toContain("C5");
  });

  it("百分率には鋳造の修正が付く", () => {
    const found = issues("P1 p=60% D=2026-09-30 S=x O=y C=1 J=API R=閾値を変更").find((issue) => issue.ruleId === "C5");
    expect(found?.fixes[0]?.title).toContain("0.60");
  });
});

describe("C8 難度標示", () => {
  it("p≥0.90 に [易] が無ければ警告する", () => {
    const found = issues("P1 p=0.95 D=2026-09-30 S=x O=y C=1 J=API R=閾値を変更").find(
      (issue) => issue.ruleId === "C8",
    );
    expect(found?.severity).toBe("warning");
    expect(found?.fixes[0]?.title).toBe("[易] を付す");
  });

  it("[易] があれば警告しない", () => {
    expect(
      issues("P1 [易] p=0.95 D=2026-09-30 S=x O=y C=1 J=API R=閾値を変更").some((issue) => issue.ruleId === "C8"),
    ).toBe(false);
  });
});

describe("文法：選言は存在しない", () => {
  it("「AまたはB」は非文", () => {
    const found = issues("P1 p=0.5 D=2026-09-30 S=x O=リリース済 C=true または false J=API R=閾値を変更").find(
      (issue) => issue.ruleId === "G-DISJUNCTION",
    );
    expect(found?.severity).toBe("error");
    expect(found?.excuse).toBe("両張り");
    const fix = found?.fixes[0];
    expect(fix?.kind).toBe("split");
    if (fix?.kind !== "split") return;
    expect(fix.lines).toHaveLength(2);
    // 分割した二行は p を空にする。前の確率を持ち越すのは分割していないのと同じ。
    expect(fix.lines.every((line) => /p=(?:\s|$)/.test(line))).toBe(true);
  });
});

describe("C4 単一観測", () => {
  it("O の連言は却下される", () => {
    const found = issues("P1 p=0.5 D=2026-09-30 S=x O=mergedフラグ かつ CI成功 C=true J=API R=閾値を変更").find(
      (issue) => issue.ruleId === "C4",
    );
    expect(found?.severity).toBe("error");
    expect(found?.fixes[0]?.kind).toBe("split");
  });
});

describe("§5 禁止語彙", () => {
  it("O 欄の「かなり」は却下される", () => {
    const found = issues("P1 p=0.5 D=2026-09-30 S=x O=かなり速い応答 C=<300ms J=API R=閾値を変更").find(
      (issue) => issue.ruleId === "G-VOCABULARY",
    );
    expect(found?.severity).toBe("error");
    expect(found?.message).toContain("閾値の数値");
  });

  it("O 欄の「成功する」は定義ずらしとして却下される", () => {
    const found = issues("P1 p=0.5 D=2026-09-30 S=x O=成功する C=true J=API R=閾値を変更").find(
      (issue) => issue.ruleId === "G-VOCABULARY",
    );
    expect(found?.excuse).toBe("定義ずらし");
  });

  it("S 欄では警告に留まる（§5 は O・C の規則）", () => {
    const found = issues("P1 p=0.5 D=2026-09-30 S=かなり大きい集団 O=件数 C=>10 J=API R=閾値を変更").find(
      (issue) => issue.ruleId === "G-VOCABULARY",
    );
    expect(found?.severity).toBe("warning");
  });
});

describe("C2 外部判定", () => {
  it("自分が判定するだけの J は却下される", () => {
    expect(rules("P1 p=0.5 D=2026-09-30 S=x O=y C=1 J=自分 R=閾値を変更")).toContain("C2");
  });

  it("裁量の語がある J は却下される", () => {
    expect(rules("P1 p=0.5 D=2026-09-30 S=x O=y C=1 J=総合的な判断 R=閾値を変更")).toContain("C2");
  });

  it("自分でも手順が固定されていれば通る", () => {
    expect(rules("P1 p=0.5 D=2026-09-30 S=x O=y C=1 J=自分がGitHubのAPIで取得 R=閾値を変更")).toEqual([]);
  });
});

describe("C7 停止条件", () => {
  it("態度は処置ではない", () => {
    expect(rules("P1 p=0.5 D=2026-09-30 S=x O=y C=1 J=API R=気をつける")).toContain("C7");
    expect(rules("P1 p=0.5 D=2026-09-30 S=x O=y C=1 J=API R=解釈を改める")).toContain("C7");
  });

  it("書き換え対象を指していない処置は却下される", () => {
    expect(rules("P1 p=0.5 D=2026-09-30 S=x O=y C=1 J=API R=よく考える")).toContain("C7");
  });
});

describe("C3 反証形", () => {
  it("C に閾値も状態も無ければ却下される", () => {
    expect(rules("P1 p=0.5 D=2026-09-30 S=x O=y C=よい感じ J=API R=閾値を変更")).toContain("C3");
  });

  it("比較は閉じた集合", () => {
    expect(rules("P4 p=0.5 D=2026-09-30 S₁=a S₂=b O=件数 比較=だいたい同じ J=API R=閾値を変更")).toContain("C3");
  });
});

describe("C6 例外閉包", () => {
  it("判定可能な観測を持たない「ただし」節は却下される", () => {
    expect(rules("P1 p=0.5 D=2026-09-30 S=x O=件数 C=>10 ただし状況が変わらなければ J=API R=閾値を変更")).toContain(
      "C6",
    );
  });

  it("判定可能な観測を持つ「ただし」節は通る", () => {
    expect(rules("P1 p=0.5 D=2026-09-30 S=x O=件数 C=>10 ただし停止時間が0分の場合 J=API R=閾値を変更")).toEqual([]);
  });
});

describe("未形式化", () => {
  it("散文は在庫送りの対象として警告し、含まれる言い訳を挙げる", () => {
    const found = issues("このPRはたぶん今週中に通る");
    expect(found.some((issue) => issue.ruleId === "G-UNFORMALIZED")).toBe(true);
    expect(found.filter((issue) => issue.ruleId === "G-VOCABULARY").length).toBeGreaterThan(0);
    expect(hasBlockingIssue(found)).toBe(false);
  });
});

describe("確定行", () => {
  it("確定した行には実行できない修正を出さない", () => {
    const found = issues("[2026-08-04] P1 p=0.95 D=2026-09-30 S=x O=y C=1 J=API R=閾値を変更  →");
    const c8 = found.find((issue) => issue.ruleId === "C8");
    expect(c8).toBeDefined();
    expect(c8?.fixes).toEqual([]);
  });

  it("末尾記号の無い確定行には → を足す修正が出る", () => {
    const found = issues("[2026-08-04] P1 p=0.5 D=2026-09-30 S=x O=y C=1 J=API R=閾値を変更").find(
      (issue) => issue.ruleId === "G-MARKER",
    );
    expect(found?.fixes[0]?.title).toBe("→ を足す");
  });
});

describe("validateFieldValue（鋳造ウィザードの打鍵ごとの検査）", () => {
  it("空の値を通さない", () => {
    expect(validateFieldValue("P1", "D", "", CHECKS, NOW)).not.toBeNull();
  });

  it("相対表現を通さない", () => {
    expect(validateFieldValue("P1", "D", "来月", CHECKS, NOW)).toContain("相対表現不可");
  });

  it("絶対日付を通す", () => {
    expect(validateFieldValue("P1", "D", "2026-09-30", CHECKS, NOW)).toBeNull();
  });

  it("語の確率を通さない", () => {
    expect(validateFieldValue("P1", "p", "たぶん", CHECKS, NOW)).not.toBeNull();
    expect(validateFieldValue("P1", "p", "0.35", CHECKS, NOW)).toBeNull();
  });

  it("自判の J を通さない", () => {
    expect(validateFieldValue("P1", "J", "自分の感覚", CHECKS, NOW)).not.toBeNull();
  });

  it("態度の R を通さない", () => {
    expect(validateFieldValue("P1", "R", "気をつける", CHECKS, NOW)).not.toBeNull();
    expect(validateFieldValue("P1", "R", "見積もりを+2日側へ改訂", CHECKS, NOW)).toBeNull();
  });

  it("他の項の記号が混ざった値を通さない", () => {
    expect(validateFieldValue("P1", "O", "x J=自分", CHECKS, NOW)).toContain("一行一予測");
  });
});
