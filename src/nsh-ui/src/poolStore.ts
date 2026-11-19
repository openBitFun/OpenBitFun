// Model pools: an ordered group of configured models a session can be bound to.
//
// The pools belong to the execution host and live in its main configuration, so
// this store owns no state of its own beyond the snapshot it just read and the
// draft being edited. A pool's members are `ai.models[].id` values, which is what
// the desktop editor puts in `member_model_ids`, and a draft with an empty id is
// how a new pool is created: the host allocates the stable id.

import { signal } from "nsh";
import { invokeCommand } from "./bridge";
import { peerScope, peerSupports } from "./peerState";
import { runStep } from "./state";

export interface ModelPool {
  id: string;
  name: string;
  strategy: string;
  memberModelIds: string[];
}

export interface PoolMemberStatus {
  modelId: string;
  status: string;
  reason?: string;
}

export interface PoolDraft {
  id: string;
  name: string;
  strategy: string;
  members: string[];
}

interface PoolDocument {
  version?: number;
  pools?: unknown[];
}

export const pools = signal<ModelPool[]>([]);
/** `null` until the host has been asked; `false` means it has no pools at all. */
export const poolsSupported = signal<boolean | null>(null);
export const poolsNotice = signal("");
export const poolDraft = signal<PoolDraft | null>(null);
export const poolStatuses = signal<Record<string, PoolMemberStatus[]>>({});

/** The strategies the desktop editor offers, in its order. */
export const POOL_STRATEGIES: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  { value: "ordered", label: "Ordered", hint: "Always the first member that is available" },
  { value: "balanced", label: "Balanced", hint: "Spreads turns across members that are available" },
];

function readablePools(document: PoolDocument): ModelPool[] {
  const rows = Array.isArray(document?.pools) ? document.pools : [];
  const result: ModelPool[] = [];
  for (const value of rows) {
    const pool = value as Partial<{ id: string; name: string; strategy: string; member_model_ids: string[] }>;
    if (typeof pool?.id !== "string" || typeof pool?.name !== "string") continue;
    if (typeof pool?.strategy !== "string" || !Array.isArray(pool?.member_model_ids)) continue;
    if (!pool.member_model_ids.every(id => typeof id === "string")) continue;
    result.push({
      id: pool.id,
      name: pool.name,
      strategy: pool.strategy,
      memberModelIds: pool.member_model_ids,
    });
  }
  return result;
}

let loading = false;

/**
 * Reads the pools once. The settings section calls this on every render, and
 * `pools` is one of its dependencies, so an unguarded read would never settle.
 */
export function ensurePools(): void {
  if (poolsSupported() !== null || loading) return;
  // Pools belong to the execution host, and a peer states whether it selects
  // through them; asking one that did not is how a surface shows a feature that
  // cannot work there.
  if (peerScope() && peerSupports("model_pool_selection_v1") === false) {
    poolsSupported.set(false);
    poolsNotice.set(`${peerScope()?.label ?? "That device"} does not select models through pools`);
    return;
  }
  loading = true;
  void loadPools().finally(() => {
    loading = false;
  });
}

export async function loadPools(): Promise<void> {
  await runStep(async () => {
    try {
      const document = await invokeCommand<PoolDocument>("get_model_pools");
      pools.set(readablePools(document));
      poolsSupported.set(true);
      poolsNotice.set("");
    } catch {
      // A host without model pools keeps the section out of the way instead of
      // showing an error for a feature that surface never had.
      poolsSupported.set(false);
      pools.set([]);
    }
  });
}

export function openPoolDraft(pool?: ModelPool): void {
  poolDraft.set(
    pool
      ? { id: pool.id, name: pool.name, strategy: pool.strategy, members: [...pool.memberModelIds] }
      : { id: "", name: "", strategy: "ordered", members: [] },
  );
  poolsNotice.set("");
}

export function closePoolDraft(): void {
  poolDraft.set(null);
}

export function updatePoolDraft(patch: Partial<PoolDraft>): void {
  poolDraft.update(current => (current ? { ...current, ...patch } : current));
}

/** Adds a model to the draft when it is not already a member. */
export function togglePoolMember(modelId: string): void {
  poolDraft.update(current => {
    if (!current) return current;
    const members = current.members.includes(modelId)
      ? current.members.filter(id => id !== modelId)
      : [...current.members, modelId];
    return { ...current, members };
  });
}

/** Moves a member one place, which is what an ordered pool's priority is. */
export function movePoolMember(modelId: string, delta: number): void {
  poolDraft.update(current => {
    if (!current) return current;
    const index = current.members.indexOf(modelId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.members.length) return current;
    const members = [...current.members];
    const [moved] = members.splice(index, 1);
    members.splice(target, 0, moved);
    return { ...current, members };
  });
}

export async function savePoolDraft(): Promise<void> {
  const draft = poolDraft();
  if (!draft) return;
  if (!draft.name.trim()) {
    poolsNotice.set("A pool needs a name");
    return;
  }
  await runStep(async () => {
    try {
      const document = await invokeCommand<PoolDocument>("save_model_pool", {
        pool: {
          id: draft.id,
          name: draft.name.trim(),
          strategy: draft.strategy,
          member_model_ids: draft.members,
        },
      });
      pools.set(readablePools(document));
      poolsSupported.set(true);
      poolDraft.set(null);
      poolsNotice.set(`Saved ${draft.name.trim()}`);
    } catch (error) {
      poolsNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

export async function deletePool(poolId: string): Promise<void> {
  await runStep(async () => {
    try {
      const document = await invokeCommand<PoolDocument>("delete_model_pool", { poolId });
      pools.set(readablePools(document));
      poolsNotice.set("Pool deleted");
    } catch (error) {
      poolsNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

/** Asks the host how each member of a pool is doing right now. */
export async function loadPoolStatus(poolId: string): Promise<void> {
  await runStep(async () => {
    try {
      const rows = await invokeCommand<Array<{ modelId?: string; model_id?: string; status?: string; reason?: string }>>(
        "get_model_pool_status",
        { poolId },
      );
      const statuses: PoolMemberStatus[] = [];
      for (const row of rows ?? []) {
        const modelId = row.modelId ?? row.model_id;
        if (!modelId) continue;
        statuses.push({
          modelId,
          status: row.status ?? "unverified",
          ...(row.reason ? { reason: row.reason } : {}),
        });
      }
      poolStatuses.update(current => ({ ...current, [poolId]: statuses }));
    } catch (error) {
      poolsNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}
