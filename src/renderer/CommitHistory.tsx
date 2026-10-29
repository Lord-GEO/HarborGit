import { useMemo, type CSSProperties } from 'react';
import type { Branch, Commit } from '../shared/types';
import { branchColors, branchHue, buildCommitGraph, commitRefs, GRAPH_LANE_WIDTH, GRAPH_ROW_HEIGHT, refLabel } from '../shared/commit-graph';

const dateText = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const hueStyle = (hue: number) => ({ '--lane-hue': hue } as CSSProperties);
function graphPath(from: number, to: number, top: number, bottom: number) {
  const x1 = 13 + from * GRAPH_LANE_WIDTH, x2 = 13 + to * GRAPH_LANE_WIDTH;
  return x1 === x2 ? `M ${x1} ${top} V ${bottom}` : `M ${x1} ${top} C ${x1} ${top + (bottom - top) * .6} ${x2} ${top + (bottom - top) * .4} ${x2} ${bottom}`;
}
export function CommitHistory({ commits, branches, selected, scope, loading, busy, onScope, onSelect, onRefresh, onMore }: {
  commits: Commit[]; branches: Branch[]; selected: string | undefined; scope: 'all' | 'current'; loading: boolean; busy: boolean;
  onScope(scope: 'all' | 'current'): void; onSelect(commit: Commit): void; onRefresh(): void; onMore(): void;
}) {
  const graph = useMemo(() => buildCommitGraph(commits, branches), [commits, branches]);
  const colors = useMemo(() => branchColors(branches), [branches]);
  const width = graph.laneCount * GRAPH_LANE_WIDTH + 17;
  return <section className="history-list graph-history" aria-label="提交列表">
    <div className="graph-history-toolbar"><select aria-label="历史分支范围" value={scope} disabled={busy || loading} onChange={e => onScope(e.target.value as 'all' | 'current')}><option value="all">全部分支</option><option value="current">当前分支</option></select><span>{commits.length} 个提交</span><button className="icon-button" aria-label="刷新历史" disabled={busy || loading} onClick={onRefresh}>↻</button></div>
    <div className="graph-legend" aria-label="分支颜色图例">{branches.filter(b => !b.remote).map(branch => <span key={branch.name} style={hueStyle(colors.get(branch.name)!)} title={`${branch.name}${branch.current ? ' · 当前分支' : ''}`}><i />{branch.name}{branch.current ? ' •' : ''}</span>)}</div>
    <div className="commit-list-scroll"><div className="graph-rows" style={{ minWidth: width + 210 }}>
      <svg className="commit-graph" aria-label="提交分支与合并路径" role="img" width={width} height={commits.length * GRAPH_ROW_HEIGHT} viewBox={`0 0 ${width} ${Math.max(1, commits.length * GRAPH_ROW_HEIGHT)}`}>
        {graph.rows.map((row, index) => { const top = index * GRAPH_ROW_HEIGHT, middle = top + GRAPH_ROW_HEIGHT / 2, bottom = top + GRAPH_ROW_HEIGHT; return <g key={row.hash} data-commit={row.hash}>
          {row.segments.map((edge, i) => <path key={i} className="graph-edge" data-kind={edge.kind} data-parent={edge.parent} data-child={edge.kind === 'parent' ? row.hash : undefined} style={hueStyle(edge.hue)} d={graphPath(edge.from, edge.to, edge.kind === 'parent' ? middle : top, edge.kind === 'incoming' ? middle : bottom)} />)}
          <circle className={`graph-node ${row.merge ? 'merge-node' : ''}`} data-merge={row.merge ? 'true' : 'false'} style={hueStyle(row.hue)} cx={13 + row.lane * GRAPH_LANE_WIDTH} cy={middle} r={row.merge ? 5 : 3.7}><title>{row.merge ? `合并提交，${commits[index].parents.length} 个父提交` : row.key.startsWith('path:') ? '提交路径' : refLabel(row.key)}</title></circle>
          {row.merge && <circle className="merge-node-center" cx={13 + row.lane * GRAPH_LANE_WIDTH} cy={middle} r={1.6} />}
        </g>; })}
      </svg>
      {commits.map((commit, index) => <button key={commit.hash} className={`commit-row graph-commit-row ${selected === commit.hash ? 'selected' : ''}`} style={{ height: GRAPH_ROW_HEIGHT, paddingLeft: width + 10 }} onClick={() => onSelect(commit)} aria-label={`查看提交 ${commit.subject}`}>
        <div><strong title={commit.subject}>{commit.subject || '(无标题)'}</strong><div className="graph-ref-list">{commitRefs(commit).map(ref => <span className={`graph-ref ${ref.startsWith('tag:') ? 'tag-ref' : ''}`} key={ref} style={hueStyle(colors.get(refLabel(ref)) ?? branchHue(ref))}>{refLabel(ref)}</span>)}{commit.parents.length > 1 && <span className="merge-label">合并 · {commit.parents.length} parents</span>}</div><small>{commit.author}<span>{dateText(commit.date)}</span></small><code>{commit.shortHash}</code></div>
      </button>)}
    </div>{!commits.length && <div className="list-empty">{loading ? '正在读取提交历史…' : '此范围内还没有提交'}</div>}
    {graph.continuations > 0 && <p className="graph-continuation">路径继续到更早的提交 ↓</p>}
    <button className="load-more" disabled={busy || loading || !commits.length} onClick={onMore}>{loading ? '正在加载…' : '加载更多提交'}</button></div>
    <p className="graph-help">分支沿第一父提交延续颜色，共享祖先由连线汇合；双圈表示合并提交。</p>
  </section>;
}
