/**
 * 最小割集（Minimal Cut Sets）计算。
 *
 * 原理（单调布尔公式）：
 *   - 基本事件 e 的割集族为 [{e}]
 *   - OR 门：子门割集族取并，再做吸收极小化
 *   - AND 门：子门割集族做分配律笛卡尔积（逐项并集），每合并一个子门即极小化
 * 极小化 = 合并重复集合 + 消去所有真超集（吸收律：A⊇B ⇒ 删 A）。
 *
 * 共享 DAG 处理：每个门仅计算一次（拓扑序 + 备忘录），多个父门共享同一结果，
 * 不会因路径逐条展开而重复计算或产生错误的"超集割集"。
 *
 * 表示：基本事件不超过 30 个，单个割集用 32 位整数位掩码表示（JS 位运算
 * 作用于 32 位有符号整数，30 位安全），并集 = 按位或，包含 = (a & b) === a。
 */
import type { GateDef } from './types';

export const CUTOFF_LIMIT = 2000;
/**
 * 单次合并的候选生成硬上限（仅用于防止标签页耗尽内存）。
 * 由于每个被依赖门的规范化割集 ≤ CUTOFF_LIMIT，两因子笛卡尔积上界为
 * 2000*2000 = 4_000_000，该阈值在正常约束下永远不会先于自然耗尽触发。
 */
const GENERATION_CAP = 5_000_000;

export type GateComputationStatus = 'complete' | 'complexity_limit';

export type EventRole = 'mandatory' | 'optional' | 'irrelevant';

export interface CompleteGateResult {
  status: 'complete';
  /** 极小割集位掩码数组（内部不保证输出顺序） */
  cuts: number[];
}

export interface LimitedGateResult {
  status: 'complexity_limit';
  /** 触发上限的门：自身超限或其（传递）依赖中首个超限门 */
  reasonGateId: string;
}

export type GateResult = CompleteGateResult | LimitedGateResult;

export interface CutSetEngine {
  eventBits: Map<string, number>;
  bitToEvent: Map<number, string>;
  results: Map<string, GateResult>;
  /** 拓扑序（所有门） */
  order: string[];
}

function popCount32(x: number): number {
  // x 为非负位掩码（至多 30 位），逐位计数亦可；使用标准分治写法
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * 对候选割集做规范化：去重 + 消去所有真超集。
 * 返回按（基数升序、掩码升序）排列的极小割集。
 */
export function minimizeCuts(candidates: Iterable<number>): number[] {
  const unique = [...new Set(candidates)];
  unique.sort((a, b) => popCount32(a) - popCount32(b) || a - b);
  const kept: number[] = [];
  outer: for (const m of unique) {
    for (const k of kept) {
      // kept 中元素基数不大于 m；k⊆m 则 m 为真超集（已去重，必严格）
      if ((k & m) === k) continue outer;
    }
    kept.push(m);
  }
  return kept;
}

/**
 * 拓扑排序（子门先于父门）。调用方已保证无环。
 * dep[id] = 该门仍未计算的“门类型输入”数量；为 0 时即可入队。
 */
export function topoOrder(gates: GateDef[]): string[] {
  const byId = new Map(gates.map((g) => [g.id, g]));
  const parents = new Map<string, string[]>();
  for (const g of gates) parents.set(g.id, []);
  const dep = new Map<string, number>();
  for (const g of gates) {
    let n = 0;
    for (const ch of g.children) {
      if (byId.has(ch)) {
        n++;
        parents.get(ch)!.push(g.id);
      }
    }
    dep.set(g.id, n);
  }
  const queue = gates.filter((g) => (dep.get(g.id) ?? 0) === 0).map((g) => g.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const p of parents.get(id) ?? []) {
      const d = (dep.get(p) ?? 0) - 1;
      dep.set(p, d);
      if (d === 0) queue.push(p);
    }
  }
  return order;
}

export function buildEngine(
  gates: GateDef[],
  eventIds: string[],
): CutSetEngine {
  const eventBits = new Map<string, number>();
  const bitToEvent = new Map<number, string>();
  // 位编号按事件标识排序，保证掩码与标识顺序稳定一致
  const sortedEvents = [...eventIds].sort();
  sortedEvents.forEach((id, i) => {
    const bit = 1 << i;
    eventBits.set(id, bit);
    bitToEvent.set(bit, id);
  });

  const byId = new Map(gates.map((g) => [g.id, g]));
  const results = new Map<string, GateResult>();
  const order = topoOrder(gates);

  for (const id of order) {
    const gate = byId.get(id)!;
    // 幂等律：去重重复输入（AND(G,G)=G、OR(G,G)=G），语义不变且避免无谓组合爆炸
    const childIds = [...new Set(gate.children)];

    // 任一输入门已超限 ⇒ 本门无法精确计算，原样传播，绝不用部分结果冒充完整结论
    const limitedChild = childIds.find((ch) => {
      const r = results.get(ch);
      return r?.status === 'complexity_limit';
    });
    if (limitedChild !== undefined) {
      results.set(id, {
        status: 'complexity_limit',
        reasonGateId: (results.get(limitedChild) as LimitedGateResult).reasonGateId,
      });
      continue;
    }

    let limited = false;
    let reasonId = id;

    const familyOf = (ch: string): number[] => {
      const bit = eventBits.get(ch);
      if (bit !== undefined) return [bit];
      return (results.get(ch) as CompleteGateResult).cuts;
    };

    let cuts: number[];
    if (gate.type === 'OR') {
      const all: number[] = [];
      for (const ch of childIds) all.push(...familyOf(ch));
      cuts = minimizeCuts(all);
      if (cuts.length > CUTOFF_LIMIT) limited = true;
    } else {
      // AND：逐子门做笛卡尔积并集，每步极小化。
      // 注意 1：不能因“中间前缀”割集数 >2000 就提前判超限——后续子门可能使
      // 候选合并/被吸收而收缩（如前缀 {{A},{B}} 再 AND {{A,B}} 收敛为 1 个）。
      // 是否超限只依据最终规范化结果；GENERATION_CAP 仅作单步资源硬保护。
      // 注意 2：按割集族规模升序处理（限制性最强的先并入），使吸收尽早发生。
      const families = childIds
        .map(familyOf)
        .sort((a, b) => a.length - b.length);
      let acc: number[] = [0];
      for (const fam of families) {
        const next: number[] = [];
        let generated = 0;
        let stop = false;
        for (const a of acc) {
          for (const b of fam) {
            next.push(a | b);
            generated++;
            if (generated > GENERATION_CAP) {
              limited = true;
              reasonId = id;
              stop = true;
              break;
            }
          }
          if (stop) break;
        }
        if (limited) break;
        acc = minimizeCuts(next);
      }
      cuts = acc;
      if (!limited && cuts.length > CUTOFF_LIMIT) {
        limited = true;
        reasonId = id;
      }
    }

    if (limited) {
      results.set(id, { status: 'complexity_limit', reasonGateId: reasonId });
    } else {
      results.set(id, { status: 'complete', cuts });
    }
  }

  return { eventBits, bitToEvent, results, order };
}

/** 将位掩码割集解码为按事件标识排序的标识数组。 */
export function decodeCut(mask: number, bitToEvent: Map<number, string>): string[] {
  const out: string[] = [];
  for (let bit = 1, i = 0; i < 31; i++, bit <<= 1) {
    if (mask & bit) {
      const id = bitToEvent.get(bit);
      if (id !== undefined) out.push(id);
    }
  }
  return out;
}

/**
 * 输出排序：割集内事件按标识排序，割集之间按标识序列字典序排序。
 */
export function sortedCutSets(
  cuts: number[],
  bitToEvent: Map<number, string>,
): string[][] {
  return cuts
    .map((m) => decodeCut(m, bitToEvent))
    .sort((a, b) => {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
      }
      return a.length - b.length;
    });
}

export interface EventClassification {
  role: Map<string, EventRole>;
  /** 出现在至少一个割集中的事件位掩码 */
  orMask: number;
  /** 出现在所有割集中的事件位掩码 */
  andMask: number;
}

/**
 * 基本事件归属（针对顶事件极小割集族）：
 *   mandatory 必现——出现在每个割集中（全体割集交集）
 *   optional  可选——出现在部分割集中
 *   irrelevant 无关——不出现在任何割集中
 */
export function classifyEvents(
  cuts: number[],
  eventIds: string[],
  eventBits: Map<string, number>,
): EventClassification {
  let orMask = 0;
  let andMask = cuts.length > 0 ? cuts[0] : 0;
  for (const m of cuts) {
    orMask |= m;
    andMask &= m;
  }
  const role = new Map<string, EventRole>();
  for (const id of eventIds) {
    const bit = eventBits.get(id) ?? 0;
    if (cuts.length === 0 || !(bit & orMask)) {
      role.set(id, 'irrelevant');
    } else if (bit & andMask) {
      role.set(id, 'mandatory');
    } else {
      role.set(id, 'optional');
    }
  }
  return { role, orMask, andMask };
}
