import { cleanup, effect, Scroll, Text, View } from "nsh";
import { Editor } from "nsh/base";
import { formatCount, formatPlural } from "../format";
import { localizeHostError, tr } from "../i18n";
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
  spaceCreating,
  spaceCreationBlockedReason,
  spacesInitialLoad,
  stopSpaceWorker,
  subscribeSpaceEvents,
  spacePermissionBadges,
  type SpaceMeta,
  type SpaceSourceTab,
  openSpaceWindow,
  spaceOpening,
  spaceWindowBlockedReason,
} from "../spacesStore";
import { fontMono, palette, radii, space, textLineHeight, textSize } from "../theme";
import { deviceContext } from "../state";
import { LibraryToolbar, libraryBodyStyle } from "./LibraryChrome";
import { Icon } from "../ui/icons";
import { createEditorStyles, inferCodeLanguage } from "../ui/markdown";
import { MOTION_DURATION, paintTransition, Spinner } from "../ui/motion";
import { ModalDialog, type DropdownMenuItem } from "../ui/overlays";
import {
  MiniAppMarketView,
  MiniAppSubmissionsView,
  PackageImportModal,
  spaceIconName,
} from "../ui/MiniAppMarket";
import {
  enterMarket,
  loadMarketOrigins,
  loadSubmissions,
  marketOrigins,
  openPackageImport,
  spacesView,
  type SpacesView,
} from "../miniAppMarketStore";
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
import { CardsSection } from "../ui/cardView"; // wave22-p3
import { cardsDeviceForLibrary } from "../desktopCardsStore"; // wave22-p3
import { ElsewhereList, SpacePage } from "../ui/miniAppFrame"; // wave22-p4
import {
  accountCatalog,
  closeSpacePage,
  loadAccountCatalog,
  openSpace,
  openSpacePage,
  spaceOpenBlockedReason,
  spacesElsewhere,
} from "../spaceViewStore"; // wave22-p4

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

/** The label of a host permission badge id. */
function localizePermission(id: string): string {
  if (id === "filesystem") return tr("spaces.permFilesystem");
  if (id === "shell") return tr("spaces.permShell");
  if (id === "network") return tr("spaces.permNetwork");
  if (id === "node_worker") return tr("spaces.permNodeWorker");
  if (id === "ai_bridge") return tr("spaces.permAiBridge");
  if (id === "agent_bridge") return tr("spaces.permAgentBridge");
  if (id === "sandboxed_ui") return tr("spaces.permSandboxedUi");
  return id;
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

export { spaceIconName };

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

/** The release a Space was installed from, when the host reports a market origin for it. */
function spaceMarketRelease(appId: string): number | null {
  for (const origin of Object.values(marketOrigins())) {
    if (origin.appId === appId) return origin.releaseNumber;
  }
  return null;
}

function spaceMetaLine(space: SpaceMeta): string {
  const parts = [space.category, `v${space.version}`, space.runtimeProfile];
  const release = spaceMarketRelease(space.id);
  if (release !== null) parts.push(tr("market.fromMarket", { release }));
  return parts.join(" · ");
}

function viewTabs(): ReadonlyArray<SegmentedTabOption<SpacesView>> {
  return [
    { value: "library", label: tr("spaces.p4.apps"), accessibilityLabel: "spaces-view-library" },
    { value: "cards", label: tr("spaces.p4.cards"), accessibilityLabel: "spaces-view-cards" },
    { value: "market", label: tr("market.viewMarket"), accessibilityLabel: "spaces-view-market" },
    { value: "submissions", label: tr("market.viewSubmissions"), accessibilityLabel: "spaces-view-submissions" },
  ];
}

function refreshCurrentView(): void {
  const view = spacesView();
  if (view === "market") enterMarket();
  else if (view === "submissions") void loadSubmissions();
  else if (view === "library") {
    void loadSpaces();
    void loadMarketOrigins();
    void loadAccountCatalog();
  }
}

/** Opens a Space inside the app on the device in context, with its placements. */
function openInstalledSpace(item: SpaceMeta): void {
  const catalogApp = accountCatalog()?.apps.find(app => app.appId === item.id);
  openSpacePage({
    appId: item.id,
    name: item.name,
    devices: catalogApp?.devices.map(device => device.deviceId),
    needsDevice: catalogApp?.needsDevice,
  });
}

function openElsewhereSpace(appId: string, deviceId: string): void {
  const app = spacesElsewhere().find(item => item.appId === appId);
  if (!app) return;
  openSpacePage({
    appId,
    name: app.name,
    deviceId,
    devices: app.devices.map(device => device.deviceId),
    needsDevice: app.needsDevice,
  });
}

function spaceMenuItems(space: SpaceMeta, running: boolean): DropdownMenuItem[] {
  return [
    {
      id: "open",
      label: tr("spaces.p4.open"),
      icon: "layout-grid",
      disabled: Boolean(spaceOpenBlockedReason()),
      accessibilityLabel: `space-menu-open-inline-${space.id}`,
      onSelect: () => openInstalledSpace(space),
    },
    {
      id: "open-window",
      label: tr("spaces.openWindow"),
      icon: "external-link",
      disabled: Boolean(spaceWindowBlockedReason()) || spaceOpening() !== null,
      accessibilityLabel: `space-menu-open-${space.id}`,
      onSelect: () => void openSpaceWindow(space.id),
    },
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
    const all = spacePermissionBadges(props.space()).map(localizePermission);
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
        accessibilityLabel={`space-open-${props.space().id}`}
        onPress={() => openInstalledSpace(props.space())}
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
          {spaceMetaLine(props.space())}
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
            <If when={Boolean(selectedSpaceId()) && !spaceWindowBlockedReason()}>
              <Button
                label={tr("spaces.openWindow")}
                variant="primary"
                size="md"
                leadingIcon="external-link"
                disabled={spaceOpening() !== null}
                accessibilityLabel="space-inspector-open"
                onPress={() => {
                  const id = selectedSpaceId();
                  if (id) void openSpaceWindow(id);
                }}
              />
            </If>
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
                  items={spacePermissionBadges(detail()).map(localizePermission)}
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

function installedSummary(): string {
  const installed = tr("spaces.installedCount", { count: formatCount(spaces().length) });
  const running = runningSpaceWorkers().length;
  return running > 0 ? `${installed} · ${tr("spaces.activeWorkers", { count: running })}` : installed;
}

/** The Library's Spaces gallery: `minmax(280, 1fr)` columns (visual spec §4.8). */
const SPACE_GALLERY_MIN_COLUMN = 280;

export function SpacesScene(props: { embedded?: boolean }) {
  const refreshControls = () => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <If when={spacesBusy() && !spacesInitialLoad()}>
        <Spinner size={14} />
      </If>
      <IconButton
        icon="refresh"
        size="md"
        accessibilityLabel="spaces-refresh"
        tooltip={tr("spaces.refreshTooltip")}
        disabled={spacesBusy()}
        onPress={() => refreshCurrentView()}
      />
    </View>
  );
  const spaceViewTabs = () => (
    <SegmentedTabs size="sm" options={viewTabs()} value={spacesView()} onChange={next => spacesView.set(next)} />
  );
  effect(() => {
    // The device the Library looks at (fleet) or the driven peer (older backends).
    const scopeKey = `local:${deviceContext()}`;
    void scopeKey;
    void loadSpaces();
    void loadMarketOrigins();
    void loadAccountCatalog(); // wave22-p4
  });
  // Each view reads its own host state when it is shown (and again when the
  // driven device changes), so a hidden view costs nothing.
  effect(() => {
    // The device the Library looks at (fleet) or the driven peer (older backends).
    const scopeKey = `local:${deviceContext()}`;
    void scopeKey;
    const view = spacesView();
    if (view === "market") enterMarket();
    else if (view === "submissions") void loadSubmissions();
  });
  const unsubscribe = subscribeSpaceEvents();
  cleanup(() => unsubscribe());
  // wave22-p4: a Space page belongs to the device it opened on.
  let openedFor = deviceContext();
  effect(() => {
    const device = deviceContext();
    if (device !== openedFor) {
      openedFor = device;
      if (openSpace()?.deviceId && openSpace()?.deviceId !== device) closeSpacePage();
    }
  });

  return (
    <View
      onLayout={trackStudioWidth}
      style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column", backgroundColor: palette().canvas }}
    >
      <If when={openSpace()}>
        <SpacePage permissionLabel={localizePermission} />
      </If>
      <If when={!openSpace()}>
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <If
          when={props.embedded}
          else={
            <StudioHeader
              title={tr("spaces.title")}
              subtitle={tr("spaces.subtitle")}
              actions={refreshControls()}
              extra={spaceViewTabs()}
            />
          }
        >
          <LibraryToolbar wide accessibilityLabel="spaces-toolbar" leading={spaceViewTabs()} primary={refreshControls()} />
        </If>
        <StudioBody style={props.embedded ? libraryBodyStyle(true) : undefined}>
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

          <If when={spacesView() === "market"}>
            <MiniAppMarketView />
          </If>
          <If when={spacesView() === "submissions"}>
            <MiniAppSubmissionsView />
          </If>
          {/* wave22-p3 cards, under Library › Spaces › Cards (wave22-p4). */}
          <If when={spacesView() === "cards"}>
            <CardsSection deviceId={cardsDeviceForLibrary()} />
          </If>
          <If when={spacesView() === "library"}>
          <CreateSpaceSection />

          <StudioSection
            title={tr("spaces.polish.installedSection")}
            accessibilityLabel="spaces-installed-section"
            trailing={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
                <Button
                  label={tr("market.import.open")}
                  variant="ghost"
                  size="sm"
                  leadingIcon="upload"
                  accessibilityLabel="spaces-import-package"
                  onPress={() => openPackageImport()}
                />
              </View>
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
              <GalleryGrid minColumn={props.embedded ? SPACE_GALLERY_MIN_COLUMN : undefined} gap={space.md}>
                <Each of={spaces()} key={item => item.id}>
                  {item => <SpaceCard space={item} />}
                </Each>
              </GalleryGrid>
            </If>
          </StudioSection>

          {/* wave22-p4: the account's Spaces that live on other devices. */}
          <If when={spacesElsewhere().length > 0}>
            <StudioSection title={tr("spaces.p4.elsewhereTitle")} accessibilityLabel="spaces-elsewhere-section">
              <ElsewhereList apps={spacesElsewhere()} onOpen={openElsewhereSpace} />
            </StudioSection>
          </If>
          {/* wave22-p4: Spaces open inside the app everywhere; only "Open in window" is desktop-only. */}
          </If>
        </StudioBody>
      </Scroll>
      </If>

      <SpaceInspectorModal />
      <PackageImportModal />
    </View>
  );
}
