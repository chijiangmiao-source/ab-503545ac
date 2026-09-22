/**
 * 文本输入解析。
 *
 * 约定的门定义语法（每行一个，# 之后为注释）：
 *   G1 = AND(A, B, G2)
 *   G2: OR B C
 * 标识仅允许 ASCII：字母/数字/下划线/连字符，且首字符为字母、数字或下划线。
 * 基本事件每行可写多个，以空白或逗号分隔。
 */
import type { GateDef, GateType, ParsedGateLine, ParsedModel } from './types';

const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function stripComment(line: string): string {
  const hash = line.indexOf('#');
  return hash >= 0 ? line.slice(0, hash) : line;
}

/** 解析基本事件文本，保留出现顺序与行号。 */
export function parseEvents(eventsText: string): {
  ids: string[];
  lines: Map<string, number>;
  invalid: { token: string; line: number }[];
} {
  const ids: string[] = [];
  const lines = new Map<string, number>();
  const invalid: { token: string; line: number }[] = [];
  eventsText.split('\n').forEach((rawLine, idx) => {
    const line = idx + 1;
    const text = stripComment(rawLine).trim();
    if (!text) return;
    for (const token of text.split(/[\s,]+/).filter(Boolean)) {
      if (!isValidId(token)) {
        invalid.push({ token, line });
      } else {
        if (!lines.has(token)) lines.set(token, line);
        ids.push(token);
      }
    }
  });
  return { ids, lines, invalid };
}

const GATE_HEAD_RE =
  /^([A-Za-z0-9_][A-Za-z0-9_-]*)\s*[:=]\s*(AND|OR)\b[\s:(]*(.*?)\s*\)?\s*$/i;

/** 解析单行门定义。 */
export function parseGateLine(rawLine: string, line: number): ParsedGateLine {
  const result: ParsedGateLine = { line, raw: rawLine, children: [] };
  const text = stripComment(rawLine).trim();
  if (!text) return result;

  const m = text.match(GATE_HEAD_RE);
  if (!m) {
    result.parseError =
      '无法识别的门定义，期望格式：ID = AND(输入1, 输入2) 或 ID: OR A B';
    return result;
  }
  const [, id, typeRaw, restRaw] = m;
  if (!isValidId(id)) {
    result.parseError = `非法门标识「${id}」`;
    return result;
  }
  const type = typeRaw.toUpperCase() as GateType;
  const children = restRaw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  result.id = id;
  result.type = type;
  result.children = children;

  if (children.length === 0) {
    result.parseError = `门 ${id} 至少需要一个输入（不支持常量门）`;
  }
  const badChild = children.find((c) => !isValidId(c));
  if (badChild) {
    result.parseError = `门 ${id} 含有非法输入标识「${badChild}」`;
  }
  return result;
}

export function parseGates(gatesText: string): {
  gates: GateDef[];
  badLines: ParsedGateLine[];
} {
  const gates: GateDef[] = [];
  const badLines: ParsedGateLine[] = [];
  gatesText.split('\n').forEach((raw, idx) => {
    const parsed = parseGateLine(raw, idx + 1);
    if (!parsed.raw.trim() || stripComment(parsed.raw).trim() === '') return;
    if (parsed.parseError || !parsed.id || !parsed.type) {
      badLines.push(parsed);
      return;
    }
    gates.push({
      id: parsed.id,
      type: parsed.type,
      children: parsed.children,
      line: parsed.line,
    });
  });
  return { gates, badLines };
}

export function parseTop(topText: string): {
  top: string | null;
  extra: string[];
} {
  const tokens = stripComment(topText)
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  return { top: tokens[0] ?? null, extra: tokens.slice(1) };
}

export function parseModel(input: {
  eventsText: string;
  gatesText: string;
  topText: string;
}): ParsedModel & {
  invalidEvents: { token: string; line: number }[];
} {
  const ev = parseEvents(input.eventsText);
  const { gates, badLines } = parseGates(input.gatesText);
  const { top, extra: topExtra } = parseTop(input.topText);
  return {
    events: ev.ids,
    eventLines: ev.lines,
    gates,
    badLines,
    top,
    topExtra,
    invalidEvents: ev.invalid,
  };
}
