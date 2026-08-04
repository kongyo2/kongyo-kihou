import { describe, expect, it } from "vitest";

import { kongyoFencedRegions } from "../src/core/fence.ts";

function regions(lines: readonly string[]): readonly { start: number; end: number }[] {
  return [...kongyoFencedRegions(lines.length, (index) => lines[index] ?? "")];
}

describe("kongyoFencedRegions", () => {
  it("```kongyo フェンスの本文範囲を返す", () => {
    expect(regions(["前", "```kongyo", "P1 p=0.5", "```", "後"])).toEqual([{ start: 2, end: 3 }]);
  });

  it("```kgy も読む（注入文法と同じもの）", () => {
    expect(regions(["```kgy", "P1", "```"])).toEqual([{ start: 1, end: 2 }]);
  });

  it("大文字も読む", () => {
    expect(regions(["```KONGYO", "P1", "```"])).toEqual([{ start: 1, end: 2 }]);
  });

  it("~~~ フェンスも読む", () => {
    expect(regions(["~~~kongyo", "P1", "~~~"])).toEqual([{ start: 1, end: 2 }]);
  });

  it("閉じは開きと同じ文字でなければならない", () => {
    // ``` で開いたフェンスは ~~~ では閉じない（CommonMark と同じ）。
    expect(regions(["```kongyo", "P1", "~~~", "P2", "```"])).toEqual([{ start: 1, end: 4 }]);
  });

  it("閉じは開きと同じ長さ以上でなければならない", () => {
    expect(regions(["````kongyo", "```", "P1", "````"])).toEqual([{ start: 1, end: 3 }]);
  });

  it("閉じられないフェンスは文書末尾まで", () => {
    expect(regions(["```kongyo", "P1", "P2"])).toEqual([{ start: 1, end: 3 }]);
  });

  it("kongyo 以外のフェンスは対象外", () => {
    expect(regions(["```python", "print(1)", "```"])).toEqual([]);
    expect(regions(["```kongyox", "P1", "```"])).toEqual([]);
  });

  it("空のフェンスは範囲を作らない", () => {
    expect(regions(["```kongyo", "```"])).toEqual([]);
  });
});
