import type { Branch, Commit } from './types';

export const GRAPH_ROW_HEIGHT = 102;
export const GRAPH_LANE_WIDTH = 15;
export function branchHue(name: string): number {
  const key = name.replace(/^refs\/(heads|remotes)\//, '');
  let value = 2166136261;
  for (const char of key) value = Math.imul(value ^ char.codePointAt(0)!, 16777619);
  return (value >>> 0) % 360;
}
export function branchColors(branches: Branch[]): Map<string, number> {
  const result = new Map<string, number>(), used = new Set<number>();
  const palette = [164, 208, 32, 280, 346, 88, 238, 12, 188, 312, 56, 116];
  const known: Record<string, number> = { main: 164, master: 208, dev: 32, develop: 280 };
  const names = [...new Set(branches.map(b => b.name))].sort();
  for (const name of names) if (known[name] !== undefined) { result.set(name, known[name]); used.add(known[name]); }
  for (const name of names) {
    if (result.has(name)) continue;
    const start = branchHue(name) % palette.length;
    // Search the rotated palette while keeping visually separated named lanes.
    let hue = Array.from({ length: palette.length }, (_, index) => palette[(index + start) % palette.length]).find(value => !used.has(value));
    if (hue === undefined) { hue = branchHue(name); while (used.has(hue)) hue = (hue + 137.508) % 360; }
    result.set(name, hue); used.add(hue);
  }
  return result;
}
export function commitRefs(commit: Commit): string[] { return commit.refs.split(', ').filter(Boolean).map(v => v.replace(/^HEAD -> /, '')); }
export function refLabel(ref: string) { return ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '').replace(/^tag: refs\/tags\//, 'tag: '); }
interface Lane { hash: string; hue: number; key: string; }
export interface GraphSegment { from: number; to: number; hue: number; kind: 'incoming' | 'continuation' | 'parent'; parent?: string; }
export interface GraphRow { hash: string; lane: number; hue: number; key: string; merge: boolean; segments: GraphSegment[]; }
export interface CommitGraph { rows: GraphRow[]; laneCount: number; continuations: number; }

/** Walk child-before-parent order. Holes stay stable until their lanes can end. */
export function buildCommitGraph(commits: Commit[], branches: Branch[]): CommitGraph {
  const seeds = new Map<string, { key: string; hue: number }>();
  const colors = branchColors(branches);
  // A shared ancestor has no unique branch ownership; prefer the current/local
  // tip when several refs point to the same commit, then follow first parents.
  const ordered = [...branches].sort((a, b) => Number(b.current) - Number(a.current) || Number(a.remote) - Number(b.remote) || a.name.localeCompare(b.name));
  for (const branch of ordered) if (!seeds.has(branch.hash)) seeds.set(branch.hash, { key: branch.name, hue: colors.get(branch.name) ?? branchHue(branch.name) });
  for (const commit of commits) {
    const branch = commitRefs(commit).find(v => /^refs\/(heads|remotes)\//.test(v));
    if (branch && !seeds.has(commit.hash)) seeds.set(commit.hash, { key: refLabel(branch), hue: colors.get(refLabel(branch)) ?? branchHue(branch) });
  }
  let lanes: (Lane | null)[] = [], laneCount = 1;
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    const before = lanes.map(v => v ? { ...v } : null);
    let lane = lanes.findIndex(v => v?.hash === commit.hash);
    const incoming = lane >= 0;
    if (lane < 0) { lane = lanes.findIndex(v => !v); if (lane < 0) lane = lanes.length; }
    const seed = seeds.get(commit.hash), existing = lanes[lane];
    const key = seed?.key ?? existing?.key ?? `path:${commit.hash}`;
    const hue = seed?.hue ?? existing?.hue ?? branchHue(key);
    lanes[lane] = null;
    const segments: GraphSegment[] = [];
    if (incoming) segments.push({ from: lane, to: lane, hue: before[lane]!.hue, kind: 'incoming' });
    const uniqueParents = [...new Set(commit.parents)];
    for (let i = 0; i < uniqueParents.length; i++) {
      const parent = uniqueParents[i];
      let target = lanes.findIndex(v => v?.hash === parent);
      const parentSeed = seeds.get(parent);
      const edgeHue = i === 0 ? hue : parentSeed?.hue ?? branchHue(`path:${parent}`);
      if (target < 0) {
        if (i === 0 && !lanes[lane]) target = lane;
        else { target = lanes.findIndex((v, index) => !v && index > lane); if (target < 0) target = lanes.length; }
        lanes[target] = { hash: parent, hue: edgeHue, key: i === 0 ? key : parentSeed?.key ?? `path:${parent}` };
      }
      segments.push({ from: lane, to: target, hue: edgeHue, kind: 'parent', parent });
    }
    before.forEach((entry, index) => {
      if (!entry || index === lane) return;
      const target = lanes.findIndex(v => v?.hash === entry.hash);
      if (target >= 0) segments.push({ from: index, to: target, hue: entry.hue, kind: 'continuation' });
    });
    laneCount = Math.max(laneCount, before.length, lanes.length, lane + 1);
    rows.push({ hash: commit.hash, lane, hue, key, merge: uniqueParents.length > 1, segments });
    while (lanes.length && !lanes.at(-1)) lanes.pop();
  }
  return { rows, laneCount, continuations: lanes.filter(Boolean).length };
}
