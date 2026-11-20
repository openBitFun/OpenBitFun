import { expect, open, test } from "nsh/test";
import { createBackend, createDeviceBackend, type Backend, type BackendCall, type BackendOptions } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

interface StudioMockOptions extends BackendOptions {
  skillConfigsShape?: "report" | "array";
  marketShape?: "diagnostics" | "array";
  initialDisabledSkills?: string[];
  includeShadowedSkill?: boolean;
}

function createAgentsSkillsBackend(options: StudioMockOptions = {}) {
  const base: Backend = options.devices || options.onlineDevices
    ? createDeviceBackend(options)
    : createBackend(options);
  const baseInvoke = base.handlers["openbitfun.invoke"];

  const recorded: BackendCall[] = [];
  const modes: Array<Record<string, unknown>> = [
    {
      id: "Standard",
      name: "Standard",
      description: "Balanced default profile.",
      source: "builtin",
      isReadonly: false,
      toolCount: 3,
      defaultTools: ["Read", "Write", "Grep"],
      configProfileId: "Standard",
      model: null,
    },
    {
      id: "Reviewer",
      name: "Reviewer",
      description: "Custom user code review primary mode.",
      source: "user",
      isReadonly: true,
      toolCount: 2,
      defaultTools: ["Read", "Grep"],
      configProfileId: "Reviewer",
      model: "gpt-4.1",
    },
    {
      id: "OpenCodeMode",
      name: "OpenCode ACP",
      description: "External ACP primary runtime.",
      source: "external",
      isReadonly: false,
      toolCount: 1,
      defaultTools: ["Bash"],
      configProfileId: "OpenCodeMode",
      model: "opencode-acp",
    },
  ];

  const subagents: Array<Record<string, unknown>> = [
    {
      id: "Explorer",
      name: "Explorer",
      description: "Fast built-in codebase explorer.",
      source: "builtin",
      subagentSource: "builtin",
      isReadonly: true,
      isReview: false,
      toolCount: 2,
      defaultTools: ["Read", "Grep"],
      effectiveEnabled: true,
      model: null,
    },
    {
      id: "HelperSub",
      name: "HelperSub",
      description: "User-created helper subagent.",
      source: "user",
      subagentSource: "user",
      isReadonly: true,
      isReview: false,
      toolCount: 2,
      defaultTools: ["Read", "Glob"],
      effectiveEnabled: true,
      model: "gpt-4.1-mini",
    },
  ];

  const customAgentDetails: Record<string, Record<string, unknown>> = {
    Reviewer: {
      agentId: "Reviewer",
      kind: "mode",
      level: "user",
      name: "Reviewer",
      description: "Custom user code review primary mode.",
      prompt: "Review diffs carefully.",
      tools: ["Read", "Grep"],
      readonly: true,
      review: false,
      model: "gpt-4.1",
      path: "/tmp/agents/reviewer.md",
    },
  };

  const customSubagentDetails: Record<string, Record<string, unknown>> = {
    HelperSub: {
      subagentId: "HelperSub",
      name: "HelperSub",
      description: "User-created helper subagent.",
      prompt: "Assist with focused tasks.",
      tools: ["Read", "Glob"],
      readonly: true,
      review: false,
      enabled: true,
      model: "gpt-4.1-mini",
      level: "user",
      path: "/tmp/agents/helpersub.md",
    },
  };

  const toolNames = ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "LS"];
  let profileConfigs: Record<string, Record<string, unknown>> = {
    Standard: {
      profile_id: "Standard",
      default_tools: ["Read", "Write", "Grep"],
      enabled_tools: ["Read", "Write", "Grep"],
    },
  };

  const skills: Array<Record<string, unknown>> = [
    {
      key: "user::openbitfun-system::core-guide",
      name: "Core Guide",
      description: "Built-in baseline conventions.",
      path: "/skills/builtin/core-guide",
      level: "user",
      sourceSlot: "openbitfun-system",
      sourceId: "openbitfun-system",
      sourceLabel: "OpenBitFun",
      dirName: "core-guide",
      isBuiltin: true,
      isShadowed: false,
    },
    {
      key: "user::openbitfun::reviewer",
      name: "Code Reviewer",
      description: "Structured code review checklist.",
      path: "/skills/reviewer",
      level: "user",
      sourceSlot: "openbitfun",
      sourceId: "openbitfun",
      sourceLabel: "OpenBitFun",
      installationSource: "team/skills",
      dirName: "reviewer",
      isBuiltin: false,
      isShadowed: false,
    },
    ...(options.includeShadowedSkill
      ? [
          {
            key: "project::openbitfun::shadowed-skill",
            name: "Shadowed Skill",
            description: "Overridden project skill.",
            path: "/repo/.openbitfun/skills/shadowed-skill",
            level: "project",
            sourceSlot: "openbitfun",
            sourceId: "openbitfun",
            sourceLabel: "OpenBitFun",
            dirName: "shadowed-skill",
            isBuiltin: false,
            isShadowed: true,
            shadowedByKey: "user::openbitfun::reviewer",
          },
        ]
      : []),
  ];

  const fileContents: Record<string, string> = {
    "/skills/reviewer/SKILL.md": "# Code Reviewer\n\nInspect diffs for **correctness** and missing tests.",
    "/skills/builtin/core-guide/SKILL.md": "# Core Guide\n\nBaseline workspace instructions.",
    ...(options.fileContent ?? {}),
  };

  let disabledSkills = [...(options.initialDisabledSkills ?? [])];

  const marketItems: Array<Record<string, unknown>> = [
    {
      id: "skills-sh:https://skills.sh#team/skills/reviewer",
      name: "reviewer",
      description: "Code review automation skill.",
      source: "team/skills",
      installs: 1200,
      url: "https://skills.sh/team/skills/reviewer",
      installId: "skills-sh:https://skills.sh#team/skills@reviewer",
      marketName: "skills.sh",
    },
    {
      id: "skills-sh:https://skills.sh#team/skills/testing",
      name: "testing",
      description: "Automated test generation and coverage.",
      source: "team/skills",
      installs: 420,
      url: "https://skills.sh/team/skills/testing",
      installId: "skills-sh:https://skills.sh#team/skills@testing",
      marketName: "skills.sh",
    },
  ];

  const RAW_ONLY = new Set([
    "list_agent_tool_names",
    "get_agent_profile_configs",
    "set_agent_profile_config",
    "reset_agent_profile_config",
    "get_skill_configs",
    "validate_skill_path",
    "add_skill",
    "delete_skill",
  ]);

  const REQUEST_ONLY = new Set([
    "get_available_modes",
    "list_subagents",
    "get_custom_agent_detail",
    "create_custom_agent",
    "update_custom_agent",
    "delete_custom_agent",
    "reload_custom_agents",
    "get_subagent_detail",
    "create_subagent",
    "update_subagent",
    "delete_subagent",
    "reload_subagents",
    "update_subagent_config",
    "get_global_skill_settings",
    "set_global_skill_disabled",
    "list_skill_market",
    "search_skill_market",
    "download_skill_market",
  ]);

  function handleCustomAction(action: string, payload: Record<string, unknown>): { handled: boolean; value?: unknown } {
    switch (action) {
      case "get_available_modes":
        return { handled: true, value: [...modes] };
      case "list_subagents":
        return { handled: true, value: [...subagents] };
      case "list_agent_tool_names":
        return { handled: true, value: [...toolNames] };
      case "get_agent_profile_configs":
        return { handled: true, value: { ...profileConfigs } };
      case "set_agent_profile_config": {
        const agentId = String(payload.agentId ?? "");
        const config = (payload.config ?? {}) as Record<string, unknown>;
        profileConfigs = { ...profileConfigs, [agentId]: config };
        const idx = modes.findIndex(m => m.id === agentId);
        if (idx >= 0 && Array.isArray(config.enabled_tools)) {
          modes[idx] = {
            ...modes[idx],
            toolCount: config.enabled_tools.length,
          };
        }
        return { handled: true, value: `Updated ${agentId}` };
      }
      case "reset_agent_profile_config": {
        const agentId = String(payload.agentId ?? "");
        profileConfigs = {
          ...profileConfigs,
          [agentId]: {
            profile_id: agentId,
            default_tools: ["Read", "Write", "Grep"],
            enabled_tools: ["Read", "Write", "Grep"],
          },
        };
        return { handled: true, value: `Reset ${agentId}` };
      }
      case "get_custom_agent_detail": {
        const agentId = String(payload.agentId ?? "");
        const found = customAgentDetails[agentId];
        if (!found) throw new Error(`Unknown custom agent: ${agentId}`);
        return { handled: true, value: found };
      }
      case "create_custom_agent": {
        const id = String(payload.id ?? "");
        const name = String(payload.name ?? id);
        const tools = Array.isArray(payload.tools) ? payload.tools : ["Read"];
        modes.push({
          id,
          name,
          description: String(payload.description ?? ""),
          source: String(payload.level ?? "user"),
          isReadonly: Boolean(payload.readonly),
          toolCount: tools.length,
          defaultTools: tools,
          configProfileId: id,
          model: payload.model ?? null,
        });
        customAgentDetails[id] = {
          agentId: id,
          kind: String(payload.kind ?? "mode"),
          level: String(payload.level ?? "user"),
          name,
          description: String(payload.description ?? ""),
          prompt: String(payload.prompt ?? ""),
          tools,
          readonly: Boolean(payload.readonly),
          review: false,
          model: String(payload.model ?? ""),
          path: `/tmp/agents/${id.toLowerCase()}.md`,
        };
        return { handled: true, value: null };
      }
      case "update_custom_agent": {
        const agentId = String(payload.agentId ?? "");
        const idx = modes.findIndex(m => m.id === agentId);
        if (idx >= 0) {
          modes[idx] = {
            ...modes[idx],
            name: String(payload.name ?? modes[idx].name),
            description: String(payload.description ?? modes[idx].description),
            isReadonly: payload.readonly !== undefined ? Boolean(payload.readonly) : modes[idx].isReadonly,
            defaultTools: Array.isArray(payload.tools) ? payload.tools : modes[idx].defaultTools,
            toolCount: Array.isArray(payload.tools) ? payload.tools.length : modes[idx].toolCount,
            model: payload.model ?? modes[idx].model,
          };
        }
        if (customAgentDetails[agentId]) {
          customAgentDetails[agentId] = {
            ...customAgentDetails[agentId],
            name: String(payload.name ?? customAgentDetails[agentId].name),
            description: String(payload.description ?? customAgentDetails[agentId].description),
            prompt: String(payload.prompt ?? customAgentDetails[agentId].prompt),
            tools: Array.isArray(payload.tools) ? payload.tools : customAgentDetails[agentId].tools,
            readonly: Boolean(payload.readonly),
            model: String(payload.model ?? ""),
          };
        }
        return { handled: true, value: null };
      }
      case "delete_custom_agent": {
        const agentId = String(payload.agentId ?? "");
        const idx = modes.findIndex(m => m.id === agentId);
        if (idx >= 0) modes.splice(idx, 1);
        delete customAgentDetails[agentId];
        return { handled: true, value: null };
      }
      case "reload_custom_agents":
      case "reload_subagents":
        return { handled: true, value: null };
      case "get_subagent_detail": {
        const subagentId = String(payload.subagentId ?? "");
        const found = customSubagentDetails[subagentId];
        if (!found) throw new Error(`Unknown subagent: ${subagentId}`);
        return { handled: true, value: found };
      }
      case "create_subagent": {
        const id = String(payload.id ?? payload.name ?? "");
        const name = String(payload.name ?? id);
        const level = String(payload.level ?? "user");
        const tools = Array.isArray(payload.tools) ? payload.tools : ["Read"];
        subagents.push({
          id,
          name,
          description: String(payload.description ?? ""),
          source: level,
          subagentSource: level,
          isReadonly: Boolean(payload.readonly ?? true),
          isReview: false,
          toolCount: tools.length,
          defaultTools: tools,
          effectiveEnabled: true,
          model: payload.model ?? null,
        });
        customSubagentDetails[id] = {
          subagentId: id,
          name,
          description: String(payload.description ?? ""),
          prompt: String(payload.prompt ?? ""),
          tools,
          readonly: Boolean(payload.readonly ?? true),
          review: false,
          enabled: true,
          model: String(payload.model ?? ""),
          level,
          path: `/tmp/agents/${id.toLowerCase()}.md`,
        };
        return { handled: true, value: null };
      }
      case "update_subagent": {
        const subagentId = String(payload.subagentId ?? "");
        const idx = subagents.findIndex(s => s.id === subagentId);
        if (idx >= 0) {
          subagents[idx] = {
            ...subagents[idx],
            name: String(payload.name ?? subagents[idx].name),
            description: String(payload.description ?? subagents[idx].description),
            isReadonly: Boolean(payload.readonly),
            defaultTools: Array.isArray(payload.tools) ? payload.tools : subagents[idx].defaultTools,
            toolCount: Array.isArray(payload.tools) ? payload.tools.length : subagents[idx].toolCount,
            model: payload.model ?? subagents[idx].model,
          };
        }
        if (customSubagentDetails[subagentId]) {
          customSubagentDetails[subagentId] = {
            ...customSubagentDetails[subagentId],
            name: String(payload.name ?? customSubagentDetails[subagentId].name),
            description: String(payload.description ?? customSubagentDetails[subagentId].description),
            prompt: String(payload.prompt ?? customSubagentDetails[subagentId].prompt),
            tools: Array.isArray(payload.tools) ? payload.tools : customSubagentDetails[subagentId].tools,
            readonly: Boolean(payload.readonly),
            model: String(payload.model ?? ""),
          };
        }
        return { handled: true, value: null };
      }
      case "delete_subagent": {
        const subagentId = String(payload.subagentId ?? "");
        const idx = subagents.findIndex(s => s.id === subagentId);
        if (idx >= 0) subagents.splice(idx, 1);
        delete customSubagentDetails[subagentId];
        return { handled: true, value: null };
      }
      case "list_manageable_subagents": {
        const parent = String(payload.parentAgentType ?? "");
        return {
          handled: true,
          value: subagents.map(sub => ({
            ...sub,
            effectiveEnabled: (sub as Record<string, unknown>)[`enabledFor:${parent}`] !== false,
          })),
        };
      }
      case "update_subagent_config": {
        if (payload.parentAgentType && payload.enabled !== undefined) {
          const target = subagents.find(s => s.id === String(payload.subagentId ?? ""));
          if (target) target[`enabledFor:${String(payload.parentAgentType)}`] = Boolean(payload.enabled);
        }
        const subagentId = String(payload.subagentId ?? "");
        const idx = subagents.findIndex(s => s.id === subagentId);
        if (idx >= 0) {
          subagents[idx] = {
            ...subagents[idx],
            effectiveEnabled: payload.enabled !== undefined ? Boolean(payload.enabled) : subagents[idx].effectiveEnabled,
            model: payload.model !== undefined ? payload.model : subagents[idx].model,
          };
        }
        return { handled: true, value: { availabilityUpdated: true, modelUpdated: true } };
      }
      case "get_skill_configs": {
        if (options.skillConfigsShape === "array") {
          return { handled: true, value: [...skills] };
        }
        return {
          handled: true,
          value: {
            skills: [...skills],
            diagnostics: [
              {
                path: "/tmp/broken-skill",
                sourceId: "codex",
                message: "Missing frontmatter description",
              },
            ],
            importOperationsVersion: 3,
          },
        };
      }
      case "get_global_skill_settings": {
        return {
          handled: true,
          value: {
            globallyDisabledUserSkillKeys: disabledSkills.filter(k => k.startsWith("user::")),
            globallyDisabledProjectSkillKeys: disabledSkills.filter(k => k.startsWith("project::")),
            directSkillManagementVersion: 1,
          },
        };
      }
      case "set_global_skill_disabled": {
        const skillKey = String(payload.skillKey ?? "");
        const disabled = Boolean(payload.disabled);
        disabledSkills = disabled
          ? Array.from(new Set([...disabledSkills, skillKey]))
          : disabledSkills.filter(k => k !== skillKey);
        return {
          handled: true,
          value: {
            globallyDisabledUserSkillKeys: disabledSkills.filter(k => k.startsWith("user::")),
            globallyDisabledProjectSkillKeys: disabledSkills.filter(k => k.startsWith("project::")),
            directSkillManagementVersion: 1,
          },
        };
      }
      case "validate_skill_path": {
        const path = String(payload.path ?? "");
        if (path.includes("invalid")) {
          return { handled: true, value: { valid: false, error: "Directory is missing SKILL.md file" } };
        }
        return {
          handled: true,
          value: { valid: true, name: "my-skill", description: "Validated folder skill." },
        };
      }
      case "add_skill": {
        const sourcePath = String(payload.sourcePath ?? "");
        const level = payload.level === "project" ? "project" : "user";
        const dirName = sourcePath.split("/").filter(Boolean).pop() || "my-skill";
        skills.push({
          key: `${level}::openbitfun::${dirName}`,
          name: dirName,
          description: "Validated folder skill.",
          path: sourcePath,
          level,
          sourceSlot: "openbitfun",
          sourceId: "openbitfun",
          sourceLabel: "OpenBitFun",
          dirName,
          isBuiltin: false,
          isShadowed: false,
        });
        return { handled: true, value: `Skill '${dirName}' added successfully` };
      }
      case "delete_skill": {
        const skillKey = String(payload.skillKey ?? "");
        const idx = skills.findIndex(s => s.key === skillKey);
        if (idx >= 0) skills.splice(idx, 1);
        return { handled: true, value: "Skill deleted successfully" };
      }
      case "list_skill_market": {
        if (options.marketShape === "array") {
          return { handled: true, value: [...marketItems] };
        }
        return {
          handled: true,
          value: {
            skills: [...marketItems],
            sourceErrors: ["PrivateMarket: timeout"],
          },
        };
      }
      case "search_skill_market": {
        const q = String(payload.query ?? "").trim().toLowerCase();
        const filtered = marketItems.filter(item =>
          `${String(item.name)} ${String(item.description)}`.toLowerCase().includes(q),
        );
        if (options.marketShape === "array") {
          return { handled: true, value: filtered };
        }
        return {
          handled: true,
          value: {
            skills: filtered,
            sourceErrors: [],
          },
        };
      }
      case "download_skill_market": {
        const pkg = String(payload.package ?? "");
        const level = payload.level === "project" ? "project" : "user";
        const shortName = pkg.split("@").pop() || "downloaded";
        skills.push({
          key: `${level}::openbitfun::${shortName}`,
          name: shortName,
          description: "Installed from marketplace.",
          path: `/skills/${shortName}`,
          level,
          sourceSlot: "openbitfun",
          sourceId: "openbitfun",
          sourceLabel: "OpenBitFun",
          installationSource: "team/skills",
          dirName: shortName,
          isBuiltin: false,
          isShadowed: false,
        });
        return {
          handled: true,
          value: {
            package: pkg,
            level,
            installedSkills: [shortName],
            output: "Skill downloaded successfully.",
          },
        };
      }
      case "read_file_content": {
        const filePath = String(payload.filePath ?? "");
        if (filePath in fileContents) {
          return { handled: true, value: fileContents[filePath] };
        }
        return { handled: false };
      }
      default:
        return { handled: false };
    }
  }

  const handlers: Record<string, (data: unknown) => unknown> = {
    ...base.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
      const action = args.action ?? "";
      const raw = Object.prototype.hasOwnProperty.call(args, "raw");
      const payload = (raw ? args.raw : args.request) ?? {};
      recorded.push({ action, request: payload, raw });

      if (RAW_ONLY.has(action) && !raw) {
        return { ok: false, error: `${action} must be called via invokeRawCommand (raw: true)` };
      }
      if (REQUEST_ONLY.has(action) && raw) {
        return { ok: false, error: `${action} must be called via invokeCommand (raw: false)` };
      }

      if (action === "account_device_rpc") {
        const rpcPayload = payload as {
          targetDeviceId?: string;
          commandJson?: string;
          target_device_id?: string;
          command_json?: string;
        };
        const envelope = JSON.parse(String(rpcPayload.commandJson ?? rpcPayload.command_json ?? "{}")) as {
          cmd?: string;
          command?: string;
          args?: Record<string, unknown>;
        };
        const innerAction = envelope.command ?? "";
        const innerArgs = (envelope.args ?? {}) as Record<string, unknown>;
        const innerPayload = (innerArgs.request ?? innerArgs) as Record<string, unknown>;
        const custom = handleCustomAction(innerAction, innerPayload);
        if (custom.handled) {
          return {
            ok: true,
            value: JSON.stringify({ resp: "host_invoke_result", ok: true, value: custom.value }),
            transport: "dev",
          };
        }
      }

      try {
        const custom = handleCustomAction(action, payload as Record<string, unknown>);
        if (custom.handled) {
          return { ok: true, value: custom.value, transport: "dev" };
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          transport: "dev",
        };
      }

      return baseInvoke(data);
    },
  };

  return {
    base,
    calls: recorded,
    handlers,
    callFor: (action: string) => recorded.filter(call => call.action === action),
  };
}

test("AgentsScene loads catalog with exact raw flags, filters, and Start Thread switches to Sessions", async () => {
  const mock = createAgentsSkillsBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("Agents");
  await app.waitFor("Agents & Subagents");
  await app.waitFor("Reviewer");
  await app.waitFor("HelperSub");

  expect(mock.callFor("get_available_modes")[0]).toMatchObject({
    raw: false,
    request: { workspaceId: "workspace-1", workspacePath: "/repo" },
  });
  expect(mock.callFor("list_subagents")[0]).toMatchObject({
    raw: false,
    request: { workspaceId: "workspace-1", workspacePath: "/repo" },
  });
  expect(mock.callFor("list_agent_tool_names")[0]).toMatchObject({ raw: true });
  expect(mock.callFor("get_agent_profile_configs")[0]).toMatchObject({ raw: true });

  // SegmentedTabs filtering
  await app.press("agents-tab-subagent");
  await app.waitFor("HelperSub");
  expect(app.texts()).not.toContain("Reviewer");

  await app.press("agents-tab-mode");
  await app.waitFor("Reviewer");
  expect(app.texts()).not.toContain("HelperSub");

  await app.press("agents-tab-all");
  await app.waitFor("HelperSub");

  // Source SelectDropdown filter
  await app.press("agents-source-select");
  await app.press("agent-scope-user");
  await app.waitUntil(() => !app.texts().includes("OpenCode ACP"));
  expect(app.texts()).toContain("Reviewer");
  expect(app.texts()).not.toContain("OpenCode ACP");
  await app.press("agents-source-select");
  await app.press("agent-scope-all");
  await app.waitFor("OpenCode ACP");

  // Search filter
  await app.type("agents-search-input", "OpenCode");
  expect(app.texts()).toContain("OpenCode ACP");
  expect(app.texts()).not.toContain("HelperSub");
  await app.clear("agents-search-input");

  // Start Thread switches to Sessions with the requested mode
  await app.press("agent-start-thread-Reviewer");
  await app.waitFor("How can I help today?");
  await app.press("bot-capsule-trigger");
  await app.waitFor("Agent: Reviewer");
  const createSessionCall = mock.calls.find(call => call.action === "create_session");
  expect(createSessionCall?.request).toMatchObject({
    agentType: "Reviewer",
    workspaceId: "workspace-1",
  });
});

test("AgentsScene creates, edits, deletes custom mode and configures/resets built-in profile", async () => {
  const mock = createAgentsSkillsBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("Agents");
  await app.waitFor("Reviewer");

  // Create custom primary mode
  await app.press("agents-create-bot");
  await app.type("builder-id-input", "architect");
  await app.type("builder-name-input", "Architect");
  await app.type("builder-description-input", "Designs modular systems.");
  await app.type("builder-model-input", "gpt-4.1");
  await app.type("builder-prompt-input", "Write clean architecture plans.");
  await app.press("builder-readonly-toggle");
  await app.press("builder-tools-clear");
  await app.press("builder-tool-Read");
  await app.press("builder-tool-Grep");
  await app.press("builder-save");

  await app.waitFor("Architect");
  const createCall = mock.callFor("create_custom_agent")[0];
  expect(createCall?.raw).toBe(false);
  expect(createCall?.request).toMatchObject({
    kind: "mode",
    level: "user",
    id: "architect",
    name: "Architect",
    description: "Designs modular systems.",
    prompt: "Write clean architecture plans.",
    tools: ["Read", "Grep"],
    readonly: true,
    model: "gpt-4.1",
    workspaceId: "workspace-1",
  });

  // Edit custom mode
  await app.press("agent-configure-architect");
  await app.waitFor("Edit Primary Agent · Architect");
  expect(mock.callFor("get_custom_agent_detail")[0]).toMatchObject({
    raw: false,
    request: { agentId: "architect", workspaceId: "workspace-1" },
  });

  await app.clear("builder-description-input");
  await app.type("builder-description-input", "Updated design specialist.");
  await app.press("builder-save");

  await app.waitFor("Updated design specialist.");
  const updateCall = mock.callFor("update_custom_agent")[0];
  expect(updateCall?.raw).toBe(false);
  expect(updateCall?.request).toMatchObject({
    agentId: "architect",
    name: "Architect",
    description: "Updated design specialist.",
    workspaceId: "workspace-1",
  });

  // Delete custom mode via card action DropdownMenu + Delete ModalDialog
  await app.press("agent-actions-architect");
  await app.press("agent-menu-delete-architect");
  await app.waitFor("Confirm delete");
  await app.press("Confirm delete");

  await app.waitUntil(() => !app.texts().includes("Architect"));
  expect(mock.callFor("delete_custom_agent")[0]).toMatchObject({
    raw: false,
    request: { agentId: "architect", workspaceId: "workspace-1" },
  });

  // Built-in profile tool configuration (raw: true) & reset (raw: true)
  await app.press("agent-configure-Standard");
  await app.waitFor("Configure Profile · Standard");
  // The profile lists the subagents Standard may call; a switch is scoped to Standard.
  await app.waitFor("parent-subagent-Explorer");
  expect(mock.callFor("list_manageable_subagents").at(-1)?.request).toMatchObject({
    parentAgentType: "Standard",
  });
  await app.press("parent-subagent-Explorer");
  await app.waitUntil(() => mock.callFor("update_subagent_config").length > 0);
  expect(mock.callFor("update_subagent_config")[0]?.request).toMatchObject({
    subagentId: "Explorer",
    parentAgentType: "Standard",
    enabled: false,
  });
  await app.press("builder-tool-Bash");
  await app.press("profile-save");

  const setProfileCall = mock.callFor("set_agent_profile_config")[0];
  expect(setProfileCall?.raw).toBe(true);
  expect(setProfileCall?.request).toMatchObject({
    agentId: "Standard",
    config: {
      enabled_tools: ["Read", "Write", "Grep", "Bash"],
    },
  });

  await app.press("profile-reset");
  const resetProfileCall = mock.callFor("reset_agent_profile_config")[0];
  expect(resetProfileCall?.raw).toBe(true);
  expect(resetProfileCall?.request).toMatchObject({ agentId: "Standard" });
  await app.press("agent-builder-close");
});

test("AgentsScene creates, edits, configures, reloads, and deletes subagents", async () => {
  const mock = createAgentsSkillsBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("Agents");
  await app.waitFor("Explorer");

  // Create project subagent
  await app.press("agents-create-bot");
  await app.press("builder-kind-subagent");
  await app.press("builder-level-project");
  await app.type("builder-id-input", "qa-bot");
  await app.type("builder-name-input", "qa-bot");
  await app.type("builder-description-input", "Validates test suites.");
  await app.type("builder-prompt-input", "Check edge cases.");
  await app.press("builder-tool-Bash");
  await app.press("builder-save");

  await app.waitFor("qa-bot");
  const createSub = mock.callFor("create_subagent")[0];
  expect(createSub?.raw).toBe(false);
  expect(createSub?.request).toMatchObject({
    level: "project",
    id: "qa-bot",
    name: "qa-bot",
    description: "Validates test suites.",
    prompt: "Check edge cases.",
    readonly: true,
    workspaceId: "workspace-1",
  });

  // Edit custom subagent
  await app.press("agent-configure-qa-bot");
  await app.waitFor("Edit Subagent · qa-bot");
  expect(mock.callFor("get_subagent_detail")[0]).toMatchObject({
    raw: false,
    request: { subagentId: "qa-bot", workspaceId: "workspace-1" },
  });

  await app.clear("builder-description-input");
  await app.type("builder-description-input", "Runs full regression checks.");
  await app.press("builder-save");

  await app.waitFor("Runs full regression checks.");
  expect(mock.callFor("update_subagent")[0]).toMatchObject({
    raw: false,
    request: {
      subagentId: "qa-bot",
      description: "Runs full regression checks.",
      workspaceId: "workspace-1",
    },
  });

  // Configure built-in subagent enabled/model override
  await app.press("agent-configure-Explorer");
  await app.waitFor("Configure Subagent · Explorer");
  await app.press("subagent-enabled-toggle");
  // Availability is scoped to a parent the user picks; the host never gets a guessed one.
  await app.press("subagent-config-save");
  await app.waitFor("Choose the parent agent this availability applies to.");
  expect(mock.callFor("update_subagent_config").length).toBe(0);
  await app.press("subagent-parent-select");
  await app.press("subagent-parent-Reviewer");
  await app.press("subagent-model-select");
  await app.press("subagent-model-fast");
  await app.press("subagent-config-save");
  await app.waitUntil(() => mock.callFor("update_subagent_config").length > 0);

  const configSub = mock.callFor("update_subagent_config")[0];
  expect(configSub?.raw).toBe(false);
  expect(configSub?.request).toMatchObject({
    subagentId: "Explorer",
    enabled: false,
    parentAgentType: "Reviewer",
  });
  expect((configSub?.request as Record<string, unknown>).model).toBeUndefined();
  // A built-in's model is the desktop's model selection document, not a model string.
  await app.waitUntil(() =>
    mock.base.settingsWrites.some(w => w.path === "ai.agent_model_selections.subagents.builtin.Explorer"),
  );
  expect(
    mock.base.settingsWrites.find(w => w.path === "ai.agent_model_selections.subagents.builtin.Explorer")?.value,
  ).toEqual({ kind: "model", model_ref: "fast" });

  // Clearing the choice removes the override.
  await app.press("subagent-model-select");
  await app.press("subagent-model-default");
  await app.press("subagent-config-save");
  await app.waitUntil(
    () =>
      mock.base.settingsWrites.filter(w => w.path === "ai.agent_model_selections.subagents.builtin.Explorer")
        .length === 2,
  );
  expect(mock.base.settingsWrites.at(-1)?.value).toBe(null);
  await app.press("agent-builder-close");

  // Reload triggers both reload_custom_agents and reload_subagents
  await app.press("agents-reload");
  expect(mock.callFor("reload_custom_agents")[0]).toMatchObject({
    raw: false,
    request: { workspaceId: "workspace-1" },
  });
  expect(mock.callFor("reload_subagents")[0]).toMatchObject({
    raw: false,
    request: { workspaceId: "workspace-1" },
  });

  // Delete custom subagent via DropdownMenu + Delete ModalDialog
  await app.press("agent-actions-qa-bot");
  await app.press("agent-menu-delete-qa-bot");
  await app.waitFor("Confirm delete");
  await app.press("Confirm delete");
  await app.waitUntil(() => !app.texts().includes("qa-bot"));
  expect(mock.callFor("delete_subagent")[0]).toMatchObject({
    raw: false,
    request: { subagentId: "qa-bot", workspaceId: "workspace-1" },
  });
});

test("SkillsScene toggles global disabled, inspects SKILL.md, validates, installs, and deletes skills", async () => {
  const mock = createAgentsSkillsBackend({ includeShadowedSkill: true });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("Skills");
  await app.waitFor("Code Reviewer");
  await app.waitFor("Shadowed · Overridden by user::openbitfun::reviewer");
  await app.waitFor("Discovery Diagnostics");

  expect(mock.callFor("get_skill_configs")[0]).toMatchObject({
    raw: true,
    request: {
      forceRefresh: false,
      includeDiagnostics: true,
      workspaceId: "workspace-1",
      workspacePath: "/repo",
    },
  });
  expect(mock.callFor("get_global_skill_settings")[0]).toMatchObject({
    raw: false,
    request: { workspaceId: "workspace-1", workspacePath: "/repo" },
  });

  // Toggle global disabled
  await app.press("label:skill-toggle-user::openbitfun::reviewer");
  expect(mock.callFor("set_global_skill_disabled")[0]).toMatchObject({
    raw: false,
    request: {
      skillKey: "user::openbitfun::reviewer",
      disabled: true,
      workspaceId: "workspace-1",
      workspacePath: "/repo",
    },
  });

  // Inspect SKILL.md via read_file_content
  await app.press("label:skill-inspect-user::openbitfun::reviewer");
  await app.waitFor("Path: /skills/reviewer");
  await app.waitFor("Inspect diffs for correctness and missing tests.");
  expect(mock.callFor("read_file_content")[0]).toMatchObject({
    raw: false,
    request: {
      workspaceId: "workspace-1",
      filePath: "/skills/reviewer/SKILL.md",
    },
  });
  await app.press("skill-inspect-close");

  // Install from Folder: invalid path -> Validate -> valid path -> Scope -> Install skill
  await app.press("skills-install-folder-toggle");
  await app.type("skill-folder-path-input", "/tmp/invalid-skill");
  await app.press("skill-folder-validate");
  await app.waitFor("Directory is missing SKILL.md file");
  expect(app.enabled("skill-folder-install")).toBe(false);

  await app.clear("skill-folder-path-input");
  await app.type("skill-folder-path-input", "/tmp/my-skill");
  await app.press("skill-folder-validate");
  await app.waitFor("Validated folder skill.");

  expect(mock.callFor("validate_skill_path")[1]).toMatchObject({
    raw: true,
    request: {
      path: "/tmp/my-skill",
      sourceKey: null,
      workspaceId: "workspace-1",
      workspacePath: "/repo",
    },
  });

  await app.press("skill-folder-scope-project");
  await app.press("skill-folder-install");
  await app.waitFor("my-skill");

  expect(mock.callFor("add_skill")[0]).toMatchObject({
    raw: true,
    request: {
      sourcePath: "/tmp/my-skill",
      level: "project",
      workspaceId: "workspace-1",
      workspacePath: "/repo",
      sourceKey: null,
      targetName: null,
      expectedSourceFingerprint: null,
    },
  });

  // Scope SelectDropdown filter
  await app.press("skills-scope-select");
  await app.press("skills-scope-builtin");
  await app.waitUntil(() => !app.texts().includes("Code Reviewer"));
  await app.press("skills-scope-select");
  await app.press("skills-scope-all");
  await app.waitFor("Code Reviewer");

  // Delete installed skill via card DropdownMenu + Delete ModalDialog
  await app.press("label:skill-actions-project::openbitfun::my-skill");
  await app.press("label:skill-menu-delete-project::openbitfun::my-skill");
  await app.waitFor("Confirm delete");
  await app.press("Confirm delete");
  await app.waitUntil(() => !app.texts().includes("my-skill"));

  expect(mock.callFor("delete_skill")[0]).toMatchObject({
    raw: true,
    request: {
      skillKey: "project::openbitfun::my-skill",
      workspaceId: "workspace-1",
      workspacePath: "/repo",
      expectedImportId: null,
    },
  });
});

test("SkillsScene marketplace lists, searches, shows Installed badge, downloads, and degrades on remote/peer", async () => {
  const mock = createAgentsSkillsBackend({ skillConfigsShape: "array", marketShape: "array" });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("Skills");
  await app.waitFor("Code Reviewer");

  // Marketplace list
  await app.press("skills-tab-marketplace");
  await app.waitFor("testing");

  expect(mock.callFor("list_skill_market")[0]).toMatchObject({
    raw: false,
    request: { query: null, limit: 30, includeDiagnostics: false },
  });
  expect(app.texts()).toContain("Installed");

  // Search marketplace
  await app.type("market-search-input", "testing");
  await app.press("market-search-submit");
  expect(mock.callFor("search_skill_market")[0]).toMatchObject({
    raw: false,
    request: { query: "testing", limit: 30, includeDiagnostics: false },
  });

  // Download from marketplace
  await app.press("label:market-install-user-skills-sh:https://skills.sh#team/skills/testing");
  await app.waitFor("Installed 'testing' (user) from marketplace.");

  expect(mock.callFor("download_skill_market")[0]).toMatchObject({
    raw: false,
    request: {
      package: "skills-sh:https://skills.sh#team/skills@testing",
      level: "user",
      workspaceId: "workspace-1",
      workspacePath: "/repo",
    },
  });

  // Switch to remote workspace and verify explicit degradation for local-only folder installs & custom agents
  await app.press("remote-host");
  await app.waitFor("Remote workspace active: installing skills from a local folder path is unsupported.");
  await app.press("skills-install-folder-toggle");
  expect(app.enabled("skill-folder-validate")).toBe(false);
  expect(app.enabled("skill-folder-install")).toBe(false);

  await app.press("Agents");
  await app.waitFor("Remote workspace active: creating, editing, or deleting custom agents is unsupported on remote workspaces. You can still start threads and inspect available bots.");
  expect(app.enabled("agents-create-bot")).toBe(false);
});

test("SkillsScene renders marketplace { skills, sourceErrors } object responses", async () => {
  const mock = createAgentsSkillsBackend({ marketShape: "diagnostics" });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("Skills");
  await app.waitFor("Code Reviewer");

  await app.press("skills-tab-marketplace");
  await app.waitFor("testing");
  await app.waitFor("PrivateMarket: timeout");
});

test("SkillsScene warns and disables local folder installs in Peer Device Mode", async () => {
  const mock = createAgentsSkillsBackend({
    onlineDevices: [{ deviceId: "device-mac" }, { deviceId: "device-linux" }],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("Devices");
  await app.waitFor("builder");
  await app.press("device-use-device-linux");
  await app.waitFor("peer session on device-linux");

  await app.press("Skills");
  await app.waitFor("Peer Device Mode (builder): installing skills from a local folder on this controller machine is unsupported.");
  await app.press("skills-install-folder-toggle");
  expect(app.enabled("skill-folder-validate")).toBe(false);
  expect(app.enabled("skill-folder-install")).toBe(false);
});

test("AgentsScene respects peerSupports('tool_catalog') === false in Peer Device Mode", async () => {
  const mock = createAgentsSkillsBackend({
    onlineDevices: [{ deviceId: "device-mac" }, { deviceId: "device-linux" }],
    peerCapabilities: { tool_catalog: false },
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });

  await app.waitFor("NSH skeleton");
  await app.press("Devices");
  await app.waitFor("builder");
  await app.press("device-use-device-linux");
  await app.waitFor("peer session on device-linux");

  await app.press("Agents");
  await app.waitFor("Peer Device Mode (builder): connected peer does not expose tool_catalog; tool lists are read-only.");
  expect(mock.callFor("list_agent_tool_names")).toHaveLength(0);

  await app.press("agent-configure-Standard");
  await app.waitFor("Connected peer host does not expose the tool catalog.");
});

test("Agents and Skills load the user-level catalogue without a workspace, as the desktop does", async () => {
  const mock = createAgentsSkillsBackend({ openedWorkspaces: [], currentWorkspaceId: null });
  // No recent workspace either, so nothing is reopened at launch.
  const invoke = mock.handlers["openbitfun.invoke"];
  mock.handlers["openbitfun.invoke"] = (data: unknown) =>
    (data as { action?: string })?.action === "get_recent_workspaces"
      ? { ok: true, value: [], transport: "dev" }
      : (data as { action?: string })?.action === "get_workspace_navigator"
        ? { ok: true, value: { opened: [], recent: [], selectedId: null, selection: "none" }, transport: "dev" }
        : invoke(data);
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });
  await app.waitFor("No open workspace yet.");

  await app.press("Agents");
  await app.waitFor("Reviewer");
  const modes = mock.callFor("get_available_modes")[0];
  expect((modes?.request as Record<string, unknown> | undefined)?.workspaceId).toBeUndefined();
  expect(mock.callFor("list_subagents").length).toBeGreaterThan(0);

  await app.press("Skills");
  await app.waitUntil(() => mock.callFor("get_skill_configs").length > 0);
  expect(mock.callFor("get_skill_configs")[0]?.request).toMatchObject({
    workspaceId: null,
    workspacePath: null,
  });

  // Re-entering a scene reads the catalogue again.
  const before = mock.callFor("get_available_modes").length;
  await app.press("Agents");
  await app.waitUntil(() => mock.callFor("get_available_modes").length > before);
});

test("an agent that can load skills lists them and replaces its selection per skill", async () => {
  const mock = createAgentsSkillsBackend();
  let enabled = ["review", "deploy"];
  const replaced: unknown[] = [];
  const invoke = mock.handlers["openbitfun.invoke"];
  mock.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown>; raw?: Record<string, unknown> };
    if (args.action === "get_available_modes") {
      return {
        ok: true,
        value: [
          {
            id: "Standard",
            name: "Standard",
            description: "Balanced default profile.",
            source: "builtin",
            toolCount: 2,
            defaultTools: ["Read", "Skill"],
            configProfileId: "Standard",
          },
        ],
        transport: "dev",
      };
    }
    if (args.action === "get_agent_profile_configs") {
      return { ok: true, value: { Standard: { enabled_tools: ["Read", "Skill"] } }, transport: "dev" };
    }
    if (args.action === "get_mode_skill_configs") {
      expect(args.raw).toMatchObject({ modeId: "Standard" });
      return {
        ok: true,
        value: ["review", "deploy"].map(key => ({
          key,
          name: key,
          description: `${key} skill`,
          effectiveEnabled: enabled.includes(key),
          globallyEnabled: true,
        })),
        transport: "dev",
      };
    }
    if (args.action === "replace_mode_skill_selection") {
      replaced.push(args.request);
      enabled = ((args.request?.enabledSkillKeys ?? []) as string[]).slice();
      return { ok: true, value: "ok", transport: "dev" };
    }
    return invoke(data);
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Agents");
  await app.press("agent-configure-Standard");
  await app.waitFor("mode-skill-deploy");
  await app.press("mode-skill-deploy");
  await app.waitUntil(() => replaced.length === 1);
  expect(replaced[0]).toMatchObject({ modeId: "Standard", enabledSkillKeys: ["review"] });
});

test("Agents and Skills switch to the compact layout at phone width and keep their primary action", async () => {
  const mock = createAgentsSkillsBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });
  await app.waitFor("NSH skeleton");

  await app.press("Agents");
  await app.waitFor("Reviewer");
  const desktopTitle = Number(app.spanStyle("Agents & Subagents").fontSize);

  // At phone width the shell's sidebar is put away, as a phone user would, and the
  // scene reads its own laid-out width to move to the compact layout.
  await app.setViewport(390, 844);
  // The shell folds its sidebar away at phone width (or overlays it); make sure the scene is uncovered.
  if (app.shows("compact-drawer-scrim")) await app.press("compact-drawer-scrim");
  await app.waitUntil(() => Number(app.spanStyle("Agents & Subagents").fontSize) < desktopTitle);
  await app.waitFor("Primary agents");
  expect(app.texts()).toContain("Reviewer");
  expect(app.texts()).toContain("HelperSub");
  await app.press("agents-create-bot");
  await app.waitFor("builder-id-input");
  await app.press("agent-builder-close");
  await app.waitUntil(() => !app.shows("builder-id-input"));

  await app.press("toggle-drawer");
  await app.press("Skills");
  await app.waitFor("Skills & Capabilities");
  if (app.shows("compact-drawer-scrim")) await app.press("compact-drawer-scrim");
  await app.waitFor("Code Reviewer");
  expect(Number(app.spanStyle("Skills & Capabilities").fontSize)).toBeLessThan(desktopTitle);
  await app.press("label:skill-toggle-user::openbitfun::reviewer");
  await app.waitUntil(() => mock.callFor("set_global_skill_disabled").length > 0);
  await app.press("skills-install-folder-toggle");
  await app.waitFor("skill-folder-path-input");
  await app.press("skill-folder-close");
});

test("Agents and Skills follow the host's capability flags instead of their own source rules", async () => {
  const mock = createAgentsSkillsBackend({ skillConfigsShape: "array" });
  const invoke = mock.handlers["openbitfun.invoke"];
  // The host says the custom HelperSub is locked and the reviewer skill cannot be
  // toggled: the wave 4 flags win over the client's old source-based derivation.
  mock.handlers["openbitfun.invoke"] = async (data: unknown) => {
    const result = (await invoke(data)) as { ok?: boolean; value?: unknown };
    const action = (data as { action?: string }).action;
    if (result?.ok && Array.isArray(result.value)) {
      if (action === "list_subagents") {
        result.value = (result.value as Array<Record<string, unknown>>).map(row => ({
          ...row,
          canEdit: false,
          canDelete: false,
        }));
      }
      if (action === "get_skill_configs") {
        result.value = (result.value as Array<Record<string, unknown>>).map(row => ({
          ...row,
          canToggle: row.key !== "user::openbitfun::reviewer",
          canDelete: true,
        }));
      }
    }
    return result;
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: mock.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("Agents");
  await app.waitFor("HelperSub");
  await app.press("agent-actions-HelperSub");
  await app.waitFor("agent-menu-delete-HelperSub");
  expect(app.enabled("agent-menu-delete-HelperSub")).toBe(false);
  await app.keyboard.press("escape");

  await app.press("Skills");
  await app.waitFor("Code Reviewer");
  expect(app.enabled("label:skill-toggle-user::openbitfun::reviewer")).toBe(false);
});
