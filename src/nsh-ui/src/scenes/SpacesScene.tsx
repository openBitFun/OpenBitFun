import { effect, Scroll, signal, Text, View, type ViewRef } from "nsh";
import { Editor } from "nsh/base";
import { formatCount, formatPlural } from "../format";
import { localizeHostError, tr } from "../i18n";
import { peerScope } from "../peerState";
import {
  cancelDeleteSpace,
  closeSpaceInspector,
  confirmDeleteSpace,
  confirmingDeleteSpaceId,
  createSpaceWithAgent,
  inspectSpace,
  loadSpaces,
  requestDeleteSpace,
  runningSpaceWorkers,
  runningWorkerSet,
  selectedSpaceDetail,
  selectedSpaceId,
  selectedSpaceSourceCode,
  selectedSpaceVersions,
  spaceInspectorBusy,
  spacePrompt,
  spaces,
  spacesBusy,
  spacesError,
  spacesNotice,
  spaceSourceTab,
  spacesPeerNotice,
  stopSpaceWorker,
  summarizeSpacePermissions,
  type SpaceMeta,
  type SpaceSourceTab,
} from "../spacesStore";
import { fontMono, palette, radii, textLineHeight, textSize, textTracking } from "../theme";
import { BotCharacter, Icon } from "../ui/icons";
import { createEditorStyles, inferCodeLanguage } from "../ui/markdown";
import { MOTION_DURATION, paintTransition, Spinner } from "../ui/motion";
import {
  DropdownMenu,
  ModalDialog,
  type DropdownMenuItem,
} from "../ui/overlays";
import {
  Badge,
  Button,
  ConfigSection,
  EmptyStateCard,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  PillChip,
  SegmentedTabs,
  StatusPill,
  type SegmentedTabOption,
} from "../ui/primitives";

function sourceTabs(): ReadonlyArray<SegmentedTabOption<SpaceSourceTab>> {
  return [
    { value: "html", label: tr("spaces.tabHtml") },
    { value: "css", label: tr("spaces.tabCss") },
    { value: "ui_js", label: tr("spaces.tabUiJs") },
    { value: "worker_js", label: tr("spaces.tabWorkerJs") },
  ];
}

function spacePromptStarters(): ReadonlyArray<{ id: string; label: string; prompt: string }> {
  return [
    {
      id: "sprint",
      label: tr("spaces.starterSprintTitle"),
      prompt: tr("spaces.starterSprintPrompt"),
    },
    {
      id: "pomodoro",
      label: tr("spaces.starterPomodoroTitle"),
      prompt: tr("spaces.starterPomodoroPrompt"),
    },
    {
      id: "log",
      label: tr("spaces.starterLogTitle"),
      prompt: tr("spaces.starterLogPrompt"),
    },
  ];
}

function localizePermission(raw: string): string {
  if (raw === "Filesystem") return tr("spaces.permFilesystem");
  if (raw === "Shell") return tr("spaces.permShell");
  if (raw === "Network") return tr("spaces.permNetwork");
  if (raw === "Node/Bun Worker") return tr("spaces.permNodeWorker");
  if (raw === "AI Bridge") return tr("spaces.permAiBridge");
  if (raw === "Agent Bridge") return tr("spaces.permAgentBridge");
  if (raw === "Sandboxed UI") return tr("spaces.permSandboxedUi");
  return raw;
}

const CARD_PERMISSION_CAP = 3;
const INSPECTOR_TAG_CAP = 8;

function sourceTabFilename(tab: SpaceSourceTab): string {
  if (tab === "html") return "index.html";
  if (tab === "css") return "styles.css";
  if (tab === "ui_js") return "ui.js";
  return "worker.js";
}

function sourceLineCount(code: string): number {
  if (!code) return 0;
  return code.split(/\r?\n/).length;
}

function SpaceCard(props: { space: () => SpaceMeta }) {
  const menuOpen = signal(false);
  const anchorRef = signal<ViewRef | null>(null);
  const isRunning = () => runningWorkerSet().has(props.space().id);
  const isSelected = () => selectedSpaceId() === props.space().id;
  const allPermissions = () => summarizeSpacePermissions(props.space().permissions);
  const visiblePermissions = () => allPermissions().slice(0, CARD_PERMISSION_CAP);
  const overflowPermCount = () => Math.max(0, allPermissions().length - CARD_PERMISSION_CAP);

  const menuItems = (): DropdownMenuItem[] => [
    {
      id: "inspect",
      label: tr("spaces.inspectSource"),
      icon: "code",
      accessibilityLabel: `space-menu-inspect-${props.space().id}`,
      onSelect: () => void inspectSpace(props.space().id),
    },
    {
      id: "stop",
      label: tr("spaces.stopWorkerTitle"),
      icon: "stop",
      disabled: !isRunning(),
      accessibilityLabel: `space-menu-stop-${props.space().id}`,
      onSelect: () => void stopSpaceWorker(props.space().id),
    },
    { id: "sep", label: "", separator: true },
    {
      id: "delete",
      label: tr("spaces.deleteSpace"),
      icon: "trash",
      danger: true,
      accessibilityLabel: `space-menu-delete-${props.space().id}`,
      onSelect: () => requestDeleteSpace(props.space().id),
    },
  ];

  return (
    <View
      style={{
        minWidth: 0,
        height: "100%",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 18,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: isSelected() ? palette().borderFocus : palette().border,
        backgroundColor: palette().panelRaised,
        boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
        gap: 14,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: palette().panelHover,
        borderColor: isSelected() ? palette().borderFocus : palette().borderStrong,
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
              borderColor: isRunning() ? palette().successBorder : palette().borderSubtle,
              backgroundColor: isRunning() ? palette().successSoft : palette().surfaceSubtle,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BotCharacter
              seed={props.space().name}
              size={34}
              ringColor={palette().panelRaised}
              status={isRunning() ? "running" : ""}
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
                {props.space().name}
              </Text>
              <If when={isRunning()}>
                <StatusPill label={tr("common.running")} kind="success" />
              </If>
            </View>
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
              {`${props.space().category} · v${props.space().version} · ${props.space().runtimeProfile}`}
            </Text>
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
          {props.space().description || tr("common.noDescription")}
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Each of={visiblePermissions()} key={p => p}>
            {perm => <Badge label={localizePermission(perm())} tone="neutral" />}
          </Each>
          <If when={overflowPermCount() > 0}>
            <Badge label={`+${overflowPermCount()}`} tone="neutral" />
          </If>
        </View>
      </View>

      <View
        style={{
          gap: 10,
          paddingTop: 12,
          borderTopWidth: 1,
          borderColor: palette().borderSubtle,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
            <Button
              label={tr("common.inspect")}
              size="sm"
              variant="secondary"
              leadingIcon="code"
              accessibilityLabel={`space-inspect-${props.space().id}`}
              onPress={() => void inspectSpace(props.space().id)}
            />
            <If when={isRunning()}>
              <Button
                label={tr("spaces.stopWorker")}
                size="sm"
                variant="outline"
                leadingIcon="stop"
                disabled={spacesBusy()}
                accessibilityLabel={`space-stop-${props.space().id}`}
                onPress={() => void stopSpaceWorker(props.space().id)}
              />
            </If>
          </View>

          <View ref={el => anchorRef.set(el)} style={{ flexShrink: 0 }}>
            <IconButton
              icon="more"
              size="sm"
              active={menuOpen()}
              accessibilityLabel={`space-more-${props.space().id}`}
              tooltip={tr("spaces.spaceActions")}
              onPress={() => menuOpen.update(open => !open)}
            />
          </View>
        </View>

        <If when={confirmingDeleteSpaceId() === props.space().id}>
          <InlineConfirmBar
            danger
            message={tr("spaces.deleteConfirmCard", { name: props.space().name })}
            confirmLabel={tr("common.delete")}
            cancelLabel={tr("common.cancel")}
            onConfirm={() => void confirmDeleteSpace(props.space().id)}
            onCancel={() => cancelDeleteSpace()}
          />
        </If>
      </View>

      <DropdownMenu
        open={menuOpen()}
        anchor={anchorRef()}
        align="end"
        minWidth={210}
        items={menuItems()}
        onClose={() => menuOpen.set(false)}
      />
    </View>
  );
}

function SpaceInspectorModal() {
  const lineCount = () => sourceLineCount(selectedSpaceSourceCode());

  return (
    <ModalDialog
      open={Boolean(selectedSpaceId())}
      title={selectedSpaceDetail()?.name ?? tr("spaces.inspectTitle")}
      subtitle={
        selectedSpaceDetail()
          ? `${selectedSpaceDetail()!.category} · v${selectedSpaceDetail()!.version} · ${selectedSpaceDetail()!.runtimeProfile}`
          : tr("spaces.loadingMeta")
      }
      size="lg"
      onClose={() => closeSpaceInspector()}
      footer={
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <If when={Boolean(selectedSpaceId())}>
            <Button
              label={tr("spaces.deleteSpace")}
              variant="danger"
              size="md"
              leadingIcon="trash"
              disabled={spacesBusy()}
              accessibilityLabel="space-inspector-delete"
              onPress={() => {
                const id = selectedSpaceId();
                if (id) requestDeleteSpace(id);
              }}
            />
          </If>

          <View style={{ flex: 1, minWidth: 8 }} />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <If when={Boolean(selectedSpaceId() && runningWorkerSet().has(selectedSpaceId()!))}>
              <Button
                label={tr("spaces.stopWorkerTitle")}
                variant="outline"
                size="md"
                leadingIcon="stop"
                disabled={spacesBusy()}
                accessibilityLabel="space-inspector-stop"
                onPress={() => {
                  const id = selectedSpaceId();
                  if (id) void stopSpaceWorker(id);
                }}
              />
            </If>
            <Button
              label={tr("common.close")}
              variant="secondary"
              size="md"
              accessibilityLabel="space-inspector-close"
              onPress={() => closeSpaceInspector()}
            />
          </View>
        </View>
      }
    >
      <View style={{ gap: 16 }}>
        {/* Calm inline note instead of heavy notice rectangle */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            paddingHorizontal: 2,
          }}
        >
          <Icon name="info" size={13} color={palette().textMuted} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.44),
            }}
          >
            {tr("spaces.inspectorWebviewHint")}
          </Text>
        </View>

        <If when={spaceInspectorBusy()}>
          <View style={{ padding: 24, alignItems: "center", gap: 8 }}>
            <Spinner size={18} />
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
              }}
            >
              {tr("spaces.loadingSource")}
            </Text>
          </View>
        </If>

        <If when={!spaceInspectorBusy() && !selectedSpaceDetail() && Boolean(spacesError())}>
          <InlineBanner tone="danger" message={localizeHostError(spacesError())} />
        </If>

        <If when={Boolean(confirmingDeleteSpaceId() && confirmingDeleteSpaceId() === selectedSpaceId())}>
          <InlineConfirmBar
            danger
            message={tr("spaces.deleteConfirmModal", {
              name: selectedSpaceDetail()?.name ?? selectedSpaceId() ?? "",
            })}
            confirmLabel={tr("spaces.deleteSpace")}
            cancelLabel={tr("common.cancel")}
            onConfirm={() => {
              const id = selectedSpaceId();
              if (id) void confirmDeleteSpace(id);
            }}
            onCancel={() => cancelDeleteSpace()}
          />
        </If>

        <If when={!spaceInspectorBusy() ? selectedSpaceDetail() : null}>
          {detail => (
            <View style={{ gap: 16 }}>
              <Text
                style={{
                  minWidth: 0,
                  color: palette().textSecondary,
                  fontSize: textSize(12.5),
                  lineHeight: textLineHeight(12.5, 1.5),
                }}
              >
                {detail().description || tr("spaces.noManifestDesc")}
              </Text>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <Each of={summarizeSpacePermissions(detail().permissions)} key={p => `perm:${p}`}>
                  {perm => <Badge label={localizePermission(perm())} tone="accent" />}
                </Each>
                <Each of={detail().tags.slice(0, INSPECTOR_TAG_CAP)} key={tag => `tag:${tag}`}>
                  {tag => <Badge label={tag()} tone="neutral" />}
                </Each>
                <If when={detail().tags.length > INSPECTOR_TAG_CAP}>
                  <Badge
                    label={tr("spaces.overflowTags", {
                      count: formatCount(detail().tags.length - INSPECTOR_TAG_CAP),
                    })}
                    tone="neutral"
                  />
                </If>
              </View>

              <If when={detail().originalPrompt}>
                {prompt => (
                  <ConfigSection title={tr("spaces.originalPrompt")}>
                    <Text
                      style={{
                        minWidth: 0,
                        color: palette().text,
                        fontSize: textSize(12.5),
                        lineHeight: textLineHeight(12.5, 1.52),
                      }}
                    >
                      {prompt()}
                    </Text>
                  </ConfigSection>
                )}
              </If>

              <If when={selectedSpaceVersions().length > 0}>
                <ConfigSection
                  title={tr("spaces.savedVersions", {
                    count: formatCount(selectedSpaceVersions().length),
                  })}
                >
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    <Each of={selectedSpaceVersions()} key={v => v.version}>
                      {ver => (
                        <Badge
                          label={ver().label}
                          tone={ver().label === `v${detail().version}` ? "accent" : "neutral"}
                        />
                      )}
                    </Each>
                  </View>
                </ConfigSection>
              </If>

              {/* Syntax-highlighted Read-Only Source Bundle Viewer */}
              <View style={{ gap: 10 }}>
                <SegmentedTabs
                  size="md"
                  options={sourceTabs()}
                  value={spaceSourceTab()}
                  onChange={next => spaceSourceTab.set(next)}
                />

                <View
                  style={{
                    borderRadius: radii.md,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().border,
                    backgroundColor: palette().canvas,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderColor: palette().borderSubtle,
                      backgroundColor: palette().surfaceTertiary,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <Icon name="file-code" size={12} color={palette().textMuted} />
                      <Text
                        style={{
                          minWidth: 0,
                          color: palette().textSecondary,
                          fontFamily: fontMono,
                          fontSize: textSize(11.5),
                          fontWeight: "500",
                          lineHeight: textLineHeight(11.5, 1.35),
                          numberOfLines: 1,
                          textOverflow: "ellipsis",
                        }}
                      >
                        {sourceTabFilename(spaceSourceTab())}
                      </Text>
                    </View>
                    <Text
                      style={{
                        flexShrink: 0,
                        color: palette().textMuted,
                        fontFamily: fontMono,
                        fontSize: textSize(11),
                        fontVariant: ["tabular-nums"],
                        lineHeight: textLineHeight(11, 1.35),
                      }}
                    >
                      {formatPlural(lineCount(), "format.lineOne", "format.lineOther")}
                    </Text>
                  </View>

                  <View style={{ height: 280 }}>
                    <Editor
                      value={selectedSpaceSourceCode()}
                      language={inferCodeLanguage(sourceTabFilename(spaceSourceTab()))}
                      readOnly={true}
                      lineNumbers={true}
                      fontSize={textSize(12)}
                      softWrap={true}
                      styles={createEditorStyles()}
                      accessibilityLabel="space-source-editor"
                      style={{ flex: 1 }}
                    />
                  </View>
                </View>
              </View>
            </View>
          )}
        </If>
      </View>
    </ModalDialog>
  );
}

export function SpacesScene() {
  effect(() => {
    const scopeKey = peerScope()?.deviceId ?? "local";
    void scopeKey;
    void loadSpaces();
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
            <Icon name="layout-grid" size={17} color={palette().accent} />
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
                {tr("spaces.title")}
              </Text>
              <Badge
                label={tr("spaces.installedCount", { count: formatCount(spaces().length) })}
                tone="neutral"
              />
              <If when={runningSpaceWorkers().length > 0}>
                <StatusPill
                  label={tr("spaces.activeWorkers", { count: runningSpaceWorkers().length })}
                  kind="success"
                />
              </If>
            </View>
            <Text
              style={{
                maxWidth: 620,
                color: palette().textMuted,
                fontSize: textSize(12.5),
                lineHeight: textLineHeight(12.5, 1.44),
              }}
            >
              {tr("spaces.subtitle")}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <If when={spacesBusy()}>
              <Spinner size={14} />
            </If>
            <IconButton
              icon="refresh"
              size="md"
              accessibilityLabel="spaces-refresh"
              tooltip={tr("spaces.refreshTooltip")}
              disabled={spacesBusy()}
              onPress={() => void loadSpaces()}
            />
          </View>
        </View>
      </View>

      <Scroll
        style={{ flex: 1, minHeight: 0 }}
        contentStyle={{ paddingHorizontal: 24, paddingVertical: 20, alignItems: "center" }}
      >
        <View style={{ width: "100%", maxWidth: 960, gap: 20 }}>
          <If when={spacesError()}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>

          <If when={spacesNotice() && !spacesError()}>
            <InlineBanner
              tone="success"
              message={localizeHostError(spacesNotice() ?? "")}
              onDismiss={() => spacesNotice.set("")}
            />
          </If>
          {/* Prominent warning in Peer mode; understated inline note locally */}
          <If when={spacesPeerNotice()}>
            {notice => <InlineBanner tone="warning" message={notice()} />}
          </If>

          <If when={!spacesPeerNotice()}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
                paddingHorizontal: 2,
              }}
            >
              <Icon name="info" size={13} color={palette().textMuted} />
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.44),
                }}
              >
                {tr("spaces.desktopWebviewHint")}
              </Text>
            </View>
          </If>

          {/* Elevated Space Creation Launchpad matching Sessions Composer craft */}
          <View
            style={{
              padding: 20,
              borderRadius: 16,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().border,
              backgroundColor: palette().surfaceElevated,
              boxShadow: `${palette().shadowComposer}, ${palette().innerHighlight}`,
              gap: 14,
              ...paintTransition(MOTION_DURATION.fast),
            }}
            focusWithinStyle={{
              borderColor: palette().fieldFocusBorder,
              boxShadow: palette().shadowComposerFocus,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
              <Icon name="sparkles" size={16} color={palette().accent} />
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().text,
                  fontSize: textSize(15),
                  fontWeight: "600",
                  letterSpacing: textTracking(15),
                  lineHeight: textLineHeight(15, 1.3),
                }}
              >
                {tr("spaces.createTitle")}
              </Text>
              <Badge label={tr("agents.modeUltimate")} tone="accent" />
            </View>

            <InputBox
              value={spacePrompt()}
              multiline
              minHeight={76}
              placeholder={tr("spaces.promptPlaceholder")}
              accessibilityLabel="spaces-prompt-input"
              onChange={val => spacePrompt.set(val)}
            />

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Each of={spacePromptStarters()} key={s => s.id}>
                {starter => (
                  <PillChip
                    label={starter().label}
                    icon="sparkles"
                    onPress={() => spacePrompt.set(starter().prompt)}
                  />
                )}
              </Each>
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
                paddingTop: 12,
                borderTopWidth: 1,
                borderColor: palette().borderSubtle,
              }}
            >
              <Text
                style={{
                  flex: 1,
                  minWidth: 180,
                  color: palette().textElevatedMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.44),
                }}
              >
                {tr("spaces.createSubtitle")}
              </Text>
              <Button
                label={tr("spaces.createWithAgent")}
                variant="primary"
                size="md"
                leadingIcon="sparkles"
                disabled={!spacePrompt().trim()}
                accessibilityLabel="spaces-create-agent"
                onPress={() => void createSpaceWithAgent()}
              />
            </View>
          </View>

          {/* Responsive 2-Column Studio MiniApp Gallery Grid */}
          <View style={{ gap: 12 }}>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(15),
                fontWeight: "600",
                letterSpacing: textTracking(15),
                fontVariant: ["tabular-nums"],
                lineHeight: textLineHeight(15, 1.3),
              }}
            >
              {tr("spaces.installedTitle", { count: formatCount(spaces().length) })}
            </Text>

            <If when={spaces().length === 0 && !spacesBusy()}>
              <EmptyStateCard
                icon="layout-grid"
                title={tr("spaces.emptyTitle")}
                subtitle={tr("spaces.emptySubtitle")}
              />
            </If>

            <If when={spaces().length > 0}>
              <View
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                  gap: 14,
                }}
              >
                <Each of={spaces()} key={item => item.id}>
                  {item => <SpaceCard space={item} />}
                </Each>
              </View>
            </If>
          </View>
        </View>
      </Scroll>

      <SpaceInspectorModal />
    </View>
  );
}
