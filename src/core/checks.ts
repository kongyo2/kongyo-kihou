/**
 * §3 の静的検査（書いた時点で走る）と、§2 の文法規則、§5 の禁止語彙。
 *
 * 検査は一行で閉じる。前後の行を参照しないので、打鍵のたびに走らせても費用が線形に収まる。
 * 行を跨ぐ拘束（追記のみ・編集不可・事後追加不可）は台帳側の責務であって、ここには無い。
 */

import { addDays, formatDate, looksRelative, parseAbsoluteDate } from "./datetime.ts";
import { type FieldKey, FIELD_META, COMPARISONS, type PatternId, PATTERN_IDS, PATTERNS } from "./patterns.ts";
import {
  fieldValue,
  getField,
  isEasy,
  type KongyoLine,
  parseLine,
  parseProbability,
  type PredictionLine,
} from "./parse.ts";
import type { RuleId } from "./rules.ts";
import { splitFieldValue } from "./render.ts";
import { findAll, type Span, span, trimmedEnd, trimmedStart, unionRegex } from "./text.ts";
import {
  BANNED_VOCABULARY,
  CONJUNCTION_SOURCES,
  DEFINITE_CONDITION_SOURCES,
  DISCRETION_SOURCES,
  DISJUNCTION_SOURCES,
  EXCEPTION_SOURCES,
  PROCEDURE_SOURCES,
  REWRITE_VERB_SOURCES,
  SELF_JUDGE_SOURCES,
  VAGUE_REMEDY,
  type VocabularyEntry,
} from "./vocabulary.ts";

export type Severity = "error" | "warning" | "information";

export interface IssueFixReplace {
  readonly kind: "replace";
  readonly title: string;
  readonly span: Span;
  readonly text: string;
}

export interface IssueFixSplit {
  readonly kind: "split";
  readonly title: string;
  readonly lines: readonly string[];
}

export interface IssueFixCommand {
  readonly kind: "command";
  readonly title: string;
  readonly command: string;
}

export type IssueFix = IssueFixReplace | IssueFixSplit | IssueFixCommand;

export interface Issue {
  readonly ruleId: RuleId;
  readonly severity: Severity;
  readonly message: string;
  readonly span: Span;
  readonly fixes: readonly IssueFix[];
  /** 塞いでいる言い訳の型（§4）。診断の補足に出す。 */
  readonly excuse: string | null;
}

export interface CheckOptions {
  readonly vocabularyEnforcement: "oc" | "all";
  readonly extraVocabulary: readonly VocabularyEntry[];
  readonly selfPatterns: readonly string[];
  readonly discretionPatterns: readonly string[];
  readonly procedurePatterns: readonly string[];
  readonly rewriteVerbs: readonly string[];
  readonly requireRewriteVerb: boolean;
  readonly requireDefiniteCondition: boolean;
}

export const DEFAULT_CHECK_OPTIONS: CheckOptions = {
  vocabularyEnforcement: "oc",
  extraVocabulary: [],
  selfPatterns: [],
  discretionPatterns: [],
  procedurePatterns: [],
  rewriteVerbs: [],
  requireRewriteVerb: true,
  requireDefiniteCondition: true,
};

interface CompiledVocabulary {
  readonly entry: VocabularyEntry;
  readonly regex: RegExp;
}

export interface CompiledChecks {
  readonly banned: readonly CompiledVocabulary[];
  readonly vagueRemedy: readonly CompiledVocabulary[];
  readonly disjunction: RegExp;
  readonly conjunction: RegExp;
  readonly exception: RegExp;
  readonly definite: RegExp;
  readonly selfJudge: RegExp;
  readonly discretion: RegExp;
  readonly procedure: RegExp;
  readonly rewriteVerb: RegExp;
  readonly options: CheckOptions;
}

function safeRegex(sources: readonly string[]): RegExp {
  const usable: string[] = [];
  for (const source of sources) {
    try {
      // 組み立てられることの確認。組み立てた結果は束ねる側で作り直す。
      const probe = new RegExp(source, "g");
      if (probe.source.length > 0) usable.push(source);
    } catch {
      // 設定の書き損じで検査全体が止まるほうが害が大きい。落として続ける。
    }
  }
  return unionRegex(usable);
}

function compileVocabulary(entries: readonly VocabularyEntry[]): readonly CompiledVocabulary[] {
  const out: CompiledVocabulary[] = [];
  for (const entry of entries) {
    try {
      out.push({ entry, regex: new RegExp(entry.source, "g") });
    } catch {
      // 同上。
    }
  }
  return out;
}

export function compileChecks(options: CheckOptions): CompiledChecks {
  return {
    banned: compileVocabulary([...BANNED_VOCABULARY, ...options.extraVocabulary]),
    vagueRemedy: compileVocabulary(VAGUE_REMEDY),
    disjunction: safeRegex(DISJUNCTION_SOURCES),
    conjunction: safeRegex(CONJUNCTION_SOURCES),
    exception: safeRegex(EXCEPTION_SOURCES),
    definite: safeRegex(DEFINITE_CONDITION_SOURCES),
    selfJudge: safeRegex([...SELF_JUDGE_SOURCES, ...options.selfPatterns]),
    discretion: safeRegex([...DISCRETION_SOURCES, ...options.discretionPatterns]),
    procedure: safeRegex([...PROCEDURE_SOURCES, ...options.procedurePatterns]),
    rewriteVerb: safeRegex([...REWRITE_VERB_SOURCES, ...options.rewriteVerbs]),
    options,
  };
}

function testRe(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  const hit = re.test(text);
  re.lastIndex = 0;
  return hit;
}

/** 値の中の相対位置を、行の中の絶対位置へ移す。 */
function shift(base: Span, inner: Span): Span {
  return span(base.start + inner.start, base.start + inner.end);
}

/** §5 の禁止語彙を走査する対象の項。`D` `p` `J` `R` はそれぞれ専用の規則が見る。 */
const VOCABULARY_FIELDS: readonly FieldKey[] = ["S", "S1", "S2", "O", "C", "T", "E"];
const DISJUNCTION_FIELDS: readonly FieldKey[] = ["S", "S1", "S2", "O", "C", "T", "E", "R"];

function lineSpan(text: string): Span {
  const start = trimmedStart(text);
  const end = trimmedEnd(text);
  return span(start, Math.max(start, end));
}

function checkFieldPresence(line: PredictionLine, pattern: PatternId, out: Issue[]): void {
  const spec = PATTERNS[pattern];
  const allowed = new Set<FieldKey>([...spec.required, ...spec.optional]);
  const seen = new Set<FieldKey>();
  const anchor = line.patternSpan ?? lineSpan(line.text);

  for (const field of line.fields) {
    if (!allowed.has(field.key)) {
      out.push({
        ruleId: "F-UNKNOWN",
        severity: "error",
        message: `${pattern}（${spec.name}）に ${FIELD_META[field.key].token} は無い。構文は「${spec.syntax}」。`,
        span: field.keySpan,
        fixes: [],
        excuse: null,
      });
      continue;
    }
    if (seen.has(field.key)) {
      out.push({
        ruleId: "F-DUPLICATE",
        severity: "error",
        message: `${FIELD_META[field.key].token} が二度書かれている。どちらを読むかが決まらない文は判定できない。`,
        span: field.keySpan,
        fixes: [],
        excuse: null,
      });
      continue;
    }
    seen.add(field.key);
    if (field.value.length === 0) {
      out.push({
        ruleId: "F-EMPTY",
        severity: "error",
        message: `${FIELD_META[field.key].token}（${FIELD_META[field.key].label}）が空。§1「一つでも空なら、それは予測ではない」。`,
        span: field.keySpan,
        fixes: [],
        excuse: null,
      });
    }
  }

  // 足すのは本文の末尾。末尾記号があるなら、その手前でなければ項が記号の外に出てしまう。
  const insertAt =
    line.verdictSpan === null ? trimmedEnd(line.text) : trimmedEnd(line.text.slice(0, line.verdictSpan.start));

  for (const key of spec.required) {
    if (seen.has(key)) continue;
    const meta = FIELD_META[key];
    out.push({
      ruleId: "F-MISSING",
      severity: "error",
      message: `必須項 ${meta.token}（${meta.label}）が無い。${meta.description}。`,
      span: anchor,
      fixes: [
        {
          kind: "replace",
          title: `${meta.token}= を足す`,
          span: span(insertAt, insertAt),
          text: ` ${meta.token}=`,
        },
      ],
      excuse: key === "D" ? "無期限" : null,
    });
  }
}

/** 型と項のあいだの語。正規形が保存しないものを、黙って消える前に却下する。 */
function checkStray(line: PredictionLine, out: Issue[]): void {
  if (line.straySpan === null) return;
  const word = line.text.slice(line.straySpan.start, line.straySpan.end);
  out.push({
    ruleId: "G-STRAY",
    severity: "error",
    message: `「${word}」はどの項にも属さない。この位置の語は確定でも整形でも保存されない。項の値に入れるか、削除する。`,
    span: line.straySpan,
    fixes: [
      {
        kind: "replace",
        title: `「${word.slice(0, 20)}」を削除する`,
        span: line.straySpan,
        text: "",
      },
    ],
    excuse: null,
  });
}

function checkDeadline(line: PredictionLine, nowMs: number, out: Issue[]): void {
  const field = getField(line, "D");
  if (field === null || field.value.length === 0) return;
  const parsed = parseAbsoluteDate(field.value);
  const now = new Date(nowMs);

  if (parsed === null) {
    const relative = looksRelative(field.value);
    out.push({
      ruleId: "C1",
      severity: "error",
      message: relative
        ? `D は相対表現不可。「${field.value}」は判定が返る日時を指していない。YYYY-MM-DD もしくは YYYY-MM-DDThh:mm で書く。`
        : `D を絶対日付として読めない：「${field.value}」。YYYY-MM-DD もしくは YYYY-MM-DDThh:mm で書く。`,
      span: field.valueSpan,
      fixes: [7, 30, 90].map((days) => ({
        kind: "replace" as const,
        title: `${formatDate(addDays(now, days))}（${String(days)}日後）にする`,
        span: field.valueSpan,
        text: formatDate(addDays(now, days)),
      })),
      excuse: "無期限",
    });
    return;
  }

  // 前後性の基準時刻。刻印があるならそれが記述時刻、無いなら「いま」。
  const stampMs = line.stamp === null ? null : (parseAbsoluteDate(line.stamp)?.startMs ?? null);
  const referenceMs = stampMs ?? nowMs;
  if (parsed.deadlineMs <= referenceMs) {
    out.push({
      ruleId: "C1",
      severity: "error",
      message:
        line.stamp === null
          ? `C1 前後性：D（${parsed.iso}）が既に過ぎている。記述時刻 < D でなければ後知恵になる。`
          : `C1 前後性：記述時刻（${line.stamp}）が D（${parsed.iso}）以降。後知恵の行。`,
      span: field.valueSpan,
      fixes:
        line.stamp === null
          ? [30, 90].map((days) => ({
              kind: "replace" as const,
              title: `${formatDate(addDays(now, days))}（${String(days)}日後）にする`,
              span: field.valueSpan,
              text: formatDate(addDays(now, days)),
            }))
          : [],
      excuse: null,
    });
  }
}

function checkProbability(line: PredictionLine, out: Issue[]): void {
  const field = getField(line, "p");
  if (field === null || field.value.length === 0) return;
  const value = parseProbability(field.value);
  if (value === null) {
    const percent = /^(\d{1,3})(?:\.(\d+))?\s*[%％]$/.exec(field.value);
    const bare = /^(\d{1,3})$/.exec(field.value);
    const fixes: IssueFix[] = [];
    const raw = percent?.[1] ?? bare?.[1];
    if (raw !== undefined) {
      const asNumber = Number.parseFloat(`${raw}.${percent?.[2] ?? "0"}`) / 100;
      if (asNumber >= 0 && asNumber <= 1) {
        fixes.push({
          kind: "replace",
          title: `p=${asNumber.toFixed(2)} に鋳造する`,
          span: field.valueSpan,
          text: asNumber.toFixed(2),
        });
      }
    }
    out.push({
      ruleId: "C5",
      severity: "error",
      message: `C5 数値確率：p は 0.00–1.00 の数値のみ。「${field.value}」は語であって数値ではない。`,
      span: field.valueSpan,
      fixes,
      excuse: "幅寄せ",
    });
    return;
  }

  if (isEasy(value, false) && line.easySpan === null) {
    const anchor = line.patternSpan;
    out.push({
      ruleId: "C8",
      severity: "warning",
      message: `C8 難度標示：p=${field.value} は易問。[易] を付す。付さなくても集計の主成分からは除外される。`,
      span: field.valueSpan,
      fixes:
        anchor === null
          ? []
          : [
              {
                kind: "replace",
                title: "[易] を付す",
                span: span(anchor.end, anchor.end),
                text: " [易]",
              },
            ],
      excuse: "易問偏重",
    });
  }
}

function checkSingleObservation(line: PredictionLine, checks: CompiledChecks, out: Issue[]): void {
  for (const key of ["O", "C"] as const) {
    const field = getField(line, key);
    if (field === null || field.value.length === 0) continue;
    for (const hit of findAll(checks.conjunction, field.value)) {
      const at = shift(field.valueSpan, hit);
      out.push({
        ruleId: "C4",
        severity: key === "O" ? "error" : "warning",
        message:
          key === "O"
            ? "C4 単一観測：O はただ一つ。連言があるなら分割して複数行にする。"
            : "C は連言を許すが、観測が二つに割れていないか確かめること（§2「複合は連言に限る」）。",
        span: at,
        fixes: [
          {
            kind: "split",
            title: "二行に分割する（各行に p を振り直す）",
            lines: [...splitFieldValue(line.text, field.valueSpan, at)],
          },
        ],
        excuse: "定義ずらし",
      });
    }
  }
}

function checkDisjunction(line: PredictionLine, checks: CompiledChecks, out: Issue[]): void {
  for (const key of DISJUNCTION_FIELDS) {
    const field = getField(line, key);
    if (field === null || field.value.length === 0) continue;
    for (const hit of findAll(checks.disjunction, field.value)) {
      const at = shift(field.valueSpan, hit);
      out.push({
        ruleId: "G-DISJUNCTION",
        severity: "error",
        message: "選言は文法に存在しない。「A または B になる」は非文。二行に分割して各々に p を振る。",
        span: at,
        fixes: [
          {
            kind: "split",
            title: "二行に分割する（各行に p を振り直す）",
            lines: [...splitFieldValue(line.text, field.valueSpan, at)],
          },
        ],
        excuse: "両張り",
      });
    }
  }
}

function checkVocabulary(line: PredictionLine, checks: CompiledChecks, out: Issue[]): void {
  const strictAll = checks.options.vocabularyEnforcement === "all";
  for (const key of VOCABULARY_FIELDS) {
    const field = getField(line, key);
    if (field === null || field.value.length === 0) continue;
    const severity: Severity = strictAll || key === "O" || key === "C" ? "error" : "warning";
    for (const { entry, regex } of checks.banned) {
      for (const hit of findAll(regex, field.value)) {
        const at = shift(field.valueSpan, hit);
        const word = field.value.slice(hit.start, hit.end);
        out.push({
          ruleId: "G-VOCABULARY",
          severity,
          message: `禁止語彙「${word}」。${FIELD_META[key].token} 欄では使えない。→ ${entry.replacement} に鋳造する。`,
          span: at,
          fixes:
            entry.fixText === null
              ? []
              : [
                  {
                    kind: "replace",
                    title: entry.fixText.length === 0 ? `「${word}」を削除する` : `「${entry.fixText}」に置換する`,
                    span: at,
                    text: entry.fixText,
                  },
                ],
          excuse: entry.excuse,
        });
      }
    }
  }
}

function checkExceptionClosure(line: PredictionLine, checks: CompiledChecks, out: Issue[]): void {
  for (const field of line.fields) {
    if (field.value.length === 0) continue;
    for (const hit of findAll(checks.exception, field.value)) {
      const clause = field.value.slice(hit.start);
      if (testRe(checks.definite, clause)) continue;
      out.push({
        ruleId: "C6",
        severity: "error",
        message:
          "C6 例外閉包：「ただし」節は各々に判定可能な観測を持つこと。数値・比較・状態のいずれも無い節は逃げ道になる。",
        span: shift(field.valueSpan, hit),
        fixes: [
          {
            kind: "replace",
            title: "「ただし」節を削除する",
            span: span(field.valueSpan.start + hit.start, field.valueSpan.end),
            text: "",
          },
        ],
        excuse: "逃げ道",
      });
    }
  }
}

function checkJudge(line: PredictionLine, checks: CompiledChecks, out: Issue[]): void {
  const field = getField(line, "J");
  if (field === null || field.value.length === 0) return;

  const discretionHits = findAll(checks.discretion, field.value);
  if (discretionHits.length > 0) {
    const first = discretionHits[0];
    out.push({
      ruleId: "C2",
      severity: "error",
      message: "C2 外部判定：J に裁量が入っている。判定手順を J 欄に固定し、その手順に裁量が入らないようにする。",
      span: first === undefined ? field.valueSpan : shift(field.valueSpan, first),
      fixes: [],
      excuse: "自判",
    });
    return;
  }

  if (testRe(checks.selfJudge, field.value) && !testRe(checks.procedure, field.value)) {
    out.push({
      ruleId: "C2",
      severity: "error",
      message:
        "C2 外部判定：J が自分。自分で判定するなら、読む手順（コマンド・ログ・API・議事録など）を J 欄に書き切ること。",
      span: field.valueSpan,
      fixes: [],
      excuse: "自判",
    });
  }
}

function checkRemedy(line: PredictionLine, checks: CompiledChecks, out: Issue[]): void {
  const field = getField(line, "R");
  if (field === null || field.value.length === 0) return;

  let vague = false;
  for (const { entry, regex } of checks.vagueRemedy) {
    for (const hit of findAll(regex, field.value)) {
      vague = true;
      out.push({
        ruleId: "C7",
        severity: "error",
        message: `C7 停止条件：「${field.value.slice(hit.start, hit.end)}」は書き換え対象を指していない。→ ${entry.replacement}。`,
        span: shift(field.valueSpan, hit),
        fixes: [],
        excuse: entry.excuse,
      });
    }
  }
  if (vague) return;

  if (checks.options.requireRewriteVerb && !testRe(checks.rewriteVerb, field.value)) {
    out.push({
      ruleId: "C7",
      severity: "error",
      message:
        "C7 停止条件：R が具体的な書き換えを指していない。「何を」「どちら側へ」書き換えるかを書く（例：見積もりを +2 日側へ改訂）。",
      span: field.valueSpan,
      fixes: [],
      excuse: "本質化",
    });
  }
}

function checkCondition(line: PredictionLine, checks: CompiledChecks, out: Issue[]): void {
  if (!checks.options.requireDefiniteCondition) return;
  const field = getField(line, "C");
  if (field === null || field.value.length === 0) return;
  if (testRe(checks.definite, field.value)) return;
  out.push({
    ruleId: "C3",
    severity: "error",
    message:
      "C3 反証形：C に閾値も状態も無い。「この予測が外れた世界」を一文で書けるだけの条件を書く（数値・比較・状態のいずれか）。",
    span: field.valueSpan,
    fixes: [],
    excuse: "本質化",
  });
}

function checkComparison(line: PredictionLine, out: Issue[]): void {
  const field = getField(line, "CMP");
  if (field === null || field.value.length === 0) return;
  if ((COMPARISONS as readonly string[]).includes(field.value)) return;
  out.push({
    ruleId: "C3",
    severity: "error",
    message: `比較は ${COMPARISONS.join(" / ")} のいずれか。「${field.value}」は向きが定まらない。`,
    span: field.valueSpan,
    fixes: COMPARISONS.map((value) => ({
      kind: "replace" as const,
      title: `比較=${value} にする`,
      span: field.valueSpan,
      text: value,
    })),
    excuse: null,
  });
}

function checkMarker(line: PredictionLine, out: Issue[]): void {
  if (line.stamp === null || line.verdict !== null) return;
  const end = trimmedEnd(line.text);
  out.push({
    ruleId: "G-MARKER",
    severity: "warning",
    message: "確定行に末尾記号が無い。未判定は →、判定済みは ○ × － のいずれかで終わる。",
    span: span(Math.max(0, end - 1), end),
    fixes: [{ kind: "replace", title: "→ を足す", span: span(end, end), text: "  →" }],
    excuse: null,
  });
}

function checkUnformalized(line: string, checks: CompiledChecks, out: Issue[]): void {
  out.push({
    ruleId: "G-UNFORMALIZED",
    severity: "warning",
    message:
      "この行は記法を通っていない。鋳造するか、原文のまま未形式化在庫へ落とす（§7「通らなかったものは捨てず、在庫に落とす」）。",
    span: lineSpan(line),
    fixes: [
      { kind: "command", title: "予測に鋳造する", command: "kongyo.cast" },
      { kind: "command", title: "未形式化在庫へ落とす", command: "kongyo.toInventory" },
    ],
    excuse: null,
  });

  for (const { entry, regex } of checks.banned) {
    for (const hit of findAll(regex, line)) {
      out.push({
        ruleId: "G-VOCABULARY",
        severity: "information",
        message: `「${line.slice(hit.start, hit.end)}」は ${entry.excuse}。鋳造するなら ${entry.replacement} に置き換わる。`,
        span: hit,
        fixes: [],
        excuse: entry.excuse,
      });
    }
  }
}

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  error: 0,
  warning: 1,
  information: 2,
};

/** 一行を検査する。`nowMs` は C1 の基準時刻。 */
export function checkLine(line: KongyoLine, checks: CompiledChecks, nowMs: number): readonly Issue[] {
  const issues: Issue[] = [];

  if (line.kind === "unformalized") {
    checkUnformalized(line.text, checks, issues);
  } else if (line.kind === "prediction") {
    if (line.pattern === null) {
      issues.push({
        ruleId: "G-TYPE",
        severity: "error",
        message: `型が無い。行頭に ${PATTERN_IDS.join(" / ")} のいずれかを置く。`,
        span: lineSpan(line.text),
        fixes: PATTERN_IDS.map((id) => ({
          kind: "replace" as const,
          title: `${id}（${PATTERNS[id].name}）にする`,
          span: span(trimmedStart(line.text), trimmedStart(line.text)),
          text: `${id} `,
        })),
        excuse: null,
      });
    } else {
      checkFieldPresence(line, line.pattern, issues);
    }
    checkStray(line, issues);
    checkDeadline(line, nowMs, issues);
    checkProbability(line, issues);
    checkSingleObservation(line, checks, issues);
    checkDisjunction(line, checks, issues);
    checkVocabulary(line, checks, issues);
    checkExceptionClosure(line, checks, issues);
    checkJudge(line, checks, issues);
    checkRemedy(line, checks, issues);
    checkCondition(line, checks, issues);
    checkComparison(line, issues);
    checkMarker(line, issues);
  }

  issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.span.start - b.span.start);

  // 確定行は本文を書き換えられない。実行できない修正を出すのは嘘になる。
  if (line.kind === "prediction" && line.stamp !== null) {
    return issues.map((issue) =>
      issue.ruleId === "G-MARKER" ? issue : { ...issue, fixes: [] as readonly IssueFix[] },
    );
  }
  return issues;
}

export function hasBlockingIssue(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

/**
 * 項の値ひとつを、その項に効く規則だけで検査する。鋳造ウィザードの打鍵ごとの検査に使う。
 *
 * 合成した一行を本検査に通してから、その項に落ちた却下だけを拾う。
 * ウィザードとエディタで別の実装を持つと、片方だけが緩む。
 */
export function validateFieldValue(
  pattern: PatternId,
  key: FieldKey,
  value: string,
  checks: CompiledChecks,
  nowMs: number,
): string | null {
  const token = FIELD_META[key].token;
  const text = `${pattern} ${token}=${value}`;
  const line = parseLine(text);
  if (line.kind !== "prediction") return `${token} を読み取れない。`;
  if (line.fields.length !== 1) {
    return `${token} の値に他の項の記号（例：\` D=\`）が混ざっている。一行一予測、一項一値。`;
  }
  const field = getField(line, key);
  if (field === null) return `${token} を読み取れない。`;
  const upper = Math.max(field.valueSpan.end, field.keySpan.end);
  const blocking = checkLine(line, checks, nowMs).filter(
    (issue) =>
      issue.severity === "error" &&
      issue.ruleId !== "F-MISSING" &&
      issue.span.start >= field.keySpan.start &&
      issue.span.end <= upper,
  );
  return blocking[0]?.message ?? null;
}

/** 欠けている必須項。インレイヒントで行末に出す。 */
export function missingFields(line: PredictionLine): readonly FieldKey[] {
  if (line.pattern === null) return [];
  const present = new Set(line.fields.filter((f) => f.value.length > 0).map((f) => f.key));
  return PATTERNS[line.pattern].required.filter((key) => !present.has(key));
}

/** `p` を読む。読めなければ null。集計とホバーで使う。 */
export function probabilityOf(line: PredictionLine): number | null {
  return parseProbability(fieldValue(line, "p"));
}
