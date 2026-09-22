/**
 * 分析编排：文本输入 → 解析 → 结构校验 → 割集引擎 → 顶事件结论与事件归属。
 * 存在任何校验错误时绝不进入数值计算；
 * 顶事件链路触发 complexity_limit 时绝不输出截断割集或基于截断的归属结论。
 */
import { parseModel } from './parser';
import { validate } from './validate';
import {
  buildEngine,
  classifyEvents,
  type CompleteGateResult,
  type EventRole,
  type GateResult,
  type LimitedGateResult,
  sortedCutSets,
} from './cutsets';
import type { FaultTreeInputs, Issue } from './types';

export interface GateSummary {
  id: string;
  type: 'AND' | 'OR';
  line: number;
  reachable: boolean;
  result: GateResult;
  /** 完整时给出解码后的极小割集；超限时为 undefined，绝不展示部分结果 */
  cutSets?: string[][];
  cutCount: number;
}

export type AnalysisStatus = 'invalid' | 'ok' | 'limited';

export interface AnalysisResult {
  status: AnalysisStatus;
  issues: Issue[];
  top: string | null;
  topIsEvent: boolean;
  gates: GateSummary[];
  /** 顶事件极小割集（按事件标识排序、割集间字典序）；仅 status === 'ok' 时存在 */
  topCutSets?: string[][];
  classification?: Record<EventRole, string[]>;
  /** 顶事件链路超限时，首个超限门标识 */
  limitReasonGateId?: string;
  uniqueEventCount: number;
  uniqueGateCount: number;
}

export function analyze(input: FaultTreeInputs): AnalysisResult {
  const parsed = parseModel(input);

  const badLineIssues: Issue[] = parsed.badLines.map((b) => ({
    severity: 'error',
    code: 'parse_error' as const,
    line: b.line,
    message: b.parseError ?? `第 ${b.line} 行无法解析`,
  }));

  const validation = validate(
    parsed.events,
    parsed.gates,
    parsed.top,
    parsed.invalidEvents,
    badLineIssues,
    parsed.eventLines,
    parsed.topExtra,
  );

  const uniqueEventCount = new Set(parsed.events).size;
  const uniqueGateCount = new Set(parsed.gates.map((g) => g.id)).size;
  const base = {
    issues: validation.issues,
    top: parsed.top,
    topIsEvent: parsed.top !== null && new Set(parsed.events).has(parsed.top),
    uniqueEventCount,
    uniqueGateCount,
  };

  if (validation.errors.length > 0) {
    return {
      ...base,
      status: 'invalid',
      gates: [],
    };
  }

  const engine = buildEngine(parsed.gates, [...new Set(parsed.events)]);
  const eventSet = new Set(parsed.events);
  const topIsEvent = parsed.top !== null && eventSet.has(parsed.top);

  const gates: GateSummary[] = parsed.gates.map((g) => {
    const result = engine.results.get(g.id)!;
    const summary: GateSummary = {
      id: g.id,
      type: g.type,
      line: g.line,
      reachable: validation.reachable.has(g.id),
      result,
      cutCount: result.status === 'complete' ? result.cuts.length : 0,
    };
    if (result.status === 'complete') {
      summary.cutSets = sortedCutSets(result.cuts, engine.bitToEvent);
    }
    return summary;
  });

  // 顶事件直接是基本事件：割集为单元素 {top}
  if (topIsEvent) {
    const topCutSets = [[parsed.top as string]];
    const classification: Record<EventRole, string[]> = {
      mandatory: [parsed.top as string],
      optional: [],
      irrelevant: [...eventSet].filter((e) => e !== parsed.top).sort(),
    };
    classification.mandatory.sort();
    return { ...base, status: 'ok', gates, topCutSets, classification };
  }

  const topResult = parsed.top
    ? engine.results.get(parsed.top)
    : undefined;

  if (!topResult) {
    // 理论上校验阶段已拦截（顶事件未定义），此处为防御性分支
    return {
      ...base,
      status: 'invalid',
      gates,
      issues: [
        ...validation.issues,
        {
          severity: 'error' as const,
          code: 'top_missing' as const,
          message: `顶事件「${parsed.top ?? ''}」无计算结果`,
        },
      ],
    };
  }

  if (topResult.status === 'complexity_limit') {
    return {
      ...base,
      status: 'limited',
      gates,
      limitReasonGateId: topResult.reasonGateId,
    };
  }

  const topCuts = (topResult as CompleteGateResult).cuts;
  const topCutSets = sortedCutSets(topCuts, engine.bitToEvent);
  const cls = classifyEvents(
    topCuts,
    [...eventSet].sort(),
    engine.eventBits,
  );
  const classification: Record<EventRole, string[]> = {
    mandatory: [],
    optional: [],
    irrelevant: [],
  };
  for (const [id, role] of cls.role) classification[role].push(id);
  (Object.keys(classification) as EventRole[]).forEach((k) =>
    classification[k].sort(),
  );

  return { ...base, status: 'ok', gates, topCutSets, classification };
}

export type { LimitedGateResult };
