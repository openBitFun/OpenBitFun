import { cleanup, effect, Scroll, Text, View } from "nsh";
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
  spaceCreating,
  spaceCreationBlockedReason,
  spacesInitialLoad,
  stopSpaceWorker,
  subscribeSpaceEvents,
  summarizeSpacePermissions,
  type SpaceMeta,
  type SpaceSourceTab,
} from "../spacesStore";
import { fontMono, palette, radii, textLineHeight, textSize } from "../theme";
import { Icon, type IconName } from "../ui/icons";
import { createEditorStyles, inferCodeLanguage } from "../ui/markdown";
import { MOTION_DURATION, paintTransition, Spinner } from "../ui/motion";
import { ModalDialog, type DropdownMenuItem } from "../ui/overlays";
import {
  Button,
  ConfigSection,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  PillChip,
  SegmentedTabs,
  StatusDot,
  type SegmentedTabOption,
} from "../ui/primitives";
import {
  GalleryGrid,
  GallerySkeleton,
  MoreMenu,
  StudioBody,
  StudioEmpty,
  StudioHeader,
  StudioSection,
  galleryCardHoverStyle,
  galleryCardStyle,
  studioCompact,
  trackStudioWidth,
} from "../ui/studio";

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

/**
 * Manifest icon names the desktop's miniAppIcons map knows (kebab-case lucide
 * names), projected onto glyphs this surface draws. Unknown names fall back
 * to the package glyph, as the desktop falls back to lucide's Box.
 */
const SPACE_ICON_MAP: Readonly<Record<string, IconName>> = {
  "app-window": "layers",
  aperture: "compass",
  bot: "bot",
  box: "package",
  code: "code",
  database: "database",
  "file-text": "file-text",
  "git-pull-request": "git-pull-request",
  globe: "globe",
  "grid-3x3": "layout-grid",
  image: "image",
  "layout-grid": "layout-grid",
  presentation: "monitor",
  regex: "hash",
  rocket: "zap",
  settings: "settings",
  sparkles: "sparkles",
  terminal: "terminal",
  workflow: "network",
  wrench: "wrench",
};

export function spaceIconName(icon: string): IconName {
  const key = icon
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  return SPACE_ICON_MAP[key] ?? "package";
}

/** A quiet inline list: "Permissions  Filesystem · Network". Each item is its own text. */
function QuietList(props: { label: string; items: ReadonlyArray<string>; overflow?: string }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 6, rowGap: 2, minWidth: 0 }}>
      <Text
        style={{
          color: palette().textMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.45),
          marginRight: 4,
        }}
      >
        {props.label}
      </Text>
      <Each of={props.items} key="index">
        {(item, index) => (
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
            <If when={index() > 0}>
              <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.45) }}>
                ·
              </Text>
            </If>
            <Text
              style={{
                color: palette().textSecondary,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.45),
              }}
            >
              {item()}
            </Text>
          </View>
        )}
      </Each>
      <If when={props.overflow ?? ""}>
        {more => (
          <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.45) }}>
            {more()}
          </Text>
        )}
      </If>
    </View>
  );
}

function spaceMenuItems(space: SpaceMeta, running: boolean): DropdownMenuItem[] {
  return [
    {
      id: "inspect",
      label: tr("spaces.inspectSource"),
      icon: "code",
      accessibilityLabel: `space-menu-inspect-${space.id}`,
      onSelect: () => void inspectSpace(space.id),
    },
    {
      id: "stop",
      label: tr("spaces.stopWorkerTitle"),
      icon: "stop",
      disabled: !running,
      accessibilityLabel: `space-menu-stop-${space.id}`,
      onSelect: () => void stopSpaceWorker(space.id),
    },
    { id: "sep", label: "", separator: true },
    {
      id: "delete",
      label: tr("spaces.deleteSpace"),
      icon: "trash",
      danger: true,
      accessibilityLabel: `space-menu-delete-${space.id}`,
      onSelect: () => requestDeleteSpace(space.id),
    },
  ];
}

/**
 * A flat gallery card. The card body opens the inspector; the "…" menu sits
 * beside it as a sibling so a press never reaches both.
 */
function SpaceCard(props: { space: () => SpaceMeta }) {
  const isRunning = () => runningWorkerSet().has(props.space().id);
  const isSelected = () => selectedSpaceId() === props.space().id;
  const permissionLine = () => {
    const all = summarizeSpacePermissions(props.space().permissions).map(localizePermission);
    const shown = all.slice(0, CARD_PERMISSION_CAP).join(" · ");
    const overflow = all.length - CARD_PERMISSION_CAP;
    return overflow > 0 ? `${shown} +${overflow}` : shown;
  };

  return (
    <View
      style={{
        ...galleryCardStyle(),
        position: "relative",
        padding: 0,
        gap: 0,
        borderColor: isSelected() ? palette().borderFocus : palette().borderSubtle,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={galleryCardHoverStyle()}
    >
      <View
        role="button"
        accessibilityLabel={`space-inspect-${props.space().id}`}
        onPress={() => void inspectSpace(props.space().id)}
        style={{
          minHeight: 132,
          padding: 16,
          paddingRight: 48,
          gap: 6,
          minWidth: 0,
          cursor: "pointer",
          borderRadius: radii.lg,
        }}
        focusVisibleStyle={{ outlineWidth: 2, outlineColor: palette().borderFocus, outlineOffset: -2 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Icon name={spaceIconName(props.space().icon)} size={16} color={palette().textSecondary} />
          <Text
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette().text,
              fontSize: textSize(15),
              fontWeight: "600",
              lineHeight: textLineHeight(15, 1.3),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.space().name}
          </Text>
          <If when={isRunning()}>
            <View
              accessibilityLabel={`space-running-${props.space().id}`}
              tooltip={tr("spaces.workerRunning")}
              style={{ flexShrink: 0, padding: 2 }}
            >
              <StatusDot kind="success" size={7} />
            </View>
          </If>
        </View>
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
          {`${props.space().category} · v${props.space().version} · ${props.space().runtimeProfile}`}
        </Text>
        <Text
          style={{
            marginTop: 4,
            minWidth: 0,
            color: palette().textSecondary,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.5),
            numberOfLines: 2,
            textOverflow: "ellipsis",
          }}
        >
          {props.space().description || tr("common.noDescription")}
        </Text>
        <If when={permissionLine()}>
          {line => (
            <Text
              style={{
                marginTop: 4,
                minWidth: 0,
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {line()}
            </Text>
          )}
        </If>
      </View>

      <View style={{ position: "absolute", top: 12, right: 12 }}>
        <MoreMenu
          accessibilityLabel={`space-more-${props.space().id}`}
          tooltip={tr("spaces.spaceActions")}
          minWidth={210}
          items={spaceMenuItems(props.space(), isRunning())}
        />
      </View>

      <If when={confirmingDeleteSpaceId() === props.space().id}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <InlineConfirmBar
            danger
            message={tr("spaces.deleteConfirmCard", { name: props.space().name })}
            confirmLabel={tr("common.delete")}
            cancelLabel={tr("common.cancel")}
            onConfirm={() => void confirmDeleteSpace(props.space().id)}
            onCancel={() => cancelDeleteSpace()}
          />
        </View>
      </If>
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
                  fontSize: textSize(13),
                  lineHeight: textLineHeight(13, 1.5),
                }}
              >
                {detail().description || tr("spaces.noManifestDesc")}
              </Text>

              <View style={{ gap: 6 }}>
                <QuietList
                  label={tr("spaces.polish.permissions")}
                  items={summarizeSpacePermissions(detail().permissions).map(localizePermission)}
                />
                <If when={detail().tags.length > 0}>
                  <QuietList
                    label={tr("spaces.polish.tags")}
                    items={detail().tags.slice(0, INSPECTOR_TAG_CAP)}
                    overflow={
                      detail().tags.length > INSPECTOR_TAG_CAP
                        ? tr("spaces.overflowTags", {
                            count: formatCount(detail().tags.length - INSPECTOR_TAG_CAP),
                          })
                        : ""
                    }
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
                        fontSize: textSize(13),
                        lineHeight: textLineHeight(13, 1.52),
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
                  <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
                    <Each of={selectedSpaceVersions()} key={v => v.version}>
                      {ver => (
                        <Text
                          style={{
                            color:
                              ver().label === `v${detail().version}` ? palette().text : palette().textSecondary,
                            fontSize: textSize(13),
                            fontWeight: ver().label === `v${detail().version}` ? "600" : "400",
                            fontVariant: ["tabular-nums"],
                            lineHeight: textLineHeight(13, 1.4),
                          }}
                        >
                          {ver().label}
                        </Text>
                      )}
                    </Each>
                  </View>
                </ConfigSection>
              </If>

              {/* Syntax-highlighted Read-Only Source Bundle Viewer */}
              <View style={{ gap: 10 }}>
                <SegmentedTabs
                  size="sm"
                  options={sourceTabs()}
                  value={spaceSourceTab()}
                  onChange={next => spaceSourceTab.set(next)}
                />

                <View
                  style={{
                    borderRadius: radii.md,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().borderSubtle,
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
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <Icon name="file-code" size={12} color={palette().textMuted} />
                      <Text
                        style={{
                          minWidth: 0,
                          color: palette().textSecondary,
                          fontFamily: fontMono,
                          fontSize: textSize(12),
                          fontWeight: "500",
                          lineHeight: textLineHeight(12, 1.35),
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

/** The composer that asks an agent to build a Space; the page's one primary action. */
function CreateSpaceSection() {
  return (
    <StudioSection title={tr("spaces.createTitle")} accessibilityLabel="spaces-create-section">
      <View style={{ gap: 10, minWidth: 0 }}>
        <InputBox
          value={spacePrompt()}
          multiline
          minHeight={76}
          placeholder={tr("spaces.promptPlaceholder")}
          accessibilityLabel="spaces-prompt-input"
          onChange={val => spacePrompt.set(val)}
        />
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
          <Each of={spacePromptStarters()} key={s => s.id}>
            {starter => (
              <PillChip
                label={starter().label}
                accessibilityLabel={`spaces-starter-${starter().id}`}
                onPress={() => spacePrompt.set(starter().prompt)}
              />
            )}
          </Each>
          <View style={{ flex: 1, minWidth: 0 }} />
          <Button
            label={tr("spaces.createWithAgent")}
            variant="primary"
            size="md"
            leadingIcon="sparkles"
            loading={spaceCreating()}
            disabled={Boolean(spaceCreationBlockedReason()) || spaceCreating()}
            tooltip={spaceCreationBlockedReason() || undefined}
            accessibilityLabel="spaces-create-agent"
            style={studioCompact() ? { width: "100%" } : undefined}
            onPress={() => void createSpaceWithAgent()}
          />
        </View>
        <Text
          style={{
            paddingHorizontal: 4,
            color: spaceCreationBlockedReason() ? palette().warning : palette().textMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.45),
          }}
        >
          {spaceCreationBlockedReason() || tr("spaces.createSubtitleCreative")}
        </Text>
      </View>
    </StudioSection>
  );
}

/** Running a Space needs the MiniApp runner, which this surface does not have yet: say so plainly. */
function RunUnsupportedNote() {
  return (
    <View
      accessibilityLabel="spaces-run-unsupported"
      style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 4 }}
    >
      <View style={{ paddingTop: 2 }}>
        <Icon name="info" size={14} color={palette().textMuted} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            color: palette().textSecondary,
            fontSize: textSize(13),
            fontWeight: "600",
            lineHeight: textLineHeight(13, 1.4),
          }}
        >
          {tr("spaces.runUnsupportedTitle")}
        </Text>
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.5),
          }}
        >
          {tr("spaces.runUnsupportedBody")}
        </Text>
      </View>
    </View>
  );
}

function installedSummary(): string {
  const installed = tr("spaces.installedCount", { count: formatCount(spaces().length) });
  const running = runningSpaceWorkers().length;
  return running > 0 ? `${installed} · ${tr("spaces.activeWorkers", { count: running })}` : installed;
}

export function SpacesScene() {
  effect(() => {
    const scopeKey = peerScope()?.deviceId ?? "local";
    void scopeKey;
    void loadSpaces();
  });
  const unsubscribe = subscribeSpaceEvents();
  cleanup(() => unsubscribe());

  return (
    <View
      onLayout={trackStudioWidth}
      style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column", backgroundColor: palette().canvas }}
    >
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <StudioHeader
          title={tr("spaces.title")}
          subtitle={tr("spaces.subtitleStudio")}
          actions={
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <If when={spacesBusy() && !spacesInitialLoad()}>
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
          }
        />
        <StudioBody>
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
          <If when={spacesPeerNotice()}>
            {notice => <InlineBanner tone="warning" message={notice()} />}
          </If>

          <CreateSpaceSection />

          <StudioSection
            title={tr("spaces.polish.installedSection")}
            accessibilityLabel="spaces-installed-section"
            trailing={
              <Text
                style={{
                  color: palette().textSecondary,
                  fontSize: textSize(13),
                  fontVariant: ["tabular-nums"],
                  lineHeight: textLineHeight(13, 1.35),
                }}
              >
                {installedSummary()}
              </Text>
            }
          >
            <If when={spaces().length === 0 && spacesBusy() && spacesInitialLoad()}>
              <GallerySkeleton count={4} height={132} />
            </If>
            <If when={spaces().length === 0 && !(spacesBusy() && spacesInitialLoad())}>
              <StudioEmpty
                icon="layout-grid"
                message={tr("spaces.emptyTitle")}
                detail={tr("spaces.emptySubtitle")}
              />
            </If>
            <If when={spaces().length > 0}>
              <GalleryGrid>
                <Each of={spaces()} key={item => item.id}>
                  {item => <SpaceCard space={item} />}
                </Each>
              </GalleryGrid>
            </If>
          </StudioSection>

          <RunUnsupportedNote />
        </StudioBody>
      </Scroll>

      <SpaceInspectorModal />
    </View>
  );
}
