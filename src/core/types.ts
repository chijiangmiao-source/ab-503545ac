/**
 * 故障树领域模型类型定义。
 * 全部计算均在浏览器本地完成，不存在任何网络调用。
 */

export type GateType = 'AND' | 'OR';

/** 门输入行的解析中间形态（保留行号与原文，便于错误定位）。 */
export interface ParsedGateLine {
  /** 文本框中的 1 起始行号 */
  line: number;
  raw: string;
  id?: string;
  type?: GateType;
  children: string[];
  parseError?: string;
}

/** 通过解析的门定义。 */
export interface GateDef {
  id: string;
  type: GateType;
  children: string[];
  /** 定义所在行（1 起始） */
  line: number;
}

export type IssueCode =
  | 'parse_error'
  | 'invalid_id'
  | 'duplicate_event'
  | 'duplicate_gate'
  | 'id_conflict'
  | 'missing_reference'
  | 'self_reference'
  | 'cycle'
  | 'count_event'
  | 'count_gate'
  | 'top_missing'
  | 'unreachable_gate';

export interface Issue {
  severity: 'error' | 'warning';
  code: IssueCode;
  message: string;
  /** 1 起始行号（可定位时给出） */
  line?: number;
  gateId?: string;
  /** 环路径（含首尾重复节点），如 ['G1','G2','G1'] */
  path?: string[];
}

export interface FaultTreeInputs {
  eventsText: string;
  gatesText: string;
  topText: string;
}

export interface ParsedModel {
  events: string[];
  /** 每个唯一基本事件首次出现的行号 */
  eventLines: Map<string, number>;
  gates: GateDef[];
  /** 无法解析成行的门文本（保留在输入中，不参与计算） */
  badLines: ParsedGateLine[];
  top: string | null;
  /** 顶事件框中首个标识之外的多余 token（属于非法输入） */
  topExtra: string[];
}
