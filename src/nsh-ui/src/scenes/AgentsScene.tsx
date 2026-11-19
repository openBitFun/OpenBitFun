import { computed, effect, Scroll, signal, Text, View, type ViewRef } from "nsh";
import {
  agentKindFilter,
  agentSearchQuery,
  agentSourceFilter,
  agentsCatalogError,
  agentsLoadedKey,
  agentsLoading,
  agentsNotice,
  allCatalogAgents,
  availableModes,
  availableSubagents,
  builderDraft,
  builderError,
  builderLoading,
  builderOpen,
  builderSaving,
  clearBuilderTools,
  closeBuilder,
  confirmDeleteAgentUid,
  deleteCatalogAgent,
  effectiveToolCountForAgent,
  filteredAgents,
  isCustomSource,
  isRemoteAgentWorkspace,
  loadAgentsCatalog,
  openAgentInspector,
  openCreateBotBuilder,
  pendingDeleteAgent,
  reloadAgentsCatalog,
  resetProfileConfig,
  saveBuilderBot,
  saveProfileConfig,
  saveSubagentRuntimeConfig,
  selectAllBuilderTools,
  selectableToolNames,
  startThreadWithMode,
  toggleBuilderTool,
  toolCatalogError,
  updateBuilderDraft,
  type AgentCatalogItem,
  type AgentSource,
  type AgentSourceFilter,
} from "../agentsCatalogStore";
import { formatCount, formatPlural } from "../format";
import { localizeHostError, tr } from "../i18n";
import { peerScope, peerSupports } from "../peerState";
import { activeWorkspace, activeWorkspaceId } from "../state";
import {
  fontMono,
  isLightAppearance,
  palette,
  radii,
  textLineHeight,
  textSize,
  textTracking,
} from "../theme";
import { BotCharacter, Icon, type BotVariant } from "../ui/icons";
import { MOTION_DURATION, paintTransition, Spinner } from "../ui/motion";
import {
  DropdownMenu,
  ModalDialog,
  SelectDropdown,
  type DropdownMenuItem,
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
  PillChip,
  SearchInput,
  SegmentedTabs,
  ToggleSwitch,
  type BadgeTone,
} from "../ui/primitives";

function sourceOptions(): ReadonlyArray<SelectDropdownOption<AgentSourceFilter>> {
  return [
    { value: "all", label: tr("agents.allSources"), accessibilityLabel: "agent-scope-all" },
    { value: "builtin", label: tr("common.builtin"), accessibilityLabel: "agent-scope-builtin" },
    { value: "user", label: tr("common.user"), accessibilityLabel: "agent-scope-user" },
    { value: "project", label: tr("common.project"), accessibilityLabel: "agent-scope-project" },
    { value: "external", label: tr("common.external"), accessibilityLabel: "agent-scope-external" },
  ];
}

type HarnessKey = "minimal" | "standard" | "ultimate" | "creative";

function detectHarnessKey(item: AgentCatalogItem): HarnessKey | null {
  if (item.kind !== "mode" || item.source !== "builtin") return null;
  const key = `${item.id} ${item.name}`.toLowerCase();
  if (key.includes("minimal")) return "minimal";
  if (key.includes("standard")) return "standard";
  if (key.includes("ultimate")) return "ultimate";
  if (key.includes("creative")) return "creative";
  return null;
}

function harnessHaloColors(item: AgentCatalogItem): { bg: string; border: string } | null {
  const key = detectHarnessKey(item);
  if (!key) return null;
  const light = isLightAppearance();
  if (key === "minimal") {
    return light
      ? { bg: "rgba(124, 58, 237, 0.09)", border: "rgba(124, 58, 237, 0.24)" }
      : { bg: "rgba(167, 139, 250, 0.12)", border: "rgba(167, 139, 250, 0.28)" };
  }
  if (key === "standard") {
    return light
      ? { bg: "rgba(22, 163, 74, 0.09)", border: "rgba(22, 163, 74, 0.24)" }
      : { bg: "rgba(74, 222, 128, 0.12)", border: "rgba(74, 222, 128, 0.28)" };
  }
  if (key === "ultimate") {
    return light
      ? { bg: "rgba(217, 119, 6, 0.10)", border: "rgba(217, 119, 6, 0.26)" }
      : { bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.28)" };
  }
  return light
    ? { bg: "rgba(29, 86, 216, 0.09)", border: "rgba(29, 86, 216, 0.24)" }
    : { bg: "rgba(96, 165, 250, 0.12)", border: "rgba(96, 165, 250, 0.28)" };
}

function harnessBotVariant(item: AgentCatalogItem): BotVariant | undefined {
  const key = detectHarnessKey(item);
  if (key === "minimal") return "violet";
  if (key === "standard") return "mint";
  if (key === "ultimate") return "amber";
  if (key === "creative") return "grok";
  return undefined;
}

function sourceLabel(source: AgentSource): string {
  if (source === "builtin") return tr("common.builtin");
  if (source === "user") return tr("common.user");
  if (source === "project") return tr("common.project");
  return tr("common.external");
}

function cardBadgeLabel(item: AgentCatalogItem): string {
  if (item.kind === "subagent") return tr("agents.subagent");
  if (item.source === "builtin") return tr("common.builtin");
  if (item.source === "external") return tr("common.external");
  return tr("common.custom");
}

function cardBadgeTone(item: AgentCatalogItem): BadgeTone {
  if (item.kind === "subagent") return isCustomSource(item.source) ? "accent" : "neutral";
  if (isCustomSource(item.source)) return "accent";
  return "neutral";
}

function editActionLabel(item: AgentCatalogItem): string {
  if (isCustomSource(item.source)) {
    return isRemoteAgentWorkspace() ? tr("common.inspect") : tr("common.edit");
  }
  if (item.source === "external") return tr("common.inspect");
  return tr("common.configure");
}

function distinctSubtitle(item: AgentCatalogItem): string {
  const idClean = item.id.trim();
  const nameClean = item.name.trim();
  if (idClean && idClean.toLowerCase() !== nameClean.toLowerCase()) {
    return idClean;
  }
  if (item.externalProviderLabel) {
    return item.externalProviderLabel;
  }
  return "";
}

function builderTitle(): string {
  const draft = builderDraft();
  if (draft.mode === "create") return tr("agents.createBot");
  if (draft.mode === "edit-custom") {
    const name = draft.name || draft.id;
    return draft.kind === "mode"
      ? tr("agents.editPrimaryTitle", { name })
      : tr("agents.editSubagentTitle", { name });
  }
  if (draft.mode === "configure-profile") {
    return tr("agents.configureProfileTitle", { name: draft.name });
  }
  if (draft.mode === "configure-subagent") {
    return tr("agents.configureSubagentTitle", { name: draft.name });
  }
  return tr("agents.inspectBotTitle", { name: draft.name });
}

function builderSubtitle(): string | undefined {
  const draft = builderDraft();
  if (draft.path) return draft.path;
  if (draft.mode === "create") return tr("agents.createSubtitle");
  if (draft.mode === "configure-profile") return tr("agents.configureProfileSubtitle");
  if (draft.mode === "configure-subagent") return tr("agents.configureSubagentSubtitle");
  if (draft.mode === "inspect-external") return tr("agents.inspectExternalSubtitle");
  return undefined;
}

function botSummaryLine(item: AgentCatalogItem): string {
  const count = effectiveToolCountForAgent(item);
  const parts: string[] = [];
  parts.push(formatPlural(count, "agents.toolCountOne", "agents.toolCountOther"));
  parts.push(
    item.model
      ? tr("sessions.modelLabel", { name: item.model })
      : tr("agents.inheritModel"),
  );
  if (item.kind === "subagent" && item.source !== "builtin") {
    parts.push(sourceLabel(item.source));
  }
  if (item.isReadonly) parts.push(tr("common.readonly"));
  return parts.join(" · ");
}

const toolSearchQuery = signal("");
const toolShowSelectedOnly = signal(false);

function resetToolFilterState(): void {
  toolSearchQuery.set("");
  toolShowSelectedOnly.set(false);
}

const filteredSelectableTools = computed(() => {
  const query = toolSearchQuery().trim().toLowerCase();
  const selectedOnly = toolShowSelectedOnly();
  const selectedSet = selectedOnly ? new Set(builderDraft().tools) : null;
  const names = selectableToolNames();
  return names.filter(name => {
    if (selectedSet && !selectedSet.has(name)) return false;
    if (query && !name.toLowerCase().includes(query)) return false;
    return true;
  });
});

const hasActiveFilter = computed(
  () => agentKindFilter() !== "all" || agentSourceFilter() !== "all" || agentSearchQuery().trim().length > 0,
);

function resetCatalogFilters(): void {
  agentKindFilter.set("all");
  agentSourceFilter.set("all");
  agentSearchQuery.set("");
}

function BotCard(props: { item: AgentCatalogItem }) {
  const menuOpen = signal(false);
  const menuAnchor = signal<ViewRef | null>(null);
  const halo = () => harnessHaloColors(props.item);
  const isDisabledSubagent = () => props.item.kind === "subagent" && !props.item.effectiveEnabled;
  const subtitle = () => distinctSubtitle(props.item);

  return (
    <View
      style={{
        position: "relative",
        minWidth: 0,
        height: "100%",
        flexDirection: "column",
        justifyContent: "space-between",
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: isDisabledSubagent() ? palette().borderSubtle : palette().border,
        backgroundColor: isDisabledSubagent() ? palette().surfaceTertiary : palette().panelRaised,
        boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
        padding: 18,
        gap: 14,
        opacity: isDisabledSubagent() ? 0.72 : 1,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: palette().panelHover,
        borderColor: palette().borderStrong,
      }}
    >
      <View style={{ flex: 1, gap: 10, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 }}>
          <View
            style={{
              width: 42,
              height: 42,
              flexShrink: 0,
              borderRadius: radii.pill,
              borderWidth: 1,
              borderColor: halo()?.border ?? palette().borderSubtle,
              backgroundColor: halo()?.bg ?? palette().surfaceSubtle,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BotCharacter
              variant={harnessBotVariant(props.item)}
              seed={props.item.name}
              size={34}
              ringColor={isDisabledSubagent() ? palette().surfaceTertiary : palette().panelRaised}
              status={
                props.item.kind === "subagent"
                  ? props.item.effectiveEnabled
                    ? "online"
                    : "idle"
                  : "online"
              }
            />
          </View>

          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 }}>
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
              <Badge label={cardBadgeLabel(props.item)} tone={cardBadgeTone(props.item)} />
              <If when={isDisabledSubagent()}>
                <Badge label={tr("common.disabled")} tone="neutral" />
              </If>
            </View>

            <If when={subtitle()}>
              {sub => (
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
                  {sub()}
                </Text>
              )}
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Icon name="wrench" size={11.5} color={palette().textMuted} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textMuted,
              fontSize: textSize(11.5),
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(11.5, 1.35),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {botSummaryLine(props.item)}
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 }}>
            <If when={props.item.kind === "mode"}>
              <Button
                label={tr("agents.startThread")}
                variant="secondary"
                size="sm"
                leadingIcon="chat"
                accessibilityLabel={`agent-start-thread-${props.item.id}`}
                onPress={() => startThreadWithMode(props.item.id)}
              />
            </If>
            <Button
              label={editActionLabel(props.item)}
              variant="ghost"
              size="sm"
              leadingIcon={
                isCustomSource(props.item.source)
                  ? isRemoteAgentWorkspace()
                    ? "eye"
                    : "edit"
                  : props.item.source === "external"
                    ? "eye"
                    : "sliders"
              }
              accessibilityLabel={`agent-configure-${props.item.id}`}
              onPress={() => {
                resetToolFilterState();
                void openAgentInspector(props.item);
              }}
            />
          </View>

          <View ref={el => menuAnchor.set(el)} style={{ flexShrink: 0 }}>
            <IconButton
              icon="more"
              size="sm"
              active={menuOpen()}
              accessibilityLabel={`agent-actions-${props.item.id}`}
              tooltip={tr("agents.botActions")}
              onPress={() => menuOpen.update(open => !open)}
            />
          </View>
        </View>
      </View>

      <DropdownMenu
        open={menuOpen()}
        anchor={menuAnchor()}
        align="end"
        minWidth={196}
        onClose={() => menuOpen.set(false)}
        items={[
          ...(isCustomSource(props.item.source)
            ? [
                {
                  id: "edit",
                  label: isRemoteAgentWorkspace() ? tr("agents.inspectBot") : tr("agents.editBot"),
                  hint: isRemoteAgentWorkspace()
                    ? tr("agents.remoteReadonlyHint")
                    : tr("agents.editBotHint"),
                  icon: isRemoteAgentWorkspace() ? "eye" : "edit",
                  accessibilityLabel: `agent-menu-edit-${props.item.id}`,
                  onSelect: () => {
                    resetToolFilterState();
                    void openAgentInspector(props.item);
                  },
                } satisfies DropdownMenuItem,
              ]
            : [
                {
                  id: "configure",
                  label:
                    props.item.source === "external"
                      ? tr("agents.inspectBot")
                      : tr("agents.configureTools"),
                  icon: props.item.source === "external" ? "eye" : "sliders",
                  accessibilityLabel: `agent-menu-configure-${props.item.id}`,
                  onSelect: () => {
                    resetToolFilterState();
                    void openAgentInspector(props.item);
                  },
                } satisfies DropdownMenuItem,
              ]),
          {
            id: "reload",
            label: tr("agents.reloadCatalog"),
            icon: "refresh",
            onSelect: () => void reloadAgentsCatalog(),
          },
          ...(isCustomSource(props.item.source)
            ? [
                {
                  id: "delete",
                  label: tr("common.delete"),
                  icon: "trash",
                  danger: true,
                  separator: true,
                  disabled: isRemoteAgentWorkspace(),
                  accessibilityLabel: `agent-menu-delete-${props.item.id}`,
                  onSelect: () => {
                    confirmDeleteAgentUid.set(props.item.uid);
                  },
                } satisfies DropdownMenuItem,
              ]
            : []),
        ]}
      />
    </View>
  );
}

function ToolMultiSelect() {
  const peerReadOnly = () => Boolean(peerScope() && peerSupports("tool_catalog") === false);

  return (
    <ConfigSection
      title={tr("agents.toolPermissionsTitle", {
        selected: formatCount(builderDraft().tools.length),
        total: formatCount(selectableToolNames().length),
      })}
      subtitle={
        peerReadOnly()
          ? tr("agents.toolPermissionsPeerReadOnly")
          : toolCatalogError()
            ? tr("agents.toolPermissionsCatalogUnavailable")
            : tr("agents.toolPermissionsSubtitle")
      }
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <If when={selectableToolNames().length > 6}>
            <PillChip
              label={tr("common.selected")}
              badge={builderDraft().tools.length}
              active={toolShowSelectedOnly()}
              accessibilityLabel="builder-tools-selected-only"
              onPress={() => toolShowSelectedOnly.update(v => !v)}
            />
          </If>
          <Button
            label={tr("common.all")}
            variant="ghost"
            size="xs"
            disabled={peerReadOnly() || selectableToolNames().length === 0}
            accessibilityLabel="builder-tools-select-all"
            onPress={selectAllBuilderTools}
          />
          <Button
            label={tr("common.clear")}
            variant="ghost"
            size="xs"
            disabled={peerReadOnly() || builderDraft().tools.length === 0}
            accessibilityLabel="builder-tools-clear"
            onPress={() => {
              toolShowSelectedOnly.set(false);
              clearBuilderTools();
            }}
          />
        </View>
      }
    >
      <View style={{ gap: 10 }}>
        <If when={toolCatalogError() ?? ""}>
          {message => <InlineBanner tone="warning" message={localizeHostError(message())} />}
        </If>

        <If when={selectableToolNames().length > 6}>
          <SearchInput
            value={toolSearchQuery()}
            size="md"
            placeholder={tr("agents.filterTools")}
            countLabel={`${formatCount(filteredSelectableTools().length)}/${formatCount(selectableToolNames().length)}`}
            accessibilityLabel="builder-tools-search"
            onChange={val => toolSearchQuery.set(val)}
          />
        </If>

        <If when={selectableToolNames().length === 0}>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.45),
            }}
          >
            {tr("agents.noTools")}
          </Text>
        </If>

        <If when={selectableToolNames().length > 0 && filteredSelectableTools().length === 0}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 4 }}>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.45),
              }}
            >
              {toolShowSelectedOnly() && !toolSearchQuery().trim()
                ? tr("agents.noToolsSelected")
                : tr("agents.noToolsMatch")}
            </Text>
            <Button
              label={tr("common.resetFilter")}
              variant="ghost"
              size="xs"
              onPress={resetToolFilterState}
            />
          </View>
        </If>

        <If when={filteredSelectableTools().length > 0}>
          <Scroll
            style={{ maxHeight: 204, minHeight: 0 }}
            contentStyle={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingVertical: 2 }}
            scrollbar={true}
          >
            <Each of={filteredSelectableTools()} key={tool => tool}>
              {tool => (
                <PillChip
                  label={tool()}
                  active={builderDraft().tools.includes(tool())}
                  disabled={peerReadOnly()}
                  maxWidth={240}
                  accessibilityLabel={`builder-tool-${tool()}`}
                  onPress={() => toggleBuilderTool(tool())}
                />
              )}
            </Each>
          </Scroll>
        </If>
      </View>
    </ConfigSection>
  );
}

function AgentBuilderModal() {
  const handleClose = () => {
    resetToolFilterState();
    closeBuilder();
  };

  return (
    <ModalDialog
      open={builderOpen()}
      title={builderTitle()}
      subtitle={builderSubtitle()}
      size="lg"
      accessibilityLabel="agent-builder-dialog"
      onClose={handleClose}
      footer={
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <If when={builderDraft().mode === "configure-profile"}>
            <Button
              label={tr("common.resetDefaults")}
              variant="secondary"
              size="md"
              disabled={builderSaving()}
              accessibilityLabel="profile-reset"
              onPress={() => void resetProfileConfig()}
            />
          </If>

          <View style={{ flex: 1, minWidth: 8 }} />

          <If when={builderDraft().mode === "create" || builderDraft().mode === "edit-custom"}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <Button
                label={tr("common.cancel")}
                variant="secondary"
                size="md"
                accessibilityLabel="agent-builder-close"
                onPress={handleClose}
              />
              <Button
                label={
                  builderSaving()
                    ? tr("common.saving")
                    : builderDraft().mode === "create"
                      ? tr("agents.createBot")
                      : tr("common.saveChanges")
                }
                variant="primary"
                size="md"
                loading={builderSaving()}
                disabled={builderSaving() || builderLoading()}
                accessibilityLabel="builder-save"
                onPress={() => void saveBuilderBot()}
              />
            </View>
          </If>

          <If when={builderDraft().mode === "configure-profile"}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <Button
                label={tr("common.close")}
                variant="secondary"
                size="md"
                accessibilityLabel="agent-builder-close"
                onPress={handleClose}
              />
              <Button
                label={builderSaving() ? tr("common.saving") : tr("agents.saveProfile")}
                variant="primary"
                size="md"
                loading={builderSaving()}
                disabled={builderSaving()}
                accessibilityLabel="profile-save"
                onPress={() => void saveProfileConfig()}
              />
            </View>
          </If>

          <If when={builderDraft().mode === "configure-subagent"}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <Button
                label={tr("common.close")}
                variant="secondary"
                size="md"
                accessibilityLabel="agent-builder-close"
                onPress={handleClose}
              />
              <Button
                label={builderSaving() ? tr("common.saving") : tr("agents.saveSubagentConfig")}
                variant="primary"
                size="md"
                loading={builderSaving()}
                disabled={builderSaving()}
                accessibilityLabel="subagent-config-save"
                onPress={() => void saveSubagentRuntimeConfig()}
              />
            </View>
          </If>

          <If when={builderDraft().mode === "inspect-external"}>
            <Button
              label={tr("common.close")}
              variant="secondary"
              size="md"
              accessibilityLabel="agent-builder-close"
              onPress={handleClose}
            />
          </If>
        </View>
      }
    >
      <View style={{ gap: 18 }}>
        <If when={builderLoading()}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Spinner size={14} />
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
              }}
            >
              {tr("agents.loadingDefinition")}
            </Text>
          </View>
        </If>

        <If when={builderError() ?? ""}>
          {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
        </If>

        <If when={builderDraft().mode === "create" || builderDraft().mode === "edit-custom"}>
          <View style={{ gap: 18 }}>
            <If when={builderDraft().mode === "create"}>
              <ConfigSection title={tr("agents.identityScope")} flush controlWidth={240}>
                <ConfigRow
                  label={tr("agents.botKind")}
                  description={tr("agents.botKindHint")}
                >
                  <SegmentedTabs
                    size="sm"
                    options={[
                      { value: "mode", label: tr("agents.primaryAgent"), accessibilityLabel: "builder-kind-mode" },
                      { value: "subagent", label: tr("agents.subagent"), accessibilityLabel: "builder-kind-subagent" },
                    ]}
                    value={builderDraft().kind}
                    onChange={next => {
                      updateBuilderDraft({
                        kind: next,
                        readonly: next === "subagent",
                        level: next === "mode" ? "user" : builderDraft().level,
                      });
                    }}
                  />
                </ConfigRow>

                <ConfigRow
                  label={tr("agents.scope")}
                  description={
                    builderDraft().kind === "mode"
                      ? tr("agents.scopePrimaryHint")
                      : tr("agents.scopeSubagentHint")
                  }
                >
                  <SegmentedTabs
                    size="sm"
                    options={
                      builderDraft().kind === "subagent" && Boolean(activeWorkspaceId())
                        ? [
                            { value: "user", label: tr("common.user"), accessibilityLabel: "builder-level-user" },
                            { value: "project", label: tr("common.project"), accessibilityLabel: "builder-level-project" },
                          ]
                        : [
                            { value: "user", label: tr("common.user"), accessibilityLabel: "builder-level-user" },
                          ]
                    }
                    value={builderDraft().level}
                    onChange={next => updateBuilderDraft({ level: next })}
                  />
                </ConfigRow>

                <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
                  <InputBox
                    label={tr("agents.botId")}
                    hint={tr("agents.botIdHint")}
                    size="md"
                    monospace
                    value={builderDraft().id}
                    placeholder={tr("agents.botIdPlaceholder")}
                    accessibilityLabel="builder-id-input"
                    onChange={id => updateBuilderDraft({ id })}
                  />
                </View>
              </ConfigSection>
            </If>

            <ConfigSection title={tr("agents.profilePrompt")}>
              <View style={{ gap: 12 }}>
                <InputBox
                  label={tr("common.name")}
                  size="md"
                  value={builderDraft().name}
                  placeholder={tr("agents.displayNamePlaceholder")}
                  accessibilityLabel="builder-name-input"
                  onChange={name => updateBuilderDraft({ name })}
                />
                <InputBox
                  label={tr("common.description")}
                  size="md"
                  value={builderDraft().description}
                  placeholder={tr("agents.descriptionPlaceholder")}
                  accessibilityLabel="builder-description-input"
                  onChange={description => updateBuilderDraft({ description })}
                />
                <InputBox
                  label={tr("agents.model")}
                  hint={tr("agents.modelHint")}
                  size="md"
                  monospace
                  value={builderDraft().model}
                  placeholder={tr("agents.modelPlaceholder")}
                  accessibilityLabel="builder-model-input"
                  onChange={model => updateBuilderDraft({ model })}
                />
                <InputBox
                  label={tr("agents.systemPrompt")}
                  multiline
                  minHeight={96}
                  monospace
                  value={builderDraft().prompt}
                  placeholder={tr("agents.systemPromptPlaceholder")}
                  accessibilityLabel="builder-prompt-input"
                  onChange={prompt => updateBuilderDraft({ prompt })}
                />
              </View>
            </ConfigSection>

            <ConfigSection title={tr("agents.safetyToolAccess")} flush controlWidth={240}>
              <ConfigRow
                label={tr("agents.readonlyTools")}
                description={tr("agents.readonlyToolsHint")}
                divider={false}
              >
                <ToggleSwitch
                  value={builderDraft().readonly}
                  accessibilityLabel="builder-readonly-toggle"
                  onChange={next => updateBuilderDraft({ readonly: next })}
                />
              </ConfigRow>
            </ConfigSection>

            <ToolMultiSelect />

            <If when={builderDraft().mode === "edit-custom" && builderDraft().kind === "subagent"}>
              <ConfigSection
                title={tr("agents.runtimeOverride")}
                subtitle={tr("agents.runtimeOverrideHint")}
                flush
                controlWidth={220}
                extra={
                  <Button
                    label={builderSaving() ? tr("common.updating") : tr("agents.saveSubagentConfig")}
                    variant="secondary"
                    size="sm"
                    disabled={builderSaving()}
                    accessibilityLabel="subagent-config-save"
                    onPress={() => void saveSubagentRuntimeConfig()}
                  />
                }
              >
                <ConfigRow
                  label={tr("agents.enabledForParent")}
                  description={tr("agents.enabledForParentHint")}
                >
                  <ToggleSwitch
                    value={builderDraft().enabled}
                    accessibilityLabel="subagent-enabled-toggle"
                    onChange={next => updateBuilderDraft({ enabled: next })}
                  />
                </ConfigRow>
                <ConfigRow
                  label={tr("agents.parentAgentMode")}
                  description={tr("agents.parentAgentModeHint")}
                  controlAlign="stretch"
                  divider={false}
                >
                  <SelectDropdown
                    size="md"
                    fullWidth
                    options={availableModes().map(mode => ({
                      value: mode.id,
                      label: mode.name,
                    }))}
                    value={builderDraft().parentAgentType}
                    accessibilityLabel="subagent-parent-select"
                    onChange={next => updateBuilderDraft({ parentAgentType: next })}
                  />
                </ConfigRow>
              </ConfigSection>
            </If>
          </View>
        </If>

        <If when={builderDraft().mode === "configure-profile"}>
          <View style={{ gap: 18 }}>
            <ConfigSection title={tr("agents.builtinProfile")} flush controlWidth={220}>
              <ConfigRow
                label={builderDraft().name}
                description={builderDraft().description || tr("agents.builtinProfileDesc")}
              >
                <Badge label={tr("common.builtin")} tone="neutral" />
              </ConfigRow>
              <ConfigRow
                label={tr("agents.accessMode")}
                description={tr("agents.profileIdLabel", { id: builderDraft().id })}
                divider={false}
              >
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontSize: textSize(12),
                    fontWeight: "500",
                    lineHeight: textLineHeight(12, 1.38),
                  }}
                >
                  {builderDraft().readonly ? tr("common.readonly") : tr("common.readWrite")}
                </Text>
              </ConfigRow>
            </ConfigSection>

            <ToolMultiSelect />
          </View>
        </If>

        <If when={builderDraft().mode === "configure-subagent"}>
          <View style={{ gap: 18 }}>
            <ConfigSection title={tr("agents.runtimeConfig")} flush controlWidth={220}>
              <ConfigRow
                label={tr("agents.enabledForParent")}
                description={builderDraft().description || tr("agents.builtinSubagentDesc")}
              >
                <ToggleSwitch
                  value={builderDraft().enabled}
                  accessibilityLabel="subagent-enabled-toggle"
                  onChange={next => updateBuilderDraft({ enabled: next })}
                />
              </ConfigRow>

              <ConfigRow
                label={tr("agents.parentAgentMode")}
                description={tr("agents.targetPrimaryProfile")}
                controlAlign="stretch"
              >
                <SelectDropdown
                  size="md"
                  fullWidth
                  options={availableModes().map(mode => ({
                    value: mode.id,
                    label: mode.name,
                  }))}
                  value={builderDraft().parentAgentType}
                  accessibilityLabel="subagent-parent-select"
                  onChange={next => updateBuilderDraft({ parentAgentType: next })}
                />
              </ConfigRow>

              <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
                <InputBox
                  label={tr("agents.modelOverride")}
                  hint={tr("agents.modelPlaceholder")}
                  size="md"
                  monospace
                  value={builderDraft().model}
                  placeholder={tr("agents.modelPlaceholder")}
                  accessibilityLabel="subagent-model-input"
                  onChange={model => updateBuilderDraft({ model })}
                />
              </View>
            </ConfigSection>

            <ConfigSection
              title={tr("agents.defaultToolsTitle", { count: formatCount(builderDraft().tools.length) })}
            >
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <If when={builderDraft().tools.length === 0}>
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.45),
                    }}
                  >
                    {tr("agents.noDefaultTools")}
                  </Text>
                </If>
                <Each of={builderDraft().tools} key={tool => tool}>
                  {tool => <Badge label={tool()} tone="neutral" />}
                </Each>
              </View>
            </ConfigSection>
          </View>
        </If>

        <If when={builderDraft().mode === "inspect-external"}>
          <ConfigSection title={tr("agents.readonlyDetails")} flush controlWidth={220}>
            <ConfigRow
              label={builderDraft().name}
              description={builderDraft().description || tr("agents.externalAgentDesc")}
            >
              <Badge label={sourceLabel(builderDraft().source)} tone="neutral" />
            </ConfigRow>
            <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.45),
                }}
              >
                {tr("agents.readonlyNotice")}
              </Text>
              <If when={builderDraft().tools.length === 0}>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(11.5),
                    lineHeight: textLineHeight(11.5, 1.4),
                  }}
                >
                  {tr("agents.noToolBindings")}
                </Text>
              </If>
              <If when={builderDraft().tools.length > 0}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Each of={builderDraft().tools} key={tool => tool}>
                    {tool => <Badge label={tool()} tone="neutral" />}
                  </Each>
                </View>
              </If>
            </View>
          </ConfigSection>
        </If>
      </View>
    </ModalDialog>
  );
}

function AgentDeleteModal() {
  return (
    <ModalDialog
      open={Boolean(pendingDeleteAgent())}
      title={tr("agents.deleteBot")}
      size="sm"
      accessibilityLabel="agent-delete-dialog"
      onClose={() => confirmDeleteAgentUid.set(null)}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button
            label={tr("common.cancel")}
            variant="secondary"
            size="md"
            accessibilityLabel="agent-delete-cancel"
            onPress={() => confirmDeleteAgentUid.set(null)}
          />
          <Button
            label={tr("common.confirmDelete")}
            variant="danger"
            size="md"
            accessibilityLabel="agent-delete-confirm"
            onPress={() => {
              const target = pendingDeleteAgent();
              if (target) void deleteCatalogAgent(target);
            }}
          />
        </View>
      }
    >
      <If when={pendingDeleteAgent()}>
        {target => (
          <Text
            style={{
              color: palette().textSecondary,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.5),
            }}
          >
            {tr("agents.deleteConfirmBody", { name: target().name })}
          </Text>
        )}
      </If>
    </ModalDialog>
  );
}

export function AgentsScene() {
  effect(() => {
    const workspace = activeWorkspace();
    const peer = peerScope();
    if (!workspace) return;
    const key = `${peer?.deviceId ?? "local"}:${workspace.id}:${workspace.rootPath}`;
    if (agentsLoadedKey() !== key) {
      void loadAgentsCatalog(key);
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
            <Icon name="bot" size={17} color={palette().accent} />
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
                {tr("agents.title")}
              </Text>
              <Badge
                label={
                  agentsLoading()
                    ? tr("common.loading")
                    : formatPlural(allCatalogAgents().length, "agents.botCountOne", "agents.botCountOther")
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
              {tr("agents.subtitle")}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <IconButton
              icon="refresh"
              size="md"
              accessibilityLabel="agents-reload"
              tooltip={tr("agents.reload")}
              disabled={agentsLoading()}
              onPress={() => void reloadAgentsCatalog()}
            />
            <Button
              label={tr("agents.createBot")}
              leadingIcon="plus"
              variant="primary"
              size="md"
              accessibilityLabel="agents-create-bot"
              disabled={isRemoteAgentWorkspace()}
              tooltip={isRemoteAgentWorkspace() ? tr("agents.unavailableRemote") : undefined}
              onPress={() => {
                resetToolFilterState();
                openCreateBotBuilder("mode");
              }}
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
          {/* Filter & Search Toolbar — locked to exact controlHeight.md (32px) baseline */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <SegmentedTabs
              size="md"
              options={[
                { value: "all", label: tr("agents.allBots"), badge: allCatalogAgents().length, accessibilityLabel: "agents-tab-all" },
                { value: "mode", label: tr("agents.primaryAgents"), badge: availableModes().length, accessibilityLabel: "agents-tab-mode" },
                { value: "subagent", label: tr("agents.subagents"), badge: availableSubagents().length, accessibilityLabel: "agents-tab-subagent" },
              ]}
              value={agentKindFilter()}
              onChange={next => agentKindFilter.set(next)}
            />

            <SearchInput
              size="md"
              value={agentSearchQuery()}
              placeholder={tr("agents.searchPlaceholder")}
              countLabel={
                hasActiveFilter()
                  ? `${formatCount(filteredAgents().length)}/${formatCount(allCatalogAgents().length)}`
                  : undefined
              }
              accessibilityLabel="agents-search-input"
              style={{ flex: 1, minWidth: 180 }}
              onChange={val => agentSearchQuery.set(val)}
            />

            <SelectDropdown
              size="md"
              options={sourceOptions()}
              value={agentSourceFilter()}
              accessibilityLabel="agents-source-select"
              minWidth={148}
              onChange={next => agentSourceFilter.set(next)}
            />

            <If when={hasActiveFilter()}>
              <Button
                label={tr("common.clear")}
                variant="ghost"
                size="md"
                accessibilityLabel="agents-filters-clear"
                onPress={resetCatalogFilters}
              />
            </If>
          </View>

          <If when={isRemoteAgentWorkspace()}>
            <InlineBanner
              tone="warning"
              message={tr("agents.remoteUnsupportedBanner")}
            />
          </If>

          <If when={peerScope()}>
            {scope => (
              <InlineBanner
                tone="info"
                icon="laptop"
                message={
                  peerSupports("tool_catalog") === false
                    ? tr("agents.peerNoToolCatalog", { label: scope().label })
                    : tr("agents.peerCatalogNotice", { label: scope().label })
                }
              />
            )}
          </If>

          <If when={agentsCatalogError() ?? ""}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>

          <If when={agentsNotice() ?? ""}>
            {notice => (
              <InlineBanner
                tone="neutral"
                icon="check-circle"
                message={localizeHostError(notice())}
                onDismiss={() => agentsNotice.set(null)}
              />
            )}
          </If>

          <If when={agentsLoading() && allCatalogAgents().length === 0}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }}>
              <Spinner size={14} />
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.4),
                }}
              >
                {tr("agents.loading")}
              </Text>
            </View>
          </If>

          <If when={!agentsLoading() && filteredAgents().length === 0}>
            <EmptyStateCard
              icon="bot"
              title={hasActiveFilter() ? tr("agents.emptyFilteredTitle") : tr("agents.emptyTitle")}
              subtitle={
                hasActiveFilter()
                  ? tr("agents.emptyFilteredSubtitle")
                  : tr("agents.emptySubtitle")
              }
              actionLabel={
                hasActiveFilter()
                  ? tr("common.resetFilter")
                  : isRemoteAgentWorkspace()
                    ? undefined
                    : tr("agents.createBot")
              }
              onAction={() => {
                if (hasActiveFilter()) {
                  resetCatalogFilters();
                } else {
                  resetToolFilterState();
                  openCreateBotBuilder("mode");
                }
              }}
            />
          </If>

          {/* Responsive 2-Column Studio Gallery Grid */}
          <If when={filteredAgents().length > 0}>
            <View
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 14,
              }}
            >
              <Each of={filteredAgents()} key={item => item.uid}>
                {item => <BotCard item={item()} />}
              </Each>
            </View>
          </If>
        </View>
      </Scroll>

      <AgentBuilderModal />
      <AgentDeleteModal />
    </View>
  );
}
