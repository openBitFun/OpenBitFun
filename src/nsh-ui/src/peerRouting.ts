// Fleet routing: how a command reaches the account device that owns it.
//
// The controller-local set and the fleet entry verbs are generated from the
// Product Operation Registry (`generated/peerSurface.ts`).

import {
  FLEET_ENTRY_COMMANDS,
  FLEET_OWNER_KEYS,
  PEER_CONTROLLER_LOCAL_COMMANDS,
  type FleetOwnerEntity,
} from "./generated/peerSurface";

/** One routed call: the command that goes out and its arguments. */
export interface PeerRoute {
  command: string;
  args: Record<string, unknown>;
}

// ── Fleet routing ─────────────────────────────────────────────────────────────
//
// On a fleet connection every account device is reachable through the one
// entry the UI is connected to. A command goes out as `fleet_call {target,
// command, args}` with the Tauri args unchanged; the entry runs it when it is
// the target and forwards it as a plain call otherwise. The fleet verbs the
// entry answers itself and the controller-local commands stay plain calls.

/** Whether a command goes out unwrapped on a fleet connection. */
export function isFleetPlainCommand(command: string): boolean {
  return FLEET_ENTRY_COMMANDS.has(command) || PEER_CONTROLLER_LOCAL_COMMANDS.has(command);
}

/** `sessionId` <-> `session_id`, mirroring Rust `fleet_routing::other_spelling`. */
function otherSpelling(key: string): string {
  if (key.includes("_")) {
    return key.replace(/_([a-z0-9])/gi, (_, ch: string) => ch.toUpperCase());
  }
  return key.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`);
}

/**
 * The id a command acts on (`FLEET_OWNER_KEYS`), read from its Tauri args at
 * the registry's path (checking both exact spelling and `camelCase`/`snake_case`
 * alias on the leaf segment, matching Rust's `owner_key_value`); `null` for
 * commands without an owner key or when the call does not carry the id.
 */
export function fleetOwnerKeyOf(
  command: string,
  args: Record<string, unknown> | undefined,
): { entity: FleetOwnerEntity; id: string } | null {
  const key = FLEET_OWNER_KEYS[command];
  if (!key || !args) return null;
  const parts = key.path.split(".");
  const leaf = parts.pop();
  if (!leaf) return null;
  let parent: unknown = args;
  for (const part of parts) {
    if (!parent || typeof parent !== "object") return null;
    parent = (parent as Record<string, unknown>)[part];
  }
  if (!parent || typeof parent !== "object") return null;
  const record = parent as Record<string, unknown>;
  const direct = record[leaf];
  if (typeof direct === "string" && direct) return { entity: key.entity, id: direct };
  const alias = record[otherSpelling(leaf)];
  return typeof alias === "string" && alias ? { entity: key.entity, id: alias } : null;
}

export interface FleetRouteContext {
  /** The caller's explicit target. */
  target?: string | null;
  /** The device owning an entity id, from the fleet index; `null` when unknown. */
  ownerOf(entity: FleetOwnerEntity, id: string): string | null;
  /** The device context (the selected workspace's device, else the entry). */
  deviceContext(): string | null;
}

/**
 * The `fleet_call` a command becomes on a fleet connection, or `null` when it
 * goes out plain. The target is the caller's, else the owner of the id the
 * command acts on, else the device context. With none known the target is
 * left out and the entry resolves it or refuses with `fleet_target_required`;
 * a wrong owner is refused (`fleet_owner_mismatch`), never rerouted.
 */
export function fleetRouteFor(
  command: string,
  args: Record<string, unknown> | undefined,
  context: FleetRouteContext,
): PeerRoute | null {
  if (isFleetPlainCommand(command)) return null;
  const owned = fleetOwnerKeyOf(command, args);
  const target =
    context.target || (owned ? context.ownerOf(owned.entity, owned.id) : null) || context.deviceContext() || null;
  const request: Record<string, unknown> = { command, args: args ?? {} };
  if (target) request.target = target;
  return { command: "fleet_call", args: { request } };
}
