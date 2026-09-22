import { useMemo, useRef, useState } from 'react';
import type { FaultTreeInputs } from '../core/types';
import { analyze } from '../core/analyze';
import { CUTOFF_LIMIT } from '../core/cutsets';
import { SAMPLE, EMPTY_INPUT } from '../core/sample';

type EditorKind = 'events' | 'gates' | 'top';

const KIND_LABEL: Record<EditorKind, string> = {
  events: '基本事件（每行 1–多个，2–30 个唯一）',
  gates: '门定义：ID = AND(输入...) 或 ID: OR 输入...（1–80 个唯一）',
  top: '顶事件（门或基本事件标识）',
};

export function App() {
  const [input, setInput] = useState<FaultTreeInputs>(SAMPLE);
  const eventsRef = useRef<HTMLTextAreaElement>(null);
  const gatesRef = useRef<HTMLTextAreaElement>(null);
  const topRef = useRef<HTMLTextAreaElement>(null);

  const result = useMemo(() => analyze(input), [input]);

  const refs = { events: eventsRef, gates: gatesRef, top: topRef };

  const set = (kind: EditorKind, value: string) =>
    setInput((p) => ({ ...p, [`${kind}Text`]: value }));

  const jumpTo = (kind: EditorKind, line?: number) => {
    const ta = refs[kind].current;
    if (!ta) return;
    ta.focus();
    if (line && line >= 1) {
      const lines = ta.value.split('\n');
      const pos = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
      ta.setSelectionRange(pos, pos + (lines[line - 1]?.length ?? 0));
      ta.scrollTop = Math.max(0, (line - 3) * 20);
    }
  };

  const issueTarget = (
    code: string,
    gateId?: string,
  ): EditorKind | null => {
    if (
      ['parse_error', 'duplicate_gate', 'id_conflict', 'missing_reference',
        'self_reference', 'cycle', 'unreachable_gate', 'count_gate'].includes(code)
    ) {
      return 'gates';
    }
    if (['invalid_id', 'duplicate_event', 'count_event'].includes(code)) {
      return 'events';
    }
    if (code === 'top_missing') return 'top';
    return gateId ? 'gates' : null;
  };

  const issueLines = useMemo(() => {
    const map: Record<EditorKind, { err: Set<number>; warn: Set<number> }> = {
      events: { err: new Set(), warn: new Set() },
      gates: { err: new Set(), warn: new Set() },
      top: { err: new Set(), warn: new Set() },
    };
    for (const is of result.issues) {
      if (is.line === undefined) continue;
      const target =
        is.code === 'invalid_id' || is.code === 'duplicate_event'
          ? 'events'
          : issueTarget(is.code, is.gateId);
      if (target) {
        (is.severity === 'error' ? map[target].err : map[target].warn).add(
          is.line,
        );
      }
    }
    return map;
  }, [result.issues]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>航天器供电故障树 · 最小割集审计</h1>
        <div className="sub">
          共享有向无环图 · 精确极小割集（吸收律）· 事件归属（必现/可选/无关）
        </div>
      </header>

      <div className="privacy-note">
        本工具完全在浏览器内运行：页面不含任何业务后端、远程脚本或在线接口调用，
        关闭/断网后仍可使用；所有输入不会离开本机。
      </div>

      <div className="toolbar">
        <button onClick={() => setInput(SAMPLE)}>载入示例</button>
        <button onClick={() => setInput(EMPTY_INPUT)}>清空</button>
        <span className="counts">
          唯一基本事件 {result.uniqueEventCount} 个（限 2–30） · 唯一门{' '}
          {result.uniqueGateCount} 个（限 1–80） · 单门割集上限 {CUTOFF_LIMIT}
        </span>
      </div>

      <div className="editors">
        <CodeEditor
          id="editor-events"
          label={KIND_LABEL.events}
          value={input.eventsText}
          onChange={(v) => set('events', v)}
          taRef={eventsRef}
          errLines={issueLines.events.err}
          warnLines={issueLines.events.warn}
        />
        <CodeEditor
          id="editor-gates"
          label={KIND_LABEL.gates}
          value={input.gatesText}
          onChange={(v) => set('gates', v)}
          taRef={gatesRef}
          errLines={issueLines.gates.err}
          warnLines={issueLines.gates.warn}
        />
        <CodeEditor
          id="editor-top"
          label={KIND_LABEL.top}
          value={input.topText}
          onChange={(v) => set('top', v)}
          taRef={topRef}
          errLines={issueLines.top.err}
          warnLines={issueLines.top.warn}
        />
      </div>

      <section className="section">
        <StatusBanner
          status={result.status}
          count={result.topCutSets?.length ?? 0}
          limitGate={result.limitReasonGateId}
          top={result.top}
        />
      </section>

      {result.issues.length > 0 && (
        <section className="section">
          <div className="issues">
            {result.issues.map((is, i) => {
              const target = issueTarget(is.code, is.gateId);
              return (
                <button
                  key={i}
                  className={`issue ${is.severity}`}
                  onClick={() => target && jumpTo(target, is.line)}
                  title={target ? '点击定位到输入位置' : undefined}
                >
                  <span className="loc">
                    {is.severity === 'error' ? '错误' : '警告'}
                    {is.line ? ` · 第 ${is.line} 行` : ''}
                  </span>
                  {is.message}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {result.status === 'limited' && (
        <section className="section">
          <div className="card">
            <h2>复杂度限制</h2>
            <p>
              门 <span className="limit-code">{result.limitReasonGateId}</span>{' '}
              规范化后的极小割集数量超过 {CUTOFF_LIMIT} 个
              （或其依赖门超限）。依据精确性要求，本工具显示{' '}
              <span className="limit-code">complexity_limit</span>，
              <strong>不输出任何截断割集，也不给出基于截断结果的事件归属</strong>，
              以免把不完整结果误判为完整结论。请增加冗余分组层级或缩小分析范围后重试。
            </p>
            <GateTable result={result} />
          </div>
        </section>
      )}

      {result.status === 'ok' && (
        <>
          <section className="section result-grid">
            <div className="card">
              <h2>
                顶事件 {result.top} 的最小割集（共 {result.topCutSets!.length}{' '}
                个）
              </h2>
              <div className="cut-list">
                {result.topCutSets!.map((cs, i) => (
                  <div className="cut-row" key={cs.join('|')}>
                    <span className="idx">{i + 1}.</span>
                    <span className="events">{'{ ' + cs.join(', ') + ' }'}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h2>基本事件归属</h2>
              <div className="role-groups">
                <RoleGroup
                  role="mandatory"
                  title="必现 mandatory"
                  desc="出现在每一个最小割集中"
                  ids={result.classification!.mandatory}
                />
                <RoleGroup
                  role="optional"
                  title="可选 optional"
                  desc="出现在部分最小割集中"
                  ids={result.classification!.optional}
                />
                <RoleGroup
                  role="irrelevant"
                  title="无关 irrelevant"
                  desc="不出现在任何最小割集中"
                  ids={result.classification!.irrelevant}
                />
              </div>
            </div>
          </section>

          <section className="section card">
            <h2>各门计算明细（共享子门仅计算一次）</h2>
            <GateTable result={result} />
          </section>
        </>
      )}
    </div>
  );
}

function CodeEditor(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  taRef: React.RefObject<HTMLTextAreaElement>;
  errLines: Set<number>;
  warnLines: Set<number>;
}) {
  const lineCount = Math.max(props.value.split('\n').length, 3);
  return (
    <div className="editor-card" id={props.id}>
      <div className="editor-head">
        <span>{props.label}</span>
      </div>
      <div className="editor-body">
        <div className="gutter">
          {Array.from({ length: lineCount }, (_, i) => i + 1)
            .map((n) => (
              <div
                key={n}
                className={
                  props.errLines.has(n)
                    ? 'ln-err'
                    : props.warnLines.has(n)
                      ? 'ln-warn'
                      : ''
                }
              >
                {n}
              </div>
            ))}
        </div>
        <textarea
          ref={props.taRef}
          className="code"
          spellCheck={false}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function StatusBanner(props: {
  status: string;
  count: number;
  limitGate?: string;
  top: string | null;
}) {
  if (props.status === 'invalid') {
    return (
      <div className="status-banner invalid">
        <span className="big">输入不合法</span>
        <span className="muted-text">
          已保留全部原文；请按下列错误提示修正（点击可定位行号），修正前不进行割集计算。
        </span>
      </div>
    );
  }
  if (props.status === 'limited') {
    return (
      <div className="status-banner limited">
        <span className="big">complexity_limit</span>
        <span className="muted-text">
          门 {props.limitGate} 触发 {'>'} {CUTOFF_LIMIT} 割集上限；结论不完整，
          未输出任何截断割集。
        </span>
      </div>
    );
  }
  return (
    <div className="status-banner ok">
      <span className="big">计算完成</span>
      <span className="muted-text">
        顶事件 {props.top} 共 {props.count} 个精确最小割集（已合并重复集合并消去全部真超集）。
      </span>
    </div>
  );
}

function RoleGroup(props: {
  role: 'mandatory' | 'optional' | 'irrelevant';
  title: string;
  desc: string;
  ids: string[];
}) {
  return (
    <div className="role-group">
      <h3>
        {props.title} <span className="desc">（{props.desc}）</span>
      </h3>
      <div className="tags">
        {props.ids.length === 0 && <span className="muted-text">（无）</span>}
        {props.ids.map((id) => (
          <span key={id} className={`tag ${props.role}`}>
            {id}
          </span>
        ))}
      </div>
    </div>
  );
}

function GateTable({
  result,
}: {
  result: ReturnType<typeof analyze>;
}) {
  return (
    <table className="gates">
      <thead>
        <tr>
          <th className="mono">门</th>
          <th>类型</th>
          <th>可达</th>
          <th>状态</th>
          <th>极小割集数</th>
        </tr>
      </thead>
      <tbody>
        {result.gates.map((g) => (
          <tr key={`${g.id}-${g.line}`}>
            <td className="mono">
              {g.id}
              {g.cutSets && g.cutSets.length > 0 && (
                <details className="gate-cuts">
                  <summary>查看割集</summary>
                  <div className="cut-list" style={{ maxHeight: 180 }}>
                    {g.cutSets.map((cs) => (
                      <div className="cut-row" key={cs.join('|')}>
                        <span className="events">{'{ ' + cs.join(', ') + ' }'}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </td>
            <td>{g.type}</td>
            <td>{g.reachable ? '是' : <span className="muted-text">否</span>}</td>
            <td>
              {g.result.status === 'complete' ? (
                <span className="pill ok">complete</span>
              ) : (
                <span className="pill limited" title={`超限来源：${g.result.reasonGateId}`}>
                  complexity_limit
                </span>
              )}
            </td>
            <td className="mono">
              {g.result.status === 'complete'
                ? g.cutCount
                : `—（源自 ${g.result.reasonGateId}）`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
