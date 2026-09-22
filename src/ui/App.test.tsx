import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { App } from './App';
import { SAMPLE } from '../core/sample';
import { analyze } from '../core/analyze';

// 通过修改模块级示例不易注入，直接渲染默认 App（载入的是 SAMPLE），
// 再用核心层构造 invalid / limited 文本，经组件 props 不可达时，
// 至少保证三种分析结论的数据形态可被渲染器消费而不抛异常。
describe('App 服务端渲染冒烟', () => {
  it('默认示例（ok）可渲染并包含关键文案', () => {
    const html = renderToString(React.createElement(App));
    expect(html).toContain('最小割集');
    expect(html).toContain('必现');
    expect(html).toContain('无关');
    expect(html).toContain('浏览器内运行');
  });

  it('invalid 结论包含状态分支所需字段', () => {
    const r = analyze({
      eventsText: 'A',
      gatesText: 'G = AND(A, MISSING)',
      topText: 'G',
    });
    expect(r.status).toBe('invalid');
    expect(r.issues.length).toBeGreaterThan(0);
    // 渲染层只在有 topCutSets 时访问它，invalid 下必须缺省
    expect(r.topCutSets).toBeUndefined();
  });

  it('limited 结论不携带任何割集或归属数据', () => {
    const events: string[] = [];
    const lines: string[] = [];
    for (let i = 0; i < 11; i++) {
      events.push(`x${i}`, `y${i}`);
      lines.push(`P${i} = OR(x${i}, y${i})`);
    }
    lines.push(`TOP = AND(${Array.from({ length: 11 }, (_, i) => `P${i}`).join(', ')})`);
    const r = analyze({
      eventsText: events.join('\n'),
      gatesText: lines.join('\n'),
      topText: 'TOP',
    });
    expect(r.status).toBe('limited');
    expect(r.topCutSets).toBeUndefined();
    expect(r.classification).toBeUndefined();
    expect(r.limitReasonGateId).toBe('TOP');
  });

  it('示例数据本身可解（与 App 默认状态一致）', () => {
    expect(analyze(SAMPLE).status).toBe('ok');
  });
});
