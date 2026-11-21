import { expect, open, test } from "nsh/test";
import { showDevices, openToolScene, type BackendOptions, createBackend, createDeviceBackend, projectWorkspaceNavigator } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

interface RecordedInvoke {
  action: string;
  raw: boolean;
  payload: Record<string, unknown>;
}

interface MockSshBackendOptions extends BackendOptions {
  wslSupported?: boolean;
  wslDistributions?: string[];
  configHosts?: Array<{
    host: string;
    hostname?: string;
    user?: string;
    port?: number;
    identityFile?: string;
    proxyJump?: string;
  }>;
  conflictOwners?: Record<string, string>;
  failAuthOnFirstConnect?: boolean;
  failMissingRemoteOpenCommand?: boolean;
  movedPortAllocation?: Record<number, number>;
  /** A host that predates `remote_workspace_ensure_connected` (no backend link supervision). */
  noLinkSupervision?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function posixBasename(path: string): string {
  const cleaned = path.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) || "/" : cleaned || "workspace";
}

function createSshBackend(options: MockSshBackendOptions = {}) {
  const base = createBackend(options);
  const originalInvoke = base.handlers["openbitfun.invoke"] as (data: unknown) => Promise<unknown>;

  const recordedCalls: RecordedInvoke[] = [];
  const localOpenCalls: Array<Record<string, unknown>> = [];

  const savedConnections: Array<Record<string, unknown>> = [
    {
      id: "conn-prod-1",
      name: "Prod App Box",
      host: "prod.example.com",
      port: 22,
      username: "deploy",
      authType: { type: "PrivateKey", keyPath: "~/.ssh/id_ed25519" },
      defaultWorkspace: "/home/deploy/apps",
      hasStoredPassword: false,
    },
    {
      id: "conn-staging-2",
      name: "Staging Box",
      host: "staging.example.com",
      port: 2222,
      username: "ubuntu",
      authType: { type: "Password" },
      hasStoredPassword: true,
    },
  ];

  const connectedIds = new Set<string>(["conn-prod-1"]);
  const configHosts = options.configHosts ?? [
    {
      host: "bastion-dev",
      hostname: "10.0.4.20",
      user: "devuser",
      port: 2200,
      identityFile: "~/.ssh/dev_ed25519",
      proxyJump: "jump.internal",
    },
  ];

  const remoteFs: Record<
    string,
    Array<{
      name: string;
      path: string;
      isDir: boolean;
      isSymlink?: boolean;
      size?: number;
      modifiedAt?: number;
    }>
  > = {
    "/home/deploy": [
      { name: "apps", path: "/home/deploy/apps", isDir: true, size: 0, modifiedAt: 1730000000 },
      { name: "README.md", path: "/home/deploy/README.md", isDir: false, size: 1280, modifiedAt: 1730000000 },
    ],
    "/home/deploy/apps": [
      { name: "openbitfun-api", path: "/home/deploy/apps/openbitfun-api", isDir: true, size: 0, modifiedAt: 1730000000 },
      { name: "notes.txt", path: "/home/deploy/apps/notes.txt", isDir: false, size: 420, modifiedAt: 1730000000 },
    ],
    "/home/deploy/apps/openbitfun-api": [
      { name: "src", path: "/home/deploy/apps/openbitfun-api/src", isDir: true, size: 0, modifiedAt: 1730000000 },
    ],
    "/": [
      { name: "home", path: "/home", isDir: true, size: 0, modifiedAt: 1730000000 },
      { name: "workspace", path: "/workspace", isDir: true, size: 0, modifiedAt: 1730000000 },
    ],
    "/workspace": [
      { name: "service", path: "/workspace/service", isDir: true, size: 0, modifiedAt: 1730000000 },
    ],
  };

  const portForwards: Array<Record<string, unknown>> = [
    {
      id: "pf-initial-1",
      connectionId: "conn-prod-1",
      localHost: "127.0.0.1",
      localPort: 8080,
      remoteHost: "127.0.0.1",
      remotePort: 8080,
      label: "API Gateway",
      description: "API Gateway",
      activeConnections: 1,
      exposeOnLan: false,
    },
  ];

  const listeningPorts = [
    { port: 3000, bindAddress: "0.0.0.0", process: "vite" },
    { port: 5432, bindAddress: "127.0.0.1", process: "postgres" },
  ];

  const remoteWorkspaces: Array<Record<string, unknown>> = [];
  const createdWorkspaces: Array<Record<string, unknown>> = [];
  const localDirs = new Set<string>(["/tmp/workspace-1", "/tmp/existing-project"]);
  const conflictOwners: Record<string, string> = { ...(options.conflictOwners ?? {}) };
  let firstConnectRejected = Boolean(options.failAuthOnFirstConnect);
  let linkRevision = 0;
  const linkRestores: string[] = [];
  const linkActivations: Array<{ connectionId: string; remotePath: string }> = [];
  let activeWorkspaceIdOverride: string | null = null;
  let seq = 1;

  base.handlers["openbitfun.invoke"] = async (data: unknown) => {
    const args = asRecord(data);
    const action = typeof args.action === "string" ? args.action : "";
    const hasRaw = Object.prototype.hasOwnProperty.call(args, "raw");
    const payload = asRecord(hasRaw ? args.raw : args.request);

    recordedCalls.push({ action, raw: hasRaw, payload });

    const ok = (value: unknown) => ({ ok: true, value, transport: "dev" });

    switch (action) {
      case "ssh_list_saved_connections":
        return ok([...savedConnections]);

      case "ssh_save_connection": {
        const cfg = asRecord(payload.config);
        const id = String(cfg.id || `conn-saved-${seq++}`);
        const entry = {
          id,
          name: String(cfg.name || `${cfg.username}@${cfg.host}`),
          host: String(cfg.host || "localhost"),
          port: Number(cfg.port || 22),
          username: String(cfg.username || "root"),
          authType: cfg.auth ?? cfg.authType ?? { type: "PrivateKey", keyPath: "~/.ssh/id_rsa" },
          defaultWorkspace: cfg.defaultWorkspace,
          wsl: cfg.wsl,
          container: cfg.container,
          proxyJump: cfg.proxyJump,
          hasStoredPassword: Boolean(asRecord(cfg.auth).password),
        };
        const existingIdx = savedConnections.findIndex(c => c.id === id);
        if (existingIdx >= 0) savedConnections[existingIdx] = entry;
        else savedConnections.unshift(entry);
        return ok(entry);
      }

      case "ssh_delete_connection": {
        const connectionId = String(payload.connectionId || "");
        const idx = savedConnections.findIndex(c => c.id === connectionId);
        if (idx >= 0) savedConnections.splice(idx, 1);
        connectedIds.delete(connectionId);
        return ok(null);
      }

      case "ssh_has_stored_password": {
        const connectionId = String(payload.connectionId || "");
        const found = savedConnections.find(c => c.id === connectionId);
        return ok(Boolean(found?.hasStoredPassword));
      }

      case "ssh_list_config_hosts":
        return ok(configHosts);

      case "ssh_get_config": {
        const host = String(payload.host || "");
        const found = configHosts.find(h => h.host === host);
        return ok(found ? { found: true, config: found } : { found: false });
      }

      case "ssh_list_wsl_distributions":
        return ok({
          supported: options.wslSupported ?? true,
          distributions: options.wslDistributions ?? ["Ubuntu-22.04", "Debian"],
        });

      case "ssh_list_docker_containers":
        return ok([
          {
            name: "api-dev",
            id: "c1234567890",
            image: "node:22-alpine",
            status: "Up 2 hours",
            state: "running",
          },
          {
            name: "worker-queue",
            id: "c9876543210",
            image: "rust:1.83",
            status: "Up 1 hour",
            state: "running",
          },
        ]);

      case "ssh_test_connection": {
        const cfg = asRecord(payload.config);
        return ok({
          success: true,
          latencyMs: 38,
          stages: [
            { id: "target", label: `${cfg.host || "host"}:${cfg.port || 22}`, success: true, latencyMs: 24 },
            ...(cfg.container
              ? [{ id: "container", label: String(asRecord(cfg.container).name || "container"), success: true }]
              : []),
            ...(cfg.wsl
              ? [{ id: "wsl", label: String(asRecord(cfg.wsl).distribution || "wsl"), success: true }]
              : []),
          ],
          serverInfo: {
            osType: "linux",
            hostname: String(cfg.host || "remote-box"),
            homeDir: cfg.container ? "/workspace" : "/home/deploy",
            arch: "x86_64",
          },
          resolvedContainerAccess: cfg.container ? "docker-exec" : undefined,
        });
      }

      case "ssh_connect": {
        const cfg = asRecord(payload.config);
        if (firstConnectRejected) {
          firstConnectRejected = false;
          return ok({
            success: false,
            error: "Authentication failed for deploy@prod.example.com",
          });
        }
        const cid = String(cfg.id || `conn-live-${seq++}`);
        connectedIds.add(cid);
        const existingIdx = savedConnections.findIndex(c => c.id === cid);
        const record = {
          id: cid,
          name: String(cfg.name || `${cfg.username}@${cfg.host}`),
          host: String(cfg.host || "localhost"),
          port: Number(cfg.port || 22),
          username: String(cfg.username || "deploy"),
          authType: cfg.auth ?? { type: "Password" },
          wsl: cfg.wsl,
          container: cfg.container,
          hasStoredPassword: Boolean(asRecord(cfg.auth).password),
        };
        if (existingIdx >= 0) savedConnections[existingIdx] = { ...savedConnections[existingIdx], ...record };
        else savedConnections.unshift(record);
        return ok({
          success: true,
          connectionId: cid,
          serverInfo: {
            osType: "linux",
            hostname: String(cfg.host || "remote-box"),
            homeDir: cfg.container ? "/workspace" : "/home/deploy",
            arch: "x86_64",
          },
        });
      }

      case "ssh_disconnect": {
        const cid = String(payload.connectionId || "");
        connectedIds.delete(cid);
        return ok(null);
      }

      case "ssh_is_connected":
        return ok(connectedIds.has(String(payload.connectionId || "")));

      case "ssh_get_server_info": {
        const cid = String(payload.connectionId || "");
        const conn = savedConnections.find(c => c.id === cid);
        return ok({
          osType: "linux",
          hostname: String(conn?.host || "remote-box"),
          homeDir: conn?.container ? "/workspace" : "/home/deploy",
          arch: "x86_64",
        });
      }

      case "remote_read_dir": {
        const dirPath = String(payload.path || "/home/deploy").replace(/\/+$/, "") || "/";
        return ok(remoteFs[dirPath] ?? []);
      }

      case "remote_exists": {
        const targetPath = String(payload.path || "");
        if (remoteFs[targetPath]) return ok(true);
        const parentIdx = targetPath.lastIndexOf("/");
        const parentDir = parentIdx > 0 ? targetPath.slice(0, parentIdx) : "/";
        const entries = remoteFs[parentDir] ?? [];
        return ok(entries.some(e => e.path === targetPath));
      }

      case "remote_create_dir": {
        const dirPath = String(payload.path || "");
        const parentIdx = dirPath.lastIndexOf("/");
        const parentDir = parentIdx > 0 ? dirPath.slice(0, parentIdx) : "/";
        const name = posixBasename(dirPath);
        remoteFs[parentDir] = [
          ...(remoteFs[parentDir] ?? []).filter(e => e.path !== dirPath),
          { name, path: dirPath, isDir: true, size: 0, modifiedAt: 1730000100 },
        ];
        if (!remoteFs[dirPath]) remoteFs[dirPath] = [];
        return ok(null);
      }

      case "remote_rename": {
        const oldPath = String(payload.oldPath || "");
        const newPath = String(payload.newPath || "");
        const parentIdx = oldPath.lastIndexOf("/");
        const parentDir = parentIdx > 0 ? oldPath.slice(0, parentIdx) : "/";
        const entries = remoteFs[parentDir] ?? [];
        const newName = posixBasename(newPath);
        remoteFs[parentDir] = entries.map(e =>
          e.path === oldPath ? { ...e, name: newName, path: newPath } : e,
        );
        if (remoteFs[oldPath]) {
          remoteFs[newPath] = remoteFs[oldPath];
          delete remoteFs[oldPath];
        }
        return ok(null);
      }

      case "remote_remove": {
        const targetPath = String(payload.path || "");
        const parentIdx = targetPath.lastIndexOf("/");
        const parentDir = parentIdx > 0 ? targetPath.slice(0, parentIdx) : "/";
        remoteFs[parentDir] = (remoteFs[parentDir] ?? []).filter(e => e.path !== targetPath);
        delete remoteFs[targetPath];
        return ok(null);
      }

      case "open_remote_workspace": {
        const remotePath = String(payload.remotePath || "");
        const connectionId = String(payload.connectionId || "");
        const connectionName = String(payload.connectionName || "Remote");
        const sshHost = typeof payload.sshHost === "string" ? payload.sshHost : "remote-box";
        const owner = conflictOwners[remotePath];
        if (owner && owner !== connectionId && payload.rebindConnection !== true) {
          throw new Error(
            `remote_workspace_connection_conflict: "${remotePath}" is bound to SSH connection ${owner}; close or rebind.`,
          );
        }
        delete conflictOwners[remotePath];
        const wsRecord = {
          id: `ws-remote-${seq++}`,
          name: posixBasename(remotePath),
          rootPath: remotePath,
          workspaceKind: "remote",
          connectionId,
          connectionName,
          sshHost,
        };
        const idx = remoteWorkspaces.findIndex(w => w.rootPath === remotePath);
        if (idx >= 0) remoteWorkspaces[idx] = wsRecord;
        else remoteWorkspaces.unshift(wsRecord);
        activeWorkspaceIdOverride = String(wsRecord.id);
        return ok(wsRecord);
      }

      // The backend's link supervisor, reduced: probe, restore from the saved
      // profile (vault password, key or agent), or say why it cannot.
      case "remote_workspace_ensure_connected": {
        if (options.noLinkSupervision) {
          throw new Error("the simulated backend has no answer for remote_workspace_ensure_connected");
        }
        const cid = String(payload.connectionId || "");
        linkRevision += 1;
        const link = (state: string, extra: Record<string, unknown> = {}) => ({
          connectionId: cid,
          state,
          revision: linkRevision,
          ...extra,
        });
        if (!connectedIds.has(cid)) {
          const saved = savedConnections.find(c => c.id === cid);
          if (!saved) {
            return ok({
              link: link("failed", {
                reason: "profile_missing",
                detail: "The saved connection for this workspace is missing on this host.",
              }),
              activated: false,
            });
          }
          const auth = asRecord(saved.authType);
          if (auth.type === "KeyboardInteractive" || (auth.type === "Password" && !saved.hasStoredPassword)) {
            return ok({ link: link("failed", { reason: "auth_required" }), activated: false });
          }
          connectedIds.add(cid);
          linkRestores.push(cid);
        }
        const activate = payload.activate !== false && typeof payload.remotePath === "string";
        if (activate) linkActivations.push({ connectionId: cid, remotePath: String(payload.remotePath) });
        return ok({ link: link("connected"), activated: activate });
      }

      case "remote_open_workspace": {
        if (options.failMissingRemoteOpenCommand) {
          throw new Error("Unknown command: remote_open_workspace");
        }
        return ok(null);
      }

      case "remote_close_workspace": {
        return ok(null);
      }

      case "remote_remove_workspace": {
        const targetPath = String(payload.remotePath || "");
        const idx = remoteWorkspaces.findIndex(w => w.rootPath === targetPath);
        if (idx >= 0) remoteWorkspaces.splice(idx, 1);
        return ok(null);
      }

      case "open_workspace": {
        localOpenCalls.push(payload);
        const wsPath = String(payload.path || "");
        const wsRecord = {
          id: `ws-local-${seq++}`,
          name: posixBasename(wsPath),
          rootPath: wsPath,
          workspaceKind: "normal",
        };
        createdWorkspaces.unshift(wsRecord);
        activeWorkspaceIdOverride = String(wsRecord.id);
        return ok(wsRecord);
      }

      case "create_directory": {
        const targetPath = String(payload.path || "");
        localDirs.add(targetPath);
        return ok(null);
      }

      case "create_assistant_workspace": {
        const wsRecord = {
          id: `ws-assistant-${seq++}`,
          name: "Personal Assistant",
          rootPath: `/srv/mock-openbitfun/assistants/assistant-${seq}`,
          workspaceKind: "assistant",
        };
        createdWorkspaces.unshift(wsRecord);
        activeWorkspaceIdOverride = String(wsRecord.id);
        return ok(wsRecord);
      }

      case "close_workspace": {
        const workspaceId = String(payload.workspaceId || "");
        for (const list of [remoteWorkspaces, createdWorkspaces]) {
          const idx = list.findIndex(w => w.id === workspaceId);
          if (idx >= 0) list.splice(idx, 1);
        }
        if (activeWorkspaceIdOverride === workspaceId) activeWorkspaceIdOverride = null;
        return ok(null);
      }

      case "get_opened_workspaces": {
        const baseRes = asRecord(await originalInvoke(data));
        const baseList = Array.isArray(baseRes.value) ? baseRes.value : [];
        return ok([...remoteWorkspaces, ...createdWorkspaces, ...baseList]);
      }

      // view models (wave 4): the host's navigator over this fixture's lists.
      case "get_workspace_navigator": {
        const read = async (command: string) =>
          asRecord(await base.handlers["openbitfun.invoke"]({ action: command, request: {} })).value;
        const current = asRecord(await originalInvoke({ action: "get_current_workspace", request: {} })).value;
        return ok(
          projectWorkspaceNavigator(
            await read("get_opened_workspaces"),
            await read("get_recent_workspaces"),
            activeWorkspaceIdOverride ?? (asRecord(current).id as string | undefined) ?? null,
            typeof payload.selectedId === "string" ? payload.selectedId : null,
          ),
        );
      }

      case "get_active_workspace": {
        const all = [...remoteWorkspaces, ...createdWorkspaces];
        if (activeWorkspaceIdOverride) {
          const hit = all.find(w => w.id === activeWorkspaceIdOverride);
          if (hit) return ok(hit);
        }
        return originalInvoke(data);
      }

      case "get_recent_workspaces": {
        const baseRes = asRecord(await originalInvoke(data));
        const baseList = Array.isArray(baseRes.value) ? baseRes.value : [];
        return ok([...createdWorkspaces, ...baseList]);
      }

      case "set_active_workspace": {
        const wid = String(payload.workspaceId || "");
        activeWorkspaceIdOverride = wid || null;
        const known = [...remoteWorkspaces, ...createdWorkspaces].find(w => w.id === wid);
        if (known) return ok(known);
        return originalInvoke(data);
      }

      case "get_system_info":
        return ok({ homeDir: "/tmp/mock-home", platform: "macos" });

      case "ssh_list_port_forwards": {
        const cid = payload.connectionId ? String(payload.connectionId) : null;
        const filtered = cid ? portForwards.filter(f => f.connectionId === cid) : portForwards;
        return ok([...filtered]);
      }

      case "ssh_list_remote_listening_ports":
        return ok([...listeningPorts]);

      case "ssh_start_port_forward": {
        const remotePort = Number(payload.remotePort);
        const requestedLocal =
          typeof payload.localPort === "number" && payload.localPort > 0
            ? payload.localPort
            : undefined;
        const movedPort =
          requestedLocal !== undefined && options.movedPortAllocation?.[requestedLocal]
            ? options.movedPortAllocation[requestedLocal]
            : undefined;
        const effectiveLocal = movedPort ?? requestedLocal ?? 42000 + seq;
        const record: Record<string, unknown> = {
          id: `pf-live-${seq++}`,
          connectionId: String(payload.connectionId || ""),
          localHost: payload.exposeOnLan ? "0.0.0.0" : "127.0.0.1",
          localPort: effectiveLocal,
          remoteHost: String(payload.remoteHost || "127.0.0.1"),
          remotePort,
          label: payload.label ?? payload.description,
          description: payload.description ?? payload.label,
          activeConnections: 0,
          exposeOnLan: payload.exposeOnLan === true,
          ...(movedPort !== undefined ? { requestedLocalPort: requestedLocal } : {}),
        };
        portForwards.unshift(record);
        return ok(record);
      }

      case "ssh_stop_port_forward": {
        const forwardId = String(payload.forwardId || "");
        const idx = portForwards.findIndex(f => f.id === forwardId);
        if (idx >= 0) portForwards.splice(idx, 1);
        return ok(null);
      }

      default:
        return originalInvoke(data);
    }
  };

  return {
    base,
    recordedCalls,
    localOpenCalls,
    linkRestores,
    linkActivations,
    connectedIds,
    callsFor(action: string) {
      return recordedCalls.filter(c => c.action === action);
    },
  };
}

/** This device's page: All sessions › By device › This device (New workspace…, SSH connections). */
async function openThisDevicePage(app: Awaited<ReturnType<typeof open>>) {
  await showDevices(app);
  await app.press("device-open-local");
  await app.waitFor("device-scene");
}

async function openNewWorkspaceViaUi(app: Awaited<ReturnType<typeof open>>) {
  await openThisDevicePage(app);
  await app.press("device-new-workspace");
  await app.waitFor("new-workspace-modal");
}

async function openSshModalViaUi(app: Awaited<ReturnType<typeof open>>) {
  await openThisDevicePage(app);
  await app.press("device-ssh");
  await app.waitFor("ssh-connection-modal");
}

test("New Workspace modal creates Assistant and Local Project without mixing remote open", async () => {
  const ssh = createSshBackend();
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: ssh.base.handlers },
  });

  await app.waitFor("OpenBitFun");
  await openNewWorkspaceViaUi(app);

  // Assistant creation flow
  await app.press("new-workspace-choice-assistant");
  await app.waitUntil(() => ssh.callsFor("create_assistant_workspace").length === 1);
  expect(ssh.callsFor("create_assistant_workspace")[0]?.raw).toBe(false);
  expect(app.shows("new-workspace-modal")).toBe(false);

  // Local Project flow: explicit local path opens via open_workspace
  await openNewWorkspaceViaUi(app);
  await app.press("new-workspace-choice-project");
  await app.type("new-workspace-local-path", "/tmp/new-local-proj");
  await app.press("new-workspace-add-local");
  await app.waitFor("new-local-proj");
  await app.type("new-workspace-name", "My Local App");
  await app.press("new-workspace-confirm");

  await app.waitUntil(() => ssh.localOpenCalls.length === 1);
  expect(ssh.callsFor("open_workspace")[0]?.raw).toBe(false);
  expect(ssh.callsFor("open_workspace")[0]?.payload).toMatchObject({ path: "/tmp/new-local-proj" });

  // Local Project flow: empty folder name creates directory under ~/OpenBitFun/Projects
  await openNewWorkspaceViaUi(app);
  await app.press("new-workspace-choice-project");
  await app.type("new-workspace-name", "fresh-proj");
  await app.press("new-workspace-confirm");

  await app.waitUntil(() => ssh.localOpenCalls.length === 2);
  expect(ssh.callsFor("create_directory").some(c => c.raw === false)).toBe(true);
  expect(ssh.callsFor("open_workspace")[1]?.payload).toMatchObject({
    path: "/tmp/mock-home/OpenBitFun/Projects/fresh-proj",
  });
});

test("New Workspace remote SSH and Docker/WSL host selection opens via remote_open_workspace", async () => {
  const ssh = createSshBackend({ wslSupported: true, wslDistributions: ["Ubuntu-22.04"] });
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: ssh.base.handlers },
  });

  await app.waitFor("OpenBitFun");
  await openNewWorkspaceViaUi(app);
  await app.press("new-workspace-choice-project");

  // WSL environment on current host triggers ssh_list_wsl_distributions
  await app.press("WSL");
  await app.waitUntil(() => ssh.callsFor("ssh_list_wsl_distributions").length >= 1);
  expect(ssh.callsFor("ssh_list_wsl_distributions")[0]?.raw).toBe(true);

  // Switch to Other Host (SSH)
  await app.press("Other Host (SSH)");
  await app.press("new-workspace-host-select");
  await app.waitFor("new-ws-host-opt-conn-prod-1");
  await app.press("new-ws-host-opt-conn-prod-1");

  // Remote Docker discovery
  await app.press("Remote Docker");
  await app.waitUntil(() => ssh.callsFor("ssh_list_docker_containers").length >= 1);
  expect(ssh.callsFor("ssh_list_docker_containers")[0]?.raw).toBe(true);

  // Back to System (SSH), browse remote directory, confirm open
  await app.press("System (SSH)");
  await app.press("new-workspace-browse-remote");
  await app.waitFor("remote-file-browser-modal");
  await app.press("remote-entry-apps");
  await app.waitFor("remote-entry-openbitfun-api");
  await app.press("remote-browser-open");
  await app.waitFor("Prod App Box: /home/deploy/apps");
  await app.press("new-workspace-confirm");

  await app.waitUntil(() => ssh.callsFor("remote_open_workspace").length === 1);
  expect(ssh.callsFor("remote_open_workspace")[0]).toMatchObject({
    raw: true,
    payload: { connectionId: "conn-prod-1", remotePath: "/home/deploy/apps" },
  });
  expect(ssh.callsFor("open_remote_workspace")[0]).toMatchObject({
    raw: false,
    payload: { connectionId: "conn-prod-1", remotePath: "/home/deploy/apps" },
  });
  expect(ssh.localOpenCalls).toHaveLength(0);
});

test("SSH Connection modal supports ~/.ssh/config import, ssh_get_config, test report, save, edit, and delete", async () => {
  const ssh = createSshBackend();
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: ssh.base.handlers },
  });

  await app.waitFor("OpenBitFun");
  await openSshModalViaUi(app);

  await app.waitFor("ssh-saved-conn-prod-1");
  expect(ssh.callsFor("ssh_list_saved_connections")[0]?.raw).toBe(true);
  expect(ssh.callsFor("ssh_list_config_hosts")[0]?.raw).toBe(true);

  // Switch to New Connection and import ~/.ssh/config entry
  await app.press("New Connection");
  await app.waitFor("ssh-config-host-bastion-dev");
  await app.press("ssh-config-host-bastion-dev");
  expect(app.value("ssh-form-host")).toBe("bastion-dev");
  expect(app.value("ssh-form-username")).toBe("devuser");
  expect(app.value("ssh-form-port")).toBe("2200");

  // Typing host triggers debounced ssh_get_config positional call
  await app.type("ssh-form-host", "");
  await app.clear("ssh-form-host");
  await app.type("ssh-form-host", "bastion-dev");
  await app.wait(320);
  expect(ssh.callsFor("ssh_get_config").some(c => c.raw === true && c.payload.host === "bastion-dev")).toBe(true);

  // Run connection test
  await app.press("ssh-test-btn");
  await app.waitFor("Test Passed");
  expect(ssh.callsFor("ssh_test_connection")[0]?.raw).toBe(true);

  // Save new connection profile -> returns to Saved Connections view
  await app.press("ssh-save-btn");
  await app.waitFor("Connection profile saved.");
  expect(ssh.callsFor("ssh_save_connection")[0]?.raw).toBe(true);

  // Edit Staging Box -> calls ssh_has_stored_password
  await app.press("ssh-edit-conn-staging-2");
  await app.waitUntil(() => ssh.callsFor("ssh_has_stored_password").length >= 1);
  expect(ssh.callsFor("ssh_has_stored_password")[0]).toMatchObject({
    raw: true,
    payload: { connectionId: "conn-staging-2" },
  });

  // Delete Staging Box via inline confirm
  await app.press("Saved Connections");
  await app.press("ssh-delete-conn-staging-2");
  await app.waitFor("Confirm Delete");
  await app.press("Confirm Delete");
  await app.waitUntil(() => ssh.callsFor("ssh_delete_connection").length === 1);
  expect(ssh.callsFor("ssh_delete_connection")[0]).toMatchObject({
    raw: true,
    payload: { connectionId: "conn-staging-2" },
  });
});

test("SSH Auth Prompt modal repairs password credentials after authentication rejection", async () => {
  const ssh = createSshBackend({ failAuthOnFirstConnect: true });
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: ssh.base.handlers },
  });

  await app.waitFor("OpenBitFun");
  await openSshModalViaUi(app);
  await app.waitFor("ssh-connect-conn-staging-2");
  await app.press("ssh-connect-conn-staging-2");

  // Opens Auth Prompt automatically on auth error
  await app.waitFor("ssh-auth-prompt-modal");
  await app.type("ssh-auth-password", "super-secret-pass");
  await app.press("ssh-auth-submit");

  // Re-attempts ssh_connect and lands in Remote File Browser
  await app.waitFor("remote-file-browser-modal");
  expect(ssh.callsFor("ssh_connect")).toHaveLength(2);
  expect(ssh.callsFor("ssh_connect")[1]?.raw).toBe(true);
});

test("Remote File Browser handles POSIX navigation, mkdir, rename, delete, and rebind conflict", async () => {
  const ssh = createSshBackend({
    conflictOwners: { "/home/deploy/apps/openbitfun-api": "conn-staging-2" },
  });
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: ssh.base.handlers },
  });

  await app.waitFor("OpenBitFun");
  await openSshModalViaUi(app);
  await app.press("ssh-browse-conn-prod-1");
  await app.waitFor("remote-file-browser-modal");
  await app.waitFor("remote-entry-apps");

  expect(ssh.callsFor("ssh_get_server_info")[0]?.raw).toBe(true);
  expect(ssh.callsFor("remote_read_dir")[0]?.raw).toBe(true);

  // Create new folder (navigates into new folder), then go up to parent via POSIX parent helper
  await app.press("remote-browser-new-folder-toggle");
  await app.type("remote-browser-new-dir-name", "scratch-dir");
  await app.press("remote-browser-new-dir-create");
  await app.waitFor("Directory is empty.");
  await app.press("remote-browser-up");
  await app.waitFor("remote-entry-scratch-dir");
  expect(ssh.callsFor("remote_exists").some(c => c.raw === true)).toBe(true);
  expect(ssh.callsFor("remote_create_dir")[0]).toMatchObject({
    raw: true,
    payload: { connectionId: "conn-prod-1", path: "/home/deploy/scratch-dir", recursive: true },
  });

  // Rename created folder
  await app.press("Rename scratch-dir");
  await app.clear("remote-browser-rename-input");
  await app.type("remote-browser-rename-input", "renamed-dir");
  await app.press("remote-browser-rename-save");
  await app.waitFor("remote-entry-renamed-dir");
  expect(ssh.callsFor("remote_rename")[0]).toMatchObject({
    raw: true,
    payload: {
      connectionId: "conn-prod-1",
      oldPath: "/home/deploy/scratch-dir",
      newPath: "/home/deploy/renamed-dir",
    },
  });

  // Delete renamed folder -> calls positional remote_remove
  await app.press("Delete renamed-dir");
  await app.waitFor('Delete "renamed-dir" on remote host?');
  await app.press("text:Delete");
  await app.waitUntil(() => ssh.callsFor("remote_remove").length === 1);
  expect(ssh.callsFor("remote_remove")[0]).toMatchObject({
    raw: true,
    payload: {
      connectionId: "conn-prod-1",
      path: "/home/deploy/renamed-dir",
      recursive: true,
    },
  });

  // Navigate into conflicting workspace -> rebind confirmation -> Move Workspace
  await app.rightClick("remote-entry-README.md");
  await app.waitFor("Rename");
  await app.press("Rename");
  await app.waitFor("remote-browser-rename-input");
  await app.press("text:Cancel >> nth=0");

  await app.press("remote-entry-apps");
  await app.waitFor("remote-entry-openbitfun-api");
  await app.press("remote-entry-openbitfun-api");
  await app.waitFor("remote-entry-src");
  await app.press("remote-browser-open");

  await app.waitFor("Move Workspace");
  await app.press("Move Workspace");

  await app.waitUntil(() => ssh.callsFor("remote_open_workspace").length === 1);
  expect(ssh.callsFor("open_remote_workspace").at(-1)?.payload).toMatchObject({
    connectionId: "conn-prod-1",
    remotePath: "/home/deploy/apps/openbitfun-api",
    rebindConnection: true,
  });
  expect(ssh.localOpenCalls).toHaveLength(0);

  // Disconnect SSH & close the remote workspace from its row in All sessions › By device
  await showDevices(app);
  await app.waitFor("workspace-actions-ws-remote-1");
  await app.press("workspace-actions-ws-remote-1");
  await app.waitFor("Disconnect SSH");
  await app.press("Disconnect SSH");
  await app.waitUntil(() => ssh.callsFor("ssh_disconnect").length === 1);
  expect(ssh.callsFor("ssh_disconnect")[0]).toMatchObject({
    raw: true,
    payload: { connectionId: "conn-prod-1" },
  });

  await app.press("workspace-actions-ws-remote-1");
  await app.waitFor("Close workspace");
  await app.press("Close workspace");
  await app.waitUntil(() => ssh.callsFor("remote_close_workspace").length === 1);
  expect(ssh.callsFor("close_workspace")[0]).toMatchObject({
    raw: false,
    payload: { workspaceId: "ws-remote-1" },
  });
  expect(ssh.callsFor("remote_close_workspace")[0]?.raw).toBe(true);
});

test("Port Forwarding modal detects listeners without auto-forwarding, normalizes 0.0.0.0, starts structured request, and stops tunnel", async () => {
  const ssh = createSshBackend({ movedPortAllocation: { 4000: 41234 } });
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: ssh.base.handlers },
  });

  await app.waitFor("OpenBitFun");
  await openSshModalViaUi(app);
  await app.press("ssh-pf-conn-prod-1");
  await app.waitFor("port-forward-modal");

  // Initial forwards listed, no auto-forwarding started
  await app.waitUntil(() => app.texts().some(t => t.includes("API Gateway")));
  expect(ssh.callsFor("ssh_list_port_forwards")[0]?.raw).toBe(true);
  expect(ssh.callsFor("ssh_list_remote_listening_ports").some(c => c.raw === true)).toBe(true);
  expect(ssh.callsFor("ssh_start_port_forward")).toHaveLength(0);

  // One-click forward detected 0.0.0.0:3000 -> normalized to 127.0.0.1 via structured { request }
  await app.waitFor("pf-detected-3000");
  await app.press("pf-detected-3000");
  await app.waitUntil(() => ssh.callsFor("ssh_start_port_forward").length === 1);
  expect(ssh.callsFor("ssh_start_port_forward")[0]).toMatchObject({
    raw: false,
    payload: {
      connectionId: "conn-prod-1",
      remoteHost: "127.0.0.1",
      remotePort: 3000,
    },
  });

  // Manual custom forward with busy local port shows moved note
  await app.type("pf-remote-port", "4000");
  await app.type("pf-local-port", "4000");
  await app.type("pf-description", "GraphQL");
  await app.press("pf-expose-lan");
  await app.press("pf-submit");
  await app.waitUntil(() => ssh.callsFor("ssh_start_port_forward").length === 2);
  expect(ssh.callsFor("ssh_start_port_forward")[1]).toMatchObject({
    raw: false,
    payload: {
      connectionId: "conn-prod-1",
      remoteHost: "127.0.0.1",
      remotePort: 4000,
      localPort: 4000,
      exposeOnLan: true,
      description: "GraphQL",
    },
  });
  await app.waitUntil(() =>
    app.texts().some(t => t.includes("Moved from :4000 to :41234")),
  );

  // Stop initial forward uses positional ssh_stop_port_forward
  await app.press("pf-stop-pf-initial-1");
  await app.waitUntil(() => ssh.callsFor("ssh_stop_port_forward").length === 1);
  expect(ssh.callsFor("ssh_stop_port_forward")[0]).toMatchObject({
    raw: true,
    payload: { forwardId: "pf-initial-1" },
  });
});

test("the remote browser tolerates a host lacking remote_open_workspace", async () => {
  const ssh = createSshBackend({ failMissingRemoteOpenCommand: true });
  const deviceBackend = createDeviceBackend();
  const baseInvoke = deviceBackend.handlers["openbitfun.invoke"] as (d: unknown) => Promise<unknown>;
  deviceBackend.handlers["openbitfun.invoke"] = async (data: unknown) => {
    const args = asRecord(data);
    const action = typeof args.action === "string" ? args.action : "";
    if (
      action.startsWith("ssh_") ||
      action.startsWith("remote_") ||
      action === "open_remote_workspace" ||
      action === "get_opened_workspaces" ||
      action === "get_workspace_navigator" ||
      action === "get_active_workspace"
    ) {
      return (ssh.base.handlers["openbitfun.invoke"] as (d: unknown) => Promise<unknown>)(data);
    }
    return baseInvoke(data);
  };

  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: deviceBackend.handlers },
  });

  await app.waitFor("OpenBitFun");
  await openSshModalViaUi(app);
  await app.press("ssh-browse-conn-prod-1");
  await app.waitFor("remote-file-browser-modal");
  await app.press("remote-browser-open");

  // The host lacks remote_open_workspace, but open_remote_workspace succeeded -> closes browser cleanly
  await app.waitUntil(() => !app.shows("remote-file-browser-modal"));
  expect(ssh.callsFor("open_remote_workspace")).toHaveLength(1);
});

test("Local Docker / WSL target discovery in the SSH Connection modal", async () => {
  const ssh = createSshBackend({ wslSupported: true, wslDistributions: ["Ubuntu-22.04"] });
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: ssh.base.handlers },
  });

  await app.waitFor("OpenBitFun");

  await openSshModalViaUi(app);
  await app.press("Local Docker");
  await app.waitUntil(() =>
    ssh.callsFor("ssh_list_docker_containers").some(c => c.raw === true),
  );
  await app.press("WSL");
  await app.waitUntil(() =>
    ssh.callsFor("ssh_list_wsl_distributions").some(c => c.raw === true),
  );
});

test("Remote workspace activation asks the backend to restore a dropped link and marks an unrecoverable one offline", async () => {
  const opened = [
    { id: "workspace-1", name: "OpenBitFun", rootPath: "/repo", workspaceKind: "local" },
    { id: "ws-staging", name: "staging", rootPath: "/srv/staging", workspaceKind: "remote", connectionId: "conn-staging-2", sshHost: "staging.example.com" },
    { id: "ws-gone", name: "gone", rootPath: "/srv/gone", workspaceKind: "remote", connectionId: "conn-gone-9", sshHost: "gone.example.com" },
  ] as unknown as BackendOptions["openedWorkspaces"];
  const ssh = createSshBackend({ openedWorkspaces: opened });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: ssh.base.handlers } });

  await app.waitFor("OpenBitFun");
  await openToolScene(app, "files");
  await app.waitFor("Explorer");

  // The staging link is down: activation hands it to the backend, which restores
  // it from the saved profile (vault password) and re-activates the workspace.
  // This surface reconnects and activates nothing itself (the saved-host list
  // still reads each host's status for its dot).
  await showDevices(app);
  await app.press("workspace-row-ws-staging");
  await openToolScene(app, "files");
  await app.waitUntil(() => ssh.linkRestores.includes("conn-staging-2"));
  expect(ssh.callsFor("remote_workspace_ensure_connected")[0]).toMatchObject({
    raw: false,
    payload: { connectionId: "conn-staging-2", remotePath: "/srv/staging", activate: true },
  });
  expect(ssh.linkActivations).toContainEqual({ connectionId: "conn-staging-2", remotePath: "/srv/staging" });
  expect(ssh.callsFor("ssh_connect")).toHaveLength(0);
  expect(ssh.callsFor("remote_open_workspace")).toHaveLength(0);
  expect(app.shows("remote-link-offline")).toBe(false);
  // The host has no watcher for a remote root: the explorer says so instead of pretending to be live.
  await app.waitFor("file-watch-unsupported");

  // A workspace whose saved connection is gone is marked offline, loudly, with a way to retry.
  await showDevices(app);
  await app.press("workspace-row-ws-gone");
  await openToolScene(app, "files");
  await app.waitFor("remote-link-offline");
  await app.waitFor("gone.example.com is offline");
  await app.waitFor("The saved connection for this workspace is missing on this host.");
  await app.waitFor("remote-link-reconnect");
  const before = ssh.callsFor("remote_workspace_ensure_connected").length;
  await app.press("remote-link-reconnect");
  await app.waitUntil(() => ssh.callsFor("remote_workspace_ensure_connected").length === before + 1);
});

test("Remote link state follows the backend's remote://link-state events and asks for credentials only when the host says so", async () => {
  const opened = [
    { id: "workspace-1", name: "OpenBitFun", rootPath: "/repo", workspaceKind: "local" },
    { id: "ws-prod", name: "prod", rootPath: "/home/deploy/apps", workspaceKind: "remote", connectionId: "conn-prod-1", sshHost: "prod.example.com" },
  ] as unknown as BackendOptions["openedWorkspaces"];
  const ssh = createSshBackend({ openedWorkspaces: opened });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: ssh.base.handlers } });

  await app.waitFor("OpenBitFun");
  await openToolScene(app, "files");
  await app.waitFor("Explorer");
  await showDevices(app);
  await app.press("workspace-row-ws-prod");
  await openToolScene(app, "files");
  await app.waitUntil(() => ssh.callsFor("remote_workspace_ensure_connected").length === 1);
  expect(app.shows("remote-link-reconnecting")).toBe(false);

  // The backend's heartbeat lost the link and is restoring it: the banner shows its attempt.
  const send = (payload: Record<string, unknown>) =>
    app.host.send("openbitfun.event", { event: "remote://link-state", payload });
  await send({ connectionId: "conn-prod-1", state: "reconnecting", attempt: 2, nextRetryMs: 10000, revision: 50 });
  await app.waitFor("remote-link-reconnecting");
  await app.waitFor("Reconnecting to prod.example.com (attempt 2)…");
  // An older event that arrives late does not move the banner back.
  await send({ connectionId: "conn-prod-1", state: "connected", revision: 10 });
  await app.waitFor("remote-link-reconnecting");

  // The host stopped: the server refused the stored key. Only now does this surface ask the user.
  await send({ connectionId: "conn-prod-1", state: "failed", reason: "auth_required", detail: "Authentication failed (publickey)", revision: 51 });
  await app.waitFor("remote-link-auth-required");
  await app.waitFor("prod.example.com needs your credentials to reconnect");

  // Restored: the banner goes away.
  await send({ connectionId: "conn-prod-1", state: "connected", revision: 52 });
  await app.waitUntil(() => !app.shows("remote-link-auth-required"));
});

test("A host without backend link supervision gets an explicit update-the-host state, not a client reconnect loop", async () => {
  const opened = [
    { id: "workspace-1", name: "OpenBitFun", rootPath: "/repo", workspaceKind: "local" },
    { id: "ws-staging", name: "staging", rootPath: "/srv/staging", workspaceKind: "remote", connectionId: "conn-staging-2", sshHost: "staging.example.com" },
  ] as unknown as BackendOptions["openedWorkspaces"];
  const ssh = createSshBackend({ openedWorkspaces: opened, noLinkSupervision: true });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: ssh.base.handlers } });

  await app.waitFor("OpenBitFun");
  await openToolScene(app, "files");
  await app.waitFor("Explorer");
  await showDevices(app);
  await app.press("workspace-row-ws-staging");
  await openToolScene(app, "files");
  await app.waitFor("remote-link-host-outdated");
  await app.waitFor("staging.example.com: this host cannot restore remote connections");
  expect(ssh.callsFor("ssh_connect")).toHaveLength(0);
  expect(app.shows("remote-link-reconnect")).toBe(false);
});
