/**
 * §6「一行一予測。追記のみ。編集不可。」を、変更イベントの上で判定する純関数。
 *
 * 確定行の同一性は「末尾記号を除いた本文」で見る。記号の置換だけは許されているので、
 * 本文を同一性にすると、判定の記入を編集と誤らずに済む。
 */

import { bodyOf, markerOf, parseLine, type Verdict } from "./parse.ts";
import { EXCEPTION_SOURCES } from "./vocabulary.ts";
import { findAll, unionRegex } from "./text.ts";

export type GuardViolation =
  /** 確定行の本文が書き換えられた。 */
  | "body-edit"
  /** 確定行が消された。 */
  | "deletion"
  /** 確定行の順序が入れ替わった。追記のみの台帳では起こり得ない。 */
  | "reorder";

export interface VerdictRewrite {
  readonly body: string;
  readonly from: Verdict | null;
  readonly to: Verdict | null;
}

export interface GuardResult {
  readonly legal: boolean;
  readonly violation: GuardViolation | null;
  /** 違反の対象になった確定行の本文。通知に出す。 */
  readonly offendingBody: string | null;
  /** 末尾記号の置換。判定済みの記号をさらに書き換えた場合は `from` が pending 以外になる。 */
  readonly verdictRewrites: readonly VerdictRewrite[];
  /** 違反と同時に「ただし」節が増えたか。C6 の事後追加を数えるためだけの印。 */
  readonly addedException: boolean;
}

const LEGAL: GuardResult = {
  legal: true,
  violation: null,
  offendingBody: null,
  verdictRewrites: [],
  addedException: false,
};

const EXCEPTION_RE = unionRegex(EXCEPTION_SOURCES);

function countExceptions(text: string): number {
  return findAll(EXCEPTION_RE, text).length;
}

function splitLines(text: string): readonly string[] {
  return text.split(/\r?\n/);
}

/** 刻印を持つ行の本文集合。保存時にここから封をし直す。 */
export function sealedBodies(text: string): ReadonlySet<string> {
  const set = new Set<string>();
  for (const line of splitLines(text)) {
    const parsed = parseLine(line);
    if (parsed.kind === "prediction" && parsed.stamp !== null) set.add(bodyOf(line));
  }
  return set;
}

/**
 * 変更が「追記のみ・編集不可」を満たすかを判定する。
 *
 * 許すもの：新しい行の挿入、確定行の末尾記号の置換、封のされていない行の自由な編集。
 * 許さないもの：確定行の本文の書き換え、削除、並べ替え。
 */
export function classifyChange(prevText: string, nextText: string, sealed: ReadonlySet<string>): GuardResult {
  if (prevText === nextText || sealed.size === 0) return LEGAL;

  const nextLines = splitLines(nextText);
  const positions = new Map<string, number[]>();
  nextLines.forEach((line, index) => {
    const body = bodyOf(line);
    const bucket = positions.get(body);
    if (bucket === undefined) positions.set(body, [index]);
    else bucket.push(index);
  });

  const addedException = countExceptions(nextText) > countExceptions(prevText);
  const rewrites: VerdictRewrite[] = [];
  let cursor = -1;

  for (const prevLine of splitLines(prevText)) {
    const body = bodyOf(prevLine);
    if (!sealed.has(body)) continue;

    const bucket = positions.get(body);
    const index = bucket?.find((candidate) => candidate > cursor);
    if (index === undefined) {
      // 本文がどこにも無いなら書き換えか削除。あるのに後ろへ回っているなら並べ替え。
      const missing = bucket === undefined || bucket.length === 0;
      return {
        legal: false,
        violation: missing ? violationForMissing(nextText, body) : "reorder",
        offendingBody: body,
        verdictRewrites: rewrites,
        addedException,
      };
    }

    cursor = index;
    const before = markerOf(prevLine);
    const after = markerOf(nextLines[index] ?? "");
    if (before !== after) rewrites.push({ body, from: before, to: after });
  }

  return {
    legal: true,
    violation: null,
    offendingBody: null,
    verdictRewrites: rewrites,
    addedException,
  };
}

/**
 * 消えた確定行が「書き換え」なのか「削除」なのかを分ける。
 * 先頭 12 文字が残っていれば書き換え、跡形も無ければ削除とみなす。通知の文面に使うだけ。
 */
function violationForMissing(nextText: string, body: string): GuardViolation {
  const head = body.slice(0, 12);
  if (head.length === 0) return "deletion";
  return nextText.includes(head) ? "body-edit" : "deletion";
}

export interface RestorePatch {
  /** `next` テキスト上の置換開始位置。 */
  readonly start: number;
  /** `next` テキスト上の置換終了位置（排他）。 */
  readonly end: number;
  /** そこへ書き戻す `prev` 側の文字列。 */
  readonly text: string;
}

/**
 * `next` を `prev` に戻す最小の置換。前方一致と後方一致を削るだけなので、
 * 大きな台帳でも差し戻しが行単位に収まり、カーソル位置が飛ばない。
 */
export function restorePatch(prev: string, next: string): RestorePatch | null {
  if (prev === next) return null;
  const limit = Math.min(prev.length, next.length);
  let head = 0;
  while (head < limit && prev[head] === next[head]) head += 1;
  let tail = 0;
  while (tail < limit - head && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) {
    tail += 1;
  }
  return {
    start: head,
    end: next.length - tail,
    text: prev.slice(head, prev.length - tail),
  };
}
