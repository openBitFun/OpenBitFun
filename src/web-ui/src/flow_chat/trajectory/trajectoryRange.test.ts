import { describe, expect, it } from 'vitest';
import { resolveTrajectoryRange, summarizeTrajectoryRange } from './trajectoryRange';
import { trajectoryNodeKey, type TrajectoryNode } from './trajectoryModel';

/**
 * The previous implementations, kept here as the reference. The range pass was
 * rewritten to walk the selection once and to stop rebuilding a key string per
 * node, and these two functions are what "behaviour is unchanged" is checked
 * against.
 */
function referenceResolve(
  nodes: readonly TrajectoryNode[],
  range: { anchor: string; focus: string } | null,
): [number, number] | null {
  if (!range) return null;
  const anchor = nodes.findIndex(node => trajectoryNodeKey(node) === range.anchor);
  const focus = nodes.findIndex(node => trajectoryNodeKey(node) === range.focus);
  return anchor < 0 || focus < 0 ? null : [Math.min(anchor, focus), Math.max(anchor, focus)];
}

function referenceSummarize(nodes: readonly TrajectoryNode[], bounds: [number, number]) {
  const selected = nodes.slice(bounds[0], bounds[1] + 1);
  const sum = (kind: 'model' | 'tool') => {
    const values = selected.filter(node => node.kind === kind);
    return values.length && values.every(node => typeof node.durationMs === 'number')
      ? values.reduce((total, node) => total + node.durationMs!, 0) : undefined;
  };
  return {
    start: selected[0],
    end: selected[selected.length - 1],
    counts: {
      user: selected.filter(node => node.kind === 'user').length,
      model: selected.filter(node => node.kind === 'model').length,
      tool: selected.filter(node => node.kind === 'tool').length,
      errors: selected.filter(node => node.status === 'error').length,
    },
    modelMs: sum('model'),
    toolMs: sum('tool'),
  };
}

function node(overrides: Partial<TrajectoryNode> & Pick<TrajectoryNode, 'id' | 'turnId' | 'kind'>): TrajectoryNode {
  return {
    turnOrdinal: 0,
    label: '',
    preview: '',
    status: 'completed',
    timestamp: 0,
    matched: false,
    ...overrides,
  };
}

/** Deterministic pseudo-random stream so a failure is reproducible. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function buildRandomNodes(next: () => number, count: number, idPrefix = ''): TrajectoryNode[] {
  const kinds = ['user', 'model', 'tool'] as const;
  return Array.from({ length: count }, (_, index) => {
    const kind = kinds[Math.floor(next() * kinds.length)];
    return node({
      id: `${idPrefix}node-${index}`,
      turnId: `${idPrefix}turn-${Math.floor(index / 6)}`,
      turnOrdinal: Math.floor(index / 6),
      kind,
      status: next() < 0.15 ? 'error' : 'completed',
      // A missing duration has to stay distinguishable from a measured zero.
      durationMs: next() < 0.5 ? undefined : Math.floor(next() * 500),
    });
  });
}

describe('trajectory range equivalence', () => {
  it('summarizes every range of a random page exactly like the previous implementation', () => {
    const next = random(20261117);
    const nodes = buildRandomNodes(next, 60);
    const ranges: Array<[number, number]> = [
      [0, 0], [0, 59], [5, 5], [10, 20], [59, 0], [20, 10],
      [-1, 5], [0, -1], [-5, -1], [50, 200], [-200, 200], [59, 59],
    ];
    for (const bounds of ranges) {
      expect(summarizeTrajectoryRange(nodes, bounds)).toEqual(referenceSummarize(nodes, bounds));
    }
  });

  it('reports the same endpoints and counts for random slices, including empty selections', () => {
    const next = random(4242);
    const nodes = buildRandomNodes(next, 40);
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const from = Math.floor(next() * 44) - 2;
      const to = from + Math.floor(next() * 44) - 4;
      const bounds: [number, number] = [from, to];
      const actual = summarizeTrajectoryRange(nodes, bounds);
      const expected = referenceSummarize(nodes, bounds);
      expect(actual.counts).toEqual(expected.counts);
      expect(actual.modelMs).toEqual(expected.modelMs);
      expect(actual.toolMs).toEqual(expected.toolMs);
      // Endpoints keep object identity with the page, and stay undefined when empty.
      expect(actual.start).toBe(expected.start);
      expect(actual.end).toBe(expected.end);
    }
  });

  it('keeps a measured zero duration distinct from a missing one', () => {
    const nodes = [
      node({ id: 'a', turnId: 't', kind: 'tool', durationMs: 0 }),
      node({ id: 'b', turnId: 't', kind: 'model', durationMs: 15 }),
      node({ id: 'c', turnId: 't', kind: 'tool' }),
    ];
    expect(summarizeTrajectoryRange(nodes, [0, 1]).toolMs).toBe(0);
    expect(summarizeTrajectoryRange(nodes, [0, 1]).modelMs).toBe(15);
    expect(summarizeTrajectoryRange(nodes, [0, 2]).toolMs).toBeUndefined();
    expect(referenceSummarize(nodes, [0, 2]).toolMs).toBeUndefined();
  });

  it('resolves endpoints exactly like the previous key scan', () => {
    const next = random(777);
    const nodes = buildRandomNodes(next, 50);
    const ranges = [
      { anchor: trajectoryNodeKey(nodes[3]), focus: trajectoryNodeKey(nodes[40]) },
      { anchor: trajectoryNodeKey(nodes[40]), focus: trajectoryNodeKey(nodes[3]) },
      { anchor: trajectoryNodeKey(nodes[7]), focus: trajectoryNodeKey(nodes[7]) },
      { anchor: trajectoryNodeKey(nodes[0]), focus: 'not-a-node-key' },
      { anchor: '["missing","model","x"]', focus: trajectoryNodeKey(nodes[1]) },
      { anchor: 'not-json', focus: trajectoryNodeKey(nodes[1]) },
      { anchor: '["only-two",1]', focus: trajectoryNodeKey(nodes[1]) },
    ];
    for (const range of ranges) {
      expect(resolveTrajectoryRange(nodes, range)).toEqual(referenceResolve(nodes, range));
    }
    expect(resolveTrajectoryRange(nodes, null)).toBeNull();
    expect(resolveTrajectoryRange([], ranges[0])).toBe(referenceResolve([], ranges[0]));
  });

  it('resolves identities that need JSON escaping in their id', () => {
    const awkward = [
      node({ id: 'quote"inside', turnId: 'turn\\back', kind: 'tool' }),
      node({ id: 'line\nbreak', turnId: 'turn\u0000nul', kind: 'model' }),
      node({ id: '中文标识', turnId: '轮次', kind: 'user' }),
    ];
    const range = { anchor: trajectoryNodeKey(awkward[0]), focus: trajectoryNodeKey(awkward[2]) };
    expect(resolveTrajectoryRange(awkward, range)).toEqual([0, 2]);
    expect(resolveTrajectoryRange(awkward, range)).toEqual(referenceResolve(awkward, range));
    for (const target of awkward) {
      const single = { anchor: trajectoryNodeKey(target), focus: trajectoryNodeKey(target) };
      expect(resolveTrajectoryRange(awkward, single)).toEqual(referenceResolve(awkward, single));
    }
  });

  it('keeps an endpoint on the same node after a page is prepended', () => {
    const next = random(99);
    const page = buildRandomNodes(next, 30, 'old-');
    const older = buildRandomNodes(next, 12, 'older-');
    const range = { anchor: trajectoryNodeKey(page[4]), focus: trajectoryNodeKey(page[9]) };
    expect(resolveTrajectoryRange(page, range)).toEqual([4, 9]);
    expect(resolveTrajectoryRange([...older, ...page], range)).toEqual([16, 21]);
    expect(referenceResolve([...older, ...page], range)).toEqual([16, 21]);
  });

  it('picks the first match when a page repeats an identity', () => {
    const repeated = [
      node({ id: 'x', turnId: 't', kind: 'tool' }),
      node({ id: 'y', turnId: 't', kind: 'tool' }),
      node({ id: 'x', turnId: 't', kind: 'tool' }),
    ];
    const range = { anchor: trajectoryNodeKey(repeated[2]), focus: trajectoryNodeKey(repeated[1]) };
    expect(resolveTrajectoryRange(repeated, range)).toEqual(referenceResolve(repeated, range));
  });
});
