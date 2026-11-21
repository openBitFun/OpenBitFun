// State, wire adapters, and actions for OpenBitFun Remote Workspaces:
// SSH hosts, ~/.ssh/config discovery, remote/local Docker containers, WSL
// distributions, Remote File Browser, Port Forwarding, and the New Workspace
// creation flow.
//
// All Tauri signatures follow `src/apps/desktop/src/api/ssh_api.rs` and
// `src/apps/desktop/src/api/commands.rs`:
// - Positional `ssh_*` and `remote_*` commands use `invokeRawCommand`.
// - Structured `{ request }` commands (`ssh_start_port_forward`, `close_workspace`,
//   `open_remote_workspace`, `open_workspace`, etc.) use `invokeCommand`.
// - Remote SSH/Docker/WSL workspaces NEVER call local `open_workspace`.

import { computed, signal } from "nsh";
import { getRecentWorkspaces, type WorkspaceRecord } from "./api";
import { invokeCommand, invokeRawCommand, listenEvent } from "./bridge";
import { isCommandUnavailable } from "./hostCommands";
import {
  activeScene,
  activeWorkspace,
  loadWorkspaces,
  onWorkspaceChanged,
  openPathWorkspace,
  selectWorkspace,
  workspaces,
} from "./state";

export type WorkspaceConnectionTarget =
  | "ssh"
  | "remoteDocker"
  | "localDocker"
  | "containerSshd"
  | "wsl";

export type WorkspaceSource = "host" | WorkspaceConnectionTarget;
export type WorkspaceLocation = "current" | "other";
export type WorkspaceEnvironment = "system" | "container" | "wsl";
export type ContainerAccess = "sshd" | "docker-exec" | "auto";
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface SSHConnectionOptions {
  connectTimeoutSecs: number;
  authTimeoutSecs: number;
  authAttempts: number;
  connectAttempts: number;
}

export interface ContainerWorkspaceConfig {
  name: string;
  access: ContainerAccess;
  local: boolean;
  dockerPath: string;
  shell: string;
  user?: string;
  interactive: boolean;
}

export interface WslWorkspaceConfig {
  distribution: string;
  user?: string;
}

export interface WslDistributions {
  supported: boolean;
  distributions: string[];
}

export type SSHAuthMethod =
  | { type: "Password"; password: string }
  | { type: "PrivateKey"; keyPath: string; passphrase?: string; certificatePath?: string }
  | { type: "Agent"; keyFingerprint?: string; fallbackKeyPath?: string }
  | { type: "KeyboardInteractive"; responses: string[] }
  | { type: "None" };

export type SavedAuthType =
  | { type: "Password" }
  | { type: "PrivateKey"; keyPath: string; certificatePath?: string }
  | { type: "Agent"; keyFingerprint?: string; fallbackKeyPath?: string }
  | { type: "KeyboardInteractive" }
  | { type: "None" };

export interface SSHConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: SSHAuthMethod;
  defaultWorkspace?: string;
  proxyJump?: string;
  proxyCommand?: string;
  container?: ContainerWorkspaceConfig;
  wsl?: WslWorkspaceConfig;
  options?: SSHConnectionOptions;
}

export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SavedAuthType;
  defaultWorkspace?: string;
  lastConnected?: number;
  proxyJump?: string;
  proxyCommand?: string;
  container?: ContainerWorkspaceConfig;
  wsl?: WslWorkspaceConfig;
  options?: SSHConnectionOptions;
}

export interface ServerInfo {
  osType?: string;
  hostname?: string;
  homeDir: string;
  os?: string;
  arch?: string;
}

export interface SSHConnectionResult {
  success: boolean;
  connectionId?: string;
  error?: string;
  serverInfo?: ServerInfo;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size?: number;
  modified?: number;
  permissions?: string;
}

export interface RemoteWorkspace {
  workspaceId?: string;
  connectionId: string;
  connectionName: string;
  remotePath: string;
  sshHost?: string;
}

export interface SSHConfigEntry {
  host: string;
  hostname?: string;
  port?: number;
  user?: string;
  identityFile?: string;
  certificateFile?: string;
  agent?: boolean;
  proxyJump?: string;
  proxyCommand?: string;
}

export interface SSHConfigLookupResult {
  found: boolean;
  config?: SSHConfigEntry;
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
}

export interface ConnectionTestStage {
  id: string;
  label: string;
  success: boolean;
  error?: string;
}

export interface ConnectionTestReport {
  success: boolean;
  stages?: ConnectionTestStage[];
  steps?: ConnectionTestStage[];
  latencyMs?: number;
  error?: string;
  serverInfo?: ServerInfo;
  resolvedContainerAccess?: ContainerAccess;
}

export type PortForwardDirection = "local" | "remote" | "dynamic";

export interface PortForwardRequest {
  connectionId: string;
  remotePort: number;
  remoteHost?: string;
  localPort?: number;
  exposeOnLan?: boolean;
  label?: string;
  description?: string;
}

export interface PortForward {
  id: string;
  connectionId: string;
  direction: PortForwardDirection;
  label?: string;
  description?: string;
  localHost: string;
  localPort: number;
  requestedLocalPort?: number;
  remoteHost: string;
  remotePort: number;
  activeConnections: number;
  totalConnections: number;
  lastError?: string;
}

export interface RemoteListeningPort {
  port: number;
  bindAddress: string;
  process?: string;
  pid?: number;
}

export interface ProjectFolder {
  path: string;
  remote?: {
    connectionId: string;
    connectionName: string;
    sshHost?: string;
  };
}

export type SshAuthFormKind =
  | "password"
  | "privateKey"
  | "agent"
  | "keyboardInteractive"
  | "none";

export interface SshFormState {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: SshAuthFormKind;
  password: string;
  keyPath: string;
  passphrase: string;
  certificatePath: string;
  keyFingerprint: string;
  fallbackKeyPath: string;
  verificationCode: string;
  proxyJump: string;
  wslDistribution: string;
  wslUser: string;
  containerName: string;
  containerAccess: "auto" | "docker-exec";
  dockerPath: string;
  containerShell: string;
  containerUser: string;
  connectTimeoutSecs: string;
  authTimeoutSecs: string;
  authAttempts: string;
  connectAttempts: string;
}

export interface OpenSshConnectionOptions {
  targetType?: WorkspaceConnectionTarget;
  fixedSource?: boolean;
  edit?: boolean;
  browseAfterConnect?: boolean;
  confirmLabel?: string;
  sshConfigEntry?: SSHConfigEntry;
  containerHost?: SavedConnection;
  onConnected?: (config: SSHConnectionConfig, connectionId: string) => void;
}

export interface OpenRemoteFileBrowserOptions {
  homePath?: string;
  selectDirectoriesOnly?: boolean;
  connectionName?: string;
  sshHost?: string;
  onSelect?: (path: string) => void;
}

export interface OpenNewWorkspaceOptions {
  step?: "choice" | "project";
  showAssistantChoice?: boolean;
}

export interface WorkspaceSourceOption {
  id: string;
  label: string;
  description: string;
  target: WorkspaceConnectionTarget;
  connection?: SavedConnection;
  sshConfigEntry?: SSHConfigEntry;
  savedConnectionId?: string;
  sourceKind: "saved" | "sshConfig" | "discovered";
}

export const DEFAULT_PROJECT_SUBDIRECTORY = "OpenBitFun/Projects";
export const DEFAULT_SSH_PORT = 22;

function createEmptySshForm(): SshFormState {
  return {
    name: "",
    host: "",
    port: "22",
    username: "",
    authType: "password",
    password: "",
    keyPath: "~/.ssh/id_rsa",
    passphrase: "",
    certificatePath: "",
    keyFingerprint: "",
    fallbackKeyPath: "~/.ssh/id_rsa",
    verificationCode: "",
    proxyJump: "",
    wslDistribution: "",
    wslUser: "",
    containerName: "",
    containerAccess: "auto",
    dockerPath: "docker",
    containerShell: "/bin/sh",
    containerUser: "",
    connectTimeoutSecs: "30",
    authTimeoutSecs: "60",
    authAttempts: "3",
    connectAttempts: "1",
  };
}

// ============================================================================
// Pure POSIX & SSH Identity Helpers
// ============================================================================

export function normalizeRemotePath(path: string): string {
  const cleaned = path.replace(/\\/g, "/").trim();
  if (!cleaned) return "/";
  if (cleaned === "~" || cleaned.startsWith("~/")) {
    const collapsed = cleaned.replace(/\/+/g, "/");
    return collapsed.length > 1 && collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
  }
  const prefixed = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  const collapsed = prefixed.replace(/\/+/g, "/");
  return collapsed.length > 1 && collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
}

export function joinRemotePath(dir: string, fileName: string): string {
  const name = fileName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!dir || dir === "/") return `/${name}`;
  if (dir === "~") return name ? `~/${name}` : "~";
  const base = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  return name ? `${base}/${name}` : base;
}

export function getRemoteParentPath(path: string): string | null {
  if (!path || path === "/" || path === "~") return null;
  if (path.startsWith("~/")) {
    const parts = path.slice(2).split("/").filter(Boolean);
    if (parts.length === 0) return null;
    parts.pop();
    return parts.length === 0 ? "~" : `~/${parts.join("/")}`;
  }
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return "/";
  parts.pop();
  return `/${parts.join("/")}`;
}

export function projectFolderName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || path;
}

export function projectFolderKey(folder: ProjectFolder): string {
  const path = folder.path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return `${folder.remote?.connectionId ?? "host"}\n${path}`;
}

export function workspaceSourceCoordinates(source: WorkspaceSource): {
  location: WorkspaceLocation;
  environment: WorkspaceEnvironment;
} {
  return {
    location:
      source === "host" || source === "localDocker" || source === "wsl" ? "current" : "other",
    environment:
      source === "wsl"
        ? "wsl"
        : source === "host" || source === "ssh"
          ? "system"
          : "container",
  };
}

export function workspaceSourceFor(
  location: WorkspaceLocation,
  environment: WorkspaceEnvironment,
): WorkspaceSource {
  if (environment === "container") return location === "current" ? "localDocker" : "remoteDocker";
  if (environment === "wsl") {
    if (location !== "current") {
      throw new Error("Native WSL requires the current work host");
    }
    return "wsl";
  }
  return location === "current" ? "host" : "ssh";
}

export function savedConnectionTarget(connection: SavedConnection): WorkspaceConnectionTarget {
  if (connection.wsl) return "wsl";
  if (connection.container?.local) return "localDocker";
  if (connection.container?.access === "sshd") return "containerSshd";
  if (connection.container) return "remoteDocker";
  return "ssh";
}

export function sameWorkspaceSource(left: WorkspaceSource, right: WorkspaceSource): boolean {
  const a = workspaceSourceCoordinates(left);
  const b = workspaceSourceCoordinates(right);
  return a.location === b.location && a.environment === b.environment;
}

export function savedConnectionConfig(connection: SavedConnection): SSHConnectionConfig {
  const { authType, lastConnected: _lastConnected, ...config } = connection;
  return {
    ...config,
    auth:
      authType.type === "Password"
        ? { type: "Password", password: "" }
        : authType.type === "KeyboardInteractive"
          ? { type: "KeyboardInteractive", responses: [] }
          : authType,
  };
}

export function formatSavedConnectionSubtitle(conn: SavedConnection): string {
  if (conn.wsl) {
    return `WSL · ${conn.wsl.distribution}${conn.wsl.user ? ` · ${conn.wsl.user}` : ""}`;
  }
  if (conn.container?.local) {
    return `Docker · ${conn.container.name}`;
  }
  const base = `${conn.username}@${conn.host}:${conn.port}`;
  const containerPart = conn.container ? ` · ${conn.container.name}` : "";
  const jumpPart = conn.proxyJump ? ` · via ${conn.proxyJump}` : "";
  return `${base}${containerPart}${jumpPart}`;
}

export function formatForwardLocalAddress(forward: PortForward): string {
  const host =
    forward.localHost === "0.0.0.0"
      ? "127.0.0.1"
      : forward.localHost === "::"
        ? "[::1]"
        : forward.localHost;
  return `${host}:${forward.localPort}`;
}

export function sshConnectionIdAliasPort(connectionId: string): number | undefined {
  if (!connectionId.startsWith("ssh-")) return undefined;
  const rest = connectionId.slice(4);
  const at = rest.indexOf("@");
  const colon = rest.lastIndexOf(":");
  const port = rest.slice(colon + 1);
  if (at < 0 || colon <= at || !/^\d+$/.test(port) || Number(port) > 65535) return undefined;
  return Number(port);
}

export function canonicalSshConnectionId(connectionId: string): string {
  if (sshConnectionIdAliasPort(connectionId) === undefined) return connectionId;
  return connectionId.slice(0, connectionId.lastIndexOf(":"));
}

export function isSshAuthenticationError(error: unknown): boolean {
  return /credentials required|authenticat|password|passphrase|private key|publickey|keyboard.interactive|challenge response|ssh agent/i.test(
    errorMessage(error),
  );
}

export function canRepairSshCredentials(authType: { type: string }, error: unknown): boolean {
  return authType.type !== "None" && isSshAuthenticationError(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingCommandError(error: unknown): boolean {
  return /command not found|no fixture|no answer|unknown command|not implemented/i.test(
    errorMessage(error),
  );
}

function isRemoteWorkspaceConnectionConflictError(error: unknown): boolean {
  return errorMessage(error).includes("remote_workspace_connection_conflict:");
}

function remoteWorkspaceConnectionConflictOwner(error: unknown): string | undefined {
  return errorMessage(error).match(/bound to SSH connection (\S+);/)?.[1];
}

function resolveConnectionIdForEndpoint(
  endpoint: { host: string; port: number; username: string; suffix?: string },
  saved: readonly SavedConnection[],
  isSameTarget: (conn: SavedConnection) => boolean,
  referencedIds: readonly string[],
): string {
  const suffix = endpoint.suffix ?? "";
  const existing = saved.find(
    conn =>
      conn.host === endpoint.host &&
      conn.port === endpoint.port &&
      conn.username === endpoint.username &&
      isSameTarget(conn),
  );
  if (existing) return existing.id;

  const legacy = `ssh-${endpoint.username}@${endpoint.host}${suffix}`;

  const taken = (id: string) => saved.some(conn => canonicalSshConnectionId(conn.id) === id);
  if (!taken(legacy)) {
    const orphan = referencedIds.find(
      id => canonicalSshConnectionId(id) === legacy && sshConnectionIdAliasPort(id) === endpoint.port,
    );
    if (orphan) return orphan;
  }

  const scoped = `ssh-${endpoint.username}@${endpoint.host}#${endpoint.port}`;
  const preferred = endpoint.port === DEFAULT_SSH_PORT ? legacy : `${scoped}${suffix}`;
  if (!taken(preferred)) return preferred;
  let candidate = `${scoped}${suffix}`;
  for (let n = 2; taken(candidate); n += 1) {
    candidate = `${scoped}~${n}${suffix}`;
  }
  return candidate;
}

// ============================================================================
// Modal Visibility & Core Signals
// ============================================================================

export const newWorkspaceModalOpen = signal<boolean>(false);
export const sshConnectionModalOpen = signal<boolean>(false);
export const remoteFileBrowserOpen = signal<boolean>(false);
export const portForwardModalOpen = signal<boolean>(false);
export const authPromptOpen = signal<boolean>(false);

// Connection inventory & liveness
export const savedConnections = signal<SavedConnection[]>([]);
export const savedConnectionsLoading = signal<boolean>(false);
export const storedPasswordMap = signal<Record<string, boolean>>({});
export const sshConfigHosts = signal<SSHConfigEntry[]>([]);
export const sshConfigLoading = signal<boolean>(false);
export const dockerContainers = signal<DockerContainerInfo[]>([]);
export const dockerContainersLoading = signal<boolean>(false);
export const wslDistributions = signal<WslDistributions | null>(null);
export const wslLoading = signal<boolean>(false);
export const wslError = signal<string>("");

export const connectionStatuses = signal<Record<string, ConnectionStatus>>({});
export const serverInfos = signal<Record<string, ServerInfo>>({});
export const activeConnectionId = signal<string | null>(null);
export const activeConnectionConfig = signal<SSHConnectionConfig | null>(null);
export const activeRemoteWorkspace = signal<RemoteWorkspace | null>(null);

// SSH Connection Dialog state
export const sshTargetType = signal<WorkspaceConnectionTarget>("ssh");
export const sshConnectionView = signal<"saved" | "new">("saved");
export const sshFixedSource = signal<boolean>(false);
export const sshEditOnly = signal<boolean>(false);
export const sshBrowseAfterConnect = signal<boolean>(true);
export const sshConfirmLabel = signal<string>("");
export const sshEditingProfile = signal<SavedConnection | null>(null);
export const sshSelectedConnectionId = signal<string | null>(null);
export const sshContainerHost = signal<SavedConnection | null>(null);
export const sshSavedSearch = signal<string>("");
export const sshConfigSearch = signal<string>("");
export const sshShowAdvanced = signal<boolean>(false);
export const sshShowPassword = signal<boolean>(false);
export const sshShowPassphrase = signal<boolean>(false);
export const sshForm = signal<SshFormState>(createEmptySshForm());
export const sshConnecting = signal<boolean>(false);
export const sshTesting = signal<boolean>(false);
export const sshError = signal<string>("");
export const sshNotice = signal<string>("");
export const connectionTestReport = signal<ConnectionTestReport | null>(null);

// Auth Prompt state (credential repair / keyboard-interactive)
export const authPromptTarget = signal<SavedConnection | null>(null);
export const authPromptDescription = signal<string>("");
export const authPromptMethod = signal<
  "password" | "privateKey" | "agent" | "keyboardInteractive"
>("password");
export const authPromptUsername = signal<string>("");
export const authPromptLockUsername = signal<boolean>(true);
export const authPromptPassword = signal<string>("");
export const authPromptKeyPath = signal<string>("~/.ssh/id_rsa");
export const authPromptPassphrase = signal<string>("");
export const authPromptCertificatePath = signal<string>("");
export const authPromptVerificationCode = signal<string>("");
export const authPromptError = signal<string>("");

// Remote File Browser state
export const browserConnectionId = signal<string | null>(null);
export const browserConnectionName = signal<string>("");
export const browserSshHost = signal<string>("");
export const browserCurrentPath = signal<string>("/tmp");
export const browserHomePath = signal<string>("/tmp");
export const browserPathInput = signal<string>("/tmp");
export const browserEditingPath = signal<boolean>(false);
export const browserEntries = signal<RemoteFileEntry[]>([]);
export const browserFilter = signal<string>("");
export const browserSelectedPath = signal<string | null>(null);
export const browserLoading = signal<boolean>(false);
export const browserBusy = signal<boolean>(false);
export const browserError = signal<string>("");
export const browserSelectDirectoriesOnly = signal<boolean>(true);
export const browserNewDirOpen = signal<boolean>(false);
export const browserNewDirName = signal<string>("");
export const browserRenamingEntry = signal<RemoteFileEntry | null>(null);
export const browserRenameValue = signal<string>("");
export const browserConfirmDeleteEntry = signal<RemoteFileEntry | null>(null);
export const browserPendingRebind = signal<{
  connectionId: string;
  connectionName: string;
  remotePath: string;
  sshHost?: string;
  owner: string;
} | null>(null);

// Port Forwarding state
export const portForwardConnectionId = signal<string | null>(null);
export const portForwardConnectionName = signal<string>("");
export const portForwards = signal<PortForward[]>([]);
export const listeningPorts = signal<RemoteListeningPort[]>([]);
export const portForwardLoading = signal<boolean>(false);
export const detectingPorts = signal<boolean>(false);
export const portForwardSubmitting = signal<boolean>(false);
export const portForwardBusyPort = signal<number | null>(null);
export const portForwardError = signal<string>("");
export const portForwardRemoteHost = signal<string>("127.0.0.1");
export const portForwardRemotePort = signal<string>("");
export const portForwardLocalPort = signal<string>("");
export const portForwardDescription = signal<string>("");
export const portForwardExposeOnLan = signal<boolean>(false);

// New Workspace Modal state
export const newWorkspaceStep = signal<"choice" | "project">("choice");
export const newWorkspaceShowAssistantChoice = signal<boolean>(true);
export const newWorkspaceSource = signal<WorkspaceSource>("host");
export const newWorkspaceName = signal<string>("");
export const newWorkspaceFolders = signal<ProjectFolder[]>([]);
export const newWorkspaceLocalPathInput = signal<string>("");
export const newWorkspaceSelectedHostId = signal<string | null>(null);
export const newWorkspaceSelectedEnvId = signal<string | null>(null);
export const newWorkspaceConnectedRemote = signal<ProjectFolder["remote"] | null>(null);
export const newWorkspaceRecentLocal = signal<WorkspaceRecord[]>([]);
export const newWorkspaceBusy = signal<boolean>(false);
export const newWorkspaceError = signal<string>("");
export const newWorkspaceEnvContainers = signal<DockerContainerInfo[]>([]);
export const newWorkspaceEnvLoading = signal<boolean>(false);

// Derived selectors
export const activeRemoteWorkspaceForCurrent = computed<WorkspaceRecord | null>(() => {
  const ws = activeWorkspace();
  return ws?.workspaceKind === "remote" ? ws : null;
});

export const filteredSavedConnections = computed<SavedConnection[]>(() => {
  const target = sshTargetType();
  const query = sshSavedSearch().trim().toLowerCase();
  return savedConnections().filter(conn => {
    if (!sameWorkspaceSource(savedConnectionTarget(conn), target)) return false;
    if (!query) return true;
    return (
      conn.name.toLowerCase().includes(query) ||
      conn.host.toLowerCase().includes(query) ||
      conn.username.toLowerCase().includes(query)
    );
  });
});

export const filteredSshConfigHosts = computed<SSHConfigEntry[]>(() => {
  const query = sshConfigSearch().trim().toLowerCase();
  const saved = savedConnections();
  return sshConfigHosts().filter(entry => {
    const hostname = entry.hostname || entry.host;
    const port = entry.port || DEFAULT_SSH_PORT;
    const user = entry.user || "";
    const alreadySaved = saved.some(
      c => !c.container && !c.wsl && c.host === hostname && c.port === port && c.username === user,
    );
    if (alreadySaved) return false;
    if (!query) return true;
    return (
      entry.host.toLowerCase().includes(query) ||
      hostname.toLowerCase().includes(query) ||
      user.toLowerCase().includes(query)
    );
  });
});

export const filteredBrowserEntries = computed<RemoteFileEntry[]>(() => {
  const query = browserFilter().trim().toLowerCase();
  const entries = browserEntries();
  if (!query) return entries;
  return entries.filter(entry => entry.name.toLowerCase().includes(query));
});

export const forwardedRemotePortSet = computed<Set<number>>(
  () => new Set(portForwards().map(forward => forward.remotePort)),
);

// Internal coordination state
let configLookupTimer: ReturnType<typeof setTimeout> | null = null;
let portForwardPollTimer: ReturnType<typeof setInterval> | null = null;
let directoryRequestTicket = 0;
let savedLoadTicket = 0;
let containerLoadTicket = 0;
let sshConnectedCallback: ((config: SSHConnectionConfig, connectionId: string) => void) | null = null;
let browserSelectCallback: ((path: string) => void) | null = null;
let pendingConnectBrowseOverride: boolean | null = null;

function stopPortForwardPolling(): void {
  if (portForwardPollTimer !== null) {
    clearInterval(portForwardPollTimer);
    portForwardPollTimer = null;
  }
}

function clearConfigLookupTimer(): void {
  if (configLookupTimer !== null) {
    clearTimeout(configLookupTimer);
    configLookupTimer = null;
  }
}

export function setSshFormField<K extends keyof SshFormState>(field: K, value: SshFormState[K]): void {
  sshForm.update(prev => ({ ...prev, [field]: value }));
  connectionTestReport.set(null);
  sshError.set("");
  if (field === "host" || field === "dockerPath") {
    dockerContainers.set([]);
  }
  if (field === "host" && typeof value === "string") {
    scheduleSshConfigLookup(value);
  }
}

export function setSshTargetType(target: WorkspaceConnectionTarget): void {
  containerLoadTicket += 1;
  dockerContainersLoading.set(false);
  const previous = sshTargetType();
  sshTargetType.set(target);
  if (!sameWorkspaceSource(previous, target)) {
    sshConnectionView.set("saved");
    sshSelectedConnectionId.set(null);
  }
  connectionTestReport.set(null);
  dockerContainers.set([]);
  sshError.set("");
  sshNotice.set("");

  if (target === "wsl") {
    void loadWslDistributions();
  } else if (target === "localDocker") {
    void loadLocalDockerContainers();
  }
}

function scheduleSshConfigLookup(host: string): void {
  clearConfigLookupTimer();
  const trimmed = host.trim();
  const target = sshTargetType();
  if (!trimmed || target === "wsl" || target === "localDocker" || target === "remoteDocker") {
    return;
  }
  configLookupTimer = setTimeout(() => {
    void lookupAndApplySshConfig(trimmed);
  }, 240);
}

async function lookupAndApplySshConfig(host: string): Promise<void> {
  try {
    const result = await invokeRawCommand<SSHConfigLookupResult>("ssh_get_config", { host });
    if (!result?.found || !result.config) return;
    const cfg = result.config;
    if (cfg.proxyJump || cfg.certificateFile) {
      sshShowAdvanced.set(true);
    }
    sshForm.update(prev => ({
      ...prev,
      port: cfg.port ? String(cfg.port) : prev.port,
      username: cfg.user || prev.username,
      keyPath: cfg.identityFile || prev.keyPath,
      certificatePath: cfg.certificateFile || prev.certificatePath,
      proxyJump: cfg.proxyJump || prev.proxyJump,
      authType: cfg.identityFile ? "privateKey" : cfg.agent ? "agent" : prev.authType,
    }));
  } catch {
    // Ignore missing ~/.ssh/config lookup errors while typing.
  }
}

export function fillFormFromSshConfig(entry: SSHConfigEntry): void {
  const keyPath = entry.identityFile?.trim() || "~/.ssh/id_rsa";
  const hasKey = Boolean(entry.identityFile?.trim());
  sshForm.update(prev => ({
    ...prev,
    name: entry.host,
    host: entry.host,
    port: entry.port ? String(entry.port) : "22",
    username: entry.user || "",
    authType: hasKey ? "privateKey" : entry.agent ? "agent" : "password",
    password: "",
    keyPath,
    passphrase: "",
    certificatePath: entry.certificateFile || "",
    keyFingerprint: "",
    fallbackKeyPath: "~/.ssh/id_rsa",
    verificationCode: "",
    proxyJump: entry.proxyJump || "",
    connectTimeoutSecs: "30",
    authTimeoutSecs: "60",
    authAttempts: "3",
    connectAttempts: "1",
  }));
  if (entry.proxyJump || entry.certificateFile) {
    sshShowAdvanced.set(true);
  }
  connectionTestReport.set(null);
  sshError.set("");
}

export function populateFormFromSavedConnection(conn: SavedConnection): void {
  const target = savedConnectionTarget(conn);
  sshTargetType.set(target);
  sshEditingProfile.set(conn);
  sshSelectedConnectionId.set(conn.id);
  if (target === "remoteDocker") {
    sshContainerHost.set({ ...conn, container: undefined });
  } else {
    sshContainerHost.set(null);
  }
  const authType: SshAuthFormKind =
    conn.authType.type === "Password"
      ? "password"
      : conn.authType.type === "PrivateKey"
        ? "privateKey"
        : conn.authType.type === "Agent"
          ? "agent"
          : conn.authType.type === "KeyboardInteractive"
            ? "keyboardInteractive"
            : "none";

  sshForm.set({
    name: conn.name,
    host: conn.host,
    port: String(conn.port),
    username: conn.username,
    authType,
    password: "",
    keyPath: conn.authType.type === "PrivateKey" ? conn.authType.keyPath : "~/.ssh/id_rsa",
    passphrase: "",
    certificatePath:
      conn.authType.type === "PrivateKey" ? conn.authType.certificatePath || "" : "",
    keyFingerprint:
      conn.authType.type === "Agent" ? conn.authType.keyFingerprint || "" : "",
    fallbackKeyPath:
      conn.authType.type === "Agent"
        ? conn.authType.fallbackKeyPath || "~/.ssh/id_rsa"
        : "~/.ssh/id_rsa",
    verificationCode: "",
    proxyJump: conn.proxyJump || "",
    wslDistribution: conn.wsl?.distribution || "",
    wslUser: conn.wsl?.user || "",
    containerName: conn.container?.name || "",
    containerAccess: conn.container?.access === "docker-exec" ? "docker-exec" : "auto",
    dockerPath: conn.container?.dockerPath || "docker",
    containerShell: conn.container?.shell || "/bin/sh",
    containerUser: conn.container?.user || "",
    connectTimeoutSecs: String(conn.options?.connectTimeoutSecs ?? 30),
    authTimeoutSecs: String(conn.options?.authTimeoutSecs ?? 60),
    authAttempts: String(conn.options?.authAttempts ?? 3),
    connectAttempts: String(conn.options?.connectAttempts ?? 1),
  });
  sshShowAdvanced.set(
    Boolean(conn.proxyJump || conn.wsl?.user) ||
      (conn.authType.type === "PrivateKey" && Boolean(conn.authType.certificatePath)) ||
      (conn.authType.type === "Agent" &&
        Boolean(conn.authType.keyFingerprint || conn.authType.fallbackKeyPath)),
  );
  connectionTestReport.set(null);
  sshError.set("");
  if (authType === "password") {
    void checkHasStoredPassword(conn.id);
  }
}

// ============================================================================
// Data Loaders
// ============================================================================

export async function loadSavedConnections(): Promise<SavedConnection[]> {
  const ticket = ++savedLoadTicket;
  savedConnectionsLoading.set(true);
  try {
    const list = await invokeRawCommand<SavedConnection[]>("ssh_list_saved_connections", {});
    if (ticket !== savedLoadTicket) return [];
    const normalized = Array.isArray(list) ? list : [];
    savedConnections.set(normalized);
    if (normalized.length === 0 && !sshEditOnly()) {
      sshConnectionView.set("new");
    }
    if (normalized.length > 0) {
      void Promise.all(
        normalized.map(async conn => {
          const alive = await invokeRawCommand<boolean>("ssh_is_connected", {
            connectionId: conn.id,
          }).catch(() => null);
          return [conn.id, alive] as const;
        }),
      ).then(results => {
        if (ticket !== savedLoadTicket) return;
        const updates: Record<string, ConnectionStatus> = {};
        let changed = false;
        for (const [id, alive] of results) {
          if (alive === true && connectionStatuses()[id] !== "connected") {
            updates[id] = "connected";
            changed = true;
          } else if (alive === false && connectionStatuses()[id] === "connected") {
            updates[id] = "disconnected";
            changed = true;
          }
        }
        if (changed) {
          connectionStatuses.update(prev => ({ ...prev, ...updates }));
        }
      });
    }
    return normalized;
  } catch (error) {
    if (
      ticket === savedLoadTicket &&
      !isMissingCommandError(error)
    ) {
      sshError.set(errorMessage(error));
    }
    return [];
  } finally {
    if (ticket === savedLoadTicket) {
      savedConnectionsLoading.set(false);
    }
  }
}

export async function checkHasStoredPassword(connectionId: string): Promise<boolean> {
  try {
    const has = await invokeRawCommand<boolean>("ssh_has_stored_password", { connectionId });
    storedPasswordMap.update(prev => ({ ...prev, [connectionId]: Boolean(has) }));
    return Boolean(has);
  } catch {
    return false;
  }
}

export async function loadSshConfigHosts(): Promise<SSHConfigEntry[]> {
  sshConfigLoading.set(true);
  try {
    const hosts = await invokeRawCommand<SSHConfigEntry[]>("ssh_list_config_hosts", {});
    const list = Array.isArray(hosts) ? hosts : [];
    sshConfigHosts.set(list);
    return list;
  } catch {
    sshConfigHosts.set([]);
    return [];
  } finally {
    sshConfigLoading.set(false);
  }
}

export async function loadWslDistributions(): Promise<WslDistributions | null> {
  wslLoading.set(true);
  wslError.set("");
  try {
    const result = await invokeRawCommand<WslDistributions>("ssh_list_wsl_distributions", {});
    wslDistributions.set(result);
    if (result?.supported && result.distributions?.length > 0 && !sshForm().wslDistribution) {
      sshForm.update(prev => ({ ...prev, wslDistribution: result.distributions[0] }));
    }
    return result;
  } catch (error) {
    wslError.set(errorMessage(error));
    return null;
  } finally {
    wslLoading.set(false);
  }
}

function buildLocalDockerDiscoveryConfig(dockerPath = "docker"): SSHConnectionConfig {
  return {
    id: "docker-local-discovery",
    name: "Docker",
    host: "localhost",
    port: 22,
    username: "docker",
    auth: { type: "PrivateKey", keyPath: "" },
    container: {
      name: "discovery",
      local: true,
      access: "auto",
      dockerPath,
      shell: "/bin/sh",
      interactive: true,
    },
  };
}

export async function loadLocalDockerContainers(): Promise<DockerContainerInfo[]> {
  return discoverDockerContainers(buildLocalDockerDiscoveryConfig(sshForm().dockerPath || "docker"));
}

export async function discoverDockerContainers(
  configOverride?: SSHConnectionConfig,
): Promise<DockerContainerInfo[]> {
  const ticket = ++containerLoadTicket;
  dockerContainersLoading.set(true);
  sshError.set("");
  try {
    const config = configOverride ?? (await buildSshConnectionConfig(false, false));
    if (!config || ticket !== containerLoadTicket) {
      return [];
    }
    const list = await invokeRawCommand<DockerContainerInfo[]>("ssh_list_docker_containers", {
      config,
    });
    if (ticket !== containerLoadTicket) return [];
    const normalized = Array.isArray(list) ? list : [];
    dockerContainers.set(normalized);
    if (normalized.length === 0) {
      sshNotice.set("No Docker containers found.");
    }
    return normalized;
  } catch (error) {
    if (ticket === containerLoadTicket) {
      sshError.set(errorMessage(error));
    }
    return [];
  } finally {
    if (ticket === containerLoadTicket) {
      dockerContainersLoading.set(false);
    }
  }
}

export async function refreshSshServerInfo(connectionId: string): Promise<ServerInfo | null> {
  try {
    const info = await invokeRawCommand<ServerInfo | null>("ssh_get_server_info", {
      connectionId,
    });
    if (info) {
      serverInfos.update(prev => ({ ...prev, [connectionId]: info }));
    }
    return info;
  } catch {
    return null;
  }
}

export async function checkSshConnected(connectionId: string): Promise<boolean> {
  try {
    const connected = await invokeRawCommand<boolean>("ssh_is_connected", { connectionId });
    connectionStatuses.update(prev => ({
      ...prev,
      [connectionId]: connected ? "connected" : "disconnected",
    }));
    return Boolean(connected);
  } catch {
    return false;
  }
}

export async function loadRemoteWorkspaceInfo(): Promise<RemoteWorkspace | null> {
  try {
    const info = await invokeRawCommand<RemoteWorkspace | null>("remote_get_workspace_info", {});
    activeRemoteWorkspace.set(info ?? null);
    return info ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Form -> SSHConnectionConfig Builder
// ============================================================================

function buildAuthMethodFromForm(form: SshFormState): SSHAuthMethod {
  switch (form.authType) {
    case "password":
      return { type: "Password", password: form.password };
    case "privateKey":
      return {
        type: "PrivateKey",
        keyPath: form.keyPath.trim(),
        passphrase: form.passphrase || undefined,
        certificatePath: form.certificatePath.trim() || undefined,
      };
    case "agent":
      return {
        type: "Agent",
        keyFingerprint: form.keyFingerprint.trim() || undefined,
        fallbackKeyPath: form.fallbackKeyPath.trim() || undefined,
      };
    case "keyboardInteractive":
      return {
        type: "KeyboardInteractive",
        responses: [form.password, form.verificationCode].filter(Boolean),
      };
    case "none":
      return { type: "None" };
  }
}

export async function buildSshConnectionConfig(
  requireContainer: boolean,
  persistsProfile = true,
): Promise<SSHConnectionConfig | null> {
  const target = sshTargetType();
  const form = sshForm();
  const editing = sshEditingProfile();
  const editOnly = sshEditOnly();

  if (target === "wsl") {
    const wsl = wslDistributions();
    if (!editOnly && !wsl?.supported) {
      sshError.set(wslError() || "WSL is not supported on this host.");
      return null;
    }
    const distribution = form.wslDistribution.trim();
    if (!distribution || (!editOnly && wsl && !wsl.distributions.includes(distribution))) {
      sshError.set("Select a WSL distribution.");
      return null;
    }
    const user = form.wslUser.trim();
    return {
      id: editing?.id ?? `wsl-${encodeURIComponent(distribution)}@${encodeURIComponent(user)}`,
      name: form.name.trim() || `WSL · ${distribution}${user ? ` · ${user}` : ""}`,
      host: "wsl.invalid",
      port: 0,
      username: user,
      auth: { type: "PrivateKey", keyPath: "" },
      wsl: { distribution, user: user || undefined },
      defaultWorkspace: editing?.defaultWorkspace,
      options: editing?.options,
    };
  }

  if (target === "remoteDocker") {
    const parentHost = sshContainerHost();
    if (!parentHost) {
      sshError.set("Select an SSH host for the remote Docker container.");
      return null;
    }
    if (requireContainer && !form.containerName.trim()) {
      sshError.set("Container name is required.");
      return null;
    }
    const containerName = form.containerName.trim() || "discovery";
    return {
      ...savedConnectionConfig(parentHost),
      id: !requireContainer
        ? parentHost.id
        : editing?.id || `${parentHost.id}-container-${containerName}`,
      name: form.name.trim() || containerName,
      defaultWorkspace: editing?.defaultWorkspace,
      container: {
        name: containerName,
        local: false,
        access: form.containerAccess,
        dockerPath: form.dockerPath.trim() || "docker",
        shell: form.containerShell.trim() || "/bin/sh",
        user: form.containerUser.trim() || undefined,
        interactive: true,
      },
    };
  }

  const isLocalDocker = target === "localDocker";
  const usesContainer = target !== "ssh";
  if (!isLocalDocker && !form.host.trim()) {
    sshError.set("Host address is required.");
    return null;
  }
  if (!isLocalDocker && !form.username.trim()) {
    sshError.set("Username is required.");
    return null;
  }
  const portText = isLocalDocker ? "22" : form.port.trim();
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    sshError.set("Port must be a number between 1 and 65535.");
    return null;
  }
  if (!isLocalDocker && form.authType === "password" && !form.password && !editing) {
    sshError.set("Password is required.");
    return null;
  }
  if (!isLocalDocker && form.authType === "privateKey" && !form.keyPath.trim()) {
    sshError.set("Private key path is required.");
    return null;
  }
  if (
    !isLocalDocker &&
    !editOnly &&
    form.authType === "keyboardInteractive" &&
    !form.password &&
    !form.verificationCode
  ) {
    sshError.set("Challenge password or verification code is required.");
    return null;
  }
  if (
    usesContainer &&
    target !== "containerSshd" &&
    requireContainer &&
    !form.containerName.trim()
  ) {
    sshError.set("Container name is required.");
    return null;
  }

  const connectTimeoutSecs = Number(form.connectTimeoutSecs);
  const authTimeoutSecs = Number(form.authTimeoutSecs);
  const authAttempts = Number(form.authAttempts);
  const connectAttempts = Number(form.connectAttempts);
  if (
    !Number.isInteger(connectTimeoutSecs) ||
    connectTimeoutSecs < 1 ||
    !Number.isInteger(authTimeoutSecs) ||
    authTimeoutSecs < 1 ||
    !Number.isInteger(authAttempts) ||
    authAttempts < 1 ||
    authAttempts > 10 ||
    !Number.isInteger(connectAttempts) ||
    connectAttempts < 1 ||
    connectAttempts > 5
  ) {
    sshShowAdvanced.set(true);
    sshError.set("Invalid connection timeouts or attempt limits.");
    return null;
  }

  const hostInput = isLocalDocker ? "local-docker" : form.host.trim();
  let connectHost = hostInput;
  let resolvedProxyJump = form.proxyJump.trim();
  if (!isLocalDocker) {
    try {
      const lookup = await invokeRawCommand<SSHConfigLookupResult>("ssh_get_config", {
        host: hostInput,
      });
      if (lookup?.found && lookup.config?.hostname?.trim()) {
        connectHost = lookup.config.hostname.trim();
      }
      if (lookup?.found && lookup.config?.proxyJump && !resolvedProxyJump) {
        resolvedProxyJump = lookup.config.proxyJump;
      }
    } catch {
      // Keep manual host settings if ~/.ssh/config lookup fails.
    }
  }

  const username = isLocalDocker ? form.username.trim() || "docker" : form.username.trim();
  const containerName =
    form.containerName.trim() || (target === "containerSshd" ? connectHost : "discovery");

  let id = editing?.id ?? `docker-local-${containerName}`;
  if (!editing && !isLocalDocker) {
    const isSameTarget = (conn: SavedConnection) =>
      !conn.wsl &&
      (usesContainer
        ? !conn.container?.local && conn.container?.name === containerName
        : !conn.container);
    const saved = savedConnections();
    const referencedIds = workspaces()
      .filter(ws => ws.workspaceKind === "remote" && ws.connectionId)
      .map(ws => ws.connectionId as string);
    id = resolveConnectionIdForEndpoint(
      { host: connectHost, port, username, suffix: usesContainer ? `-container-${containerName}` : "" },
      saved,
      isSameTarget,
      referencedIds,
    );
  }

  return {
    id,
    name: form.name.trim() || (isLocalDocker ? containerName : `${username}@${hostInput}`),
    host: connectHost,
    port,
    username,
    auth: isLocalDocker ? { type: "PrivateKey", keyPath: "" } : buildAuthMethodFromForm(form),
    defaultWorkspace: editing?.defaultWorkspace,
    proxyJump: !isLocalDocker ? resolvedProxyJump || undefined : undefined,
    proxyCommand: editing?.proxyCommand,
    container: usesContainer
      ? {
          name: containerName,
          access: target === "containerSshd" ? "sshd" : form.containerAccess,
          local: isLocalDocker,
          dockerPath: form.dockerPath.trim() || "docker",
          shell: form.containerShell.trim() || "/bin/sh",
          user: form.containerUser.trim() || undefined,
          interactive: true,
        }
      : undefined,
    options: {
      connectTimeoutSecs,
      authTimeoutSecs,
      authAttempts,
      connectAttempts,
    },
  };
}

// ============================================================================
// Connection Actions (Test, Connect, Save, Delete, Disconnect)
// ============================================================================

export async function testSshConnection(): Promise<ConnectionTestReport | null> {
  sshTesting.set(true);
  connectionTestReport.set(null);
  sshError.set("");
  try {
    const config = await buildSshConnectionConfig(true, false);
    if (!config) return null;
    const report = await invokeRawCommand<ConnectionTestReport>("ssh_test_connection", { config });
    connectionTestReport.set(report);
    return report;
  } catch (error) {
    sshError.set(errorMessage(error));
    return null;
  } finally {
    sshTesting.set(false);
  }
}

export async function connectWithConfig(
  config: SSHConnectionConfig,
  options: { browseAfterConnect?: boolean } = {},
): Promise<SSHConnectionResult | null> {
  sshConnecting.set(true);
  sshError.set("");
  sshNotice.set("");
  connectionStatuses.update(prev => ({ ...prev, [config.id]: "connecting" }));

  try {
    const result = await invokeRawCommand<SSHConnectionResult>("ssh_connect", { config });
    if (!result?.success) {
      const msg = result?.error || "SSH connection failed";
      connectionStatuses.update(prev => ({ ...prev, [config.id]: "error" }));
      throw new Error(msg);
    }

    const resolvedId = result.connectionId || config.id;
    activeConnectionId.set(resolvedId);
    activeConnectionConfig.set(config);
    connectionStatuses.update(prev => ({ ...prev, [resolvedId]: "connected" }));

    let homeDir = result.serverInfo?.homeDir?.trim() || "";
    if (result.serverInfo) {
      serverInfos.update(prev => ({ ...prev, [resolvedId]: result.serverInfo! }));
    }
    if (!homeDir) {
      const probed = await refreshSshServerInfo(resolvedId);
      if (probed?.homeDir?.trim()) homeDir = probed.homeDir.trim();
    }

    void loadSavedConnections();
    const shouldBrowse =
      options.browseAfterConnect ??
      pendingConnectBrowseOverride ??
      sshBrowseAfterConnect();

    if (sshConnectedCallback) {
      const cb = sshConnectedCallback;
      sshConnectedCallback = null;
      sshConnectionModalOpen.set(false);
      cb(config, resolvedId);
      return result;
    }

    sshConnectionModalOpen.set(false);
    if (shouldBrowse) {
      const initial = homeDir ? normalizeRemotePath(homeDir) : "/tmp";
      await openRemoteFileBrowser(resolvedId, initial, {
        homePath: initial,
        selectDirectoriesOnly: true,
        connectionName: config.name,
        sshHost: config.host,
      });
    }
    return result;
  } catch (error) {
    connectionStatuses.update(prev => ({ ...prev, [config.id]: "error" }));
    sshError.set(errorMessage(error));
    throw error;
  } finally {
    sshConnecting.set(false);
  }
}

export async function submitSshConnectionForm(): Promise<void> {
  sshError.set("");
  try {
    const config = await buildSshConnectionConfig(true, true);
    if (!config) return;
    await connectWithConfig(config);
  } catch (error) {
    sshError.set(errorMessage(error));
  }
}

export async function saveSshConnectionForm(): Promise<boolean> {
  sshConnecting.set(true);
  sshError.set("");
  try {
    const config = await buildSshConnectionConfig(true, true);
    if (!config) return false;
    await invokeRawCommand<void>("ssh_save_connection", { config });
    await loadSavedConnections();
    if (sshEditOnly()) {
      sshConnectionModalOpen.set(false);
    } else {
      sshEditingProfile.set(null);
      sshSelectedConnectionId.set(config.id);
      sshConnectionView.set("saved");
      sshNotice.set("Connection profile saved.");
    }
    return true;
  } catch (error) {
    sshError.set(errorMessage(error));
    return false;
  } finally {
    sshConnecting.set(false);
  }
}

export async function deleteSavedSshConnection(connectionId: string): Promise<boolean> {
  try {
    await invokeRawCommand<void>("ssh_delete_connection", { connectionId });
    if (sshSelectedConnectionId() === connectionId) {
      sshSelectedConnectionId.set(null);
    }
    await loadSavedConnections();
    return true;
  } catch (error) {
    sshError.set(errorMessage(error));
    return false;
  }
}

export async function quickConnectSavedConnection(
  conn: SavedConnection,
  options: { browseAfterConnect?: boolean } = {},
): Promise<SSHConnectionResult | null> {
  sshError.set("");
  if (conn.authType.type === "KeyboardInteractive") {
    openAuthPrompt(conn);
    return null;
  }
  try {
    return await connectWithConfig(savedConnectionConfig(conn), options);
  } catch (error) {
    if (!conn.wsl && !conn.container?.local && canRepairSshCredentials(conn.authType, error)) {
      openAuthPrompt(conn);
      return null;
    }
    sshError.set(errorMessage(error));
    return null;
  }
}

export function openAuthPrompt(conn: SavedConnection): void {
  authPromptTarget.set(conn);
  authPromptDescription.set(
    conn.name || `${conn.username}@${conn.host}:${conn.port}`,
  );
  authPromptMethod.set(
    conn.authType.type === "PrivateKey"
      ? "privateKey"
      : conn.authType.type === "Agent"
        ? "agent"
        : conn.authType.type === "KeyboardInteractive"
          ? "keyboardInteractive"
          : "password",
  );
  authPromptUsername.set(conn.username || "");
  authPromptLockUsername.set(Boolean(conn.username?.trim()));
  authPromptPassword.set("");
  authPromptKeyPath.set(
    conn.authType.type === "PrivateKey" ? conn.authType.keyPath : "~/.ssh/id_rsa",
  );
  authPromptPassphrase.set("");
  authPromptCertificatePath.set(
    conn.authType.type === "PrivateKey" ? conn.authType.certificatePath || "" : "",
  );
  authPromptVerificationCode.set("");
  authPromptError.set("");
  authPromptOpen.set(true);
}

export function closeAuthPrompt(): void {
  authPromptOpen.set(false);
  authPromptTarget.set(null);
  authPromptPassword.set("");
  authPromptPassphrase.set("");
  authPromptVerificationCode.set("");
  authPromptError.set("");
}

export async function submitAuthPrompt(): Promise<void> {
  const conn = authPromptTarget();
  if (!conn || sshConnecting()) return;
  const method = authPromptMethod();
  const username = authPromptUsername().trim();
  if (!username) {
    authPromptError.set("Username is required.");
    return;
  }
  let auth: SSHAuthMethod;
  if (method === "password") {
    if (!authPromptPassword()) {
      authPromptError.set("Password is required.");
      return;
    }
    auth = { type: "Password", password: authPromptPassword() };
  } else if (method === "privateKey") {
    if (!authPromptKeyPath().trim()) {
      authPromptError.set("Private key path is required.");
      return;
    }
    auth = {
      type: "PrivateKey",
      keyPath: authPromptKeyPath().trim(),
      passphrase: authPromptPassphrase().trim() || undefined,
      certificatePath: authPromptCertificatePath().trim() || undefined,
    };
  } else if (method === "agent") {
    auth = { type: "Agent" };
  } else {
    const responses = [authPromptPassword(), authPromptVerificationCode()].filter(Boolean);
    if (responses.length === 0) {
      authPromptError.set("Verification code or password is required.");
      return;
    }
    auth = { type: "KeyboardInteractive", responses };
  }

  authPromptError.set("");
  try {
    const config: SSHConnectionConfig = {
      id: conn.id,
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username,
      auth,
      defaultWorkspace: conn.defaultWorkspace,
      proxyJump: conn.proxyJump,
      proxyCommand: conn.proxyCommand,
      container: conn.container,
      wsl: conn.wsl,
      options: conn.options,
    };
    const reconnect = pendingAuthReconnect?.connectionId === conn.id ? pendingAuthReconnect : null;
    const result = await connectWithConfig(config, reconnect ? { browseAfterConnect: false } : {});
    closeAuthPrompt();
    if (reconnect && result) {
      pendingAuthReconnect = null;
      await activateReconnectedWorkspace(reconnect, result.connectionId || conn.id);
    }
  } catch (error) {
    authPromptError.set(errorMessage(error));
  }
}

export async function disconnectSsh(connectionId: string): Promise<void> {
  try {
    await invokeRawCommand<void>("ssh_disconnect", { connectionId });
  } finally {
    connectionStatuses.update(prev => ({ ...prev, [connectionId]: "disconnected" }));
    if (activeConnectionId() === connectionId) {
      activeConnectionId.set(null);
      activeConnectionConfig.set(null);
    }
    if (remoteFileBrowserOpen() && browserConnectionId() === connectionId) {
      closeRemoteFileBrowser();
    }
    if (portForwardModalOpen() && portForwardConnectionId() === connectionId) {
      closePortForwardModal();
    }
  }
}

// ============================================================================
// Remote File Browser & Remote Workspace Open/Close
// ============================================================================

export async function loadRemoteDirectory(path: string): Promise<void> {
  const connectionId = browserConnectionId();
  if (!connectionId) return;
  const ticket = ++directoryRequestTicket;
  const normalized = normalizeRemotePath(path);

  browserLoading.set(true);
  browserError.set("");
  browserSelectedPath.set(null);
  browserEditingPath.set(false);

  const readOnce = () =>
    invokeRawCommand<RemoteFileEntry[]>("remote_read_dir", {
      connectionId,
      path: normalized,
    });

  try {
    let entries: RemoteFileEntry[];
    try {
      entries = await readOnce();
    } catch (firstErr) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (ticket !== directoryRequestTicket) return;
      try {
        entries = await readOnce();
      } catch {
        throw firstErr;
      }
    }
    if (ticket !== directoryRequestTicket) return;
    const sorted = [...(Array.isArray(entries) ? entries : [])].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    browserEntries.set(sorted);
    browserCurrentPath.set(normalized);
    browserPathInput.set(normalized);
  } catch (error) {
    if (ticket === directoryRequestTicket) {
      browserError.set(errorMessage(error));
    }
  } finally {
    if (ticket === directoryRequestTicket) {
      browserLoading.set(false);
    }
  }
}

export async function checkRemoteExists(connectionId: string, path: string): Promise<boolean> {
  return Boolean(
    await invokeRawCommand<boolean>("remote_exists", {
      connectionId,
      path: normalizeRemotePath(path),
    }),
  );
}

export async function createRemoteDirectory(
  rawNameOrPath: string,
  navigateInto = true,
): Promise<boolean> {
  const connectionId = browserConnectionId();
  const trimmed = rawNameOrPath.trim();
  if (!connectionId || !trimmed) return false;
  const targetPath = trimmed.startsWith("/")
    ? normalizeRemotePath(trimmed)
    : joinRemotePath(browserCurrentPath(), trimmed);

  browserBusy.set(true);
  browserError.set("");
  try {
    const alreadyExists = await checkRemoteExists(connectionId, targetPath).catch(() => false);
    if (!alreadyExists) {
      await invokeRawCommand<void>("remote_create_dir", {
        connectionId,
        path: targetPath,
        recursive: true,
      });
    }
    browserNewDirOpen.set(false);
    browserNewDirName.set("");
    if (navigateInto) {
      await loadRemoteDirectory(targetPath);
    } else {
      await loadRemoteDirectory(browserCurrentPath());
    }
    return true;
  } catch (error) {
    browserError.set(errorMessage(error));
    return false;
  } finally {
    browserBusy.set(false);
  }
}

export async function submitRemoteRename(): Promise<boolean> {
  const connectionId = browserConnectionId();
  const entry = browserRenamingEntry();
  const nextName = browserRenameValue().trim();
  if (!connectionId || !entry || !nextName) return false;
  if (nextName === entry.name) {
    browserRenamingEntry.set(null);
    return true;
  }
  const parent = getRemoteParentPath(entry.path) ?? "/";
  const newPath = joinRemotePath(parent, nextName);
  browserBusy.set(true);
  browserError.set("");
  try {
    await invokeRawCommand<void>("remote_rename", {
      connectionId,
      oldPath: entry.path,
      newPath,
    });
    browserRenamingEntry.set(null);
    browserRenameValue.set("");
    await loadRemoteDirectory(browserCurrentPath());
    return true;
  } catch (error) {
    browserError.set(errorMessage(error));
    return false;
  } finally {
    browserBusy.set(false);
  }
}

export async function confirmRemoteDelete(): Promise<boolean> {
  const connectionId = browserConnectionId();
  const entry = browserConfirmDeleteEntry();
  if (!connectionId || !entry) return false;
  browserBusy.set(true);
  browserError.set("");
  try {
    await invokeRawCommand<void>("remote_remove", {
      connectionId,
      path: entry.path,
      recursive: entry.isDir,
    });
    browserConfirmDeleteEntry.set(null);
    await loadRemoteDirectory(browserCurrentPath());
    return true;
  } catch (error) {
    browserError.set(errorMessage(error));
    return false;
  } finally {
    browserBusy.set(false);
  }
}

/**
 * Opens and activates a remote workspace on an SSH/Docker/WSL connection.
 * Never calls local `open_workspace`.
 */
export async function openRemoteWorkspace(
  connectionId: string,
  remotePath: string,
  options: {
    connectionName?: string;
    sshHost?: string;
    rebindConnection?: boolean;
  } = {},
): Promise<boolean> {
  const normalizedPath = normalizeRemotePath(remotePath);
  const saved = savedConnections().find(conn => conn.id === connectionId);
  const connectionName =
    options.connectionName?.trim() ||
    saved?.name ||
    activeConnectionConfig()?.name ||
    "Remote";
  const sshHost =
    options.sshHost?.trim() ||
    saved?.host ||
    activeConnectionConfig()?.host ||
    undefined;

  browserBusy.set(true);
  browserError.set("");
  try {
    let openedRecord: WorkspaceRecord | null = null;
    try {
      openedRecord = await invokeCommand<WorkspaceRecord>("open_remote_workspace", {
        remotePath: normalizedPath,
        connectionId,
        connectionName,
        ...(sshHost ? { sshHost } : {}),
        ...(options.rebindConnection ? { rebindConnection: true } : {}),
      });
    } catch (error) {
      if (isRemoteWorkspaceConnectionConflictError(error)) {
        const ownerId = remoteWorkspaceConnectionConflictOwner(error) || "";
        const ownerName =
          savedConnections().find(c => c.id === ownerId)?.name || ownerId || "another connection";
        browserPendingRebind.set({
          connectionId,
          connectionName,
          remotePath: normalizedPath,
          sshHost,
          owner: ownerName,
        });
        return false;
      }
      if (!isMissingCommandError(error)) {
        throw error;
      }
    }

    try {
      await invokeRawCommand<void>("remote_open_workspace", {
        connectionId,
        remotePath: normalizedPath,
      });
    } catch (remoteErr) {
      // A CLI peer implements `open_remote_workspace` (`HANDLED`) without
      // `remote_open_workspace` (`CLI_NOT_IMPLEMENTED`); only fall through when
      // `open_remote_workspace` already registered the record.
      if (!openedRecord || !isMissingCommandError(remoteErr)) {
        throw remoteErr;
      }
    }

    await loadWorkspaces();

    if (openedRecord?.id && !workspaces().some(ws => ws.id === openedRecord?.id)) {
      workspaces.update(current => [openedRecord!, ...current]);
    }
    const matched =
      (openedRecord?.id ? workspaces().find(ws => ws.id === openedRecord?.id) : undefined) ??
      workspaces().find(
        ws =>
          ws.workspaceKind === "remote" &&
          ws.connectionId === connectionId &&
          normalizeRemotePath(ws.rootPath) === normalizedPath,
      ) ??
      workspaces().find(ws => normalizeRemotePath(ws.rootPath) === normalizedPath);

    if (matched) {
      selectWorkspace(matched.id);
    }

    activeRemoteWorkspace.set({
      workspaceId: matched?.id ?? openedRecord?.id,
      connectionId,
      connectionName,
      remotePath: normalizedPath,
      sshHost,
    });
    connectionStatuses.update(prev => ({ ...prev, [connectionId]: "connected" }));
    browserPendingRebind.set(null);
    remoteFileBrowserOpen.set(false);
    sshConnectionModalOpen.set(false);
    newWorkspaceModalOpen.set(false);
    return true;
  } catch (error) {
    browserError.set(errorMessage(error));
    return false;
  } finally {
    browserBusy.set(false);
  }
}

export async function confirmRemoteWorkspaceRebind(): Promise<boolean> {
  const pending = browserPendingRebind();
  if (!pending) return false;
  return openRemoteWorkspace(pending.connectionId, pending.remotePath, {
    connectionName: pending.connectionName,
    sshHost: pending.sshHost,
    rebindConnection: true,
  });
}

export function cancelRemoteWorkspaceRebind(): void {
  browserPendingRebind.set(null);
}

export async function confirmBrowserSelection(): Promise<void> {
  const connectionId = browserConnectionId();
  if (!connectionId || browserLoading()) return;
  const chosen = browserSelectDirectoriesOnly()
    ? browserCurrentPath()
    : browserSelectedPath() || browserCurrentPath();

  if (browserSelectCallback) {
    const cb = browserSelectCallback;
    browserSelectCallback = null;
    remoteFileBrowserOpen.set(false);
    cb(chosen);
    return;
  }

  await openRemoteWorkspace(connectionId, chosen, {
    connectionName: browserConnectionName(),
    sshHost: browserSshHost(),
  });
}

export async function closeWorkspaceRecord(workspaceId: string): Promise<void> {
  const target = workspaces().find(ws => ws.id === workspaceId);
  await invokeCommand<void>("close_workspace", { workspaceId });
  if (target?.workspaceKind === "remote") {
    const currentRemote = activeRemoteWorkspace();
    if (!currentRemote || currentRemote.workspaceId === workspaceId) {
      await invokeRawCommand<void>("remote_close_workspace", {}).catch(() => undefined);
      activeRemoteWorkspace.set(null);
    }
  }
  await loadWorkspaces();
}

export async function closeCurrentRemoteWorkspace(): Promise<void> {
  const currentRemote = activeRemoteWorkspace();
  const active = activeWorkspace();
  await invokeRawCommand<void>("remote_close_workspace", {});
  activeRemoteWorkspace.set(null);
  const wsId =
    currentRemote?.workspaceId ??
    (active?.workspaceKind === "remote" ? active.id : undefined);
  if (wsId) {
    await invokeCommand<void>("close_workspace", { workspaceId: wsId }).catch(() => undefined);
  }
  await loadWorkspaces();
}

export async function removeRemoteWorkspaceEntry(
  connectionId: string,
  remotePath: string,
): Promise<void> {
  await invokeRawCommand<void>("remote_remove_workspace", {
    connectionId,
    remotePath: normalizeRemotePath(remotePath),
  });
}

// ============================================================================
// Port Forwarding Actions
// ============================================================================

export async function loadPortForwards(connectionId?: string): Promise<PortForward[]> {
  portForwardLoading.set(true);
  try {
    const list = await invokeRawCommand<PortForward[]>("ssh_list_port_forwards", {
      connectionId: connectionId ?? null,
    });
    const normalized = Array.isArray(list) ? list : [];
    portForwards.set(normalized);
    return normalized;
  } catch (error) {
    portForwardError.set(errorMessage(error));
    return [];
  } finally {
    portForwardLoading.set(false);
  }
}

export async function detectRemoteListeningPorts(
  connectionId = portForwardConnectionId() ?? "",
): Promise<RemoteListeningPort[]> {
  if (!connectionId) return [];
  detectingPorts.set(true);
  portForwardError.set("");
  try {
    const ports = await invokeRawCommand<RemoteListeningPort[]>(
      "ssh_list_remote_listening_ports",
      { connectionId },
    );
    const normalized = Array.isArray(ports) ? ports : [];
    listeningPorts.set(normalized);
    return normalized;
  } catch (error) {
    listeningPorts.set([]);
    portForwardError.set(errorMessage(error));
    return [];
  } finally {
    detectingPorts.set(false);
  }
}

export async function startPortForward(request: PortForwardRequest): Promise<PortForward | null> {
  portForwardError.set("");
  const labelText = (request.label ?? request.description ?? "").trim() || undefined;
  const payload: Record<string, unknown> = {
    connectionId: request.connectionId,
    remoteHost: request.remoteHost?.trim() || "127.0.0.1",
    remotePort: request.remotePort,
    ...(request.localPort && request.localPort > 0 ? { localPort: request.localPort } : {}),
    exposeOnLan: request.exposeOnLan === true,
    ...(labelText ? { label: labelText, description: labelText } : {}),
  };
  try {
    const forward = await invokeCommand<PortForward>("ssh_start_port_forward", payload);
    await loadPortForwards(request.connectionId);
    return forward;
  } catch (error) {
    portForwardError.set(errorMessage(error));
    return null;
  }
}

export async function submitPortForwardForm(): Promise<boolean> {
  const connectionId = portForwardConnectionId();
  if (!connectionId || portForwardSubmitting()) return false;
  const remotePortText = portForwardRemotePort().trim();
  const localPortText = portForwardLocalPort().trim();
  const remotePort = Number(remotePortText);
  if (
    !/^\d+$/.test(remotePortText) ||
    !Number.isInteger(remotePort) ||
    remotePort < 1 ||
    remotePort > 65535
  ) {
    portForwardError.set("Remote port must be between 1 and 65535.");
    return false;
  }
  let localPort: number | undefined;
  if (localPortText) {
    const parsedLocal = Number(localPortText);
    if (!/^\d+$/.test(localPortText) || !Number.isInteger(parsedLocal) || parsedLocal < 1 || parsedLocal > 65535) {
      portForwardError.set("Local port must be between 1 and 65535.");
      return false;
    }
    localPort = parsedLocal;
  }

  portForwardSubmitting.set(true);
  try {
    const created = await startPortForward({
      connectionId,
      remoteHost: portForwardRemoteHost().trim() || "127.0.0.1",
      remotePort,
      localPort,
      exposeOnLan: portForwardExposeOnLan(),
      description: portForwardDescription().trim() || undefined,
      label: portForwardDescription().trim() || undefined,
    });
    if (created) {
      portForwardRemotePort.set("");
      portForwardLocalPort.set("");
      portForwardDescription.set("");
      return true;
    }
    return false;
  } finally {
    portForwardSubmitting.set(false);
  }
}

export async function forwardDetectedPort(port: RemoteListeningPort): Promise<void> {
  const connectionId = portForwardConnectionId();
  if (!connectionId || portForwardBusyPort() !== null) return;
  portForwardBusyPort.set(port.port);
  try {
    await startPortForward({
      connectionId,
      remoteHost: "127.0.0.1",
      remotePort: port.port,
      exposeOnLan: false,
      label: port.process ?? undefined,
      description: port.process ?? undefined,
    });
  } finally {
    portForwardBusyPort.set(null);
  }
}

export async function stopPortForward(forwardId: string): Promise<void> {
  const connectionId = portForwardConnectionId() ?? undefined;
  portForwardError.set("");
  try {
    await invokeRawCommand<void>("ssh_stop_port_forward", { forwardId });
    await loadPortForwards(connectionId);
  } catch (error) {
    portForwardError.set(errorMessage(error));
  }
}

// ============================================================================
// New Workspace Modal Actions
// ============================================================================

export function setNewWorkspaceSource(source: WorkspaceSource): void {
  const prevLoc = workspaceSourceCoordinates(newWorkspaceSource()).location;
  const nextLoc = workspaceSourceCoordinates(source).location;
  if (prevLoc !== nextLoc) {
    newWorkspaceSelectedHostId.set(null);
  }
  newWorkspaceSource.set(source);
  newWorkspaceSelectedEnvId.set(null);
  newWorkspaceConnectedRemote.set(null);
  newWorkspaceError.set("");
  newWorkspaceEnvContainers.set([]);

  if (source === "localDocker") {
    void loadNewWorkspaceEnvironmentContainers("localDocker");
  } else if (source === "remoteDocker" && newWorkspaceSelectedHostId()) {
    void loadNewWorkspaceEnvironmentContainers("remoteDocker");
  } else if (source === "wsl") {
    void loadWslDistributions();
  }
}

export function selectNewWorkspaceHostOption(optionId: string | null): void {
  newWorkspaceSelectedHostId.set(optionId);
  newWorkspaceSelectedEnvId.set(null);
  newWorkspaceConnectedRemote.set(null);
  newWorkspaceError.set("");
  newWorkspaceEnvContainers.set([]);

  if (optionId && newWorkspaceSource() === "remoteDocker") {
    void loadNewWorkspaceEnvironmentContainers("remoteDocker");
  }
}

export async function loadNewWorkspaceEnvironmentContainers(
  target: "localDocker" | "remoteDocker",
): Promise<void> {
  newWorkspaceEnvLoading.set(true);
  newWorkspaceError.set("");
  try {
    let config: SSHConnectionConfig;
    if (target === "localDocker") {
      config = buildLocalDockerDiscoveryConfig("docker");
    } else {
      const hostOpt = newWorkspaceHostOptions().find(
        opt => opt.id === newWorkspaceSelectedHostId(),
      );
      if (!hostOpt) {
        newWorkspaceEnvContainers.set([]);
        return;
      }
      if (hostOpt.connection) {
        config = {
          ...savedConnectionConfig(hostOpt.connection),
          container: {
            name: "discovery",
            local: false,
            access: "auto",
            dockerPath: "docker",
            shell: "/bin/sh",
            interactive: true,
          },
        };
      } else if (hostOpt.sshConfigEntry) {
        const e = hostOpt.sshConfigEntry;
        config = {
          id: hostOpt.id,
          name: e.host,
          host: e.hostname || e.host,
          port: e.port || DEFAULT_SSH_PORT,
          username: e.user || "",
          auth: e.identityFile
            ? { type: "PrivateKey", keyPath: e.identityFile, certificatePath: e.certificateFile }
            : e.agent
              ? { type: "Agent" }
              : { type: "Password", password: "" },
          proxyJump: e.proxyJump,
          container: {
            name: "discovery",
            local: false,
            access: "auto",
            dockerPath: "docker",
            shell: "/bin/sh",
            interactive: true,
          },
        };
      } else {
        newWorkspaceEnvContainers.set([]);
        return;
      }
    }
    const list = await invokeRawCommand<DockerContainerInfo[]>("ssh_list_docker_containers", {
      config,
    });
    newWorkspaceEnvContainers.set(Array.isArray(list) ? list : []);
  } catch (error) {
    newWorkspaceEnvContainers.set([]);
    newWorkspaceError.set(errorMessage(error));
  } finally {
    newWorkspaceEnvLoading.set(false);
  }
}

export const newWorkspaceHostOptions = computed<WorkspaceSourceOption[]>(() => {
  const saved = savedConnections().filter(conn => !conn.container && !conn.wsl);
  const options: WorkspaceSourceOption[] = saved.map(conn => ({
    id: conn.id,
    label: conn.name,
    description: `${conn.username}@${conn.host}:${conn.port}`,
    target: "ssh",
    connection: conn,
    savedConnectionId: conn.id,
    sourceKind: "saved",
  }));
  for (const entry of sshConfigHosts()) {
    const hostname = entry.hostname || entry.host;
    const port = entry.port || DEFAULT_SSH_PORT;
    const user = entry.user || "";
    if (saved.some(c => c.host === hostname && c.port === port && c.username === user)) continue;
    options.push({
      id: `ssh-config:${entry.host}`,
      label: entry.host,
      description: `${user}@${hostname}:${port}`,
      target: "ssh",
      sshConfigEntry: entry,
      sourceKind: "sshConfig",
    });
  }
  return options;
});

export const newWorkspaceEnvOptions = computed<WorkspaceSourceOption[]>(() => {
  const source = newWorkspaceSource();
  if (source === "host" || source === "ssh") return [];
  const saved = savedConnections().filter(conn =>
    sameWorkspaceSource(savedConnectionTarget(conn), source),
  );
  if (source === "wsl") {
    const out: WorkspaceSourceOption[] = saved.map(conn => ({
      id: conn.id,
      label: conn.name,
      description: conn.wsl?.distribution || "",
      target: "wsl",
      connection: conn,
      savedConnectionId: conn.id,
      sourceKind: "saved",
    }));
    const dists = wslDistributions();
    if (dists?.supported) {
      for (const dist of dists.distributions) {
        if (saved.some(c => c.wsl?.distribution === dist && !c.wsl?.user)) continue;
        const id = `wsl-${encodeURIComponent(dist)}@`;
        out.push({
          id,
          label: dist,
          description: "WSL distribution",
          target: "wsl",
          connection: {
            id,
            name: `WSL · ${dist}`,
            host: "wsl.invalid",
            port: 0,
            username: "",
            authType: { type: "PrivateKey", keyPath: "" },
            wsl: { distribution: dist },
          },
          sourceKind: "discovered",
        });
      }
    }
    return out;
  }

  const hostOption =
    source === "remoteDocker"
      ? newWorkspaceHostOptions().find(opt => opt.id === newWorkspaceSelectedHostId())
      : undefined;
  const hostConn = hostOption?.connection;
  const filteredSaved =
    source === "remoteDocker"
      ? hostConn
        ? saved.filter(
            conn =>
              conn.host === hostConn.host &&
              conn.port === hostConn.port &&
              conn.username === hostConn.username,
          )
        : []
      : saved;

  const out: WorkspaceSourceOption[] = filteredSaved.map(conn => ({
    id: conn.id,
    label: conn.name,
    description: conn.container?.name || "",
    target: source,
    connection: conn,
    savedConnectionId: conn.id,
    sourceKind: "saved",
  }));

  for (const container of newWorkspaceEnvContainers()) {
    if (filteredSaved.some(c => c.container?.name === container.name)) continue;
    const id = hostConn
      ? `${hostConn.id}-container-${container.name}`
      : `docker-local-${container.name}`;
    out.push({
      id,
      label: container.name,
      description: `${container.image} · ${container.state}`,
      target: source,
      connection: {
        ...(hostConn || {
          host: "localhost",
          port: 22,
          username: "docker",
          authType: { type: "PrivateKey", keyPath: "" },
        }),
        id,
        name: container.name,
        container: {
          name: container.name,
          local: !hostConn,
          access: "auto",
          dockerPath: "docker",
          shell: "/bin/sh",
          interactive: true,
        },
      },
      sourceKind: "discovered",
    });
  }
  return out;
});

async function connectSourceOptionForNewWorkspace(
  source: WorkspaceConnectionTarget,
): Promise<NonNullable<ProjectFolder["remote"]> | null> {
  const existingRemote = newWorkspaceConnectedRemote();
  if (existingRemote) return existingRemote;

  const option =
    source === "ssh"
      ? newWorkspaceHostOptions().find(o => o.id === newWorkspaceSelectedHostId())
      : newWorkspaceEnvOptions().find(o => o.id === newWorkspaceSelectedEnvId());

  if (option?.connection && (option.connection.username !== "" || option.connection.wsl || option.connection.container?.local)) {
    try {
      const res = await invokeRawCommand<SSHConnectionResult>("ssh_connect", {
        config: savedConnectionConfig(option.connection),
      });
      if (res?.success) {
        const cid = res.connectionId || option.connection.id;
        activeConnectionId.set(cid);
        activeConnectionConfig.set(savedConnectionConfig(option.connection));
        connectionStatuses.update(prev => ({ ...prev, [cid]: "connected" }));
        if (res.serverInfo) {
          serverInfos.update(prev => ({ ...prev, [cid]: res.serverInfo! }));
        }
        const remote = {
          connectionId: cid,
          connectionName: option.connection.name,
          sshHost: option.connection.host,
        };
        newWorkspaceConnectedRemote.set(remote);
        return remote;
      }
      throw new Error(res?.error || "SSH connection failed");
    } catch (error) {
      if (
        option.connection.wsl ||
        option.connection.container?.local ||
        !canRepairSshCredentials(option.connection.authType, error)
      ) {
        throw error;
      }
    }
  }

  return new Promise<NonNullable<ProjectFolder["remote"]> | null>(resolve => {
    const hostOpt = newWorkspaceHostOptions().find(o => o.id === newWorkspaceSelectedHostId());
    void openSshConnectionModal(option?.connection?.id, {
      targetType: source,
      fixedSource: true,
      browseAfterConnect: false,
      confirmLabel: "Connect",
      sshConfigEntry: option?.sshConfigEntry,
      containerHost: source === "remoteDocker" ? hostOpt?.connection : undefined,
      onConnected: (config, connectionId) => {
        const remote = {
          connectionId,
          connectionName: config.name,
          sshHost: config.host,
        };
        newWorkspaceConnectedRemote.set(remote);
        void loadSavedConnections();
        resolve(remote);
      },
    });
  });
}

export function addLocalFolderToNewWorkspace(rawPath?: string): void {
  const path = (rawPath ?? newWorkspaceLocalPathInput()).trim();
  if (!path) return;
  const folder: ProjectFolder = { path };
  newWorkspaceFolders.update(current =>
    current.some(item => projectFolderKey(item) === projectFolderKey(folder))
      ? current
      : [...current, folder],
  );
  if (rawPath === undefined) {
    newWorkspaceLocalPathInput.set("");
  }
  newWorkspaceError.set("");
}

export function removeNewWorkspaceFolder(folder: ProjectFolder): void {
  const targetKey = projectFolderKey(folder);
  newWorkspaceFolders.update(current =>
    current.filter(item => projectFolderKey(item) !== targetKey),
  );
  newWorkspaceError.set("");
}

export async function browseFolderForNewWorkspace(): Promise<void> {
  const source = newWorkspaceSource();
  newWorkspaceError.set("");
  if (source === "host") {
    addLocalFolderToNewWorkspace();
    return;
  }

  newWorkspaceBusy.set(true);
  try {
    const existingRemote = newWorkspaceFolders()[0]?.remote;
    const remote = existingRemote ?? (await connectSourceOptionForNewWorkspace(source));
    if (!remote) return;

    const probedInfo =
      serverInfos()[remote.connectionId] ?? (await refreshSshServerInfo(remote.connectionId));
    const initialPath =
      newWorkspaceFolders().at(-1)?.path ||
      (probedInfo?.homeDir?.trim() ? normalizeRemotePath(probedInfo.homeDir) : "/tmp");

    await openRemoteFileBrowser(remote.connectionId, initialPath, {
      homePath: initialPath,
      selectDirectoriesOnly: true,
      connectionName: remote.connectionName,
      sshHost: remote.sshHost,
      onSelect: selectedPath => {
        const folder: ProjectFolder = { path: selectedPath, remote };
        newWorkspaceFolders.update(current =>
          current.some(item => projectFolderKey(item) === projectFolderKey(folder))
            ? current
            : [...current, folder],
        );
      },
    });
  } catch (error) {
    newWorkspaceError.set(errorMessage(error));
  } finally {
    newWorkspaceBusy.set(false);
  }
}

export async function createAssistantFromNewWorkspace(): Promise<boolean> {
  if (newWorkspaceBusy()) return false;
  newWorkspaceBusy.set(true);
  newWorkspaceError.set("");
  try {
    const created = await invokeCommand<WorkspaceRecord>("create_assistant_workspace", {});
    await loadWorkspaces();
    if (created?.id) {
      if (!workspaces().some(w => w.id === created.id)) {
        workspaces.update(current => [created, ...current]);
      }
      selectWorkspace(created.id);
    }
    activeScene.set("assistants");
    newWorkspaceModalOpen.set(false);
    return true;
  } catch (error) {
    newWorkspaceError.set(errorMessage(error));
    return false;
  } finally {
    newWorkspaceBusy.set(false);
  }
}

export async function confirmNewWorkspace(): Promise<boolean> {
  if (newWorkspaceBusy()) return false;
  const source = newWorkspaceSource();
  const folders = newWorkspaceFolders();
  const name = newWorkspaceName().trim();

  if (folders.length !== 1 && !name) {
    newWorkspaceError.set("Workspace name is required.");
    return false;
  }
  if (folders.length === 0 && (/[\\/]/.test(name) || name === "." || name === "..")) {
    newWorkspaceError.set("Workspace name must be a single folder name.");
    return false;
  }

  newWorkspaceBusy.set(true);
  newWorkspaceError.set("");
  try {
    const primary = folders[0];
    if (primary?.remote) {
      const opened = await openRemoteWorkspace(primary.remote.connectionId, primary.path, {
        connectionName: primary.remote.connectionName,
        sshHost: primary.remote.sshHost,
      });
      if (!opened) return false;
      newWorkspaceModalOpen.set(false);
      return true;
    }

    if (primary) {
      await openPathWorkspace(primary.path);
      newWorkspaceModalOpen.set(false);
      return true;
    }

    if (source !== "host") {
      const remote = await connectSourceOptionForNewWorkspace(source);
      if (!remote) return false;
      const info =
        serverInfos()[remote.connectionId] ?? (await refreshSshServerInfo(remote.connectionId));
      const home = info?.homeDir?.trim();
      if (!home || !home.startsWith("/")) {
        throw new Error("The remote host did not provide an absolute home directory.");
      }
      const projectPath = joinRemotePath(
        joinRemotePath(normalizeRemotePath(home), DEFAULT_PROJECT_SUBDIRECTORY),
        name,
      );
      await invokeRawCommand<void>("remote_create_dir", {
        connectionId: remote.connectionId,
        path: projectPath,
        recursive: true,
      });
      const opened = await openRemoteWorkspace(remote.connectionId, projectPath, {
        connectionName: remote.connectionName,
        sshHost: remote.sshHost,
      });
      if (!opened) return false;
      newWorkspaceModalOpen.set(false);
      return true;
    }

    // Local host empty workspace creation
    const pendingInput = newWorkspaceLocalPathInput().trim();
    if (pendingInput) {
      await openPathWorkspace(pendingInput);
      newWorkspaceModalOpen.set(false);
      return true;
    }

    const sysInfo = await invokeCommand<{ home_dir?: string; homeDir?: string }>(
      "get_system_info",
      {},
    ).catch(() => ({} as { home_dir?: string; homeDir?: string }));
    const home = (sysInfo?.homeDir ?? sysInfo?.home_dir ?? "").replace(/\\/g, "/").trim();
    if (!home) {
      throw new Error("Enter a workspace folder path or provide a host home directory.");
    }
    const projectPath = `${home.replace(/\/+$/, "")}/${DEFAULT_PROJECT_SUBDIRECTORY}/${name}`;
    await invokeCommand<unknown>("create_directory", { path: projectPath });
    await openPathWorkspace(projectPath);
    newWorkspaceModalOpen.set(false);
    return true;
  } catch (error) {
    newWorkspaceError.set(errorMessage(error));
    return false;
  } finally {
    newWorkspaceBusy.set(false);
  }
}

// ============================================================================
// Public Modal Trigger API (used by App.tsx & Scenes)
// ============================================================================

export async function openNewWorkspaceModal(options: OpenNewWorkspaceOptions = {}): Promise<void> {
  newWorkspaceStep.set(options.step ?? "choice");
  newWorkspaceShowAssistantChoice.set(options.showAssistantChoice ?? true);
  newWorkspaceSource.set("host");
  newWorkspaceName.set("");
  newWorkspaceFolders.set([]);
  newWorkspaceLocalPathInput.set("");
  newWorkspaceSelectedHostId.set(null);
  newWorkspaceSelectedEnvId.set(null);
  newWorkspaceConnectedRemote.set(null);
  newWorkspaceError.set("");
  newWorkspaceEnvContainers.set([]);
  newWorkspaceModalOpen.set(true);

  void loadSavedConnections();
  void loadSshConfigHosts();
  void loadWslDistributions();
  try {
    const recent = await getRecentWorkspaces();
    const localOnly = (Array.isArray(recent) ? recent : []).filter(
      ws =>
        (ws.workspaceKind ?? "local").toLowerCase() !== "remote" &&
        !ws.connectionId &&
        (!ws.sshHost || ws.sshHost === "localhost") &&
        ws.rootPath,
    );
    newWorkspaceRecentLocal.set(localOnly.slice(0, 5));
  } catch {
    newWorkspaceRecentLocal.set([]);
  }
}

export function closeNewWorkspaceModal(): void {
  if (newWorkspaceBusy()) return;
  newWorkspaceModalOpen.set(false);
  newWorkspaceError.set("");
}

export async function openSshConnectionModal(
  presetConnectionId?: string,
  options: OpenSshConnectionOptions = {},
): Promise<void> {
  sshConnectedCallback = options.onConnected ?? null;
  pendingConnectBrowseOverride =
    options.browseAfterConnect !== undefined ? options.browseAfterConnect : null;

  sshFixedSource.set(Boolean(options.fixedSource));
  sshEditOnly.set(Boolean(options.edit));
  sshBrowseAfterConnect.set(options.browseAfterConnect ?? true);
  sshConfirmLabel.set(options.confirmLabel ?? "");
  sshEditingProfile.set(null);
  sshSelectedConnectionId.set(presetConnectionId ?? null);
  sshContainerHost.set(options.containerHost ?? null);
  sshSavedSearch.set("");
  sshConfigSearch.set("");
  sshShowAdvanced.set(false);
  sshShowPassword.set(false);
  sshShowPassphrase.set(false);
  sshError.set("");
  sshNotice.set("");
  connectionTestReport.set(null);
  dockerContainers.set([]);
  sshForm.set(createEmptySshForm());

  const initialTarget = options.targetType ?? "ssh";
  sshTargetType.set(initialTarget);
  sshConnectionModalOpen.set(true);

  const list = await loadSavedConnections();
  void loadSshConfigHosts();
  if (initialTarget === "wsl") {
    void loadWslDistributions();
  } else if (initialTarget === "localDocker") {
    void loadLocalDockerContainers();
  }

  if (options.sshConfigEntry) {
    sshConnectionView.set("new");
    fillFormFromSshConfig(options.sshConfigEntry);
    return;
  }

  if (options.containerHost && initialTarget === "remoteDocker") {
    sshConnectionView.set("new");
    sshForm.update(prev => ({
      ...prev,
      host: options.containerHost!.host,
      port: String(options.containerHost!.port),
      username: options.containerHost!.username,
    }));
    void discoverDockerContainers({
      ...savedConnectionConfig(options.containerHost),
      container: {
        name: "discovery",
        local: false,
        access: "auto",
        dockerPath: "docker",
        shell: "/bin/sh",
        interactive: true,
      },
    });
    return;
  }

  if (presetConnectionId) {
    const match = list.find(conn => conn.id === presetConnectionId);
    if (match) {
      populateFormFromSavedConnection(match);
      sshConnectionView.set(options.edit ? "new" : "saved");
      if (match.authType.type === "Password") {
        void checkHasStoredPassword(match.id);
      }
      return;
    }
  }

  const matchingSaved = list.filter(conn =>
    sameWorkspaceSource(savedConnectionTarget(conn), initialTarget),
  );
  sshConnectionView.set(matchingSaved.length > 0 && !options.edit ? "saved" : "new");
}

export function closeSshConnectionModal(): void {
  if (sshConnecting()) return;
  sshConnectionModalOpen.set(false);
  sshConnectedCallback = null;
  pendingConnectBrowseOverride = null;
  sshError.set("");
  sshNotice.set("");
}

export async function openRemoteFileBrowser(
  connectionId: string,
  initialPath?: string,
  options: OpenRemoteFileBrowserOptions = {},
): Promise<void> {
  browserSelectCallback = options.onSelect ?? null;
  browserConnectionId.set(connectionId);
  const saved = savedConnections().find(conn => conn.id === connectionId);
  browserConnectionName.set(
    options.connectionName || saved?.name || activeConnectionConfig()?.name || connectionId,
  );
  browserSshHost.set(
    options.sshHost || saved?.host || activeConnectionConfig()?.host || "",
  );
  browserSelectDirectoriesOnly.set(options.selectDirectoriesOnly ?? true);
  browserFilter.set("");
  browserNewDirOpen.set(false);
  browserNewDirName.set("");
  browserRenamingEntry.set(null);
  browserRenameValue.set("");
  browserConfirmDeleteEntry.set(null);
  browserPendingRebind.set(null);
  browserEntries.set([]);
  browserError.set("");

  let startPath = initialPath ? normalizeRemotePath(initialPath) : "";
  if (!startPath) {
    const info = serverInfos()[connectionId] ?? (await refreshSshServerInfo(connectionId));
    startPath = info?.homeDir?.trim() ? normalizeRemotePath(info.homeDir) : "/tmp";
  }
  const home = options.homePath ? normalizeRemotePath(options.homePath) : startPath;
  browserHomePath.set(home);
  browserCurrentPath.set(startPath);
  browserPathInput.set(startPath);
  remoteFileBrowserOpen.set(true);

  await loadRemoteDirectory(startPath);
}

export function closeRemoteFileBrowser(): void {
  browserSelectCallback = null;
  browserPendingRebind.set(null);
  remoteFileBrowserOpen.set(false);
  browserError.set("");
}

export async function openPortForwardModal(
  connectionId: string,
  connectionName?: string,
): Promise<void> {
  stopPortForwardPolling();
  const saved = savedConnections().find(conn => conn.id === connectionId);
  portForwardConnectionId.set(connectionId);
  portForwardConnectionName.set(
    connectionName || saved?.name || activeConnectionConfig()?.name || connectionId,
  );
  portForwardError.set("");
  portForwardRemoteHost.set("127.0.0.1");
  portForwardRemotePort.set("");
  portForwardLocalPort.set("");
  portForwardDescription.set("");
  portForwardExposeOnLan.set(false);
  portForwards.set([]);
  listeningPorts.set([]);
  portForwardModalOpen.set(true);

  await Promise.all([
    loadPortForwards(connectionId),
    detectRemoteListeningPorts(connectionId),
  ]);

  portForwardPollTimer = setInterval(() => {
    if (!portForwardModalOpen()) {
      stopPortForwardPolling();
      return;
    }
    const cid = portForwardConnectionId();
    if (cid) void loadPortForwards(cid);
  }, 2000);
}

export function closePortForwardModal(): void {
  stopPortForwardPolling();
  portForwardModalOpen.set(false);
  portForwardError.set("");
}

// ============================================================================
// Remote workspace liveness (backend-owned link supervision)
// ============================================================================
//
// The backend owns the link policy (`remote_ssh::link_supervisor`): activating a
// remote workspace asks it to `remote_workspace_ensure_connected`, which probes
// the transport, reconnects from the saved profile (vault password, key or
// agent) within its budget, re-activates the remote workspace and keeps a
// heartbeat on it. Progress arrives on `remote://link-state`; this surface only
// renders it. A link that needs credentials the vault does not hold comes back
// `failed { reason: auth_required }` and opens the credential prompt here, the
// one thing a backend cannot do on its own. A host without the command gets an
// explicit "update the host" state, never a client-side reconnect loop.

export type RemoteLinkState =
  | "checking"
  | "connected"
  | "reconnecting"
  | "offline"
  | "auth-required"
  | "host-outdated";

/** One `remote://link-state` payload (and the `link` of an ensure answer). */
export interface HostRemoteLink {
  connectionId: string;
  state: "checking" | "connected" | "reconnecting" | "failed" | "disconnected";
  attempt?: number;
  nextRetryMs?: number;
  reason?: "auth_required" | "profile_missing" | "unreachable" | "workspace_unavailable";
  detail?: string;
  revision?: number;
}

interface EnsureConnectedAnswer {
  link?: HostRemoteLink;
  activated?: boolean;
}

/** Liveness per connection id; the scenes read it through `remoteLinkStateOf`. */
export const remoteLinkStates = signal<Record<string, RemoteLinkState>>({});
/** Why a connection is offline, as the host said it. */
export const remoteLinkErrors = signal<Record<string, string>>({});
/** The reconnect attempt the host is on, per connection, while `reconnecting`. */
export const remoteLinkAttempts = signal<Record<string, number>>({});

interface ReconnectTarget {
  workspaceId: string;
  connectionId: string;
  remotePath: string;
}

const ensureInFlight = new Map<string, Promise<boolean>>();
const linkRevisions = new Map<string, number>();
let pendingAuthReconnect: ReconnectTarget | null = null;
let linkEventsBound = false;

function setLinkState(connectionId: string, state: RemoteLinkState, error?: string, attempt?: number): void {
  remoteLinkStates.update(prev => (prev[connectionId] === state ? prev : { ...prev, [connectionId]: state }));
  remoteLinkErrors.update(prev => {
    if (error) return prev[connectionId] === error ? prev : { ...prev, [connectionId]: error };
    if (!(connectionId in prev)) return prev;
    const { [connectionId]: _dropped, ...rest } = prev;
    return rest;
  });
  remoteLinkAttempts.update(prev => {
    if (state === "reconnecting" && attempt) return prev[connectionId] === attempt ? prev : { ...prev, [connectionId]: attempt };
    if (!(connectionId in prev)) return prev;
    const { [connectionId]: _dropped, ...rest } = prev;
    return rest;
  });
  if (state === "connected" || state === "offline") {
    connectionStatuses.update(prev => ({
      ...prev,
      [connectionId]: state === "connected" ? "connected" : "error",
    }));
  }
}

/** The link state of a remote workspace, or null for a local one (or one not checked yet). */
export function remoteLinkStateOf(ws: WorkspaceRecord | null): RemoteLinkState | null {
  if (!ws || ws.workspaceKind !== "remote" || !ws.connectionId) return null;
  return remoteLinkStates()[ws.connectionId] ?? null;
}

/** The reconnect attempt the host reports for a remote workspace, or 0. */
export function remoteLinkAttemptOf(ws: WorkspaceRecord | null): number {
  if (!ws?.connectionId) return 0;
  return remoteLinkAttempts()[ws.connectionId] ?? 0;
}

function findSavedConnection(connectionId: string): SavedConnection | undefined {
  const canonical = canonicalSshConnectionId(connectionId);
  return savedConnections().find(
    conn => conn.id === connectionId || canonicalSshConnectionId(conn.id) === canonical,
  );
}

function targetFor(ws: WorkspaceRecord, connectionId: string): ReconnectTarget {
  return { workspaceId: ws.id, connectionId, remotePath: normalizeRemotePath(ws.rootPath) };
}

/** Renders one host link state; stale revisions (an older event after a newer answer) are ignored. */
function applyHostLink(link: HostRemoteLink | undefined, target: ReconnectTarget | null = null): void {
  if (!link?.connectionId) return;
  const id = link.connectionId;
  if (typeof link.revision === "number") {
    const seen = linkRevisions.get(id) ?? 0;
    if (link.revision < seen) return;
    linkRevisions.set(id, link.revision);
  }
  switch (link.state) {
    case "checking":
      if (remoteLinkStates()[id] !== "connected") setLinkState(id, "checking");
      return;
    case "connected":
      setLinkState(id, "connected");
      return;
    case "reconnecting":
      setLinkState(id, "reconnecting", undefined, link.attempt);
      return;
    case "disconnected":
      setLinkState(id, "offline", "The connection was closed.");
      // A deliberate disconnect is not an error on the host's row.
      connectionStatuses.update(prev => ({ ...prev, [id]: "disconnected" }));
      return;
    case "failed":
      if (link.reason === "auth_required") {
        setLinkState(id, "auth-required", link.detail);
        const reconnect =
          target ??
          (activeWorkspace()?.connectionId === id ? targetFor(activeWorkspace()!, id) : null);
        if (reconnect) void promptForLinkCredentials(reconnect);
        return;
      }
      setLinkState(id, "offline", link.detail);
      return;
  }
}

async function promptForLinkCredentials(target: ReconnectTarget): Promise<void> {
  if (pendingAuthReconnect?.connectionId === target.connectionId && authPromptOpen()) return;
  if (savedConnections().length === 0) await loadSavedConnections();
  const conn = findSavedConnection(target.connectionId);
  if (!conn) return;
  pendingAuthReconnect = target;
  openAuthPrompt(conn);
}

function bindLinkEvents(): void {
  if (linkEventsBound) return;
  linkEventsBound = true;
  listenEvent<HostRemoteLink>("remote://link-state", payload => {
    applyHostLink(payload);
  });
  // Missed events (a slow client, a restarted backend): read the host's current links again.
  listenEvent("backend://events-dropped", () => void rehydrateLinkStates());
}

async function rehydrateLinkStates(): Promise<void> {
  let links: HostRemoteLink[];
  try {
    links = await invokeCommand<HostRemoteLink[]>("remote_workspace_link_states", {});
  } catch {
    // The next ensure (activation or Reconnect) answers with the state anyway.
    return;
  }
  if (!Array.isArray(links)) return;
  // A restarted backend numbers its states from 1 again.
  linkRevisions.clear();
  for (const link of links) applyHostLink(link);
}

async function requestEnsureConnected(
  target: ReconnectTarget,
  activate: boolean,
): Promise<boolean> {
  bindLinkEvents();
  if (remoteLinkStates()[target.connectionId] !== "connected") setLinkState(target.connectionId, "checking");
  let answer: EnsureConnectedAnswer;
  try {
    answer = await invokeCommand<EnsureConnectedAnswer>("remote_workspace_ensure_connected", {
      connectionId: target.connectionId,
      remotePath: target.remotePath,
      activate,
    });
  } catch (error) {
    if (isCommandUnavailable(error, "remote_workspace_ensure_connected")) {
      // An older host: it cannot restore links, and this surface no longer does it either.
      setLinkState(target.connectionId, "host-outdated");
      return true;
    }
    setLinkState(target.connectionId, "offline", errorMessage(error));
    return false;
  }
  applyHostLink(answer?.link, target);
  return answer?.link?.state === "connected" && remoteLinkStates()[target.connectionId] === "connected";
}

/**
 * Makes sure the transport behind a remote workspace is up. Local workspaces
 * pass straight through. Concurrent calls for the same connection share one request.
 */
export function ensureRemoteConnected(
  ws: WorkspaceRecord | null,
  options: { activate?: boolean } = {},
): Promise<boolean> {
  if (!ws || ws.workspaceKind !== "remote" || !ws.connectionId) return Promise.resolve(true);
  const connectionId = ws.connectionId;
  const running = ensureInFlight.get(connectionId);
  if (running) return running;
  const flight = requestEnsureConnected(targetFor(ws, connectionId), options.activate !== false).finally(() => {
    ensureInFlight.delete(connectionId);
  });
  ensureInFlight.set(connectionId, flight);
  return flight;
}

/** After the credential prompt connected: the host activates the workspace it was restoring. */
async function activateReconnectedWorkspace(target: ReconnectTarget, connectionId: string): Promise<void> {
  await requestEnsureConnected({ ...target, connectionId }, true);
  if (connectionId !== target.connectionId && remoteLinkStates()[connectionId] === "connected") {
    setLinkState(target.connectionId, "connected");
  }
}

/** The workspace's Reconnect action: ask the host again, or the user when it needs credentials. */
export async function retryRemoteWorkspace(ws: WorkspaceRecord | null = activeWorkspace()): Promise<boolean> {
  if (!ws?.connectionId) return true;
  if (remoteLinkStates()[ws.connectionId] === "auth-required") {
    await promptForLinkCredentials(targetFor(ws, ws.connectionId));
    return false;
  }
  return ensureRemoteConnected(ws);
}

// Activation is the moment the desktop checks a remote workspace's link.
onWorkspaceChanged(() => {
  const ws = activeWorkspace();
  if (!ws) return;
  void ensureRemoteConnected(ws);
});

