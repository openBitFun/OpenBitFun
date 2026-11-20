import { computed, effect, lifecycle, Scroll, signal, Text, untracked, View, type ViewRef } from "nsh";
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
  POOL_TOKEN_PREFIX,
  parentSubagents,
  parentSubagentsError,
  parentSubagentsFor,
  parentSubagentsLoading,
  parentSubagentSaving,
  setParentSubagentEnabled,
  modeSkills,
  modeSkillsError,
  modeSkillsFor,
  modeSkillsLoading,
  modeSkillsSaving,
  resetModeSkills,
  setModeSkillEnabled,
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
  agentCanDelete,
  agentCanEdit,
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
import { loadModels, modelSettingsLoaded, storedModels } from "../modelSettingsStore";
import { ensurePools, pools } from "../poolStore";
import { activeWorkspace, activeWorkspaceId } from "../state";
import { palette, textLineHeight, textSize, textTracking } from "../theme";
import { BotCharacter, type BotVariant } from "../ui/icons";
import { MOTION_DURATION, paintTransition, Spinner } from "../ui/motion";
import {
  GalleryGrid,
  GallerySkeleton,
  MoreMenu,
  StudioBody,
  StudioEmpty,
  StudioHeader,
  StudioSection,
  StudioToolbar,
  galleryCardHoverStyle,
  galleryCardStyle,
  studioCompact,
  trackStudioWidth,
} from "../ui/studio";
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
  IconButton,
  InlineBanner,
  InputBox,
  PillChip,
  SearchInput,
  SegmentedTabs,
  ToggleSwitch,
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

function editActionLabel(item: AgentCatalogItem): string {
  if (isCustomSource(item.source)) {
    return agentCanEdit(item) ? tr("common.edit") : tr("common.inspect");
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

/** Kind and identity line under a card's name: "Built-in · Standard". */
function cardMetaLine(item: AgentCatalogItem): string {
  return [cardBadgeLabel(item), distinctSubtitle(item)].filter(Boolean).join(" · ");
}

function botMenuItems(item: AgentCatalogItem): DropdownMenuItem[] {
  const open = () => {
    resetToolFilterState();
    void openAgentInspector(item);
  };
  const remote = !agentCanEdit(item);
  const items: DropdownMenuItem[] = isCustomSource(item.source)
    ? [
        {
          id: "edit",
          label: remote ? tr("agents.inspectBot") : tr("agents.editBot"),
          hint: remote ? tr("agents.remoteReadonlyHint") : tr("agents.editBotHint"),
          icon: remote ? "eye" : "edit",
          accessibilityLabel: `agent-menu-edit-${item.id}`,
          onSelect: open,
        },
      ]
    : [
        {
          id: "configure",
          label: item.source === "external" ? tr("agents.inspectBot") : tr("agents.configureTools"),
          icon: item.source === "external" ? "eye" : "sliders",
          accessibilityLabel: `agent-menu-configure-${item.id}`,
          onSelect: open,
        },
      ];
  items.push({
    id: "reload",
    label: tr("agents.reloadCatalog"),
    icon: "refresh",
    onSelect: () => void reloadAgentsCatalog(),
  });
  if (isCustomSource(item.source)) {
    items.push({
      id: "delete",
      label: tr("common.delete"),
      icon: "trash",
      danger: true,
      separator: true,
      disabled: !agentCanDelete(item),
      accessibilityLabel: `agent-menu-delete-${item.id}`,
      onSelect: () => confirmDeleteAgentUid.set(item.uid),
    });
  }
  return items;
}

/** A flat gallery card: avatar, name, one quiet status mark, description, actions. */
function BotCard(props: { item: AgentCatalogItem }) {
  const isDisabledSubagent = () => props.item.kind === "subagent" && !props.item.effectiveEnabled;

  return (
    <View
      style={{
        ...galleryCardStyle(),
        height: "100%",
        justifyContent: "space-between",
        gap: 12,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={galleryCardHoverStyle()}
    >
      <View style={{ gap: 10, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 }}>
          <View style={{ flexShrink: 0, opacity: isDisabledSubagent() ? 0.55 : 1 }}>
            <BotCharacter variant={harnessBotVariant(props.item)} seed={props.item.name} size={32} />
          </View>

          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
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
              {props.item.name}
            </Text>
            <Text
              style={{
                minWidth: 0,
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.35),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {cardMetaLine(props.item)}
            </Text>
          </View>

          <If when={isDisabledSubagent()}>
            <Text
              style={{
                flexShrink: 0,
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.35),
              }}
            >
              {tr("common.disabled")}
            </Text>
          </If>
        </View>

        <Text
          style={{
            minWidth: 0,
            color: palette().textSecondary,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.5),
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
          {botSummaryLine(props.item)}
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
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
          accessibilityLabel={`agent-configure-${props.item.id}`}
          onPress={() => {
            resetToolFilterState();
            void openAgentInspector(props.item);
          }}
        />
        <View style={{ flex: 1, minWidth: 0 }} />
        <MoreMenu
          accessibilityLabel={`agent-actions-${props.item.id}`}
          tooltip={tr("agents.botActions")}
          items={botMenuItems(props.item)}
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
            <ParentSubagentsSection />
            <ModeSkillsSection />

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
                      accessibilityLabel: `subagent-parent-${mode.id}`,
                    }))}
                    value={builderDraft().parentChosen ? builderDraft().parentAgentType : null}
                    placeholder={tr("agents.chooseParent")}
                    accessibilityLabel="subagent-parent-select"
                    onChange={next => updateBuilderDraft({ parentAgentType: next, parentChosen: true })}
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
            <ParentSubagentsSection />
            <ModeSkillsSection />
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
                    accessibilityLabel: `subagent-parent-${mode.id}`,
                  }))}
                  value={builderDraft().parentChosen ? builderDraft().parentAgentType : null}
                  placeholder={tr("agents.chooseParent")}
                  accessibilityLabel="subagent-parent-select"
                  onChange={next => updateBuilderDraft({ parentAgentType: next, parentChosen: true })}
                />
              </ConfigRow>

              <ConfigRow
                label={tr("agents.modelOverride")}
                description={tr("agents.modelSelectorHint")}
                controlAlign="stretch"
                divider={false}
              >
                <SelectDropdown
                  size="md"
                  fullWidth
                  searchable
                  options={subagentModelOptions(true)}
                  value={builderDraft().model}
                  accessibilityLabel="subagent-model-select"
                  onChange={model => updateBuilderDraft({ model })}
                />
              </ConfigRow>
            </ConfigSection>

            <ConfigSection
              title={tr("agents.defaultToolsTitle", { count: formatCount(builderDraft().tools.length) })}
            >
              <ToolListText empty={tr("agents.noDefaultTools")} />
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
              <ToolListText empty={tr("agents.noToolBindings")} />
            </View>
          </ConfigSection>
        </If>
      </View>
    </ModalDialog>
  );
}

/** The draft's tools as one quiet, selectable line instead of a wall of badges. */
function ToolListText(props: { empty: string }) {
  return (
    <Text
      style={{
        minWidth: 0,
        color: builderDraft().tools.length > 0 ? palette().textSecondary : palette().textMuted,
        fontSize: textSize(13),
        lineHeight: textLineHeight(13, 1.55),
        userSelect: "text",
      }}
    >
      {builderDraft().tools.length > 0 ? builderDraft().tools.join(" · ") : props.empty}
    </Text>
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

/** The skills one primary agent runs with; each switch rewrites that agent's selection. */
function ModeSkillsSection() {
  const visible = () =>
    builderDraft().kind === "mode" &&
    (builderDraft().mode === "configure-profile" || builderDraft().mode === "edit-custom") &&
    modeSkillsFor() === builderDraft().id;
  return (
    <If when={visible()}>
      <ConfigSection
        title={tr("agents.modeSkillsTitle")}
        subtitle={tr("agents.modeSkillsHint")}
        flush
        controlWidth={120}
        extra={
          <Button
            label={tr("common.reset")}
            variant="ghost"
            size="sm"
            disabled={modeSkillsSaving() || isRemoteAgentWorkspace()}
            accessibilityLabel="mode-skills-reset"
            onPress={() => void resetModeSkills(builderDraft().id)}
          />
        }
      >
        <If when={modeSkillsError() ?? ""}>
          {err => (
            <View style={{ padding: 12 }}>
              <InlineBanner tone="danger" message={localizeHostError(err())} />
            </View>
          )}
        </If>
        <If when={!modeSkillsLoading() && modeSkills().length === 0 && !modeSkillsError()}>
          <View style={{ padding: 14 }}>
            <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
              {tr("agents.modeSkillsEmpty")}
            </Text>
          </View>
        </If>
        <Each of={modeSkills()} key={row => row.key}>
          {(row, index) => (
            <ConfigRow
              label={row().name}
              description={
                row().globallyEnabled ? row().description : tr("agents.modeSkillGloballyOff")
              }
              divider={index() < modeSkills().length - 1}
            >
              <ToggleSwitch
                value={row().effectiveEnabled}
                disabled={modeSkillsSaving() || !row().globallyEnabled || isRemoteAgentWorkspace()}
                accessibilityLabel={`mode-skill-${row().key}`}
                onChange={next => void setModeSkillEnabled(builderDraft().id, row().key, next)}
              />
            </ConfigRow>
          )}
        </Each>
      </ConfigSection>
    </If>
  );
}

/** The subagents a primary agent may call, each switchable for that agent only. */
function ParentSubagentsSection() {
  const visible = () =>
    builderDraft().kind === "mode" &&
    (builderDraft().mode === "configure-profile" || builderDraft().mode === "edit-custom") &&
    parentSubagentsFor() === builderDraft().id;
  return (
    <If when={visible()}>
      <ConfigSection
        title={tr("agents.parentSubagentsTitle")}
        subtitle={tr("agents.parentSubagentsHint")}
        flush
        controlWidth={120}
      >
        <If when={parentSubagentsError() ?? ""}>
          {err => (
            <View style={{ padding: 12 }}>
              <InlineBanner tone="danger" message={localizeHostError(err())} />
            </View>
          )}
        </If>
        <If when={parentSubagentsLoading() && parentSubagents().length === 0}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 14 }}>
            <Spinner size={14} />
            <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
              {tr("common.loading")}
            </Text>
          </View>
        </If>
        <If when={!parentSubagentsLoading() && parentSubagents().length === 0 && !parentSubagentsError()}>
          <View style={{ padding: 14 }}>
            <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
              {tr("agents.parentSubagentsEmpty")}
            </Text>
          </View>
        </If>
        <Each of={parentSubagents()} key={item => item.uid}>
          {(item, index) => (
            <ConfigRow
              label={item().name}
              description={item().description || item().id}
              divider={index() < parentSubagents().length - 1}
            >
              <ToggleSwitch
                value={item().effectiveEnabled}
                disabled={Boolean(parentSubagentSaving()) || isRemoteAgentWorkspace()}
                accessibilityLabel={`parent-subagent-${item().id}`}
                onChange={next => void setParentSubagentEnabled(builderDraft().id, item().id, next)}
              />
            </ConfigRow>
          )}
        </Each>
      </ConfigSection>
    </If>
  );
}

/** The model choices a subagent can take, as the desktop's agent model selector lists them. */
function subagentModelOptions(includePools: boolean): SelectDropdownOption<string>[] {
  const options: SelectDropdownOption<string>[] = [
    { value: "", label: tr("agents.modelDefault"), accessibilityLabel: "subagent-model-default" },
    { value: "inherit", label: tr("agents.modelInherit"), accessibilityLabel: "subagent-model-inherit" },
    { value: "primary", label: tr("agents.modelPrimary"), accessibilityLabel: "subagent-model-primary" },
    { value: "fast", label: tr("agents.modelFast"), accessibilityLabel: "subagent-model-fast" },
  ];
  for (const model of storedModels()) {
    if (!model.id || model.enabled === false) continue;
    options.push({
      value: model.id,
      label: model.name || model.model_name || model.id,
      description: model.model_name && model.model_name !== model.name ? model.model_name : undefined,
      accessibilityLabel: `subagent-model-${model.id}`,
    });
  }
  if (includePools) {
    for (const pool of pools()) {
      options.push({
        value: `${POOL_TOKEN_PREFIX}${pool.id}`,
        label: tr("agents.modelPool", { name: pool.name }),
        icon: "layers",
        accessibilityLabel: `subagent-model-pool-${pool.id}`,
      });
    }
  }
  // A stored choice this list no longer offers stays visible instead of reading as unset.
  const current = builderDraft().model.trim();
  if (current && !options.some(option => option.value === current)) {
    options.push({ value: current, label: current });
  }
  return options;
}

// The gallery is drawn in two sections; each reads its own slice so a filter
// change recomputes once instead of per card.
const filteredModeAgents = computed(() => filteredAgents().filter(item => item.kind === "mode"));
const filteredSubagentAgents = computed(() => filteredAgents().filter(item => item.kind === "subagent"));

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

export function AgentsScene() {
  if (!modelSettingsLoaded()) void loadModels();
  ensurePools();
  // The catalogue does not need a workspace (the host answers user-level
  // entries without one, as the desktop asks). It reloads on every scene entry,
  // when the workspace or Peer changes, and when the window regains focus.
  let enteredScene = false;
  effect(() => {
    const workspace = activeWorkspace();
    const peer = peerScope();
    const key = `${peer?.deviceId ?? "local"}:${workspace?.id ?? "none"}:${workspace?.rootPath ?? ""}`;
    if (!enteredScene || untracked(() => agentsLoadedKey()) !== key) {
      enteredScene = true;
      void loadAgentsCatalog(key);
    }
  });
  let lastLifecycle = untracked(() => lifecycle());
  effect(() => {
    const state = lifecycle();
    const regained = state === "active" && lastLifecycle !== "active";
    lastLifecycle = state;
    if (!regained) return;
    const workspace = untracked(() => activeWorkspace());
    const peer = untracked(() => peerScope());
    const key = `${peer?.deviceId ?? "local"}:${workspace?.id ?? "none"}:${workspace?.rootPath ?? ""}`;
    void loadAgentsCatalog(key);
  });

  const openCreate = () => {
    resetToolFilterState();
    openCreateBotBuilder("mode");
  };

  return (
    <View
      onLayout={trackStudioWidth}
      style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column", backgroundColor: palette().canvas }}
    >
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <StudioHeader
          title={tr("agents.title")}
          subtitle={tr("agents.pageSubtitle")}
          actions={
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
                onPress={openCreate}
              />
            </View>
          }
          extra={
            <StudioToolbar
              leading={
                <SegmentedTabs
                  size="sm"
                  options={[
                    { value: "all", label: tr("common.all"), accessibilityLabel: "agents-tab-all" },
                    { value: "mode", label: tr("agents.tabPrimary"), accessibilityLabel: "agents-tab-mode" },
                    { value: "subagent", label: tr("agents.subagents"), accessibilityLabel: "agents-tab-subagent" },
                  ]}
                  value={agentKindFilter()}
                  onChange={next => agentKindFilter.set(next)}
                />
              }
              trailing={
                <>
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
                    style={{ flex: 1, minWidth: 160, maxWidth: studioCompact() ? undefined : 260 }}
                    onChange={val => agentSearchQuery.set(val)}
                  />
                  <FilterMenu
                    value={agentSourceFilter()}
                    defaultValue="all"
                    options={sourceOptions()}
                    accessibilityLabel="agents-source-select"
                    tooltip={tr("agents.sourceFilter")}
                    onChange={next => agentSourceFilter.set(next)}
                  />
                  <If when={hasActiveFilter()}>
                    <Button
                      label={tr("common.clear")}
                      variant="ghost"
                      size="sm"
                      accessibilityLabel="agents-filters-clear"
                      onPress={resetCatalogFilters}
                    />
                  </If>
                </>
              }
            />
          }
        />

        <StudioBody>
          <If when={isRemoteAgentWorkspace() || Boolean(peerScope()) || Boolean(agentsCatalogError()) || Boolean(agentsNotice())}>
            <View style={{ gap: 8 }}>
              <If when={isRemoteAgentWorkspace()}>
                <InlineBanner tone="warning" message={tr("agents.remoteUnsupportedBanner")} />
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
            </View>
          </If>

          <If when={agentsLoading() && allCatalogAgents().length === 0}>
            <GallerySkeleton count={4} height={156} />
          </If>

          <If when={!agentsLoading() && filteredAgents().length === 0}>
            <StudioEmpty
              icon="bot"
              message={hasActiveFilter() ? tr("agents.emptyFilteredTitle") : tr("agents.emptyTitle")}
              detail={hasActiveFilter() ? tr("agents.emptyFilteredSubtitle") : tr("agents.emptySubtitle")}
              action={
                hasActiveFilter() ? (
                  <Button
                    label={tr("common.resetFilter")}
                    variant="secondary"
                    size="sm"
                    onPress={resetCatalogFilters}
                  />
                ) : isRemoteAgentWorkspace() ? undefined : (
                  <Button
                    label={tr("agents.createBot")}
                    variant="secondary"
                    size="sm"
                    leadingIcon="plus"
                    onPress={openCreate}
                  />
                )
              }
            />
          </If>

          <If when={filteredModeAgents().length > 0}>
            <StudioSection
              title={tr("agents.sectionPrimary")}
              trailing={<SectionCount count={filteredModeAgents().length} />}
            >
              <GalleryGrid>
                <Each of={filteredModeAgents()} key={item => item.uid}>
                  {item => <BotCard item={item()} />}
                </Each>
              </GalleryGrid>
            </StudioSection>
          </If>

          <If when={filteredSubagentAgents().length > 0}>
            <StudioSection
              title={tr("agents.subagents")}
              trailing={<SectionCount count={filteredSubagentAgents().length} />}
            >
              <GalleryGrid>
                <Each of={filteredSubagentAgents()} key={item => item.uid}>
                  {item => <BotCard item={item()} />}
                </Each>
              </GalleryGrid>
            </StudioSection>
          </If>
        </StudioBody>
      </Scroll>

      <AgentBuilderModal />
      <AgentDeleteModal />
    </View>
  );
}
