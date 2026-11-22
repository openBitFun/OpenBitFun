import { trajectoryNodeKey, type TrajectoryNode } from './trajectoryModel';

export interface TrajectoryRange { anchor: string; focus: string }
export interface TrajectoryRangeSummary {
  start: TrajectoryNode; end: TrajectoryNode;
  counts: { user: number; model: number; tool: number; errors: number };
  modelMs?: number; toolMs?: number;
}

/**
 * Endpoint identities are `trajectoryNodeKey` values. Reading the two keys back
 * once lets a scan compare node fields directly instead of building a key string
 * for every node twice: on a loaded page this pass is the panel's whole mount cost.
 */
function readNodeIdentity(key: string): [string, string, string] | null {
  try {
    const parts = JSON.parse(key) as unknown;
    return Array.isArray(parts) && parts.length === 3 ? parts as [string, string, string] : null;
  } catch {
    return null;
  }
}

/** Endpoints use stable identities so loading older pages cannot move a range. */
export function resolveTrajectoryRange(nodes: readonly TrajectoryNode[], range: TrajectoryRange | null): [number, number] | null {
  if (!range) return null;
  const anchorIdentity = readNodeIdentity(range.anchor);
  const focusIdentity = readNodeIdentity(range.focus);
  if (!anchorIdentity || !focusIdentity) {
    // An endpoint from an unexpected source keeps the exact former comparison.
    const anchor = nodes.findIndex(node => trajectoryNodeKey(node) === range.anchor);
    const focus = nodes.findIndex(node => trajectoryNodeKey(node) === range.focus);
    return anchor < 0 || focus < 0 ? null : [Math.min(anchor, focus), Math.max(anchor, focus)];
  }
  const [anchorTurn, anchorKind, anchorId] = anchorIdentity;
  const [focusTurn, focusKind, focusId] = focusIdentity;
  // One pass, first match per endpoint, so a prepended page cannot shift a range
  // and a single-node range still reports the same index twice.
  let anchor = -1;
  let focus = -1;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (anchor < 0 && node.turnId === anchorTurn && node.kind === anchorKind && node.id === anchorId) anchor = index;
    if (focus < 0 && node.turnId === focusTurn && node.kind === focusKind && node.id === focusId) focus = index;
    if (anchor >= 0 && focus >= 0) break;
  }
  return anchor < 0 || focus < 0 ? null : [Math.min(anchor, focus), Math.max(anchor, focus)];
}

/** Slice index for a range bound: negative counts from the end, the rest clamps. */
function sliceIndex(bound: number, length: number): number {
  return bound < 0 ? Math.max(length + bound, 0) : Math.min(bound, length);
}

export function summarizeTrajectoryRange(nodes: readonly TrajectoryNode[], bounds: [number, number]): TrajectoryRangeSummary {
  const from = sliceIndex(bounds[0], nodes.length);
  const to = sliceIndex(bounds[1] + 1, nodes.length);
  if (!(to > from)) {
    // What the old `slice(from, to)` projection reported for an empty range.
    return {
      start: undefined as unknown as TrajectoryNode,
      end: undefined as unknown as TrajectoryNode,
      counts: { user: 0, model: 0, tool: 0, errors: 0 },
      modelMs: undefined,
      toolMs: undefined,
    };
  }
  // Counting, error tallying and both duration sums share one pass over the range;
  // a duration is only summed when every node of that kind carries one.
  let user = 0;
  let model = 0;
  let tool = 0;
  let errors = 0;
  let modelMs = 0;
  let toolMs = 0;
  let modelComplete = true;
  let toolComplete = true;
  for (let index = from; index < to; index += 1) {
    const node = nodes[index];
    if (node.kind === 'model') {
      model += 1;
      if (typeof node.durationMs === 'number') modelMs += node.durationMs;
      else modelComplete = false;
    } else if (node.kind === 'tool') {
      tool += 1;
      if (typeof node.durationMs === 'number') toolMs += node.durationMs;
      else toolComplete = false;
    } else {
      user += 1;
    }
    if (node.status === 'error') errors += 1;
  }
  return {
    start: nodes[from],
    end: nodes[to - 1],
    counts: { user, model, tool, errors },
    modelMs: model > 0 && modelComplete ? modelMs : undefined,
    toolMs: tool > 0 && toolComplete ? toolMs : undefined,
  };
}
