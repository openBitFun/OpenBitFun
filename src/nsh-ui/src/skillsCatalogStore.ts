// State and backend operations for the Skills & Capabilities Studio.
//
// Wire signatures strictly match `skill_api.rs`:
// - `invokeRawCommand`: `get_skill_configs`, `validate_skill_path`, `add_skill`, `delete_skill`
// - `invokeCommand`: `get_global_skill_settings`, `set_global_skill_disabled`,
//   `list_skill_market`, `search_skill_market`, `download_skill_market`, `read_file_content`

import { computed, signal } from "nsh";
import { invokeCommand, invokeRawCommand } from "./bridge";
import { tr } from "./i18n";
import { currentDeviceScopeKey, isRemotePeerContext } from "./shared/deviceScope";
import { isRemoteWorkspace } from "./shared/workspaceUtils";
import { activeWorkspace, activeWorkspaceId, activeWorkspaceRoot } from "./state";

export type SkillTab = "installed" | "marketplace";
export type SkillScopeFilter = "all" | "builtin" | "user" | "project";
export type SkillScopeLevel = "user" | "project";

export interface SkillRecord {
  key: string;
  name: string;
  description: string;
  path: string;
  entryFile?: string;
  level: SkillScopeLevel;
  sourceSlot: string;
  sourceId: string;
  sourceLabel: string;
  installationSource?: string;
  dirName: string;
  isBuiltin: boolean;
  isShadowed: boolean;
  shadowedByKey?: string;
  argumentHint?: string;
  /** The host's verdict (wave 4); `undefined` on a host that predates the flag. */
  canDelete?: boolean;
  /** The host's verdict (wave 4); `undefined` on a host that predates the flag. */
  canToggle?: boolean;
}

export interface SkillDiagnostic {
  path: string;
  sourceId: string;
  message: string;
  unsupportedField?: string;
}

export interface SkillMarketRecord {
  id: string;
  name: string;
  description: string;
  source: string;
  installs: number;
  url: string;
  installId: string;
  marketName?: string;
}

export interface SkillValidationState {
  valid: boolean;
  name?: string;
  description?: string;
  error?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  openbitfun: "OpenBitFun",
  "openbitfun-system": "OpenBitFun",
  "claude-code": "Claude Code",
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  "agent-skills": ".agents",
  agents: ".agents",
  "deepseek-harness": "DeepSeek Harness",
  dsh: "DeepSeek Harness",
  pi: "PI",
};

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readOptionalString(record: Record<string, unknown>, keys: string[]): string | undefined {
  const value = readString(record, keys);
  return value || undefined;
}

function readBoolean(record: Record<string, unknown>, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return fallback;
}

function readNumber(record: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function readStringList(record: Record<string, unknown>, keys: string[]): string[] {
  const collected: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) collected.push(item.trim());
      }
    }
  }
  return collected;
}

function resolveSourceLabel(sourceLabel: string, sourceId: string, sourceSlot: string): string {
  if (sourceLabel) return sourceLabel;
  const normalizedId = sourceId.trim().toLowerCase().replace(/^(home|config)\./, "");
  if (SOURCE_LABELS[normalizedId]) return SOURCE_LABELS[normalizedId];
  const normalizedSlot = sourceSlot.trim().toLowerCase().replace(/^(home|config)\./, "");
  if (SOURCE_LABELS[normalizedSlot]) return SOURCE_LABELS[normalizedSlot];
  return sourceId || sourceSlot || "OpenBitFun";
}

function normalizeSkillRow(raw: unknown): SkillRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const key = readString(record, ["key"]);
  const name = readString(record, ["name"]) || key;
  if (!key && !name) return null;
  const levelRaw = readString(record, ["level"]).toLowerCase();
  const level: SkillScopeLevel = levelRaw === "project" ? "project" : "user";
  const sourceSlot = readString(record, ["sourceSlot", "source_slot"]);
  const sourceId = readString(record, ["sourceId", "source_id"]);
  const rawLabel = readString(record, ["sourceLabel", "source_label"]);
  return {
    key: key || `${level}::${name}`,
    name,
    description: readString(record, ["description"]),
    path: readString(record, ["path"]),
    entryFile: readOptionalString(record, ["entryFile", "entry_file"]),
    level,
    sourceSlot,
    sourceId,
    sourceLabel: resolveSourceLabel(rawLabel, sourceId, sourceSlot),
    installationSource: readOptionalString(record, ["installationSource", "installation_source"]),
    dirName: readString(record, ["dirName", "dir_name"]),
    isBuiltin: readBoolean(record, ["isBuiltin", "is_builtin"], false),
    isShadowed: readBoolean(record, ["isShadowed", "is_shadowed"], false),
    shadowedByKey: readOptionalString(record, ["shadowedByKey", "shadowed_by_key"]),
    argumentHint: readOptionalString(record, ["argumentHint", "argument_hint"]),
    canDelete: typeof record.canDelete === "boolean" ? record.canDelete : undefined,
    canToggle: typeof record.canToggle === "boolean" ? record.canToggle : undefined,
  };
}

function normalizeDiagnosticRow(raw: unknown): SkillDiagnostic | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const message = readString(record, ["message"]);
  if (!message) return null;
  return {
    path: readString(record, ["path"]),
    sourceId: readString(record, ["sourceId", "source_id"]),
    message,
    unsupportedField: readOptionalString(record, ["unsupportedField", "unsupported_field"]),
  };
}

function normalizeMarketRow(raw: unknown): SkillMarketRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = readString(record, ["id", "installId", "install_id"]);
  const name = readString(record, ["name"]) || id;
  const installId = readString(record, ["installId", "install_id"]) || id;
  if (!id && !name) return null;
  return {
    id: id || name,
    name,
    description: readString(record, ["description"]),
    source: readString(record, ["source"]),
    installs: readNumber(record, ["installs"], 0),
    url: readString(record, ["url"]),
    installId,
    marketName: readOptionalString(record, ["marketName", "market_name"]),
  };
}

function repositoryKey(source: string): string {
  return source
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function installationKey(source: string, name: string): string {
  return `${repositoryKey(source)}@${name.trim().toLowerCase()}`;
}

export const skillsTab = signal<SkillTab>("installed");
export const skillScopeFilter = signal<SkillScopeFilter>("all");
export const skillSearchQuery = signal("");
export const skillsLoading = signal(false);
export const skillsError = signal<string | null>(null);
export const skillsNotice = signal<string | null>(null);
export const installedSkills = signal<SkillRecord[]>([]);
export const skillDiagnostics = signal<SkillDiagnostic[]>([]);
export const disabledSkillKeys = signal<string[]>([]);
export const directSkillManagementSupported = signal(true);
export const togglingSkillKey = signal<string | null>(null);
export const confirmDeleteSkillKey = signal<string | null>(null);
export const skillsLoadedKey = signal<string | null>(null);

export const inspectedSkillKey = signal<string | null>(null);
export const inspectedSkillContent = signal<string | null>(null);
export const inspectedSkillLoading = signal(false);
export const inspectedSkillError = signal<string | null>(null);

export const installDrawerOpen = signal(false);
export const folderPathInput = signal("");
export const folderLevel = signal<SkillScopeLevel>("user");
export const validatingFolder = signal(false);
export const addingFolderSkill = signal(false);
export const folderValidation = signal<SkillValidationState | null>(null);
export const folderInstallError = signal<string | null>(null);

export const marketSearchQuery = signal("");
export const marketLoading = signal(false);
export const marketError = signal<string | null>(null);
export const marketSourceErrors = signal<string[]>([]);
export const marketSkills = signal<SkillMarketRecord[]>([]);
export const marketLoadedKey = signal<string | null>(null);
export const downloadingPackage = signal<string | null>(null);
export const recentlyInstalledPackages = signal<string[]>([]);

export const inspectedSkill = computed<SkillRecord | null>(
  () => installedSkills().find(item => item.key === inspectedSkillKey()) ?? null,
);

export const pendingDeleteSkill = computed<SkillRecord | null>(
  () => installedSkills().find(item => item.key === confirmDeleteSkillKey()) ?? null,
);

export const filteredInstalledSkills = computed<SkillRecord[]>(() => {
  const scope = skillScopeFilter();
  const query = skillSearchQuery().trim().toLowerCase();
  return installedSkills().filter(skill => {
    if (scope === "builtin" && !skill.isBuiltin) return false;
    if (scope === "user" && (skill.isBuiltin || skill.level !== "user")) return false;
    if (scope === "project" && (skill.isBuiltin || skill.level !== "project")) return false;
    if (!query) return true;
    const haystack = `${skill.name} ${skill.key} ${skill.description} ${skill.sourceLabel} ${skill.path}`.toLowerCase();
    return haystack.includes(query);
  });
});

export const folderInstallUnsupportedReason = computed<string | null>(() => {
  if (isRemoteWorkspace(activeWorkspace())) {
    return tr("skills.folderInstallRemoteWorkspace");
  }
  if (isRemotePeerContext()) {
    return tr("skills.folderInstallDesktopOnly");
  }
  return null;
});

export const installedMarketIds = computed<Set<string>>(() => {
  const ids = new Set<string>(recentlyInstalledPackages());
  for (const skill of installedSkills()) {
    const src = skill.installationSource?.trim();
    if (!src) continue;
    if (src.startsWith("skillhub:")) {
      ids.add(src);
    } else {
      ids.add(installationKey(src, skill.name));
    }
  }
  return ids;
});

export function isMarketItemInstalled(item: SkillMarketRecord): boolean {
  const installed = installedMarketIds();
  if (installed.has(item.installId) || installed.has(item.id)) return true;
  if (item.installId.startsWith("skillhub:")) return installed.has(item.installId);
  const hashIndex = item.installId.indexOf("#");
  const cleanId = item.installId.startsWith("skills-sh:") && hashIndex >= 0
    ? item.installId.slice(hashIndex + 1)
    : item.installId;
  const separator = cleanId.lastIndexOf("@");
  if (separator > 0) {
    return installed.has(installationKey(cleanId.slice(0, separator), cleanId.slice(separator + 1)));
  }
  return Boolean(item.source.trim()) && installed.has(installationKey(item.source, item.name));
}

export function isSkillDisabled(skillKey: string): boolean {
  return disabledSkillKeys().includes(skillKey);
}

export function canDeleteInstalledSkill(skill: SkillRecord): boolean {
  if (skill.canDelete !== undefined) return skill.canDelete;
  // Compatibility read for a host (or CLI peer) older than the `canDelete` flag:
  // the same ownership rule its `delete_skill` enforces.
  if (skill.isBuiltin) return false;
  const sourceId = skill.sourceId.trim().toLowerCase();
  if (sourceId) {
    return sourceId === "openbitfun" || sourceId === "openbitfun-system";
  }
  const sourceSlot = skill.sourceSlot.trim().toLowerCase();
  if (sourceSlot) {
    return sourceSlot.startsWith("openbitfun");
  }
  return true;
}

export function canToggleInstalledSkill(skill: SkillRecord): boolean {
  if (!directSkillManagementSupported()) return false;
  if (skill.canToggle !== undefined) return skill.canToggle;
  // Compatibility read for a host older than the `canToggle` flag.
  return !(isRemoteWorkspace(activeWorkspace()) && skill.level === "project");
}

let skillsLoadTicket = 0;
let inspectTicket = 0;
let marketLoadTicket = 0;

function extractDisabledKeys(settings: Record<string, unknown> | null | undefined): string[] {
  if (!settings || typeof settings !== "object") return [];
  return Array.from(
    new Set(
      readStringList(settings, [
        "disabledSkills",
        "disabled_skills",
        "globallyDisabledUserSkillKeys",
        "globallyDisabledProjectSkillKeys",
        "globally_disabled_user_skill_keys",
        "globally_disabled_project_skill_keys",
      ]),
    ),
  );
}

export async function loadSkillsCatalog(forceRefresh = false, contextKey?: string): Promise<void> {
  const ticket = ++skillsLoadTicket;
  const workspace = activeWorkspace();
  const workspaceId = workspace?.id ?? activeWorkspaceId() ?? null;
  const workspacePath = workspace?.rootPath || activeWorkspaceRoot() || null;
  const isRemote = isRemoteWorkspace(workspace);
  const key = contextKey ?? `${currentDeviceScopeKey()}:${workspaceId ?? "none"}:${workspacePath ?? ""}`;

  skillsLoading.set(true);
  skillsError.set(null);
  confirmDeleteSkillKey.set(null);

  const [configsRes, settingsRes] = await Promise.allSettled([
    invokeRawCommand<unknown>("get_skill_configs", {
      forceRefresh,
      includeDiagnostics: true,
      workspaceId: workspaceId ?? null,
      workspacePath: workspacePath ?? null,
    }),
    invokeCommand<Record<string, unknown>>(
      "get_global_skill_settings",
      workspaceId && !isRemote ? { workspaceId, workspacePath } : {},
    ),
  ]);

  if (ticket !== skillsLoadTicket) return;

  if (configsRes.status === "fulfilled") {
    const raw = configsRes.value;
    if (Array.isArray(raw)) {
      installedSkills.set(
        raw.map(normalizeSkillRow).filter((item): item is SkillRecord => item !== null),
      );
      skillDiagnostics.set([]);
    } else if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const rawSkills = Array.isArray(obj.skills) ? obj.skills : [];
      const rawDiagnostics = Array.isArray(obj.diagnostics) ? obj.diagnostics : [];
      installedSkills.set(
        rawSkills.map(normalizeSkillRow).filter((item): item is SkillRecord => item !== null),
      );
      skillDiagnostics.set(
        rawDiagnostics.map(normalizeDiagnosticRow).filter((item): item is SkillDiagnostic => item !== null),
      );
    } else {
      installedSkills.set([]);
      skillDiagnostics.set([]);
    }
  } else {
    installedSkills.set([]);
    skillDiagnostics.set([]);
    skillsError.set(
      configsRes.reason instanceof Error ? configsRes.reason.message : String(configsRes.reason),
    );
  }

  if (settingsRes.status === "fulfilled") {
    const rawSettings = settingsRes.value;
    disabledSkillKeys.set(extractDisabledKeys(rawSettings));
    const version = rawSettings?.directSkillManagementVersion;
    directSkillManagementSupported.set(version !== 0);
  } else {
    disabledSkillKeys.set([]);
    directSkillManagementSupported.set(false);
  }

  skillsLoadedKey.set(key);
  skillsLoading.set(false);
}

export async function toggleSkillGlobalDisabled(skill: SkillRecord, nextEnabled: boolean): Promise<void> {
  if (!canToggleInstalledSkill(skill)) return;
  const workspace = activeWorkspace();
  const workspaceId = workspace?.id ?? activeWorkspaceId() ?? undefined;
  const workspacePath = workspace?.rootPath || activeWorkspaceRoot() || undefined;
  const disabled = !nextEnabled;

  togglingSkillKey.set(skill.key);
  skillsNotice.set(null);
  try {
    const response = await invokeCommand<Record<string, unknown> | null>("set_global_skill_disabled", {
      skillKey: skill.key,
      disabled,
      ...(workspaceId ? { workspaceId, workspacePath } : {}),
    });
    if (response && typeof response === "object" && (
      Array.isArray(response.disabledSkills)
      || Array.isArray(response.disabled_skills)
      || Array.isArray(response.globallyDisabledUserSkillKeys)
      || Array.isArray(response.globallyDisabledProjectSkillKeys)
      || Array.isArray(response.globally_disabled_user_skill_keys)
      || Array.isArray(response.globally_disabled_project_skill_keys)
    )) {
      disabledSkillKeys.set(extractDisabledKeys(response));
    } else {
      disabledSkillKeys.update(current => {
        const set = new Set(current);
        if (disabled) set.add(skill.key);
        else set.delete(skill.key);
        return Array.from(set);
      });
    }
    skillsNotice.set(
      disabled
        ? tr("skills.store.disabled", { name: skill.name })
        : tr("skills.store.enabled", { name: skill.name }),
    );
  } catch (error) {
    skillsNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    togglingSkillKey.set(null);
  }
}

export function closeSkillInspector(): void {
  inspectedSkillKey.set(null);
  inspectedSkillContent.set(null);
  inspectedSkillLoading.set(false);
  inspectedSkillError.set(null);
}

export async function inspectSkill(skill: SkillRecord): Promise<void> {
  const ticket = ++inspectTicket;
  inspectedSkillKey.set(skill.key);
  inspectedSkillContent.set(null);
  inspectedSkillError.set(null);

  if (!skill.path.trim()) {
    inspectedSkillLoading.set(false);
    inspectedSkillError.set(tr("skills.store.pathUnavailable"));
    return;
  }

  const basePath = skill.path.replace(/\/+$/, "");
  const skillMdPath = `${basePath}/SKILL.md`;
  const workspaceId = activeWorkspaceId();

  inspectedSkillLoading.set(true);
  try {
    const content = await invokeCommand<string>("read_file_content", {
      ...(workspaceId ? { workspaceId } : {}),
      filePath: skillMdPath,
    });
    if (ticket !== inspectTicket) return;
    inspectedSkillContent.set(typeof content === "string" ? content : String(content ?? ""));
  } catch (error) {
    if (ticket !== inspectTicket) return;
    inspectedSkillError.set(error instanceof Error ? error.message : String(error));
  } finally {
    if (ticket === inspectTicket) {
      inspectedSkillLoading.set(false);
    }
  }
}

export async function removeInstalledSkill(skill: SkillRecord): Promise<void> {
  if (!canDeleteInstalledSkill(skill)) return;
  const workspace = activeWorkspace();
  const workspaceId = workspace?.id ?? activeWorkspaceId() ?? null;
  const workspacePath = workspace?.rootPath || activeWorkspaceRoot() || null;

  skillsNotice.set(null);
  try {
    await invokeRawCommand<string>("delete_skill", {
      skillKey: skill.key,
      workspaceId: workspaceId ?? null,
      workspacePath: workspacePath ?? null,
      expectedImportId: null,
    });
    confirmDeleteSkillKey.set(null);
    if (inspectedSkillKey() === skill.key) {
      closeSkillInspector();
    }
    skillsNotice.set(tr("skills.store.deleted", { name: skill.name }));
    await loadSkillsCatalog(true);
  } catch (error) {
    skillsNotice.set(error instanceof Error ? error.message : String(error));
  }
}

export function setFolderPathValue(path: string): void {
  folderPathInput.set(path);
  folderValidation.set(null);
  folderInstallError.set(null);
}

export async function validateFolderSkillPath(): Promise<void> {
  if (folderInstallUnsupportedReason()) {
    folderInstallError.set(folderInstallUnsupportedReason());
    return;
  }
  const path = folderPathInput().trim();
  if (!path) {
    folderInstallError.set(tr("skills.store.enterFolderWithSkill"));
    return;
  }
  const workspace = activeWorkspace();
  const workspaceId = workspace?.id ?? activeWorkspaceId() ?? null;
  const workspacePath = workspace?.rootPath || activeWorkspaceRoot() || null;

  validatingFolder.set(true);
  folderInstallError.set(null);
  try {
    const result = await invokeRawCommand<{
      valid: boolean;
      name?: string;
      description?: string;
      error?: string;
    }>("validate_skill_path", {
      path,
      sourceKey: null,
      workspaceId: workspaceId ?? null,
      workspacePath: workspacePath ?? null,
    });
    folderValidation.set({
      valid: Boolean(result?.valid),
      name: result?.name,
      description: result?.description,
      error: result?.error,
    });
  } catch (error) {
    folderValidation.set({
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    validatingFolder.set(false);
  }
}

export async function installFolderSkill(): Promise<void> {
  if (folderInstallUnsupportedReason()) {
    folderInstallError.set(folderInstallUnsupportedReason());
    return;
  }
  const sourcePath = folderPathInput().trim();
  if (!sourcePath) {
    folderInstallError.set(tr("skills.store.enterFolderFirst"));
    return;
  }
  const level = folderLevel();
  const workspace = activeWorkspace();
  const workspaceId = workspace?.id ?? activeWorkspaceId() ?? null;
  const workspacePath = workspace?.rootPath || activeWorkspaceRoot() || null;

  if (level === "project" && !workspaceId) {
    folderInstallError.set(tr("skills.store.projectNeedsWorkspace"));
    return;
  }

  addingFolderSkill.set(true);
  folderInstallError.set(null);
  try {
    await invokeRawCommand<string>("add_skill", {
      sourcePath,
      level,
      workspaceId: workspaceId ?? null,
      workspacePath: workspacePath ?? null,
      sourceKey: null,
      targetName: null,
      expectedSourceFingerprint: null,
    });
    const addedName = folderValidation()?.name || sourcePath;
    folderPathInput.set("");
    folderValidation.set(null);
    installDrawerOpen.set(false);
    skillsNotice.set(tr("skills.store.installed", { name: addedName, level }));
    await loadSkillsCatalog(true);
  } catch (error) {
    folderInstallError.set(error instanceof Error ? error.message : String(error));
  } finally {
    addingFolderSkill.set(false);
  }
}

function normalizeMarketResponse(raw: unknown): { skills: SkillMarketRecord[]; sourceErrors: string[] } {
  if (Array.isArray(raw)) {
    return {
      skills: raw.map(normalizeMarketRow).filter((item): item is SkillMarketRecord => item !== null),
      sourceErrors: [],
    };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const rawSkills = Array.isArray(obj.skills) ? obj.skills : [];
    const rawErrors = readStringList(obj, ["sourceErrors", "source_errors"]);
    return {
      skills: rawSkills.map(normalizeMarketRow).filter((item): item is SkillMarketRecord => item !== null),
      sourceErrors: rawErrors,
    };
  }
  return { skills: [], sourceErrors: [] };
}

export async function loadSkillMarketCatalog(query?: string): Promise<void> {
  const ticket = ++marketLoadTicket;
  const trimmed = (query ?? marketSearchQuery()).trim();
  marketLoading.set(true);
  marketError.set(null);
  marketSourceErrors.set([]);

  try {
    const raw = trimmed
      ? await invokeCommand<unknown>("search_skill_market", {
          query: trimmed,
          limit: 30,
          includeDiagnostics: false,
        })
      : await invokeCommand<unknown>("list_skill_market", {
          query: null,
          limit: 30,
          includeDiagnostics: false,
        });
    if (ticket !== marketLoadTicket) return;
    const normalized = normalizeMarketResponse(raw);
    marketSkills.set(normalized.skills);
    marketSourceErrors.set(normalized.sourceErrors);
    marketLoadedKey.set(`${trimmed}:local`);
  } catch (error) {
    if (ticket !== marketLoadTicket) return;
    marketSkills.set([]);
    marketError.set(error instanceof Error ? error.message : String(error));
  } finally {
    if (ticket === marketLoadTicket) {
      marketLoading.set(false);
    }
  }
}

export async function installMarketSkill(
  item: SkillMarketRecord,
  level: SkillScopeLevel,
): Promise<void> {
  const workspace = activeWorkspace();
  const workspaceId = workspace?.id ?? activeWorkspaceId() ?? undefined;
  const workspacePath = workspace?.rootPath || activeWorkspaceRoot() || undefined;

  if (level === "project" && !workspaceId) {
    skillsNotice.set(tr("skills.store.openWorkspaceFirst"));
    return;
  }
  if (level === "project" && workspace?.workspaceKind === "remote") {
    skillsNotice.set(tr("skills.store.remoteProjectUnsupported"));
    return;
  }

  const pkg = item.installId || item.id;
  downloadingPackage.set(pkg);
  skillsNotice.set(null);
  marketError.set(null);
  try {
    await invokeCommand<unknown>("download_skill_market", {
      package: pkg,
      level,
      ...(workspaceId ? { workspaceId, workspacePath } : {}),
    });
    recentlyInstalledPackages.update(current =>
      current.includes(pkg) ? current : [...current, pkg],
    );
    skillsNotice.set(tr("skills.store.marketInstalled", { name: item.name, level }));
    await loadSkillsCatalog(true);
  } catch (error) {
    marketError.set(error instanceof Error ? error.message : String(error));
  } finally {
    downloadingPackage.set(null);
  }
}
