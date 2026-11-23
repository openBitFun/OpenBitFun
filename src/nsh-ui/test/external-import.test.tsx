import { expect, open, test } from "nsh/test";
import { showDevices, createBackend, createDeviceBackend, type BackendOptions } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

const EXTERNAL_COMMANDS = [
  "get_external_source_discovery_snapshot",
  "get_external_source_control_snapshot",
  "get_external_source_snapshot",
  "update_external_integration_policy_command",
  "plan_external_mcp_import_command",
  "apply_external_mcp_import_command",
  "list_removed_external_sessions",
  "restore_removed_external_session",
];

type Recorded = { action: string; payload: Record<string, unknown>; raw: boolean };

/** Plays the host's external-source commands on top of the simulated backend. */
function withExternalHost(
  options: BackendOptions & { device?: boolean },
  answer: (action: string, payload: Record<string, unknown>) => unknown,
) {
  const base = options.device ? createDeviceBackend(options) : createBackend(options);
  const originalInvoke = base.handlers["openbitfun.invoke"];
  const recorded: Recorded[] = [];
  base.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
    const action = args.action ?? "";
    const raw = Object.prototype.hasOwnProperty.call(args, "raw");
    const payload = ((raw ? args.raw : args.request) ?? {}) as Record<string, unknown>;
    recorded.push({ action, payload, raw });
    if (EXTERNAL_COMMANDS.includes(action)) {
      try {
        return { ok: true, value: answer(action, payload), transport: "dev" };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), transport: "dev" };
      }
    }
    return originalInvoke(data);
  };
  return { backend: base, recorded };
}

function catalog(overrides: Record<string, unknown> = {}) {
  return {
    hostCapabilities: {
      canRefresh: true,
      canMutatePolicy: true,
      canManageSources: true,
      canApproveRuntime: true,
      canExecuteExternalAssets: true,
      canSetSafeMode: true,
    },
    generation: 3,
    discoveryPending: false,
    sources: [
      {
        stableKey: "claude-code:user",
        record: {
          key: { providerId: "claude-code", sourceId: "user" },
          ecosystemId: "claude-code",
          displayName: "Claude Code",
          sourceKind: "config",
          scope: "user_global",
          location: "~/.claude",
          executionDomainId: "local",
          health: "available",
          contentVersion: "v1",
        },
        lifecycle: "available",
      },
      {
        stableKey: "opencode:project",
        record: {
          key: { providerId: "opencode", sourceId: "project" },
          ecosystemId: "opencode",
          displayName: "OpenCode",
          sourceKind: "config",
          scope: "project",
          location: "/repo/.opencode",
          executionDomainId: "local",
          health: "degraded",
          contentVersion: "v1",
        },
        lifecycle: "degraded",
      },
    ],
    commands: [{ definition: { name: "review" } }, { definition: { name: "ship" } }],
    mcpServers: [{ candidateId: "mcp-1" }, { candidateId: "mcp-2" }, { candidateId: "mcp-3" }],
    integrationPolicy: {
      registeredEcosystems: [
        { ecosystemId: "claude-code", displayName: "Claude Code", adapterRevision: "1", capabilities: [] },
        { ecosystemId: "opencode", displayName: "OpenCode", adapterRevision: "1", capabilities: [] },
      ],
    },
    ...overrides,
  };
}

function discoverySnapshot(enabled: boolean, revision: number) {
  return {
    schemaVersion: 1,
    automaticDiscovery: enabled,
    canChangeAutomaticDiscovery: true,
    hasScanned: true,
    discoverableCapabilities: { "claude-code": ["mcp"] },
    preferenceRevision: revision,
    catalog: catalog(),
  };
}

const PLAN = {
  schemaVersion: 1,
  planFingerprint: "fp-1",
  items: [
    { candidateId: "mcp-1", displayName: "github", transport: "local_stdio", disposition: "eligible" },
    {
      candidateId: "mcp-2",
      displayName: "linear",
      transport: "streamable_http",
      proposedNativeId: "linear-2",
      disposition: "automatic_rename",
    },
    {
      candidateId: "mcp-3",
      displayName: "secrets",
      transport: "local_stdio",
      disposition: "unavailable",
      reasonCode: "external_mcp.import_setup_required",
    },
  ],
};

async function openExternalImport(handlers: Record<string, (data: unknown) => unknown>) {
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers } });
  await app.waitFor("nav-library");
  await app.press("Settings");
  await app.press("nav-settings-page-external-import");
  return app;
}

test("external import reads the discovery snapshot for the workspace and writes the discovery switch", async () => {
  let enabled = true;
  let revision = 7;
  const { backend, recorded } = withExternalHost({}, (action, payload) => {
    if (action === "get_external_source_discovery_snapshot") return discoverySnapshot(enabled, revision);
    if (action === "update_external_integration_policy_command") {
      const mutation = payload.mutation as { change: { enabled: boolean } };
      enabled = mutation.change.enabled;
      revision += 1;
      return catalog();
    }
    if (action === "plan_external_mcp_import_command") return PLAN;
    if (action === "list_removed_external_sessions") return [];
    throw new Error(`unexpected ${action}`);
  });
  const app = await openExternalImport(backend.handlers);

  await app.waitFor("Claude Code");
  expect(app.texts()).toContain("OpenCode");
  expect(app.texts()).toContain("User · ~/.claude");
  expect(app.texts()).toContain("Degraded");
  expect(app.texts()).toContain("2 commands · 0 tools · 0 subagents · 3 MCP servers");

  // One request struct, the workspace by id, no rescan on open.
  const read = recorded.find(item => item.action === "get_external_source_discovery_snapshot");
  expect(read?.raw).toBe(false);
  expect(read?.payload).toEqual({ workspaceId: "workspace-1", forceRefresh: false });

  // The switch writes the one mutation against the revision it read, then re-reads.
  await app.press("external-discovery-toggle");
  await app.waitUntil(() => recorded.some(item => item.action === "update_external_integration_policy_command"));
  const write = recorded.find(item => item.action === "update_external_integration_policy_command");
  expect(write?.payload).toEqual({
    workspaceId: "workspace-1",
    mutation: {
      expectedPreferenceRevision: 7,
      scope: "workspace",
      change: { operation: "set_automatic_discovery", enabled: false },
    },
  });
  await app.waitFor("Turn on automatic discovery to preview the MCP servers other apps declare.");
  expect(recorded.filter(item => item.action === "get_external_source_discovery_snapshot").length).toBe(2);

  // Refresh asks the host to rescan.
  await app.press("external-import-refresh");
  await app.waitUntil(() =>
    recorded.some(
      item => item.action === "get_external_source_discovery_snapshot" && item.payload.forceRefresh === true,
    ),
  );
});

test("MCP servers from other apps import one at a time or together, and a stale plan replaces the preview", async () => {
  let applies = 0;
  const { backend, recorded } = withExternalHost({}, (action, payload) => {
    if (action === "get_external_source_discovery_snapshot") return discoverySnapshot(true, 1);
    if (action === "plan_external_mcp_import_command") return PLAN;
    if (action === "apply_external_mcp_import_command") {
      applies += 1;
      const request = payload.importRequest as { selections: Array<{ candidateId: string }> };
      if (applies === 1) {
        return {
          schemaVersion: 1,
          outcome: { status: "applied", imported: [{ candidateId: request.selections[0]!.candidateId, nativeId: "github" }] },
        };
      }
      return {
        schemaVersion: 1,
        outcome: {
          status: "stale",
          refreshedPlan: {
            schemaVersion: 1,
            planFingerprint: "fp-2",
            items: [{ candidateId: "mcp-1", displayName: "github", transport: "local_stdio", disposition: "already_imported" }],
          },
        },
      };
    }
    if (action === "list_removed_external_sessions") return [];
    throw new Error(`unexpected ${action}`);
  });
  const app = await openExternalImport(backend.handlers);

  await app.waitFor("github");
  expect(app.texts()).toContain("Ready to import");
  expect(app.texts()).toContain("Ready · auto-rename");
  expect(app.texts()).toContain("Setup required");
  expect(app.texts()).toContain("Streamable HTTP · Imported as linear-2");
  // An item the host will not copy offers no button.
  expect(app.count("external-mcp-import-mcp-3")).toBe(0);
  expect(app.shows("Import all (2)")).toBe(true);

  await app.press("external-mcp-import-mcp-1");
  await app.waitFor("Imported github. Its copy is now available on the MCP page.");
  const single = recorded.find(item => item.action === "apply_external_mcp_import_command");
  expect(single?.raw).toBe(false);
  expect(single?.payload).toEqual({
    workspaceId: "workspace-1",
    importRequest: { schemaVersion: 1, planFingerprint: "fp-1", selections: [{ candidateId: "mcp-1" }] },
  });

  await app.press("external-mcp-import-all");
  await app.waitFor("The source or destination changed. Review the updated preview and confirm again.");
  const batch = recorded.filter(item => item.action === "apply_external_mcp_import_command")[1];
  expect((batch?.payload.importRequest as { selections: unknown[] }).selections).toEqual([
    { candidateId: "mcp-1" },
    { candidateId: "mcp-2" },
  ]);
  // The refreshed plan is what is drawn now.
  await app.waitFor("Imported");
  expect(app.count("external-mcp-import-all")).toBe(0);
});

test("removed source sessions list per ecosystem and come back one at a time", async () => {
  let restoreCalls = 0;
  const { backend, recorded } = withExternalHost({}, (action, payload) => {
    if (action === "get_external_source_discovery_snapshot") return discoverySnapshot(true, 1);
    if (action === "plan_external_mcp_import_command") return { schemaVersion: 1, planFingerprint: "fp", items: [] };
    if (action === "list_removed_external_sessions") {
      if (payload.ecosystemId === "claude-code") {
        return [
          { ecosystemId: "claude-code", sessionId: "s-1", sessionName: "Fix login", workspaceId: "workspace-1", workspaceName: "OpenBitFun" },
          { ecosystemId: "claude-code", sessionId: "s-2", sessionName: "Refactor", workspaceId: "workspace-1", workspaceName: "OpenBitFun" },
        ];
      }
      return [];
    }
    if (action === "restore_removed_external_session") {
      restoreCalls += 1;
      if (payload.sessionId === "s-2") throw new Error('{"code":"internal","detail":"store locked","retryable":true}');
      return null;
    }
    throw new Error(`unexpected ${action}`);
  });
  const app = await openExternalImport(backend.handlers);

  await app.waitFor("Fix login");
  // One list per ecosystem the host registered, never a workspace field.
  const lists = recorded.filter(item => item.action === "list_removed_external_sessions");
  expect(lists.map(item => item.payload)).toEqual([{ ecosystemId: "claude-code" }, { ecosystemId: "opencode" }]);
  expect(app.texts()).toContain("Claude Code · OpenBitFun");

  await app.press("external-removed-restore-s-1");
  await app.waitFor("Fix login", { state: "gone" });
  const restore = recorded.find(item => item.action === "restore_removed_external_session");
  expect(restore?.payload).toEqual({ ecosystemId: "claude-code", targetWorkspaceId: "workspace-1", sessionId: "s-1" });

  // A refused restore keeps the row and says the record is kept.
  await app.press("external-removed-restore-s-2");
  await app.waitFor("Could not add this source session again. The removal record is kept; retry later.");
  expect(app.shows("Refactor")).toBe(true);
  expect(restoreCalls).toBe(2);
});

test("an older host falls back to the legacy catalog with a read-only switch, and a host without any says so", async () => {
  const { backend, recorded } = withExternalHost({}, action => {
    if (action === "get_external_source_discovery_snapshot" || action === "get_external_source_control_snapshot") {
      throw new Error(`Command not found: ${action}`);
    }
    if (action === "get_external_source_snapshot") return catalog({ mcpServers: undefined });
    if (action === "list_removed_external_sessions") throw new Error(`unknown command ${action}`);
    throw new Error(`unexpected ${action}`);
  });
  const app = await openExternalImport(backend.handlers);

  await app.waitFor("Claude Code");
  expect(app.texts()).toContain("This device or settings version does not support changing automatic discovery.");
  expect(app.enabled("external-discovery-toggle")).toBe(false);
  expect(app.texts()).toContain("No MCP servers were found in other apps.");
  // A host without the removed-sessions command is told apart from an empty list.
  await app.waitFor("This device does not support restoring removed source sessions. Update OpenBitFun on it and retry.");
  expect(recorded.some(item => item.action === "plan_external_mcp_import_command")).toBe(false);
});

test("a failed read shows the host's own detail and retries", async () => {
  let reads = 0;
  const { backend } = withExternalHost({}, action => {
    if (action === "get_external_source_discovery_snapshot") {
      reads += 1;
      if (reads === 1) throw new Error('{"code":"unavailable","detail":"Discovery service is starting","retryable":true}');
      return discoverySnapshot(true, 1);
    }
    if (action === "plan_external_mcp_import_command") return PLAN;
    if (action === "list_removed_external_sessions") return [];
    throw new Error(`unexpected ${action}`);
  });
  const app = await openExternalImport(backend.handlers);

  await app.waitFor("Could not read external apps. Discovery service is starting");
  await app.press("Retry");
  await app.waitFor("Claude Code");
});

test("a remote workspace never reaches the external-source commands and says why", async () => {
  const { backend, recorded } = withExternalHost({ currentWorkspaceId: "workspace-2" }, action => {
    if (action === "list_removed_external_sessions") return [];
    throw new Error(`unexpected ${action}`);
  });
  const app = await openExternalImport(backend.handlers);

  await app.waitFor(
    "External import reads other apps' folders on the machine running the desktop app. The active workspace is remote, so it is unavailable here; switch to a local workspace to use it.",
  );
  const workspaceScoped = recorded.filter(
    item => EXTERNAL_COMMANDS.includes(item.action) && item.action !== "list_removed_external_sessions",
  );
  expect(workspaceScoped).toEqual([]);
  expect(app.shows("external-import-open-agents")).toBe(true);
});

