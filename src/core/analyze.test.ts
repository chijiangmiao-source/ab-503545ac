import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import type { FaultTreeInputs } from './types';
import { minimizeCuts, CUTOFF_LIMIT } from './cutsets';
import { findCycles } from './validate';
import type { GateDef } from './types';
import { SAMPLE } from './sample';

const mk = (
  events: string[],
  gates: Array<[string, 'AND' | 'OR', string[]]>,
  top: string,
): FaultTreeInputs => ({
  eventsText: events.join('\n'),
  gatesText: gates
    .map(([id, type, ch], i) => `${id} = ${type}(${ch.join(', ')}) #L${i + 1}`)
    .join('\n'),
  topText: top,
});

describe('minimizeCuts 吸收律', () => {
  it('消去真超集并合并重复集合', () => {
    // 位：A=1 B=2 C=4
    const A = 1,
      B = 2,
      C = 4;
    // {A}, {A,B}, {B}, {A}(重复), {A,B,C}
    const out = minimizeCuts([A, A | B, B, A, A | B | C]);
    expect(out).toEqual([A, B]);
  });

  it('相等集合仅保留一个', () => {
    expect(minimizeCuts([1 | 2, 2 | 1, 1 | 2])).toEqual([3]);
  });
});

describe('吸收律场景的最小割集', () => {
  it('AND(OR(A,B), A) 只剩 {A}（{A,B} 被吸收）', () => {
    const r = analyze(
      mk(
        ['A', 'B'],
        [
          ['G1', 'OR', ['A', 'B']],
          ['G2', 'AND', ['G1', 'A']],
        ],
        'G2',
      ),
    );
    expect(r.status).toBe('ok');
    expect(r.topCutSets).toEqual([['A']]);
    expect(r.classification).toEqual({
      mandatory: ['A'],
      optional: [],
      irrelevant: ['B'],
    });
  });

  it('OR(AND(A,B), A) 只剩 {A}', () => {
    const r = analyze(
      mk(
        ['A', 'B'],
        [
          ['G1', 'AND', ['A', 'B']],
          ['G2', 'OR', ['G1', 'A']],
        ],
        'G2',
      ),
    );
    expect(r.status).toBe('ok');
    expect(r.topCutSets).toEqual([['A']]);
  });

  it('幂等与冗余输入：OR(G,G)、AND(G,G) 与 G 等价', () => {
    const r = analyze(
      mk(
        ['A', 'B'],
        [
          ['G', 'OR', ['A', 'B']],
          ['T1', 'OR', ['G', 'G']],
          ['T2', 'AND', ['G', 'G']],
        ],
        'T1',
      ),
    );
    expect(r.topCutSets).toEqual([['A'], ['B']]);
    const r2 = analyze(
      mk(
        ['A', 'B'],
        [
          ['G', 'OR', ['A', 'B']],
          ['T2', 'AND', ['G', 'G']],
        ],
        'T2',
      ),
    );
    expect(r2.topCutSets).toEqual([['A'], ['B']]);
  });
});

describe('共享子门 DAG', () => {
  it('共享子门只计算一次且不产生重复/超集割集', () => {
    // G_S 被两个父门共享
    const r = analyze(
      mk(
        ['A', 'B', 'C', 'D'],
        [
          ['GS', 'OR', ['A', 'B']],
          ['L', 'AND', ['GS', 'C']],
          ['R', 'AND', ['GS', 'D']],
          ['TOP', 'OR', ['L', 'R']],
        ],
        'TOP',
      ),
    );
    expect(r.status).toBe('ok');
    expect(r.topCutSets).toEqual([
      ['A', 'C'],
      ['A', 'D'],
      ['B', 'C'],
      ['B', 'D'],
    ]);
    // 所有事件可选（不出现在每个割集），无必现、无无关
    expect(r.classification).toEqual({
      mandatory: [],
      optional: ['A', 'B', 'C', 'D'],
      irrelevant: [],
    });
    // 共享门 GS 的割集数恰好为 2，不因两条路径翻倍
    const gs = r.gates.find((g) => g.id === 'GS')!;
    expect(gs.cutCount).toBe(2);
  });

  it('共享子门事件归属：AND(OR(A,B), C) 中 C 必现、A/B 可选、其余无关', () => {
    const r = analyze(
      mk(
        ['A', 'B', 'C', 'X'],
        [
          ['GS', 'OR', ['A', 'B']],
          ['TOP', 'AND', ['GS', 'C']],
          ['UNUSED', 'OR', ['X']],
        ],
        'TOP',
      ),
    );
    expect(r.status).toBe('ok');
    expect(r.topCutSets).toEqual([
      ['A', 'C'],
      ['B', 'C'],
    ]);
    expect(r.classification?.mandatory).toEqual(['C']);
    expect(r.classification?.optional.sort()).toEqual(['A', 'B']);
    expect(r.classification?.irrelevant).toEqual(['X']);
    // X 所在门不可达 → 警告
    expect(r.issues.some((i) => i.code === 'unreachable_gate' && i.gateId === 'UNUSED')).toBe(true);
  });

  it('多个父门共享同一深层子门时结果一致（备忘录）', () => {
    const r = analyze(
      mk(
        ['A', 'B'],
        [
          ['DEEP', 'OR', ['A', 'B']],
          ['P1', 'AND', ['DEEP', 'A']],
          ['P2', 'AND', ['DEEP', 'B']],
          ['TOP', 'OR', ['P1', 'P2', 'DEEP']],
        ],
        'TOP',
      ),
    );
    expect(r.status).toBe('ok');
    // P1={A}, P2={B}：{A}、{B}
    expect(r.topCutSets).toEqual([['A'], ['B']]);
  });
});

describe('输出排序', () => {
  it('割集内按标识排序、割集间按字典序', () => {
    const r = analyze(
      mk(
        ['Z', 'A', 'M'],
        [
          ['G1', 'OR', ['Z', 'A']],
          ['G2', 'AND', ['G1', 'M']],
        ],
        'G2',
      ),
    );
    expect(r.topCutSets).toEqual([
      ['A', 'M'],
      ['M', 'Z'],
    ]);
  });
});

describe('顶事件为基本事件的退化情形', () => {
  it('割集为单元素，其余事件无关', () => {
    const r = analyze(mk(['A', 'B'], [['G', 'OR', ['A', 'B']]], 'B'));
    expect(r.status).toBe('ok');
    expect(r.topCutSets).toEqual([['B']]);
    expect(r.classification).toEqual({
      mandatory: ['B'],
      optional: [],
      irrelevant: ['A'],
    });
  });
});

describe('complexity_limit 超限', () => {
  // 11 个独立 (OR x_i y_i) 的 AND ⇒ 2^11 = 2048 > 2000 个极小割集
  function limitTree(): FaultTreeInputs {
    const events: string[] = [];
    const gates: Array<[string, 'AND' | 'OR', string[]]> = [];
    for (let i = 0; i < 11; i++) {
      events.push(`x${i}`, `y${i}`);
      gates.push([`P${i}`, 'OR', [`x${i}`, `y${i}`]]);
    }
    gates.push(['TOP', 'AND', gates.slice(0, 11).map((g) => g[0])]);
    return mk(events, gates, 'TOP');
  }

  it('2^11=2048 时顶事件报 complexity_limit 且不输出截断割集', () => {
    const r = analyze(limitTree());
    expect(r.status).toBe('limited');
    expect(r.limitReasonGateId).toBe('TOP');
    expect(r.topCutSets).toBeUndefined();
    expect(r.classification).toBeUndefined();
    // 门表显示超限，且不得用数字冒充完整割集数
    const top = r.gates.find((g) => g.id === 'TOP')!;
    expect(top.result.status).toBe('complexity_limit');
    expect(top.cutSets).toBeUndefined();
    expect(top.cutCount).toBe(0);
  });

  it('2^10=1024（≤2000）时完整计算', () => {
    const events: string[] = [];
    const gates: Array<[string, 'AND' | 'OR', string[]]> = [];
    for (let i = 0; i < 10; i++) {
      events.push(`x${i}`, `y${i}`);
      gates.push([`P${i}`, 'OR', [`x${i}`, `y${i}`]]);
    }
    gates.push(['TOP', 'AND', gates.map((g) => g[0])]);
    const r = analyze(mk(events, gates, 'TOP'));
    expect(r.status).toBe('ok');
    expect(r.topCutSets).toHaveLength(1024);
  });

  it('超限沿依赖门传播，引用者同样标记并指向首个超限门', () => {
    const base = limitTree();
    base.gatesText += '\nDOWN = AND(TOP, x0)';
    base.topText = 'DOWN';
    const r = analyze(base);
    expect(r.status).toBe('limited');
    expect(r.limitReasonGateId).toBe('TOP');
    const down = r.gates.find((g) => g.id === 'DOWN')!;
    expect(down.result.status).toBe('complexity_limit');
    expect(
      down.result.status === 'complexity_limit' ? down.result.reasonGateId : '',
    ).toBe('TOP');
  });

  it('恰好 2000 个割集不触发上限', () => {
    expect(CUTOFF_LIMIT).toBe(2000);
  });
});

describe('内置示例（航天器双母线）', () => {
  it('完整可解，冗余门割集被直接单事件吸收', () => {
    const r = analyze(SAMPLE);
    expect(r.status).toBe('ok');
    expect(r.topCutSets).toEqual([
      [
        'BAT1_CELL_OPEN',
        'BAT2_CELL_OPEN',
        'DIODE1_OPEN',
        'DIODE2_OPEN',
      ],
      ['BATT_BUS_BAR'],
      ['MAIN_BUS_SHORT'],
      ['PCU1_REG_FAIL', 'PCU2_REG_FAIL'],
      ['RELAY_STUCK_OPEN'],
      ['WIRING_HARNESS_OPEN'],
    ]);
    // {BAT1_CELL_OPEN, DIODE1_OPEN, BATT_BUS_BAR} 被 {BATT_BUS_BAR} 吸收
    expect(r.classification?.mandatory).toEqual([]);
    expect(r.classification?.irrelevant).toEqual([]);
    expect(r.classification?.optional).toHaveLength(10);
  });
});

describe('非法输入：保留原文并定位问题', () => {
  it('缺失引用给出引用门与行号', () => {
    const r = analyze(
      mk(['A'], [['G', 'AND', ['A', 'GHOST']]], 'G'),
    );
    const e = r.issues.find((i) => i.code === 'missing_reference')!;
    expect(e).toBeTruthy();
    expect(e.gateId).toBe('G');
    expect(e.line).toBe(1);
    expect(r.status).toBe('invalid');
    expect(r.topCutSets).toBeUndefined();
  });

  it('自引用单独报告', () => {
    const r = analyze({
      eventsText: 'A\nB',
      gatesText: 'G = OR(A, G)',
      topText: 'G',
    });
    const e = r.issues.find((i) => i.code === 'self_reference')!;
    expect(e.gateId).toBe('G');
    expect(e.line).toBe(1);
    expect(r.issues.some((i) => i.code === 'cycle')).toBe(false);
  });

  it('任意长度环全部检出并给出闭环路径（2 环与 5 环）', () => {
    const gates2: GateDef[] = [
      { id: 'A', type: 'OR', children: ['B'], line: 1 },
      { id: 'B', type: 'OR', children: ['A'], line: 2 },
    ];
    const cyc2 = findCycles(gates2);
    expect(cyc2).toHaveLength(1);
    expect(cyc2[0].path[0]).toBe(cyc2[0].path[cyc2[0].path.length - 1]);
    expect(cyc2[0].path.slice(0, -1).sort()).toEqual(['A', 'B']);

    const gates5: GateDef[] = [
      { id: 'N1', type: 'OR', children: ['N2'], line: 1 },
      { id: 'N2', type: 'OR', children: ['N3'], line: 2 },
      { id: 'N3', type: 'OR', children: ['N4'], line: 3 },
      { id: 'N4', type: 'OR', children: ['N5'], line: 4 },
      { id: 'N5', type: 'OR', children: ['N1'], line: 5 },
    ];
    const cyc5 = findCycles(gates5);
    expect(cyc5).toHaveLength(1);
    expect(cyc5[0].path).toHaveLength(6);
    expect(cyc5[0].path[0]).toBe(cyc5[0].path[5]);

    const r = analyze({
      eventsText: 'X\nY',
      gatesText: gates5.map((g) => `${g.id} = OR(${g.children[0]})`).join('\n'),
      topText: 'N1',
    });
    expect(r.status).toBe('invalid');
    const issue = r.issues.find((i) => i.code === 'cycle')!;
    expect(issue.message).toContain('N1 → N2');
    expect(issue.message).toContain('N5 → N1');
  });

  it('非法标识、重复事件/门、计数越界', () => {
    const r = analyze({
      eventsText: 'A\nA\nB',
      gatesText: 'G = OR(A)\nG = OR(B)',
      topText: 'G',
    });
    expect(r.issues.some((i) => i.code === 'duplicate_event')).toBe(true);
    expect(r.issues.some((i) => i.code === 'duplicate_gate')).toBe(true);

    const tooFew = analyze({ eventsText: 'A', gatesText: 'G=OR(A)', topText: 'G' });
    expect(tooFew.issues.some((i) => i.code === 'count_event')).toBe(true);

    const bad = analyze({
      eventsText: 'A\nB.B',
      gatesText: 'G=OR(A,B.B)',
      topText: 'G',
    });
    expect(bad.issues.some((i) => i.code === 'invalid_id')).toBe(true);
  });

  it('门行语法错误被保留并按行报告，不参与计算', () => {
    const r = analyze({
      eventsText: 'A\nB',
      gatesText: 'G = OR(A)\n这行不是门定义\nTOP = AND(G, B)',
      topText: 'TOP',
    });
    const e = r.issues.find((i) => i.code === 'parse_error')!;
    expect(e.line).toBe(2);
    expect(r.status).toBe('invalid');
  });

  it('顶事件未定义', () => {
    const r = analyze({ eventsText: 'A\nB', gatesText: 'G=OR(A)', topText: 'NOPE' });
    expect(r.issues.some((i) => i.code === 'top_missing')).toBe(true);
  });

  it('顶事件框出现多个标识时报错', () => {
    const r = analyze({ eventsText: 'A\nB', gatesText: 'G=OR(A)', topText: 'G B' });
    const e = r.issues.find((i) => i.code === 'top_missing')!;
    expect(e.message).toContain('多余内容');
    expect(r.status).toBe('invalid');
  });

  it('事件与门标识冲突', () => {
    const r = analyze({ eventsText: 'A\nG', gatesText: 'G=OR(A)', topText: 'G' });
    expect(r.issues.some((i) => i.code === 'id_conflict')).toBe(true);
  });
});
