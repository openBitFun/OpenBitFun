// The fleet contract as the UI reads it: a hand-kept mirror of
// `openbitfun_product_domains::fleet::dto` (the Rust side owns it; there is no
// generator for these shapes yet). Every field is the backend's; the UI never
// derives one. Optional fields stay optional: an older entry or owner may omit
// them, and an unknown enum value arrives as a string this build does not know.

export const FLEET_PROTOCOL_VERSION = 1;
export const FLEET_V1_CAPABILITY = "fleet_v1";

export const FLEET_INDEX_CHANGED_EVENT = "fleet://index-changed";
export const FLEET_PROMPTS_CHANGED_EVENT = "fleet://prompts-changed";
export const FLEET_DIGEST_CHANGED_EVENT = "fleet://digest-changed";
export const FLEET_EVENT_PREFIX = "fleet://";
export const EVENTS_DROPPED_EVENT = "backend://events-dropped";

/** `backend://events-dropped` reasons. */
export const EVENTS_DROPPED_SLOW_CLIENT = "slow_client";
export const EVENTS_DROPPED_HISTORY_GONE = "history_gone";
export const EVENTS_DROPPED_INSTANCE_CHANGED = "instance_changed";

/** `fleet_call` refusal prefixes (`"<prefix>: <detail>"`); the owner's own errors pass through. */
export const FLEET_TARGET_REQUIRED = "fleet_target_required";
export const FLEET_OWNER_MISMATCH = "fleet_owner_mismatch";
export const FLEET_DEVICE_OFFLINE = "fleet_device_offline";
export const FLEET_DEVICE_OUTDATED = "fleet_device_outdated";
export const FLEET_NESTED_CALL = "fleet_nested_call";
/** A call in flight when the client lost its entry (`controller/fleetEntry.ts`). */
export const FLEET_ENTRY_LOST = "entry_lost";

export type FleetErrorKind =
  | typeof FLEET_TARGET_REQUIRED
  | typeof FLEET_OWNER_MISMATCH
  | typeof FLEET_DEVICE_OFFLINE
  | typeof FLEET_DEVICE_OUTDATED
  | typeof FLEET_NESTED_CALL
  | typeof FLEET_ENTRY_LOST;

const FLEET_ERROR_KINDS: readonly FleetErrorKind[] = [
  FLEET_TARGET_REQUIRED,
  FLEET_OWNER_MISMATCH,
  FLEET_DEVICE_OFFLINE,
  FLEET_DEVICE_OUTDATED,
  FLEET_NESTED_CALL,
  FLEET_ENTRY_LOST,
];

/** The fleet refusal a rejected call carries, or `null` for the owner's own error. */
export function fleetErrorKind(error: unknown): FleetErrorKind | null {
  const message =
    typeof error === "string"
      ? error
      : error && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "";
  const prefix = message.split(":")[0]?.trim() ?? "";
  return (FLEET_ERROR_KINDS as readonly string[]).includes(prefix) ? (prefix as FleetErrorKind) : null;
}

export type FleetHostKind = "desktop" | "cli" | "cloud" | "unknown" | (string & {});
export type FleetDeviceState =
  | "online"
  | "offline"
  | "stale"
  | "unreachable"
  | "update_required"
  | "not_indexed"
  | "unknown"
  | (string & {});
export type FleetRouteKind =
  | "local"
  | "direct_lan"
  | "direct_ipv4"
  | "direct_ipv6"
  | "relayed_server"
  | "relayed_peer"
  | "unknown"
  | (string & {});
export type FleetWorkspaceKind = "local" | "remote_ssh" | "assistant" | "unknown" | (string & {});
export type FleetSessionStatus = "idle" | "running" | "waiting" | "error" | "unknown" | (string & {});
export type FleetSessionOrigin = "dispatch" | "bot" | "superagent" | "unknown" | (string & {});
export type FleetPromptKind = "permission" | "question" | "unknown" | (string & {});
export type FleetCursorState = "resumed" | "dropped" | "unknown" | (string & {});

export interface FleetDeviceRoute {
  kind: FleetRouteKind;
  latencyMs?: number;
  relayVia?: string;
}

export interface FleetActionGate {
  allowed: boolean;
  reason?: string;
}

export interface FleetDeviceActions {
  createWorkspace: FleetActionGate;
}

export interface FleetSession {
  deviceId: string;
  workspaceId: string;
  sessionId: string;
  parentSessionId?: string;
  title: string;
  agentType: string;
  status: FleetSessionStatus;
  unread: boolean;
  needsAttention: boolean;
  lastActivityMs: number;
  origin?: FleetSessionOrigin | null;
}

export interface FleetWorkspace {
  deviceId: string;
  workspaceId: string;
  name: string;
  /** POSIX on every client OS; never split with host path rules. */
  rootPath: string;
  kind: FleetWorkspaceKind;
  sshHost?: string;
  connectionId?: string;
  connectionName?: string;
  linkState?: string;
  isHostCurrent: boolean;
  sessions: FleetSession[];
  sessionTotal: number;
  hasMore: boolean;
}

export interface FleetDevice {
  deviceId: string;
  name: string;
  hostKind: FleetHostKind;
  isClientDevice: boolean;
  state: FleetDeviceState;
  stateReason?: string;
  asOfMs: number;
  version?: string;
  fleetProtocol: number | null;
  hostCapabilities: string[];
  route?: FleetDeviceRoute;
  actions: FleetDeviceActions;
  workspaces: FleetWorkspace[];
  sessionsTruncated: boolean;
}

export interface FleetTotals {
  running: number;
  waiting: number;
  unread: number;
}

/** `fleet_navigator {sinceRevision?}`. With `full: false` only changed devices are listed. */
export interface FleetNavigator {
  revision: number;
  full: boolean;
  devices: FleetDevice[];
  removedDeviceIds: string[];
  totals: FleetTotals;
}

export interface FleetPrompt {
  deviceId: string;
  workspaceId: string;
  sessionId: string;
  kind: FleetPromptKind;
  promptId: string;
  revision: number;
  title: string;
  toolName?: string;
  payload?: unknown;
  payloadTruncated: boolean;
  answerable: boolean;
  unanswerableReason?: string;
  answerRoute?: "runtime" | "dispatch" | "unknown" | (string & {});
  jobId?: string;
}

/** `fleet_prompts {}`. */
export interface FleetPromptsResponse {
  revision: number;
  prompts: FleetPrompt[];
}

export interface FleetOriginCursor {
  instanceId: string;
  seq: number;
}

/** The vector cursor: one `(instanceId, seq)` per origin device. */
export type FleetCursor = Record<string, FleetOriginCursor>;

/** The `fleet` member of an OBP hello. Old clients never send it. */
export interface FleetHello {
  protocol: number;
  cursor: FleetCursor;
}

/**
 * The `fleet` member of the hello answer (or the native ready info). An entry
 * without it is an old backend: the UI stays single-device.
 */
export interface FleetHelloAnswer {
  protocol: number;
  cursorState: Record<string, FleetCursorState>;
  /** The entry's own device id, when the backend names it. */
  deviceId?: string;
}

/** Payload of `backend://events-dropped`; `origin` absent means the entry's whole stream. */
export interface FleetEventsDropped {
  origin?: string;
  reason?: string;
  resumeSeq?: number;
}

export interface FleetIndexChanged {
  revision: number;
  deviceIds: string[];
}

export interface FleetPromptsChanged {
  revision: number;
  deviceId: string;
}

/** A workspace anywhere on the account: workspace ids are unique per device only. */
export interface WorkspaceKey {
  deviceId: string;
  workspaceId: string;
}

/** Reads the hello `fleet` member tolerantly; `null` when absent or unusable. */
export function readFleetHelloAnswer(value: unknown): FleetHelloAnswer | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const protocol = typeof record.protocol === "number" ? record.protocol : 0;
  if (protocol < 1) return null;
  const cursorState: Record<string, FleetCursorState> = {};
  if (record.cursorState && typeof record.cursorState === "object") {
    for (const [origin, state] of Object.entries(record.cursorState as Record<string, unknown>)) {
      if (typeof state === "string") cursorState[origin] = state;
    }
  }
  const answer: FleetHelloAnswer = { protocol, cursorState };
  if (typeof record.deviceId === "string" && record.deviceId) answer.deviceId = record.deviceId;
  return answer;
}

/** Whether a frame was already delivered: same instance and not newer (`FleetCursor::has_seen`). */
export function fleetCursorHasSeen(cursor: FleetCursor, origin: string, instance: string, seq: number): boolean {
  const at = cursor[origin];
  return at !== undefined && at.instanceId === instance && seq <= at.seq;
}

/**
 * Advances one origin after delivering a frame (`FleetCursor::advance`): a new
 * instance restarts the origin; an older seq of the same instance never moves it back.
 */
export function advanceFleetCursor(cursor: FleetCursor, origin: string, instance: string, seq: number): void {
  const at = cursor[origin];
  if (!at || at.instanceId !== instance) cursor[origin] = { instanceId: instance, seq };
  else if (seq > at.seq) at.seq = seq;
}
