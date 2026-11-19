import { computed, effect, Scroll, signal, Text, View, type ViewRef } from "nsh";
import { TextView } from "nsh/base";
import { formatCount, formatPlural } from "../format";
import { localizeHostError, tr } from "../i18n";
import { peerScope } from "../peerState";
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
import { activeWorkspace, activeWorkspaceId } from "../state";
import { fontMono, palette, radii, textLineHeight, textSize, textTracking } from "../theme";
import { Icon, type IconName } from "../ui/icons";
import { createMarkdownCodeActions, createMarkdownStyles } from "../ui/markdown";
import { MOTION_DURATION, paintTransition, Spinner } from "../ui/motion";
import {
  DropdownMenu,
  ModalDialog,
  SelectDropdown,
  type SelectDropdownOption,
} from "../ui/overlays";
import {
  Badge,
  Button,
  ConfigRow,
  ConfigSection,
  EmptyStateCard,
  IconButton,
  InlineBanner,
  InputBox,
  SearchInput,
  SegmentedTabs,
  ToggleSwitch,
  type BadgeTone,
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
  if (skill.isBuiltin) return tr("common.builtin");
  return skill.level === "project" ? tr("common.project") : tr("common.user");
}

function skillScopeTone(skill: SkillRecord): BadgeTone {
  if (skill.isBuiltin) return "neutral";
  return skill.level === "project" ? "accent" : "success";
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
    (rawNorm === "builtin" || rawNorm === "内置" || rawNorm === "內建")
  ) {
    return "";
  }
  return raw;
}

function inspectSubtitle(skill: SkillRecord | null): string | undefined {
  if (!skill) return undefined;
  const parts = [skillScopeTag(skill), distinctSkillSourceLabel(skill), skill.key].filter(Boolean);
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
      <View style={{ gap: 16 }}>
        <If when={folderInstallUnsupportedReason() ?? ""}>
          {reason => <InlineBanner tone="warning" message={reason()} />}
        </If>

        <ConfigSection
          title={tr("skills.folderSource")}
          subtitle={tr("skills.folderSourceHint")}
        >
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <InputBox
                size="md"
                value={folderPathInput()}
                placeholder={tr("skills.folderPlaceholder")}
                leadingIcon="folder-open"
                monospace
                readonly={Boolean(folderInstallUnsupportedReason())}
                accessibilityLabel="skill-folder-path-input"
                style={{ flex: 1, minWidth: 180 }}
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
                onPress={() => void validateFolderSkillPath()}
              />
            </View>

            <If when={folderValidation()}>
              {validation => (
                <View
                  style={{
                    padding: 12,
                    borderRadius: radii.sm,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: validation().valid ? palette().successBorder : palette().dangerBorder,
                    backgroundColor: validation().valid ? palette().successSoft : palette().dangerSoft,
                    gap: 5,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <Badge
                      label={validation().valid ? tr("common.valid") : tr("common.invalid")}
                      tone={validation().valid ? "success" : "danger"}
                    />
                    <If when={validation().name ?? ""}>
                      {name => (
                        <Text
                          style={{
                            flex: 1,
                            minWidth: 0,
                            color: palette().text,
                            fontSize: textSize(12.5),
                            fontWeight: "600",
                            lineHeight: textLineHeight(12.5, 1.35),
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
                          fontSize: textSize(11.5),
                          lineHeight: textLineHeight(11.5, 1.44),
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
                          color: palette().danger,
                          fontSize: textSize(11.5),
                          lineHeight: textLineHeight(11.5, 1.44),
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

        <ConfigSection title={tr("skills.installScope")} flush controlWidth={200}>
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

function InstalledSkillCard(props: { skill: SkillRecord }) {
  const menuOpen = signal(false);
  const menuAnchor = signal<ViewRef | null>(null);
  const isInspected = () => inspectedSkillKey() === props.skill.key;
  const isEnabled = () => !isSkillDisabled(props.skill.key);
  const distinctSource = () => distinctSkillSourceLabel(props.skill);

  return (
    <View
      style={{
        minWidth: 0,
        height: "100%",
        flexDirection: "column",
        justifyContent: "space-between",
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: isInspected()
          ? palette().borderFocus
          : isEnabled()
            ? palette().border
            : palette().borderSubtle,
        backgroundColor: isEnabled() ? palette().panelRaised : palette().surfaceTertiary,
        boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
        padding: 18,
        gap: 14,
        opacity: isEnabled() ? 1 : 0.72,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: palette().panelHover,
        borderColor: isInspected() ? palette().borderFocus : palette().borderStrong,
      }}
    >
      <View style={{ flex: 1, gap: 10, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 11, minWidth: 0 }}>
          <View
            style={{
              width: 34,
              height: 34,
              flexShrink: 0,
              marginTop: 1,
              borderRadius: radii.sm,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: isInspected() ? palette().accentBorder : palette().borderSubtle,
              backgroundColor: isInspected() ? palette().accentSoft : palette().surfaceTertiary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon
              name={semanticSkillIcon(`${props.skill.name} ${props.skill.description ?? ""}`, "bulb")}
              size={15}
              color={isInspected() ? palette().accent : isEnabled() ? palette().textSecondary : palette().textMuted}
            />
          </View>

          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text
              style={{
                minWidth: 0,
                color: palette().text,
                fontSize: textSize(14),
                fontWeight: "600",
                letterSpacing: textTracking(14),
                lineHeight: textLineHeight(14, 1.3),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {props.skill.name}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
              <Badge label={skillScopeTag(props.skill)} tone={skillScopeTone(props.skill)} />
              <If when={!isEnabled()}>
                <Badge label={tr("common.disabled")} tone="neutral" />
              </If>
              <If when={distinctSource()}>
                {src => (
                  <Text
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: palette().textMuted,
                      fontSize: textSize(11.5),
                      lineHeight: textLineHeight(11.5, 1.35),
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {src()}
                  </Text>
                )}
              </If>
            </View>
          </View>

          <View style={{ flexShrink: 0, paddingTop: 4 }}>
            <ToggleSwitch
              value={isEnabled()}
              disabled={!canToggleInstalledSkill(props.skill) || togglingSkillKey() === props.skill.key}
              accessibilityLabel={`skill-toggle-${props.skill.key}`}
              onChange={next => void toggleSkillGlobalDisabled(props.skill, next)}
            />
          </View>
        </View>

        <Text
          style={{
            minWidth: 0,
            color: palette().textSecondary,
            fontSize: textSize(12.5),
            lineHeight: textLineHeight(12.5, 1.5),
            numberOfLines: 2,
            textOverflow: "ellipsis",
          }}
        >
          {props.skill.description || tr("common.noDescription")}
        </Text>

        <If when={props.skill.isShadowed}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 7,
              borderRadius: radii.sm,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().warningBorder,
              backgroundColor: palette().warningSoft,
            }}
          >
            <View style={{ marginTop: 1.5, flexShrink: 0 }}>
              <Icon name="warning" size={12} color={palette().warning} />
            </View>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().warning,
                fontSize: textSize(11.5),
                fontWeight: "500",
                lineHeight: textLineHeight(11.5, 1.4),
              }}
            >
              {props.skill.shadowedByKey
                ? tr("skills.shadowedBy", { key: props.skill.shadowedByKey })
                : tr("skills.shadowedGeneric")}
            </Text>
          </View>
        </If>
      </View>

      <View
        style={{
          gap: 10,
          paddingTop: 12,
          borderTopWidth: 1,
          borderColor: palette().borderSubtle,
        }}
      >
        <Text
          style={{
            minWidth: 0,
            color: palette().textMuted,
            fontFamily: fontMono,
            fontSize: textSize(11),
            lineHeight: textLineHeight(11, 1.35),
            numberOfLines: 1,
            textOverflow: "ellipsis-middle",
          }}
        >
          {props.skill.key}
        </Text>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <Button
            label={tr("common.inspect")}
            variant={isInspected() ? "primary" : "secondary"}
            size="sm"
            leadingIcon="file-text"
            accessibilityLabel={`skill-inspect-${props.skill.key}`}
            onPress={() => void inspectSkill(props.skill)}
          />
          <View ref={el => menuAnchor.set(el)} style={{ flexShrink: 0 }}>
            <IconButton
              icon="more"
              size="sm"
              active={menuOpen()}
              accessibilityLabel={`skill-actions-${props.skill.key}`}
              tooltip={tr("skills.skillActions")}
              onPress={() => menuOpen.update(open => !open)}
            />
          </View>
        </View>
      </View>

      <DropdownMenu
        open={menuOpen()}
        anchor={menuAnchor()}
        align="end"
        minWidth={184}
        onClose={() => menuOpen.set(false)}
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
                  accessibilityLabel: `skill-menu-delete-${props.skill.key}`,
                  onSelect: () => confirmDeleteSkillKey.set(props.skill.key),
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
          <View style={{ gap: 18 }}>
            <ConfigSection title={tr("skills.skillMetadata")} flush controlWidth={200}>
              <ConfigRow
                label={tr("skills.statusSource")}
                description={distinctSkillSourceLabel(skill()) || skill().key}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <Badge label={skillScopeTag(skill())} tone={skillScopeTone(skill())} />
                  <Badge
                    label={isSkillDisabled(skill().key) ? tr("common.disabled") : tr("common.enabled")}
                    tone={isSkillDisabled(skill().key) ? "neutral" : "success"}
                  />
                </View>
              </ConfigRow>
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 5 }}>
                <Text
                  style={{
                    minWidth: 0,
                    color: palette().textSecondary,
                    fontFamily: fontMono,
                    fontSize: textSize(11.5),
                    lineHeight: textLineHeight(11.5, 1.44),
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
                        fontSize: textSize(11.5),
                        lineHeight: textLineHeight(11.5, 1.42),
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
                        fontSize: textSize(11.5),
                        lineHeight: textLineHeight(11.5, 1.42),
                      }}
                    >
                      {tr("skills.argumentHintLabel", { hint: hint() })}
                    </Text>
                  )}
                </If>
              </View>
            </ConfigSection>

            {/* Clean SKILL.md reading canvas constrained to ~65ch editorial measure */}
            <View style={{ gap: 8 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  paddingHorizontal: 2,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Icon name="file-text" size={13} color={palette().textMuted} />
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
                        fontSize: textSize(10.5),
                        lineHeight: textLineHeight(10.5, 1.35),
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
                    gap: 8,
                    padding: 18,
                    borderRadius: radii.md,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().borderSubtle,
                    backgroundColor: palette().surfaceTertiary,
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
                        fontSize: textSize(12.5),
                        lineHeight: textLineHeight(12.5, 1.5),
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
                    borderColor: palette().border,
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
                            fontSize: textSize(12.5),
                            lineHeight: textLineHeight(12.5, 1.5),
                          }}
                        >
                          {tr("skills.emptySkillMd")}
                        </Text>
                      }
                    >
                      <TextView
                        markdown={inspectedSkillContent() ?? ""}
                        selectable={true}
                        links="open"
                        codeBlockActions={createMarkdownCodeActions()}
                        styles={createMarkdownStyles({ compact: true })}
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

function SkillDeleteModal() {
  return (
    <ModalDialog
      open={Boolean(pendingDeleteSkill())}
      title={tr("skills.deleteSkill")}
      size="sm"
      accessibilityLabel="skill-delete-dialog"
      onClose={() => confirmDeleteSkillKey.set(null)}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button
            label={tr("common.cancel")}
            variant="secondary"
            size="md"
            accessibilityLabel="skill-delete-cancel"
            onPress={() => confirmDeleteSkillKey.set(null)}
          />
          <Button
            label={tr("common.confirmDelete")}
            variant="danger"
            size="md"
            accessibilityLabel="skill-delete-confirm"
            onPress={() => {
              const target = pendingDeleteSkill();
              if (target) void removeInstalledSkill(target);
            }}
          />
        </View>
      }
    >
      <If when={pendingDeleteSkill()}>
        {skill => (
          <Text
            style={{
              color: palette().textSecondary,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.5),
            }}
          >
            {tr("skills.deleteConfirmBody", { name: skill().name })}
          </Text>
        )}
      </If>
    </ModalDialog>
  );
}

function MarketSkillCard(props: { item: SkillMarketRecord }) {
  const installed = () => isMarketItemInstalled(props.item);
  const busy = () => downloadingPackage() === (props.item.installId || props.item.id);
  const projectReason = () => projectScopeUnavailableReason();

  return (
    <View
      style={{
        minWidth: 0,
        height: "100%",
        flexDirection: "column",
        justifyContent: "space-between",
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().border,
        backgroundColor: palette().panelRaised,
        boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
        padding: 18,
        gap: 14,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: palette().panelHover,
        borderColor: palette().borderStrong,
      }}
    >
      <View style={{ flex: 1, gap: 10, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 11, minWidth: 0 }}>
          <View
            style={{
              width: 34,
              height: 34,
              flexShrink: 0,
              borderRadius: radii.sm,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: installed() ? palette().successBorder : palette().borderSubtle,
              backgroundColor: installed() ? palette().successSoft : palette().surfaceTertiary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon
              name={semanticSkillIcon(`${props.item.name} ${props.item.description ?? ""}`, "package")}
              size={15}
              color={installed() ? palette().success : palette().textSecondary}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: palette().text,
                fontSize: textSize(14),
                fontWeight: "600",
                letterSpacing: textTracking(14),
                lineHeight: textLineHeight(14, 1.3),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {props.item.name}
            </Text>
            <If when={installed()}>
              <Badge label={tr("skills.installed")} tone="success" />
            </If>
          </View>
        </View>

        <Text
          style={{
            minWidth: 0,
            color: palette().textSecondary,
            fontSize: textSize(12.5),
            lineHeight: textLineHeight(12.5, 1.5),
            numberOfLines: 2,
            textOverflow: "ellipsis",
          }}
        >
          {props.item.description || tr("common.noDescription")}
        </Text>
      </View>

      <View
        style={{
          gap: 10,
          paddingTop: 12,
          borderTopWidth: 1,
          borderColor: palette().borderSubtle,
        }}
      >
        <Text
          style={{
            minWidth: 0,
            color: palette().textMuted,
            fontSize: textSize(11.5),
            fontVariant: ["tabular-nums"],
            lineHeight: textLineHeight(11.5, 1.35),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {marketMetadataLine(props.item)}
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Button
            label={busy() ? tr("common.installing") : tr("skills.installUser")}
            variant={installed() ? "secondary" : "primary"}
            size="sm"
            leadingIcon="download"
            loading={busy()}
            disabled={busy()}
            accessibilityLabel={`market-install-user-${props.item.id}`}
            onPress={() => void installMarketSkill(props.item, "user")}
          />
          <Button
            label={tr("skills.installProject")}
            variant="ghost"
            size="sm"
            disabled={busy() || Boolean(projectReason())}
            tooltip={projectReason() ?? undefined}
            accessibilityLabel={`market-install-project-${props.item.id}`}
            onPress={() => void installMarketSkill(props.item, "project")}
          />
        </View>
      </View>
    </View>
  );
}

export function SkillsScene() {
  effect(() => {
    const workspace = activeWorkspace();
    const peer = peerScope();
    if (!workspace) return;
    const key = `${peer?.deviceId ?? "local"}:${workspace.id}:${workspace.rootPath}`;
    if (skillsLoadedKey() !== key) {
      void loadSkillsCatalog(false, key);
    }
  });

  effect(() => {
    const tab = skillsTab();
    const peer = peerScope();
    if (tab !== "marketplace") return;
    const query = marketSearchQuery().trim();
    if (marketLoadedKey() === null) {
      void loadSkillMarketCatalog(query);
    } else if (!marketLoading() && marketLoadedKey()?.split(":").slice(1).join(":") !== (peer?.deviceId ?? "local")) {
      void loadSkillMarketCatalog(query);
    }
  });

  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column", backgroundColor: palette().canvas }}>
      {/* Unified Studio Scene Header grounded on palette().canvas, rail-aligned with maxWidth: 960 body */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().canvas,
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 960,
            alignSelf: "center",
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              flexShrink: 0,
              borderRadius: radii.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().panelRaised,
              boxShadow: palette().shadowButton,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="bulb" size={17} color={palette().accent} />
          </View>

          <View style={{ flex: 1, minWidth: 180, gap: 3 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text
                style={{
                  color: palette().text,
                  fontSize: textSize(22),
                  fontWeight: "600",
                  letterSpacing: textTracking(22),
                  lineHeight: textLineHeight(22, 1.22),
                }}
              >
                {tr("skills.title")}
              </Text>
              <Badge
                label={
                  skillsLoading()
                    ? tr("skills.scanning")
                    : tr("skills.installedCount", { count: formatCount(installedSkills().length) })
                }
                tone="neutral"
              />
            </View>
            <Text
              style={{
                maxWidth: 620,
                color: palette().textMuted,
                fontSize: textSize(12.5),
                lineHeight: textLineHeight(12.5, 1.44),
              }}
            >
              {tr("skills.subtitle")}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <IconButton
              icon="refresh"
              size="md"
              accessibilityLabel="skills-refresh"
              tooltip={tr("skills.refreshTooltip")}
              disabled={skillsLoading()}
              onPress={() => void loadSkillsCatalog(true)}
            />
            <Button
              label={tr("skills.installFromFolder")}
              leadingIcon="plus"
              variant={folderInstallUnsupportedReason() ? "secondary" : "primary"}
              size="md"
              tooltip={folderInstallUnsupportedReason() ?? undefined}
              accessibilityLabel="skills-install-folder-toggle"
              onPress={() => installDrawerOpen.update(open => !open)}
            />
          </View>
        </View>
      </View>

      <Scroll
        style={{ flex: 1, minHeight: 0 }}
        contentStyle={{ paddingHorizontal: 24, paddingVertical: 20, alignItems: "center" }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 960,
            gap: 16,
          }}
        >
          {/* Tabs, Search & Scope Dropdown — locked to exact controlHeight.md (32px) baseline */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <SegmentedTabs
              size="md"
              options={[
                { value: "installed", label: tr("skills.installed"), badge: installedSkills().length, accessibilityLabel: "skills-tab-installed" },
                { value: "marketplace", label: tr("skills.marketplace"), badge: marketSkills().length || undefined, accessibilityLabel: "skills-tab-marketplace" },
              ]}
              value={skillsTab()}
              onChange={next => {
                skillsTab.set(next);
                if (next === "marketplace" && marketLoadedKey() === null && !marketLoading()) {
                  void loadSkillMarketCatalog();
                }
              }}
            />

            <If when={skillsTab() === "installed"}>
              <View style={{ flex: 1, minWidth: 220, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <SearchInput
                  size="md"
                  value={skillSearchQuery()}
                  placeholder={tr("skills.searchInstalled")}
                  countLabel={
                    hasActiveInstalledFilter()
                      ? `${formatCount(filteredInstalledSkills().length)}/${formatCount(installedSkills().length)}`
                      : undefined
                  }
                  accessibilityLabel="skills-search-input"
                  style={{ flex: 1, minWidth: 180 }}
                  onChange={val => skillSearchQuery.set(val)}
                />

                <SelectDropdown
                  size="md"
                  options={scopeOptions()}
                  value={skillScopeFilter()}
                  accessibilityLabel="skills-scope-select"
                  minWidth={148}
                  onChange={next => skillScopeFilter.set(next)}
                />

                <If when={hasActiveInstalledFilter()}>
                  <Button
                    label={tr("common.clear")}
                    variant="ghost"
                    size="md"
                    accessibilityLabel="skills-filters-clear"
                    onPress={resetInstalledFilters}
                  />
                </If>
              </View>
            </If>

            <If when={skillsTab() === "marketplace"}>
              <View style={{ flex: 1, minWidth: 220, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <SearchInput
                  size="md"
                  value={marketSearchQuery()}
                  placeholder={tr("skills.searchMarketplace")}
                  accessibilityLabel="market-search-input"
                  style={{ flex: 1, minWidth: 180 }}
                  onChange={val => marketSearchQuery.set(val)}
                  onSubmit={() => void loadSkillMarketCatalog()}
                />
                <Button
                  label={tr("common.search")}
                  variant="primary"
                  size="md"
                  accessibilityLabel="market-search-submit"
                  onPress={() => void loadSkillMarketCatalog()}
                />
                <If when={marketSearchQuery().trim()}>
                  <Button
                    label={tr("common.reset")}
                    variant="ghost"
                    size="md"
                    onPress={() => {
                      marketSearchQuery.set("");
                      void loadSkillMarketCatalog("");
                    }}
                  />
                </If>
              </View>
            </If>
          </View>

          <If when={folderInstallUnsupportedReason() ?? ""}>
            {warning => <InlineBanner tone="warning" message={warning()} />}
          </If>

          <If when={!directSkillManagementSupported() && !skillsLoading()}>
            <InlineBanner
              tone="neutral"
              icon="lock"
              message={tr("skills.togglesReadOnly")}
            />
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

          <If when={skillsTab() === "installed"}>
            <View style={{ gap: 14 }}>
              <If when={skillsError() ?? ""}>
                {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
              </If>

              <If when={skillDiagnostics().length > 0}>
                <ConfigSection
                  title={tr("skills.diagnostics")}
                  subtitle={formatPlural(
                    skillDiagnostics().length,
                    "skills.scanNoticeOne",
                    "skills.scanNoticeOther",
                  )}
                  extra={<Badge label={tr("common.warning")} tone="warning" />}
                  flush
                >
                  <Each of={skillDiagnostics()} key={(diag, index) => `${diag.path}:${index}`}>
                    {(diag, idx) => (
                      <View
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 11,
                          gap: 4,
                          borderTopWidth: idx() === 0 ? 0 : 1,
                          borderColor: palette().borderSubtle,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <Badge label={diag().sourceId || tr("common.warning")} tone="warning" />
                          <Text
                            style={{
                              flex: 1,
                              minWidth: 0,
                              color: palette().textMuted,
                              fontFamily: fontMono,
                              fontSize: textSize(11),
                              lineHeight: textLineHeight(11, 1.35),
                              numberOfLines: 1,
                              textOverflow: "ellipsis-middle",
                            }}
                          >
                            {diag().path}
                          </Text>
                        </View>
                        <Text
                          style={{
                            minWidth: 0,
                            color: palette().warning,
                            fontSize: textSize(11.5),
                            lineHeight: textLineHeight(11.5, 1.42),
                          }}
                        >
                          {localizeHostError(diag().message)}
                        </Text>
                      </View>
                    )}
                  </Each>
                </ConfigSection>
              </If>

              <If when={skillsLoading() && installedSkills().length === 0}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }}>
                  <Spinner size={14} />
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.4),
                    }}
                  >
                    {tr("skills.loading")}
                  </Text>
                </View>
              </If>

              <If when={!skillsLoading() && filteredInstalledSkills().length === 0}>
                <EmptyStateCard
                  icon="bulb"
                  title={
                    hasActiveInstalledFilter()
                      ? tr("skills.emptyFilteredTitle")
                      : tr("skills.emptyTitle")
                  }
                  subtitle={
                    hasActiveInstalledFilter()
                      ? tr("skills.emptyFilteredSubtitle")
                      : tr("skills.emptySubtitle")
                  }
                  actionLabel={
                    hasActiveInstalledFilter()
                      ? tr("common.resetFilter")
                      : tr("skills.browseMarketplace")
                  }
                  onAction={() => {
                    if (hasActiveInstalledFilter()) {
                      resetInstalledFilters();
                    } else {
                      skillsTab.set("marketplace");
                      if (marketLoadedKey() === null) void loadSkillMarketCatalog();
                    }
                  }}
                />
              </If>

              <If when={filteredInstalledSkills().length > 0}>
                <View
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                    gap: 14,
                  }}
                >
                  <Each of={filteredInstalledSkills()} key={skill => skill.key}>
                    {skill => <InstalledSkillCard skill={skill()} />}
                  </Each>
                </View>
              </If>
            </View>
          </If>

          <If when={skillsTab() === "marketplace"}>
            <View style={{ gap: 14 }}>
              <If when={marketError() ?? ""}>
                {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
              </If>

              <If when={marketSourceErrors().length > 0}>
                <View
                  role="alert"
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: radii.md,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().warningBorder,
                    backgroundColor: palette().warningSoft,
                  }}
                >
                  <View style={{ marginTop: 1.5, flexShrink: 0 }}>
                    <Icon name="warning" size={15} color={palette().warning} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Text
                      style={{
                        color: palette().text,
                        fontSize: textSize(12),
                        fontWeight: "600",
                        lineHeight: textLineHeight(12, 1.35),
                      }}
                    >
                      {tr("skills.marketWarnings")}
                    </Text>
                    <Each of={marketSourceErrors()} key="index">
                      {err => (
                        <Text
                          style={{
                            minWidth: 0,
                            color: palette().warning,
                            fontSize: textSize(11.5),
                            lineHeight: textLineHeight(11.5, 1.42),
                          }}
                        >
                          {localizeHostError(err())}
                        </Text>
                      )}
                    </Each>
                  </View>
                </View>
              </If>

              <If when={marketLoading()}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }}>
                  <Spinner size={14} />
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.4),
                    }}
                  >
                    {tr("skills.searchingMarketplace")}
                  </Text>
                </View>
              </If>

              <If when={!marketLoading() && marketSkills().length === 0}>
                <EmptyStateCard
                  icon="package"
                  title={tr("skills.marketEmptyTitle")}
                  subtitle={tr("skills.marketEmptySubtitle")}
                  actionLabel={tr("skills.reloadMarketplace")}
                  onAction={() => void loadSkillMarketCatalog()}
                />
              </If>

              <If when={marketSkills().length > 0}>
                <View
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                    gap: 14,
                  }}
                >
                  <Each of={marketSkills()} key={item => item.installId || item.id}>
                    {item => <MarketSkillCard item={item()} />}
                  </Each>
                </View>
              </If>
            </View>
          </If>
        </View>
      </Scroll>

      <FolderInstallModal />
      <SkillInspectModal />
      <SkillDeleteModal />
    </View>
  );
}
