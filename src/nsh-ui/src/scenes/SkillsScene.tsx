import { computed, effect, lifecycle, openUrl, Scroll, signal, Text, untracked, View, type ViewRef } from "nsh";
import { revealPath } from "../fileStore";
import { formatCount, formatPlural } from "../format";
import { localizeHostError, tr } from "../i18n";
import { dirnameOfPath, isRemoteWorkspace, resolveWorkspaceMarkdownLink } from "../shared/workspaceUtils";
import { navigateScene } from "../state";
import {
  addingFolderSkill,
  canDeleteInstalledSkill,
  canToggleInstalledSkill,
  closeSkillInspector,
  confirmDeleteSkillKey,
  directSkillManagementSupported,
  downloadingPackage,
  filteredInstalledSkills,
  folderInstallError,
  folderInstallUnsupportedReason,
  folderLevel,
  folderPathInput,
  folderValidation,
  inspectSkill,
  inspectedSkill,
  inspectedSkillContent,
  inspectedSkillError,
  inspectedSkillKey,
  inspectedSkillLoading,
  installDrawerOpen,
  installFolderSkill,
  installMarketSkill,
  installedSkills,
  isMarketItemInstalled,
  isSkillDisabled,
  loadSkillMarketCatalog,
  loadSkillsCatalog,
  marketError,
  marketLoadedKey,
  marketLoading,
  marketSearchQuery,
  marketSkills,
  marketSourceErrors,
  pendingDeleteSkill,
  removeInstalledSkill,
  setFolderPathValue,
  skillDiagnostics,
  skillScopeFilter,
  skillSearchQuery,
  skillsError,
  skillsLoadedKey,
  skillsLoading,
  skillsNotice,
  skillsTab,
  toggleSkillGlobalDisabled,
  togglingSkillKey,
  validateFolderSkillPath,
  validatingFolder,
  type SkillMarketRecord,
  type SkillRecord,
  type SkillScopeFilter,
} from "../skillsCatalogStore";
import { activeWorkspace, activeWorkspaceId, deviceContext } from "../state";
import {
  compactLayout,
  fontMono,
  layout,
  palette,
  radii,
  space,
  textLineHeight,
  textSize,
  textTracking,
  touchSlop,
} from "../theme";
import { LibraryToolbar, libraryBodyStyle } from "./LibraryChrome";
import { stateColor } from "../ui/fleet";
import { Icon, type IconName } from "../ui/icons";
import { MarkdownPreview } from "../ui/markdownEditor";
import {
  GallerySkeleton,
  InsetGroup,
  MoreMenu,
  STUDIO_SECTION_GAP,
  STUDIO_TOUCH_MIN,
  StudioBody,
  StudioEmpty,
  StudioHeader,
  StudioSection,
  StudioToolbar,
  studioCompact,
  trackStudioWidth,
} from "../ui/studio";
import { MOTION_DURATION, paintTransition, pressTransition, Spinner, tactileActiveStyle } from "../ui/motion";
import { DropdownMenu, ModalDialog, type SelectDropdownOption } from "../ui/overlays";
import {
  Button,
  ConfigRow,
  ConfigSection,
  focusRingStyle,
  IconButton,
  InlineBanner,
  InputBox,
  SearchInput,
  SegmentedTabs,
  ToggleSwitch,
} from "../ui/primitives";

function scopeOptions(): ReadonlyArray<SelectDropdownOption<SkillScopeFilter>> {
  return [
    { value: "all", label: tr("skills.allScopes"), accessibilityLabel: "skills-scope-all" },
    { value: "builtin", label: tr("common.builtin"), accessibilityLabel: "skills-scope-builtin" },
    { value: "user", label: tr("common.user"), accessibilityLabel: "skills-scope-user" },
    { value: "project", label: tr("common.project"), accessibilityLabel: "skills-scope-project" },
  ];
}

const hasActiveInstalledFilter = computed(
  () => skillScopeFilter() !== "all" || skillSearchQuery().trim().length > 0,
);

function resetInstalledFilters(): void {
  skillScopeFilter.set("all");
  skillSearchQuery.set("");
}

function skillScopeTag(skill: SkillRecord): string {
  if (skill.isBuiltin) return tr("skills.scopeBuiltin");
  return skill.level === "project" ? tr("common.project") : tr("common.user");
}

function normalizeTagToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

/**
 * Returns the skill's source label only when it adds information distinct from
 * the scope badge (eliminating duplicate `[Built-in] Built-in` metadata on
 * built-in skills like `research-synthesis`).
 */
function distinctSkillSourceLabel(skill: SkillRecord): string {
  const raw = (skill.sourceLabel || "").trim();
  if (!raw) return "";
  const rawNorm = normalizeTagToken(raw);
  const scopeNorm = normalizeTagToken(skillScopeTag(skill));
  if (rawNorm === scopeNorm) return "";
  if (
    skill.isBuiltin &&
    (rawNorm === "builtin"
      || rawNorm === normalizeTagToken(tr("skills.scopeBuiltin"))
      || rawNorm === normalizeTagToken(tr("common.builtin")))
  ) {
    return "";
  }
  return raw;
}

function inspectSubtitle(skill: SkillRecord | null): string | undefined {
  if (!skill) return undefined;
  const parts = [skillScopeTag(skill), distinctSkillSourceLabel(skill)].filter(Boolean);
  return parts.join(" · ");
}

function semanticSkillIcon(text: string, fallback: IconName): IconName {
  const lower = text.toLowerCase();
  if (lower.includes("review") || lower.includes("pr") || lower.includes("diff")) return "git-pull-request";
  if (lower.includes("git") || lower.includes("branch") || lower.includes("commit")) return "git-branch";
  if (lower.includes("test") || lower.includes("qa") || lower.includes("check")) return "check-square";
  if (lower.includes("security") || lower.includes("auth") || lower.includes("audit")) return "shield";
  if (lower.includes("sql") || lower.includes("db") || lower.includes("data")) return "database";
  if (lower.includes("shell") || lower.includes("cli") || lower.includes("terminal")) return "terminal";
  if (lower.includes("design") || lower.includes("ui") || lower.includes("theme") || lower.includes("css")) {
    return "palette";
  }
  if (lower.includes("doc") || lower.includes("guide") || lower.includes("write") || lower.includes("note")) {
    return "file-text";
  }
  if (lower.includes("code") || lower.includes("rust") || lower.includes("ts") || lower.includes("python")) {
    return "file-code";
  }
  if (lower.includes("deploy") || lower.includes("cloud") || lower.includes("docker")) return "cloud";
  if (lower.includes("perf") || lower.includes("fast") || lower.includes("speed")) return "zap";
  return fallback;
}

function marketMetadataLine(item: SkillMarketRecord): string {
  const parts: string[] = [];
  parts.push(item.source || item.id);
  if (item.marketName) parts.push(item.marketName);
  if (item.installs > 0) {
    parts.push(formatPlural(item.installs, "skills.installsOne", "skills.installsOther"));
  }
  return parts.join(" · ");
}

function projectScopeUnavailableReason(): string | null {
  if (!activeWorkspaceId()) return tr("skills.projectScopeNoWorkspace");
  if (activeWorkspace()?.workspaceKind === "remote") {
    return tr("skills.projectScopeRemote");
  }
  return null;
}

function FolderInstallModal() {
  const projectDisabledReason = () => projectScopeUnavailableReason();

  return (
    <ModalDialog
      open={installDrawerOpen()}
      title={tr("skills.installModalTitle")}
      subtitle={tr("skills.installModalSubtitle")}
      size="md"
      accessibilityLabel="skills-folder-install-dialog"
      onClose={() => installDrawerOpen.set(false)}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button
            label={tr("common.cancel")}
            variant="secondary"
            size="md"
            accessibilityLabel="skill-folder-close"
            onPress={() => installDrawerOpen.set(false)}
          />
          <Button
            label={addingFolderSkill() ? tr("common.installing") : tr("skills.installSkill")}
            variant="primary"
            size="md"
            loading={addingFolderSkill()}
            disabled={
              Boolean(folderInstallUnsupportedReason())
              || addingFolderSkill()
              || !folderPathInput().trim()
              || folderValidation()?.valid !== true
            }
            tooltip={
              !folderInstallUnsupportedReason() && folderPathInput().trim() && folderValidation()?.valid !== true
                ? tr("skills.validateBeforeInstall")
                : undefined
            }
            accessibilityLabel="skill-folder-install"
            onPress={() => void installFolderSkill()}
          />
        </View>
      }
    >
      <View style={{ gap: space.lg }}>
        <If when={folderInstallUnsupportedReason() ?? ""}>
          {reason => <InlineBanner tone="warning" message={reason()} />}
        </If>

        <ConfigSection
          title={tr("skills.folderSource")}
          subtitle={tr("skills.folderSourceHint")}
        >
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
              <InputBox
                size="md"
                value={folderPathInput()}
                placeholder={tr("skills.folderPlaceholder")}
                leadingIcon="folder-open"
                monospace
                readonly={Boolean(folderInstallUnsupportedReason())}
                accessibilityLabel="skill-folder-path-input"
                style={{ flex: 1, minWidth: 160 }}
                onChange={val => setFolderPathValue(val)}
                onSubmit={() => void validateFolderSkillPath()}
              />
              <Button
                label={validatingFolder() ? tr("common.validating") : tr("skills.validate")}
                variant="secondary"
                size="md"
                loading={validatingFolder()}
                disabled={
                  Boolean(folderInstallUnsupportedReason())
                  || validatingFolder()
                  || !folderPathInput().trim()
                }
                accessibilityLabel="skill-folder-validate"
                style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                onPress={() => void validateFolderSkillPath()}
              />
            </View>

            <If when={folderValidation()}>
              {validation => (
                <View style={{ gap: space.xs, paddingHorizontal: space.hair }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0 }}>
                    <Icon
                      name={validation().valid ? "check-circle" : "warning"}
                      size={14}
                      color={validation().valid ? palette().textSecondary : stateColor("failed")}
                    />
                    <Text
                      style={{
                        flexShrink: 0,
                        color: validation().valid ? palette().textSecondary : stateColor("failed"),
                        fontSize: textSize(13),
                        fontWeight: "500",
                        lineHeight: textLineHeight(13, 1.4),
                      }}
                    >
                      {validation().valid ? tr("common.valid") : tr("common.invalid")}
                    </Text>
                    <If when={validation().name ?? ""}>
                      {name => (
                        <Text
                          style={{
                            flex: 1,
                            minWidth: 0,
                            color: palette().text,
                            fontSize: textSize(13),
                            fontWeight: "600",
                            lineHeight: textLineHeight(13, 1.4),
                            numberOfLines: 1,
                            textOverflow: "ellipsis",
                          }}
                        >
                          {name()}
                        </Text>
                      )}
                    </If>
                  </View>
                  <If when={validation().description ?? ""}>
                    {desc => (
                      <Text
                        style={{
                          minWidth: 0,
                          color: palette().textSecondary,
                          fontSize: textSize(12),
                          lineHeight: textLineHeight(12, 1.45),
                        }}
                      >
                        {desc()}
                      </Text>
                    )}
                  </If>
                  <If when={validation().error ?? ""}>
                    {err => (
                      <Text
                        style={{
                          minWidth: 0,
                          color: stateColor("failed"),
                          fontSize: textSize(12),
                          lineHeight: textLineHeight(12, 1.45),
                        }}
                      >
                        {localizeHostError(err())}
                      </Text>
                    )}
                  </If>
                </View>
              )}
            </If>

            <If when={folderInstallError() ?? ""}>
              {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
            </If>
          </View>
        </ConfigSection>

        <ConfigSection
          title={tr("skills.installScope")}
          flush
          controlWidth={compactLayout() ? undefined : 200}
        >
          <ConfigRow
            label={tr("skills.targetScope")}
            description={
              projectDisabledReason()
                ?? tr("skills.targetScopeHint")
            }
            divider={false}
          >
            <SegmentedTabs
              size="sm"
              options={
                projectDisabledReason()
                  ? [
                      { value: "user", label: tr("common.user"), accessibilityLabel: "skill-folder-scope-user" },
                    ]
                  : [
                      { value: "user", label: tr("common.user"), accessibilityLabel: "skill-folder-scope-user" },
                      { value: "project", label: tr("common.project"), accessibilityLabel: "skill-folder-scope-project" },
                    ]
              }
              value={projectDisabledReason() ? "user" : folderLevel()}
              onChange={next => folderLevel.set(next)}
            />
          </ConfigRow>
        </ConfigSection>
      </View>
    </ModalDialog>
  );
}

/** The hairline between two rows of an inset group, inset to the text column. */
function RowSeparator(props: { inset: number }) {
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: props.inset,
        right: 0,
        height: 1,
        backgroundColor: palette().borderSubtle,
        pointerEvents: "none",
      }}
    />
  );
}

/** One installed skill: the pressable text column opens SKILL.md; the switch and "…" sit beside it. */
function InstalledSkillRow(props: { skill: SkillRecord; first: boolean }) {
  const isInspected = () => inspectedSkillKey() === props.skill.key;
  const isEnabled = () => !isSkillDisabled(props.skill.key);
  const distinctSource = () => distinctSkillSourceLabel(props.skill);

  return (
    <View
      style={{
        position: "relative",
        minHeight: compactLayout() ? layout.touchTarget : STUDIO_TOUCH_MIN,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingRight: space.md,
        minWidth: 0,
        backgroundColor: isInspected() ? palette().panelHover : "transparent",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
    >
      <If when={!props.first}>
        <RowSeparator inset={layout.touchTarget} />
      </If>
      <View
        role="button"
        accessibilityLabel={`skill-inspect-${props.skill.key}`}
        hitSlop={touchSlop(STUDIO_TOUCH_MIN)}
        onPress={() => void inspectSkill(props.skill)}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: compactLayout() ? layout.touchTarget : STUDIO_TOUCH_MIN,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingLeft: space.lg,
          paddingVertical: space.sm,
          cursor: "pointer",
          ...pressTransition(),
        }}
        activeStyle={tactileActiveStyle(0.99)}
        focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -2 }}
      >
        {/* The glyph sits on the name line; description and notes hang under the name. */}
        <View style={{ alignSelf: "flex-start", height: textLineHeight(14, 1.35), flexShrink: 0, justifyContent: "center" }}>
          <Icon
            name={semanticSkillIcon(`${props.skill.name} ${props.skill.description ?? ""}`, "bulb")}
            size={16}
            color={palette().textMuted}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm, minWidth: 0 }}>
            <Text
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: isEnabled() ? palette().text : palette().textSecondary,
                fontSize: textSize(14),
                lineHeight: textLineHeight(14, 1.35),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {props.skill.name}
            </Text>
            <If when={distinctSource()}>
              {src => (
                <Text
                  style={{
                    flexShrink: 2,
                    minWidth: 0,
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.35),
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {src()}
                </Text>
              )}
            </If>
          </View>
          <Text
            style={{
              minWidth: 0,
              color: palette().textSecondary,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.45),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.skill.description || tr("common.noDescription")}
          </Text>
          <If when={props.skill.isShadowed}>
            <Text
              style={{
                minWidth: 0,
                color: stateColor("needs_you"),
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
                numberOfLines: 2,
                textOverflow: "ellipsis",
              }}
            >
              {props.skill.shadowedByKey
                ? tr("skills.shadowedBy", { key: props.skill.shadowedByKey })
                : tr("skills.shadowedGeneric")}
            </Text>
          </If>
        </View>
      </View>

      <ToggleSwitch
        value={isEnabled()}
        disabled={!canToggleInstalledSkill(props.skill) || togglingSkillKey() === props.skill.key}
        accessibilityLabel={`skill-toggle-${props.skill.key}`}
        onChange={next => void toggleSkillGlobalDisabled(props.skill, next)}
      />
      <MoreMenu
        accessibilityLabel={`skill-actions-${props.skill.key}`}
        tooltip={tr("skills.skillActions")}
        minWidth={184}
        items={[
          {
            id: "inspect",
            label: tr("skills.inspectSkillMd"),
            icon: "eye",
            accessibilityLabel: `skill-menu-inspect-${props.skill.key}`,
            onSelect: () => void inspectSkill(props.skill),
          },
          ...(canDeleteInstalledSkill(props.skill)
            ? [
                {
                  id: "delete",
                  label: tr("common.delete"),
                  icon: "trash" as const,
                  danger: true,
                  separator: true,
                  confirmDelete: true,
                  confirmAccessibilityLabel: "skill-delete-confirm",
                  cancelAccessibilityLabel: "skill-delete-cancel",
                  accessibilityLabel: `skill-menu-delete-${props.skill.key}`,
                  onSelect: () => void removeInstalledSkill(props.skill),
                },
              ]
            : []),
        ]}
      />
    </View>
  );
}

function SkillInspectModal() {
  return (
    <ModalDialog
      open={Boolean(inspectedSkill())}
      title={inspectedSkill()?.name ?? tr("skills.inspectTitle")}
      subtitle={inspectSubtitle(inspectedSkill())}
      size="lg"
      accessibilityLabel="skill-inspect-dialog"
      onClose={closeSkillInspector}
      footer={
        <Button
          label={tr("common.close")}
          variant="secondary"
          size="md"
          accessibilityLabel="skill-inspect-close"
          onPress={closeSkillInspector}
        />
      }
    >
      <If when={inspectedSkill()}>
        {skill => (
          <View style={{ gap: space.lg }}>
            <ConfigSection
              title={tr("skills.skillMetadata")}
              flush
              controlWidth={compactLayout() ? undefined : 200}
            >
              <ConfigRow
                label={tr("skills.statusSource")}
                description={distinctSkillSourceLabel(skill()) || undefined}
              >
                <Text
                  style={{
                    flexShrink: 0,
                    color: palette().textSecondary,
                    fontSize: textSize(13),
                    lineHeight: textLineHeight(13, 1.4),
                  }}
                >
                  {`${skillScopeTag(skill())} · ${isSkillDisabled(skill().key) ? tr("common.disabled") : tr("common.enabled")}`}
                </Text>
              </ConfigRow>
              <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs }}>
                <Text
                  style={{
                    minWidth: 0,
                    color: palette().textSecondary,
                    fontFamily: fontMono,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.44),
                    userSelect: "text",
                  }}
                >
                  {tr("skills.pathLabel", { path: skill().path || tr("common.unavailable") })}
                </Text>
                <If when={skill().installationSource ?? ""}>
                  {src => (
                    <Text
                      style={{
                        minWidth: 0,
                        color: palette().textMuted,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.42),
                      }}
                    >
                      {tr("skills.sourcePackageLabel", { source: src() })}
                    </Text>
                  )}
                </If>
                <If when={skill().argumentHint ?? ""}>
                  {hint => (
                    <Text
                      style={{
                        minWidth: 0,
                        color: palette().textMuted,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.42),
                      }}
                    >
                      {tr("skills.argumentHintLabel", { hint: hint() })}
                    </Text>
                  )}
                </If>
              </View>
            </ConfigSection>

            {/* Clean SKILL.md reading canvas constrained to ~65ch editorial measure */}
            <View style={{ gap: space.sm }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: space.sm,
                  paddingHorizontal: space.hair,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                  <Icon name="file-text" size={14} color={palette().textMuted} />
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(14),
                      fontWeight: "600",
                      letterSpacing: textTracking(14),
                      lineHeight: textLineHeight(14, 1.3),
                    }}
                  >
                    SKILL.md
                  </Text>
                </View>
                <If when={skill().entryFile ?? ""}>
                  {entry => (
                    <Text
                      style={{
                        color: palette().textMuted,
                        fontFamily: fontMono,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.35),
                      }}
                    >
                      {entry()}
                    </Text>
                  )}
                </If>
              </View>

              <If when={inspectedSkillLoading()}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                    padding: space.lg,
                    borderRadius: radii.md,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().borderSubtle,
                    backgroundColor: palette().panelRaised,
                  }}
                >
                  <Spinner size={14} />
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.4),
                    }}
                  >
                    {tr("skills.readingSkillMd")}
                  </Text>
                </View>
              </If>

              <If when={inspectedSkillError() ?? ""}>
                {err => (
                  <View style={{ gap: 8 }}>
                    <InlineBanner
                      tone="warning"
                      message={tr("skills.readError", { error: localizeHostError(err()) })}
                    />
                    <Text
                      style={{
                        color: palette().textSecondary,
                        fontSize: textSize(13),
                        lineHeight: textLineHeight(13, 1.5),
                      }}
                    >
                      {skill().description || tr("common.noDescription")}
                    </Text>
                  </View>
                )}
              </If>

              <If when={!inspectedSkillLoading() && !inspectedSkillError() && inspectedSkillContent() !== null}>
                <View
                  style={{
                    padding: 20,
                    borderRadius: radii.md,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().borderSubtle,
                    backgroundColor: palette().canvas,
                  }}
                >
                  <View style={{ width: "100%", maxWidth: 624 }}>
                    <If
                      when={(inspectedSkillContent() ?? "").trim()}
                      else={
                        <Text
                          style={{
                            color: palette().textMuted,
                            fontSize: textSize(13),
                            lineHeight: textLineHeight(13, 1.5),
                          }}
                        >
                          {tr("skills.emptySkillMd")}
                        </Text>
                      }
                    >
                      <MarkdownPreview
                        markdown={inspectedSkillContent() ?? ""}
                        links="report"
                        compact={true}
                        onLinkPress={event => {
                          const remote = isRemoteWorkspace(activeWorkspace());
                          const skillPath = inspectedSkill()?.entryFile || inspectedSkill()?.path || "";
                          const baseDir = skillPath
                            ? skillPath.endsWith(".md")
                              ? dirnameOfPath(skillPath, remote)
                              : skillPath
                            : activeWorkspace()?.rootPath || "";
                          const resolved = resolveWorkspaceMarkdownLink(event.url, baseDir, remote);
                          if (resolved.kind === "external") {
                            void openUrl(resolved.target).catch(() => undefined);
                          } else if (resolved.kind === "workspace") {
                            closeSkillInspector();
                            void revealPath(resolved.target);
                            navigateScene("files");
                          }
                        }}
                      />
                    </If>
                  </View>
                </View>
              </If>
            </View>
          </View>
        )}
      </If>
    </ModalDialog>
  );
}

/** One marketplace package: name, one quiet status mark, description, source, then Install and "…". */
function MarketSkillRow(props: { item: SkillMarketRecord; first: boolean }) {
  const installed = () => isMarketItemInstalled(props.item);
  const busy = () => downloadingPackage() === (props.item.installId || props.item.id);
  const projectReason = () => projectScopeUnavailableReason();

  return (
    <View
      style={{
        position: "relative",
        minHeight: compactLayout() ? layout.touchTarget : STUDIO_TOUCH_MIN,
        flexDirection: compactLayout() ? "column" : "row",
        alignItems: compactLayout() ? "stretch" : "center",
        gap: space.md,
        paddingLeft: space.lg,
        paddingRight: space.md,
        paddingVertical: space.sm,
        minWidth: 0,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
    >
      <If when={!props.first}>
        <RowSeparator inset={compactLayout() ? space.lg : layout.touchTarget} />
      </If>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        <View style={{ height: textLineHeight(14, 1.35), flexShrink: 0, justifyContent: "center" }}>
          <Icon
            name={semanticSkillIcon(`${props.item.name} ${props.item.description ?? ""}`, "package")}
            size={16}
            color={palette().textMuted}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}>
            <Text
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: palette().text,
                fontSize: textSize(14),
                lineHeight: textLineHeight(14, 1.35),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {props.item.name}
            </Text>
            <If when={installed()}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
                <Icon name="check-circle" size={12} color={palette().textMuted} />
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.35),
                  }}
                >
                  {tr("skills.installed")}
                </Text>
              </View>
            </If>
          </View>
          <Text
            style={{
              minWidth: 0,
              color: palette().textSecondary,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.45),
              numberOfLines: 2,
              textOverflow: "ellipsis",
            }}
          >
            {props.item.description || tr("common.noDescription")}
          </Text>
          <Text
            style={{
              minWidth: 0,
              color: palette().textMuted,
              fontSize: textSize(12),
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(12, 1.4),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {marketMetadataLine(props.item)}
          </Text>
        </View>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: compactLayout() ? "flex-end" : "flex-start",
          gap: space.sm,
          flexShrink: 0,
        }}
      >
        <Button
          label={busy() ? tr("common.installing") : tr("skills.installUser")}
          variant="secondary"
          size={compactLayout() ? "md" : "sm"}
          leadingIcon="download"
          loading={busy()}
          disabled={busy()}
          accessibilityLabel={`market-install-user-${props.item.id}`}
          style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
          onPress={() => void installMarketSkill(props.item, "user")}
        />
        <MoreMenu
          accessibilityLabel={`market-actions-${props.item.id}`}
          tooltip={tr("skills.packageActions")}
          minWidth={200}
          disabled={busy()}
          items={[
            {
              id: "install-project",
              label: tr("skills.installProject"),
              hint: projectReason() ?? undefined,
              icon: "folder",
              disabled: Boolean(projectReason()),
              accessibilityLabel: `market-install-project-${props.item.id}`,
              onSelect: () => void installMarketSkill(props.item, "project"),
            },
          ]}
        />
      </View>
    </View>
  );
}

/** A quiet filter control: an icon that opens a menu of choices and tints while one is applied. */
function FilterMenu<T extends string>(props: {
  value: T;
  defaultValue: T;
  options: ReadonlyArray<SelectDropdownOption<T>>;
  accessibilityLabel: string;
  tooltip: string;
  onChange: (value: T) => void;
}) {
  const open = signal(false);
  const anchor = signal<ViewRef | null>(null);
  return (
    <View ref={el => anchor.set(el)} style={{ flexShrink: 0 }}>
      <IconButton
        icon="filter"
        size="md"
        active={open() || props.value !== props.defaultValue}
        tooltip={props.tooltip}
        accessibilityLabel={props.accessibilityLabel}
        style={
          compactLayout()
            ? {
                width: layout.touchTarget,
                height: layout.touchTarget,
                minWidth: layout.touchTarget,
                minHeight: layout.touchTarget,
              }
            : undefined
        }
        onPress={() => open.update(value => !value)}
      />
      <If when={open()}>
        <DropdownMenu
          open={true}
          anchor={anchor()}
          align="end"
          minWidth={180}
          items={props.options.map(option => ({
            id: option.value,
            label: option.label,
            active: option.value === props.value,
            accessibilityLabel: option.accessibilityLabel,
            onSelect: () => props.onChange(option.value),
          }))}
          onClose={() => open.set(false)}
        />
      </If>
    </View>
  );
}

type SkillGroupId = "project" | "user" | "builtin";

function skillGroupOf(skill: SkillRecord): SkillGroupId {
  if (skill.isBuiltin) return "builtin";
  return skill.level === "project" ? "project" : "user";
}

function skillGroupTitle(id: SkillGroupId): string {
  if (id === "project") return tr("common.project");
  if (id === "user") return tr("common.user");
  return tr("common.builtin");
}

// Installed skills are drawn as one inset group per scope; recomputed only when
// the filtered list changes.
const installedSkillGroups = computed(() => {
  const buckets: Record<SkillGroupId, SkillRecord[]> = { project: [], user: [], builtin: [] };
  for (const skill of filteredInstalledSkills()) buckets[skillGroupOf(skill)].push(skill);
  return (["project", "user", "builtin"] as const)
    .filter(id => buckets[id].length > 0)
    .map(id => ({ id, skills: buckets[id] }));
});

/** The quiet count beside a section header. */
function SectionCount(props: { count: number }) {
  return (
    <Text
      style={{
        color: palette().textMuted,
        fontSize: textSize(12),
        fontVariant: ["tabular-nums"],
        lineHeight: textLineHeight(12, 1.35),
      }}
    >
      {formatCount(props.count)}
    </Text>
  );
}

export function SkillsScene(props: { embedded?: boolean }) {
  // The catalogue does not need a workspace (the host answers user-level
  // entries without one, as the desktop asks). It reloads on every scene entry,
  // when the selected device or workspace changes, and when the window regains focus.
  let enteredScene = false;
  effect(() => {
    const dev = deviceContext() || "local";
    const workspace = activeWorkspace();
    const key = `${dev}:${workspace?.id ?? "none"}:${workspace?.rootPath ?? ""}`;
    if (!enteredScene || untracked(() => skillsLoadedKey()) !== key) {
      enteredScene = true;
      void loadSkillsCatalog(false, key);
    }
  });
  let lastLifecycle = untracked(() => lifecycle());
  effect(() => {
    const state = lifecycle();
    const regained = state === "active" && lastLifecycle !== "active";
    lastLifecycle = state;
    if (!regained) return;
    const dev = untracked(() => deviceContext()) || "local";
    const workspace = untracked(() => activeWorkspace());
    const key = `${dev}:${workspace?.id ?? "none"}:${workspace?.rootPath ?? ""}`;
    void loadSkillsCatalog(false, key);
  });

  let lastMarketDevice = "";
  effect(() => {
    const tab = skillsTab();
    const dev = deviceContext() || "local";
    if (tab !== "marketplace") return;
    const query = untracked(() => marketSearchQuery()).trim();
    const loaded = untracked(() => marketLoadedKey());
    if (loaded === null || (!untracked(() => marketLoading()) && lastMarketDevice !== dev)) {
      lastMarketDevice = dev;
      void loadSkillMarketCatalog(query);
    }
  });

  const chooseTab = (next: "installed" | "marketplace") => {
    skillsTab.set(next);
    if (next === "marketplace" && marketLoadedKey() === null && !marketLoading()) {
      void loadSkillMarketCatalog();
    }
  };

  const viewTabs = () => (
    <SegmentedTabs
      size="sm"
      options={[
        { value: "installed", label: tr("skills.installed"), accessibilityLabel: "skills-tab-installed" },
        { value: "marketplace", label: tr("skills.marketplace"), accessibilityLabel: "skills-tab-marketplace" },
      ]}
      value={skillsTab()}
      onChange={chooseTab}
    />
  );
  const filterControls = () => (
    <If
      when={skillsTab() === "installed"}
      else={
        <>
          <SearchInput
            size={compactLayout() ? "lg" : "md"}
            value={marketSearchQuery()}
            placeholder={tr("skills.searchMarketplace")}
            accessibilityLabel="market-search-input"
            style={{
              flex: 1,
              minWidth: compactLayout() ? 140 : 160,
              maxWidth: studioCompact() ? undefined : 260,
              ...(compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : {}),
            }}
            onChange={val => marketSearchQuery.set(val)}
            onSubmit={() => void loadSkillMarketCatalog()}
          />
          <Button
            label={tr("common.search")}
            variant="secondary"
            size={compactLayout() ? "md" : "sm"}
            accessibilityLabel="market-search-submit"
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => void loadSkillMarketCatalog()}
          />
          <If when={marketSearchQuery().trim()}>
            <Button
              label={tr("common.reset")}
              variant="ghost"
              size={compactLayout() ? "md" : "sm"}
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => {
                marketSearchQuery.set("");
                void loadSkillMarketCatalog("");
              }}
            />
          </If>
        </>
      }
    >
      <>
        <SearchInput
          size={compactLayout() ? "lg" : "md"}
          value={skillSearchQuery()}
          placeholder={tr("skills.searchInstalled")}
          countLabel={
            hasActiveInstalledFilter()
              ? `${formatCount(filteredInstalledSkills().length)}/${formatCount(installedSkills().length)}`
              : undefined
          }
          accessibilityLabel="skills-search-input"
          style={{
            flex: 1,
            minWidth: compactLayout() ? 140 : 160,
            maxWidth: studioCompact() ? undefined : 260,
            ...(compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : {}),
          }}
          onChange={val => skillSearchQuery.set(val)}
        />
        <FilterMenu
          value={skillScopeFilter()}
          defaultValue="all"
          options={scopeOptions()}
          accessibilityLabel="skills-scope-select"
          tooltip={tr("skills.scopeFilter")}
          onChange={next => skillScopeFilter.set(next)}
        />
        <If when={hasActiveInstalledFilter()}>
          <Button
            label={tr("common.clear")}
            variant="ghost"
            size={compactLayout() ? "md" : "sm"}
            accessibilityLabel="skills-filters-clear"
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={resetInstalledFilters}
          />
        </If>
      </>
    </If>
  );
  const refreshButton = () => (
    <IconButton
      icon="refresh"
      size="md"
      accessibilityLabel="skills-refresh"
      tooltip={tr("skills.refreshTooltip")}
      disabled={skillsLoading()}
      style={
        compactLayout()
          ? {
              width: layout.touchTarget,
              height: layout.touchTarget,
              minWidth: layout.touchTarget,
              minHeight: layout.touchTarget,
            }
          : undefined
      }
      onPress={() => void loadSkillsCatalog(true)}
    />
  );
  const installButton = () => (
    <Button
      label={tr("skills.installFromFolder")}
      leadingIcon="plus"
      variant={folderInstallUnsupportedReason() ? "secondary" : "primary"}
      size="md"
      tooltip={folderInstallUnsupportedReason() ?? undefined}
      accessibilityLabel="skills-install-folder-toggle"
      style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
      onPress={() => installDrawerOpen.update(open => !open)}
    />
  );

  return (
    <View
      onLayout={trackStudioWidth}
      style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column", backgroundColor: palette().canvas }}
    >
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <If
          when={props.embedded}
          else={
            <StudioHeader
              title={tr("skills.title")}
              subtitle={tr("skills.subtitle")}
              actions={
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  {refreshButton()}
                  {installButton()}
                </View>
              }
              extra={<StudioToolbar leading={viewTabs()} trailing={filterControls()} />}
            />
          }
        >
          <LibraryToolbar
            accessibilityLabel="skills-toolbar"
            leading={
              <>
                {viewTabs()}
                {filterControls()}
                {refreshButton()}
              </>
            }
            primary={installButton()}
          />
        </If>

        <StudioBody style={props.embedded ? libraryBodyStyle() : undefined}>
          <If
            when={
              Boolean(folderInstallUnsupportedReason())
              || (!directSkillManagementSupported() && !skillsLoading())
              || Boolean(skillsNotice())
            }
          >
            <View style={{ gap: 8 }}>
              <If when={folderInstallUnsupportedReason() ?? ""}>
                {warning => <InlineBanner tone="warning" message={warning()} />}
              </If>
              <If when={!directSkillManagementSupported() && !skillsLoading()}>
                <InlineBanner tone="neutral" icon="lock" message={tr("skills.togglesReadOnly")} />
              </If>
              <If when={skillsNotice() ?? ""}>
                {notice => (
                  <InlineBanner
                    tone="neutral"
                    icon="check-circle"
                    message={localizeHostError(notice())}
                    onDismiss={() => skillsNotice.set(null)}
                  />
                )}
              </If>
            </View>
          </If>

          <If when={skillsTab() === "installed"}>
            <View style={{ gap: studioCompact() ? 28 : STUDIO_SECTION_GAP }}>
              <If when={skillsError() ?? ""}>
                {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
              </If>

              <If when={skillsLoading() && installedSkills().length === 0}>
                <GallerySkeleton count={3} height={64} minColumn={560} />
              </If>

              <If when={!skillsLoading() && !skillsError() && filteredInstalledSkills().length === 0}>
                <StudioEmpty
                  icon="bulb"
                  message={hasActiveInstalledFilter() ? tr("skills.emptyFilteredTitle") : tr("skills.emptyTitle")}
                  detail={hasActiveInstalledFilter() ? tr("skills.emptyFilteredSubtitle") : tr("skills.emptySubtitle")}
                  action={
                    <Button
                      label={hasActiveInstalledFilter() ? tr("common.resetFilter") : tr("skills.emptyAction")}
                      variant="secondary"
                      size="md"
                      style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                      onPress={() => {
                        if (hasActiveInstalledFilter()) resetInstalledFilters();
                        else chooseTab("marketplace");
                      }}
                    />
                  }
                />
              </If>

              <Each of={installedSkillGroups()} key={group => group.id}>
                {group => (
                  <StudioSection
                    title={skillGroupTitle(group().id)}
                    trailing={<SectionCount count={group().skills.length} />}
                  >
                    <InsetGroup>
                      <Each of={group().skills} key={skill => skill.key}>
                        {(skill, index) => <InstalledSkillRow skill={skill()} first={index() === 0} />}
                      </Each>
                    </InsetGroup>
                  </StudioSection>
                )}
              </Each>

              <If when={skillDiagnostics().length > 0}>
                <StudioSection
                  title={tr("skills.diagnostics")}
                  footnote={formatPlural(skillDiagnostics().length, "skills.scanNoticeOne", "skills.scanNoticeOther")}
                >
                  <InsetGroup>
                    <Each of={skillDiagnostics()} key={(diag, index) => `${diag.path}:${index}`}>
                      {(diag, idx) => (
                        <View
                          style={{
                            position: "relative",
                            minHeight: compactLayout() ? layout.touchTarget : STUDIO_TOUCH_MIN,
                            flexDirection: "row",
                            alignItems: "flex-start",
                            gap: space.md,
                            paddingHorizontal: space.lg,
                            paddingVertical: space.md,
                            minWidth: 0,
                          }}
                        >
                          <If when={idx() > 0}>
                            <RowSeparator inset={44} />
                          </If>
                          <View style={{ paddingTop: space.hair, flexShrink: 0 }}>
                            <Icon name="warning" size={16} color={stateColor("needs_you")} />
                          </View>
                          <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                            <Text
                              style={{
                                minWidth: 0,
                                color: palette().text,
                                fontSize: textSize(13),
                                lineHeight: textLineHeight(13, 1.45),
                              }}
                            >
                              {localizeHostError(diag().message)}
                            </Text>
                            <Text
                              style={{
                                minWidth: 0,
                                color: palette().textMuted,
                                fontFamily: fontMono,
                                fontSize: textSize(12),
                                lineHeight: textLineHeight(12, 1.4),
                                numberOfLines: 1,
                                textOverflow: "ellipsis-middle",
                              }}
                            >
                              {[diag().sourceId, diag().path].filter(Boolean).join(" · ")}
                            </Text>
                          </View>
                        </View>
                      )}
                    </Each>
                  </InsetGroup>
                </StudioSection>
              </If>
            </View>
          </If>

          <If when={skillsTab() === "marketplace"}>
            <View style={{ gap: space.lg }}>
              <If when={marketError() ?? ""}>
                {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
              </If>

              <If when={marketSourceErrors().length > 0}>
                <View role="alert" style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, paddingHorizontal: space.xs }}>
                  <View style={{ paddingTop: space.hair, flexShrink: 0 }}>
                    <Icon name="warning" size={16} color={stateColor("needs_you")} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                    <Text
                      style={{
                        color: palette().text,
                        fontSize: textSize(13),
                        fontWeight: "600",
                        lineHeight: textLineHeight(13, 1.4),
                      }}
                    >
                      {tr("skills.marketWarnings")}
                    </Text>
                    <Each of={marketSourceErrors()} key="index">
                      {err => (
                        <Text
                          style={{
                            minWidth: 0,
                            color: palette().textSecondary,
                            fontSize: textSize(12),
                            lineHeight: textLineHeight(12, 1.45),
                          }}
                        >
                          {localizeHostError(err())}
                        </Text>
                      )}
                    </Each>
                  </View>
                </View>
              </If>

              <If when={marketLoading() && marketSkills().length === 0}>
                <GallerySkeleton count={3} height={72} minColumn={560} />
              </If>

              <If when={!marketLoading() && marketSkills().length === 0 && !marketError()}>
                <StudioEmpty
                  icon="package"
                  message={
                    marketSearchQuery().trim()
                      ? tr("skills.emptyFilteredTitle")
                      : tr("skills.marketEmptyTitle")
                  }
                  detail={
                    marketSearchQuery().trim()
                      ? tr("skills.emptyFilteredSubtitle")
                      : tr("skills.marketEmptySubtitle")
                  }
                  action={
                    <Button
                      label={
                        marketSearchQuery().trim()
                          ? tr("common.clearSearch")
                          : tr("skills.reloadMarketplace")
                      }
                      variant="secondary"
                      size="md"
                      style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                      onPress={() => {
                        if (marketSearchQuery().trim()) {
                          marketSearchQuery.set("");
                          void loadSkillMarketCatalog("");
                        } else {
                          void loadSkillMarketCatalog();
                        }
                      }}
                    />
                  }
                />
              </If>

              <If when={marketSkills().length > 0}>
                <StudioSection
                  title={tr("skills.marketplace")}
                  trailing={<SectionCount count={marketSkills().length} />}
                >
                  <InsetGroup>
                    <Each of={marketSkills()} key={item => item.installId || item.id}>
                      {(item, index) => <MarketSkillRow item={item()} first={index() === 0} />}
                    </Each>
                  </InsetGroup>
                </StudioSection>
              </If>
            </View>
          </If>
        </StudioBody>
      </Scroll>

      <FolderInstallModal />
      <SkillInspectModal />
    </View>
  );
}
