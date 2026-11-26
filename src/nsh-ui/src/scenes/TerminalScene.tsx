import { ToolPaneHeader } from "../ui/toolPane";
import { cleanup, computed, effect, pixelRatio, Scroll, signal, Text, View, type Point, type ViewRef } from "nsh";
import { Terminal, type TerminalRef } from "nsh/base";
import { fleetDeviceById } from "../fleetStore";
import { formatCount } from "../format";
import { localizeHostError, tr } from "../i18n";
import { activeWorkspaceId, activeWorkspaceRoot, deviceContext } from "../state";
import {
  activeTerminalTab,
  applyTerminalTitle,
  attachTerminalWriter,
  chooseShell,
  clearTerminalView,
  closeTerminalTab,
  ensureTerminal,
  getTerminalScrollback,
  renameTerminalTab,
  renamingTerminal,
  visibleTerminalTabs,
  loadTerminalShells,
  openProfile,
  openTerminal,
  selectedShellId,
  selectTerminal,
  sendTerminalInput,
  sendTerminalResize,
  shellChoices,
  shellTypeOf,
  terminalId,
  terminalMessage,
  terminalStatus,
  terminalTabs,
} from "../terminalStore";
import {
  closeProfileDraft,
  deleteProfile,
  loadTerminalProfiles,
  openProfileDraft,
  profileDraft,
  profileNotice,
  profileNoticeKind,
  profilesFor,
  saveProfileDraft,
  updateProfileDraft,
} from "../terminalProfiles";
import {
  compactLayout,
  concentricRadius,
  controlHeight,
  fontMono,
  layout,
  palette,
  radii,
  space,
  textLineHeight,
  textSize,
  textStyle,
  touchSlop,
} from "../theme";
import { deviceException, stateColor, StateMark, type MarkState } from "../ui/fleet";
import { Icon } from "../ui/icons";
import {
  MOTION_DURATION,
  paintTransition,
  pressTransition,
  Spinner,
  tactileActiveStyle,
} from "../ui/motion";
import {
  ContextMenuOverlay,
  DropdownMenu,
  ModalDialog,
  SelectDropdown,
  type DropdownMenuItem,
  type SelectDropdownOption,
} from "../ui/overlays";
import {
  Button,
  EmptyStateCard,
  focusRingStyle,
  IconButton,
  InlineBanner,
  InputBox,
  TooltipBubble,
  type InlineBannerTone,
} from "../ui/primitives";
import { RemoteWorkspaceStatusBanner } from "../ui/SshWorkspaceModals";
import { createSceneWidth, ToolbarDivider, WORKBENCH_TOUCH_MIN } from "../ui/workbenchLayout";

/**
 * Mounted `<Terminal>` widget refs across full-screen and compact AuxPane
 * instances. Fan-out writing + replay-on-mount prevents a remounted or AuxPane
 * terminal from appearing blank when a shell session is already active.
 */
const mountedTerminals = new Set<TerminalRef>();

function writeToMountedTerminals(data: string): void {
  for (const ref of mountedTerminals) {
    ref.write(data);
  }
}

function resetMountedTerminals(): void {
  for (const ref of mountedTerminals) {
    ref.reset();
  }
}

const profileModalOpen = signal(false);

function terminalMarkState(status: string): MarkState {
  const lower = status.toLowerCase();
  if (lower === "starting") return "queued";
  if (lower === "failed") return "failed";
  if (lower.startsWith("exited") || lower === "closed") return "stopped";
  return "idle";
}

function localizedTabStatus(status: string): string {
  const trimmed = status.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "running") return "";
  if (lower === "starting") return tr("terminal.statusStarting");
  if (lower === "exited") return tr("terminal.statusExited");
  const exitedMatch = /^exited\s*\((-?\d+)\)$/i.exec(trimmed);
  if (exitedMatch) return tr("terminal.statusExitedCode", { code: exitedMatch[1] });
  if (lower === "failed") return tr("terminal.statusFailed");
  if (lower === "closed") return tr("terminal.statusClosed");
  return status;
}

function profileNoticeTone(): InlineBannerTone {
  // The tone travels with the notice: translated text is never sniffed.
  return profileNoticeKind();
}

function profileSpecLabel(profile: {
  shellType: string;
  shellId: string;
  startupCommand: string;
}): string {
  const shellLabel = profile.shellType || profile.shellId || tr("terminal.defaultShellName");
  return `${shellLabel}${profile.startupCommand ? ` · ${profile.startupCommand}` : ""}`;
}

/**
 * Terminal tab chip using sibling pressable tab label and sibling close
 * IconButton (avoiding nested interactive buttons).
 */
function TabChip(props: {
  tabId: string;
  index: number;
  title: string;
  status: string;
  active: boolean;
  maxWidth: number;
  compact?: boolean;
  agent?: boolean;
  /** Stacked (narrow) layout: a taller chip so it is a full touch target. */
  touch?: boolean;
}) {
  const hovered = signal(false);
  const menuPosition = signal<Point | null>(null);
  const chipRef = signal<ViewRef | null>(null);
  const innerRadius = concentricRadius(radii.sm, space.hair);
  const tabHeight = () => (compactLayout() ? layout.touchTarget : 28);
  effect(() => {
    if (!props.active) return;
    const node = chipRef();
    if (!node) return;
    try {
      node.reveal({ horizontal: "nearest", animated: false });
    } catch {
      // Layout may not be measured yet on initial mount.
    }
  });
  const statusLabel = () => localizedTabStatus(props.status);
  const fallbackTitle = () => tr("pane.terminal.tab", { n: props.index + 1 });
  const displayTitle = () => props.title || fallbackTitle();

  const startRename = () => {
    renameDraft.set(displayTitle());
    renamingTerminal.set(props.tabId);
  };

  return (
    <View
      ref={el => chipRef.set(el)}
      onContextMenu={event => menuPosition.set(event.pagePosition)}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      hitSlop={props.touch || compactLayout() ? touchSlop(controlHeight.md) : undefined}
      style={{
        boxSizing: "border-box",
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        maxWidth: props.maxWidth,
        gap: space.hair,
        minHeight: tabHeight(),
        paddingLeft: space.sm,
        paddingRight: space.xs,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: "transparent",
        backgroundColor: props.active ? palette().panelHover : "transparent",
        userSelect: "none",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
    >
      <View
        role="tab"
        tooltip={
          !compactLayout() ? (
            <TooltipBubble text={statusLabel() ? `${displayTitle()} · ${statusLabel()}` : displayTitle()} />
          ) : undefined
        }
        accessibilityState={{ selected: props.active }}
        accessibilityLabel={`terminal-tab-${displayTitle()}`}
        onLongPress={event => menuPosition.set(event.pagePosition)}
        onPress={event => {
          if (event?.clickCount === 2) {
            startRename();
            return;
          }
          selectTerminal(props.tabId);
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          minWidth: 0,
          maxWidth: props.maxWidth,
          flexShrink: 1,
          gap: space.chip,
          paddingVertical: space.hair,
          paddingHorizontal: space.hair,
          borderRadius: innerRadius,
          borderCurve: "continuous",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        activeStyle={tactileActiveStyle(0.97)}
        focusVisibleStyle={focusRingStyle()}
      >
        <If
          when={renamingTerminal() === props.tabId}
          else={
            <Text
              style={{
                color: props.active ? palette().text : palette().textSecondary,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 16 / 12),
                fontWeight: props.active ? "600" : "500",
                maxWidth: props.compact ? 112 : 168,
                minWidth: 0,
                flexShrink: 1,
                numberOfLines: 1,
                textOverflow: "ellipsis-middle",
              }}
            >
              {displayTitle()}
            </Text>
          }
        >
          <View style={{ width: props.compact ? 112 : 150, minWidth: 0, flexShrink: 1 }}>
            <InputBox
              size="sm"
              value={renameDraft()}
              placeholder={fallbackTitle()}
              accessibilityLabel="terminal-rename-input"
              autoFocus={true}
              onChange={value => renameDraft.set(value)}
              onSubmit={() => renameTerminalTab(props.tabId, renameDraft() || displayTitle())}
              onKeyPress={event => {
                if (event.key === "Escape") renamingTerminal.set(null);
              }}
            />
          </View>
        </If>
        <If when={props.agent}>
          <View
            tooltip={compactLayout() ? undefined : <TooltipBubble text={tr("terminal.agentCreatedHint")} />}
            style={{ flexShrink: 0 }}
          >
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(11),
                lineHeight: textLineHeight(11, 14 / 11),
              }}
            >
              {tr("terminal.agentBadge")}
            </Text>
          </View>
        </If>
        <If when={statusLabel()}>
          <Text
            style={{
              color: stateColor(terminalMarkState(props.status)),
              fontSize: textSize(11),
              lineHeight: textLineHeight(11, 14 / 11),
              fontVariant: ["tabular-nums"],
              flexShrink: 0,
            }}
          >
            {statusLabel()}
          </Text>
        </If>
      </View>
      <IconButton
        icon="close"
        size="xs"
        iconSize={12}
        tooltip={tr("terminal.closeShell")}
        accessibilityLabel={"\u00d7"}
        style={{
          borderRadius: innerRadius,
          opacity: compactLayout() || props.active || hovered() ? 0.86 : 0.34,
        }}
        onPress={() => void closeTerminalTab(props.tabId)}
      />
      <ContextMenuOverlay
        open={menuPosition() !== null}
        position={menuPosition()}
        items={[
          {
            id: "rename",
            label: tr("common.rename"),
            icon: "edit",
            accessibilityLabel: "terminal-rename-tab",
            onSelect: startRename,
          },
          {
            id: "clear",
            label: tr("terminal.clear"),
            icon: "trash",
            accessibilityLabel: "terminal-clear",
            onSelect: () => void clearTerminalView(props.tabId),
          },
        ]}
        onClose={() => menuPosition.set(null)}
      />
    </View>
  );
}

const renameDraft = signal("");

function shellOptions(): SelectDropdownOption<string>[] {
  return [
    {
      value: "__default__",
      label: tr("terminal.defaultShellLabel"),
      description: tr("terminal.hostDefaultShell"),
      icon: "terminal",
      accessibilityLabel: "shell-option-default",
    },
    ...shellChoices().map(shell => ({
      value: shell.key,
      label: tr("terminal.shellLabel", { name: shell.name || shell.path || shell.type }),
      description: shell.path || shell.type,
      icon: "terminal" as const,
      accessibilityLabel: `shell-option-${shell.key}`,
    })),
  ];
}

function NewTerminalButton(props: { disabled: boolean; onCreate: (shellId?: string) => void }) {
  const open = signal(false);
  const anchor = signal<ViewRef | null>(null);
  const menuItems = (): DropdownMenuItem[] => [
    { id: "new", label: tr("pane.terminal.new"), onSelect: () => props.onCreate() },
    ...shellChoices().map((shell, index) => ({
      id: `shell-${shell.key}`,
      label: shell.name || shell.path || shell.type,
      separator: index === 0,
      onSelect: () => props.onCreate(shell.key),
    })),
  ];

  return (
    <View
      ref={el => anchor.set(el)}
      style={{ flexDirection: "row", alignItems: "center", borderRadius: radii.md, backgroundColor: palette().panelHover }}
    >
      <IconButton
        icon="plus"
        size="sm"
        iconSize={18}
        disabled={props.disabled}
        tooltip={tr("pane.terminal.new")}
        accessibilityLabel={tr("terminal.newShell")}
        onPress={() => props.onCreate()}
      />
      <IconButton
        icon="chevron-down"
        size="sm"
        iconSize={13}
        style={{ width: controlHeight.xs }}
        active={open()}
        disabled={props.disabled}
        tooltip={tr("terminal.newWithShell")}
        accessibilityLabel={tr("terminal.newWithShell")}
        onPress={() => open.set(!open())}
      />
      <DropdownMenu
        open={open() && !props.disabled}
        anchor={anchor()}
        align="end"
        items={menuItems()}
        onClose={() => open.set(false)}
      />
    </View>
  );
}

function quickProfileOptions(): SelectDropdownOption<string>[] {
  return profilesFor(activeWorkspaceRoot()).map(profile => ({
    value: profile.id,
    label: profile.name,
    description: profileSpecLabel(profile),
    icon: "terminal-square" as const,
    accessibilityLabel: `profile-quick-${profile.name}`,
  }));
}

export function TerminalScene(props: { compact?: boolean } = {}) {
  attachTerminalWriter(writeToMountedTerminals, resetMountedTerminals);
  // NSH measures each rendered row in whole device pixels. Use that same
  // height for the grid so fractional display scaling cannot clip the top row.
  const rowHeight = computed(() => {
    const scale = pixelRatio();
    return Math.round(textLineHeight(13, 18 / 13) * scale) / scale;
  });
  const sceneWidth = createSceneWidth();
  const tabStrip = createSceneWidth();
  const compactMenuOpen = signal(false);
  const compactMenuAnchor = signal<ViewRef | null>(null);
  const runProfileOpen = signal(false);
  const runProfileAnchor = signal<ViewRef | null>(null);

  let localTerminalRef: TerminalRef | undefined;
  const bindTerminalRef = (el: TerminalRef | null | undefined) => {
    if (!el) {
      if (localTerminalRef) {
        mountedTerminals.delete(localTerminalRef);
        localTerminalRef = undefined;
      }
      return;
    }
    if (localTerminalRef === el) return;
    if (localTerminalRef) mountedTerminals.delete(localTerminalRef);
    localTerminalRef = el;
    mountedTerminals.add(el);
    // Replay the active session's scrollback immediately when mounting a fresh
    // Terminal view (e.g. AuxPane or returning to Terminal while a shell runs).
    const activeId = terminalId();
    if (!activeId) return;
    const active = terminalTabs().find(tab => tab.id === activeId);
    const buffered = getTerminalScrollback(activeId, active?.deviceId);
    if (buffered) {
      el.reset();
      el.write(buffered);
    }
  };

  cleanup(() => {
    if (localTerminalRef) {
      mountedTerminals.delete(localTerminalRef);
      localTerminalRef = undefined;
    }
  });

  const scopeDevice = () => fleetDeviceById(deviceContext());
  const deviceOffline = () => deviceException(scopeDevice()?.state) === "offline";
  const deviceLabel = () => scopeDevice()?.name || tr("device.thisDevice");

  // The host resolves a terminal through its workspace, and the workspace list
  // arrives after this scene mounts: create the shell when the workspace is known
  // rather than once with nothing to attach it to.
  void loadTerminalShells();
  void loadTerminalProfiles();
  effect(() => {
    const workspaceId = activeWorkspaceId();
    if (!workspaceId || deviceOffline()) return;
    void ensureTerminal(workspaceId, activeWorkspaceRoot());
  });
  effect(() => {
    const next = profileDraft() !== null;
    if (profileModalOpen() !== next) profileModalOpen.set(next);
  });

  const startNewShell = (shellId?: string) => {
    if (deviceOffline()) return;
    void openTerminal(activeWorkspaceId(), activeWorkspaceRoot(), { shellId });
  };
  const toggleProfileModal = () =>
    profileDraft()
      ? closeProfileDraft()
      : openProfileDraft(selectedShellId() ?? "", shellTypeOf(selectedShellId()));
  const openQuickProfile = (id: string) => {
    const match = profilesFor(activeWorkspaceRoot()).find(p => p.id === id);
    if (match) void openProfile(activeWorkspaceId(), activeWorkspaceRoot(), match);
  };
  const activeExited = () => {
    const active = activeTerminalTab();
    if (!active) return false;
    return active.status.toLowerCase().startsWith("exited");
  };
  const activeExitedText = () => {
    const active = activeTerminalTab();
    if (!active) return "";
    if (typeof active.exitCode === "number") {
      return tr("pane.terminal.exited", { code: active.exitCode });
    }
    const parsed = /^exited\s*\((-?\d+)\)$/i.exec(active.status.trim());
    if (parsed) return tr("pane.terminal.exited", { code: parsed[1] });
    return tr("terminal.statusExited");
  };

  const compactMenuItems = (): DropdownMenuItem[] => {
    const currentShell = selectedShellId();
    const profiles = profilesFor(activeWorkspaceRoot());
    const items: DropdownMenuItem[] = [
      {
        id: "shell-default",
        label: tr("terminal.defaultShellLabel"),
        icon: currentShell === null ? "check" : "terminal",
        accessibilityLabel: "shell-option-default",
        onSelect: () => chooseShell(null),
      },
      ...shellChoices().map(shell => ({
        id: `shell-${shell.key}`,
        label: tr("terminal.shellLabel", { name: shell.name || shell.path || shell.type }),
        icon: (currentShell === shell.key ? "check" : "terminal") as "check" | "terminal",
        accessibilityLabel: `shell-option-${shell.key}`,
        onSelect: () => chooseShell(shell.key),
      })),
    ];

    if (profiles.length > 0) {
      items.push({ id: "sep-profiles-quick", label: "", separator: true });
      for (const profile of profiles) {
        items.push({
          id: `quick-profile-${profile.id}`,
          label: tr("terminal.openProfile", { name: profile.name }),
          icon: "play",
          accessibilityLabel: `profile-quick-${profile.name}`,
          onSelect: () => void openProfile(activeWorkspaceId(), activeWorkspaceRoot(), profile),
        });
      }
    }

    items.push({ id: "sep-manage", label: "", separator: true });
    items.push({
      id: "manage-profiles",
      label: tr("terminal.profilesCount", { count: formatCount(profiles.length) }),
      icon: "sliders",
      accessibilityLabel: "profiles-toggle",
      onSelect: toggleProfileModal,
    });
    return items;
  };

  const runProfileItems = (): DropdownMenuItem[] =>
    quickProfileOptions().map(option => ({
      id: `run-profile-${option.value}`,
      label: option.label,
      hint: option.description,
      icon: "play",
      accessibilityLabel: option.accessibilityLabel,
      onSelect: () => openQuickProfile(option.value),
    }));

  // Width-driven: wide panes (>= 680 pt, including bottom-docked AuxPane) show the full toolbar;
  // narrow panes (< 680 pt or phone) collapse extras into the compact `+` / `⋯` menu.
  const narrow = () =>
    compactLayout() ||
    sceneWidth.stacked() ||
    (sceneWidth.width() > 0 && sceneWidth.width() < 680);

  // Share the space the toolbar actually leaves. With many shells, keep
  // each title readable and let the strip scroll to the selected tab.
  const tabMaxWidth = computed(() => {
    const cap = narrow() ? 176 : 240;
    const count = visibleTerminalTabs().length;
    if (!count || !tabStrip.width()) return cap;
    const share = (tabStrip.width() - (count - 1) * space.hair) / count;
    return Math.min(cap, Math.max(128, Math.floor(share)));
  });

  return (
    <View
      onLayout={sceneWidth.onLayout}
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        flexDirection: "column",
        backgroundColor: palette().canvas,
      }}
    >
      <If when={!props.compact}>
        <ToolPaneHeader />
      </If>
      <RemoteWorkspaceStatusBanner compact={props.compact} />
      {/* Full workbench toolbar: tabs, profile controls, and the new terminal split button. */}
      <If when={!narrow()}>
        <View
          style={{
            minHeight: compactLayout() ? layout.touchTarget : 38,
            paddingHorizontal: props.compact ? space.md : space.lg,
            paddingVertical: space.xs,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: space.sm,
            flexShrink: 0,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
          }}
        >
          <Scroll smoothWheel horizontal scrollbar={false} onLayout={tabStrip.onLayout} style={{ flex: 1, minWidth: 140, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.hair }}>
              <Each of={visibleTerminalTabs()} key={tab => tab.id}>
                {(tab, index) => (
                  <TabChip
                    tabId={tab().id}
                    index={index()}
                    title={tab().title}
                    status={tab().status}
                    active={tab().id === terminalId()}
                    maxWidth={tabMaxWidth()}
                    compact={tabMaxWidth() < 176}
                    agent={Boolean(tab().agentCreated)}
                  />
                )}
              </Each>
              <If when={visibleTerminalTabs().length === 0}>
                <Text
                  style={{
                    ...textStyle("caption"),
                    paddingHorizontal: space.xs,
                  }}
                >
                  {terminalStatus() === "starting"
                    ? tr("terminal.startingShell")
                    : tr("terminal.noActiveShell")}
                </Text>
              </If>
            </View>
          </Scroll>

          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
            <If when={profilesFor(activeWorkspaceRoot()).length > 0}>
              <View ref={el => runProfileAnchor.set(el)} style={{ flexShrink: 0 }}>
                <IconButton
                  icon="play"
                  size="sm"
                  active={runProfileOpen()}
                  tooltip={tr("terminal.runProfile")}
                  accessibilityLabel="profiles-picker"
                  onPress={() => runProfileOpen.set(!runProfileOpen())}
                />
              </View>
              <DropdownMenu
                open={runProfileOpen()}
                anchor={runProfileAnchor()}
                align="end"
                minWidth={220}
                items={runProfileItems()}
                onClose={() => runProfileOpen.set(false)}
              />
            </If>
            <Button
              label={tr("terminal.profilesCount", {
                count: formatCount(profilesFor(activeWorkspaceRoot()).length),
              })}
              variant="ghost"
              size="sm"
              accessibilityLabel="profiles-toggle"
              onPress={toggleProfileModal}
            />
            <ToolbarDivider />
            <NewTerminalButton disabled={deviceOffline()} onCreate={startNewShell} />
          </View>
        </View>
      </If>

      {/* Narrow strip (< 680 pt or phone): tabs, a quiet '+', and one "…" menu. */}
      <If when={narrow()}>
        <View
          style={{
            minHeight: compactLayout() ? WORKBENCH_TOUCH_MIN : 36,
            paddingHorizontal: space.sm,
            paddingVertical: space.xs,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            flexShrink: 0,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
          }}
        >
          <Scroll smoothWheel horizontal scrollbar={false} onLayout={tabStrip.onLayout} style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.hair }}>
              <Each of={visibleTerminalTabs()} key={tab => tab.id}>
                {(tab, index) => (
                  <TabChip
                    tabId={tab().id}
                    index={index()}
                    title={tab().title}
                    status={tab().status}
                    active={tab().id === terminalId()}
                    maxWidth={tabMaxWidth()}
                    agent={Boolean(tab().agentCreated)}
                    compact={true}
                    touch={compactLayout()}
                  />
                )}
              </Each>
              <If when={visibleTerminalTabs().length === 0}>
                <Text
                  style={{
                    ...textStyle("caption"),
                    paddingHorizontal: space.xs,
                  }}
                >
                  {terminalStatus() === "starting"
                    ? tr("terminal.startingShell")
                    : tr("terminal.noActiveShell")}
                </Text>
              </If>
            </View>
          </Scroll>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.hair, flexShrink: 0 }}>
            <IconButton
              icon="plus"
              size={compactLayout() ? "md" : "sm"}
              disabled={deviceOffline()}
              tooltip={tr("pane.terminal.new")}
              accessibilityLabel={tr("terminal.newShell")}
              onPress={startNewShell}
            />
            <View ref={el => compactMenuAnchor.set(el)} style={{ flexShrink: 0 }}>
              <IconButton
                icon="more"
                size={compactLayout() ? "md" : "sm"}
                active={compactMenuOpen() || Boolean(profileDraft())}
                tooltip={tr("terminal.shellOptions")}
                accessibilityLabel="terminal-compact-menu"
                onPress={() => compactMenuOpen.set(!compactMenuOpen())}
              />
            </View>
          </View>
          <DropdownMenu
            open={compactMenuOpen()}
            anchor={compactMenuAnchor()}
            align="end"
            minWidth={212}
            items={compactMenuItems()}
            onClose={() => compactMenuOpen.set(false)}
          />
        </View>
      </If>

      <ModalDialog
        open={profileModalOpen()}
        title={tr("terminal.profilesTitle")}
        subtitle={tr("terminal.profilesSubtitle", {
          workspace: activeWorkspaceRoot() || tr("terminal.thisWorkspace"),
        })}
        size="md"
        accessibilityLabel="terminal-profiles-modal"
        onClose={() => closeProfileDraft()}
        footer={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="md"
              accessibilityLabel="profile-cancel"
              onPress={() => closeProfileDraft()}
            />
            <Button
              label={tr("terminal.saveProfile")}
              variant="primary"
              size="md"
              accessibilityLabel="profile-save"
              onPress={() => void saveProfileDraft()}
            />
          </View>
        }
      >
        <If when={Boolean(profileDraft())}>
          <View style={{ gap: space.lg }}>
            <If when={profilesFor(activeWorkspaceRoot()).length === 0}>
              <Text style={textStyle("label", { color: palette().textSecondary })}>
                {tr("terminal.noProfilesYet")}
              </Text>
            </If>
            <If when={profilesFor(activeWorkspaceRoot()).length > 0}>
              <View
                style={{
                  borderRadius: radii.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().panelRaised,
                  overflow: "hidden",
                }}
              >
                <Each of={profilesFor(activeWorkspaceRoot())} key={profile => profile.id}>
                  {(profile, index) => (
                    <View
                      style={{
                        position: "relative",
                        flexDirection: "column",
                        gap: space.xs,
                        minHeight: layout.touchTarget,
                        justifyContent: "center",
                        paddingHorizontal: space.lg,
                        paddingVertical: space.sm,
                      }}
                    >
                      <If when={index() > 0}>
                        <View
                          style={{
                            position: "absolute",
                            top: 0,
                            left: space.lg,
                            right: 0,
                            height: 1,
                            backgroundColor: palette().borderSubtle,
                          }}
                        />
                      </If>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.sm,
                          minWidth: 0,
                        }}
                      >
                        <Button
                          label={tr("terminal.openProfile", { name: profile().name })}
                          variant="ghost"
                          size="xs"
                          leadingIcon="play"
                          accessibilityLabel={`profile-open-${profile().name}`}
                          style={{ flexShrink: 1, minWidth: 0 }}
                          onPress={() => {
                            closeProfileDraft();
                            void openProfile(activeWorkspaceId(), activeWorkspaceRoot(), profile());
                          }}
                        />
                        <View style={{ flex: 1 }} />
                        <Button
                          label={tr("common.delete")}
                          variant="ghost"
                          size="xs"
                          accessibilityLabel={`profile-delete-${profile().name}`}
                          onPress={() => void deleteProfile(profile().id)}
                        />
                      </View>
                      <View
                        tooltip={compactLayout() ? undefined : <TooltipBubble text={profileSpecLabel(profile())} />}
                        style={{ minWidth: 0 }}
                      >
                        <Text
                          style={{
                            ...textStyle("mono", { color: palette().textSecondary }),
                            paddingLeft: space.hair,
                            numberOfLines: 1,
                            textOverflow: "ellipsis",
                          }}
                        >
                          {profileSpecLabel(profile())}
                        </Text>
                      </View>
                    </View>
                  )}
                </Each>
              </View>
            </If>

            <View
              style={{
                gap: space.md,
                paddingTop: space.lg,
                borderTopWidth: 1,
                borderColor: palette().borderSubtle,
              }}
            >
              <Text
                style={{
                  ...textStyle("label", { color: palette().textSecondary }),
                  fontWeight: "600",
                }}
              >
                {tr("terminal.createProfile")}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                  gap: space.md,
                }}
              >
                <InputBox
                  label={tr("terminal.profileName")}
                  value={profileDraft()?.name ?? ""}
                  placeholder={tr("common.name")}
                  autoFocus={true}
                  accessibilityLabel="profile-name"
                  onChange={value => updateProfileDraft({ name: value })}
                  style={{ flex: 1, minWidth: 160 }}
                />
                <InputBox
                  label={tr("terminal.startupCommand")}
                  value={profileDraft()?.startupCommand ?? ""}
                  placeholder={tr("terminal.startupCommand")}
                  monospace={true}
                  accessibilityLabel="profile-command"
                  onChange={value => updateProfileDraft({ startupCommand: value })}
                  onSubmit={() => void saveProfileDraft()}
                  style={{ flex: 1.4, minWidth: 200 }}
                />
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  flexWrap: "wrap",
                }}
              >
                <Icon name="terminal" size={14} color={palette().textMuted} />
                <Text
                  style={{
                    ...textStyle("caption", { color: palette().textSecondary }),
                    fontWeight: "500",
                  }}
                >
                  {tr("terminal.profileShell")}
                </Text>
                <View style={{ flex: 1 }} />
                <SelectDropdown
                  options={shellOptions()}
                  value={profileDraft()?.shellId || "__default__"}
                  placeholder={tr("terminal.defaultShellLabel")}
                  accessibilityLabel="profile-shell-picker"
                  size="md"
                  minWidth={200}
                  maxWidth={260}
                  onChange={val => {
                    const nextId = val === "__default__" ? null : val;
                    updateProfileDraft({
                      shellId: nextId ?? "",
                      shellType: shellTypeOf(nextId),
                    });
                  }}
                />
              </View>
              <If when={profileNotice()}>
                {notice => (
                  <InlineBanner
                    tone={profileNoticeTone()}
                    message={localizeHostError(notice())}
                  />
                )}
              </If>
            </View>
          </View>
        </If>
      </ModalDialog>

      <If when={terminalMessage()}>
        {message => (
          <View
            style={{
              paddingHorizontal: props.compact ? space.md : space.lg,
              paddingTop: space.sm,
              flexShrink: 0,
            }}
          >
            <InlineBanner
              tone="danger"
              message={localizeHostError(message())}
              actionLabel={
                terminalStatus().toLowerCase() === "failed" || terminalStatus().toLowerCase() === "closed"
                  ? tr("pane.terminal.restart")
                  : undefined
              }
              onAction={
                terminalStatus().toLowerCase() === "failed" || terminalStatus().toLowerCase() === "closed"
                  ? startNewShell
                  : undefined
              }
              onDismiss={() => terminalMessage.set("")}
            />
          </View>
        )}
      </If>

      {/* The widget draws its cells in the theme's text colour and paints no
          background of its own, so the surface behind it must follow the scheme:
          a fixed dark panel makes every glyph invisible in the light theme. */}
      <View
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          position: "relative",
          backgroundColor: palette().canvas,
          padding: space.sm,
        }}
      >
        <Terminal
          ref={bindTerminalRef}
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
          fontFamily={fontMono}
          fontSize={textSize(13)}
          lineHeight={rowHeight()}
          cursorStyle={{
            backgroundColor: palette().accent,
            opacity: 0.72,
            borderRadius: radii.xs,
          }}
          accessibilityLabel="terminal-viewport"
          scrollback={10000}
          onData={event => sendTerminalInput(event.data)}
          onResize={event => sendTerminalResize(event.cols, event.rows)}
          // The shell's own title, which the host also reports as `TitleChanged`;
          // this is the one a program sets through the terminal itself.
          onTitleChange={event => {
            const id = terminalId();
            if (id) applyTerminalTitle(id, event.title);
          }}
        />
        <If when={visibleTerminalTabs().length === 0}>
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: palette().canvas,
              alignItems: "center",
              justifyContent: "center",
              padding: props.compact ? space.lg : space.x3l,
            }}
          >
            <If when={terminalStatus() === "starting"}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Spinner size={16} color={palette().accent} />
                <Text style={textStyle("label", { color: palette().textSecondary })}>
                  {tr("terminal.startingShell")}
                </Text>
              </View>
            </If>
            <If when={terminalStatus() !== "starting"}>
              <EmptyStateCard
                icon="terminal"
                title={tr("terminal.noActiveShell")}
                subtitle={tr("terminal.noActiveShellSubtitle")}
                actionLabel={!deviceOffline() && activeWorkspaceId() ? tr("pane.terminal.new") : undefined}
                onAction={!deviceOffline() && activeWorkspaceId() ? startNewShell : undefined}
              />
            </If>
          </View>
        </If>
      </View>

      {/* Visual spec §4.10: 32px bottom offline or run-ended bar. */}
      <If when={deviceOffline()}>
        <View
          accessibilityLabel="terminal-offline-bar"
          style={{
            minHeight: controlHeight.md,
            paddingHorizontal: props.compact ? space.md : space.lg,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            flexShrink: 0,
            borderTopWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvasSubtle,
          }}
        >
          <Icon name="info" size={14} color={palette().textMuted} />
          <Text style={{ ...textStyle("caption"), flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
            {tr("pane.terminal.offline", { device: deviceLabel() })}
          </Text>
        </View>
      </If>
      <If when={!deviceOffline() && activeExited()}>
        <View
          accessibilityLabel="terminal-exited-bar"
          style={{
            minHeight: controlHeight.md,
            paddingHorizontal: props.compact ? space.md : space.lg,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            flexShrink: 0,
            borderTopWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvasSubtle,
          }}
        >
          <StateMark state="stopped" size={12} />
          <Text
            style={{
              ...textStyle("caption", { color: palette().textSecondary, tabular: true }),
              flex: 1,
              minWidth: 0,
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {activeExitedText()}
          </Text>
          <Button
            label={tr("pane.terminal.restart")}
            variant="ghost"
            size="xs"
            accessibilityLabel="terminal-restart"
            onPress={startNewShell}
          />
        </View>
      </If>
    </View>
  );
}
