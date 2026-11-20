import { cleanup, effect, Scroll, signal, Text, View, type ViewRef } from "nsh";
import { Terminal, type TerminalRef } from "nsh/base";
import { formatCount } from "../format";
import { localizeHostError, tr } from "../i18n";
import { activeScene, activeWorkspaceId, activeWorkspaceRoot } from "../state";
import {
  applyTerminalTitle,
  attachTerminalWriter,
  chooseShell,
  cancelCloseTerminal,
  clearTerminalView,
  closeTerminalTab,
  confirmingCloseTerminal,
  ensureTerminal,
  renameTerminalTab,
  renamingTerminal,
  requestCloseTerminalTab,
  visibleTerminalTabs,
  loadTerminalShells,
  openProfile,
  openTerminal,
  selectedShellId,
  selectTerminal,
  sendTerminalInput,
  sendTerminalResize,
  shellTypeOf,
  terminalId,
  terminalMessage,
  terminalShells,
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
  concentricRadius,
  controlHeight,
  fontMono,
  palette,
  radii,
  textLineHeight,
  textSize,
  textTracking,
} from "../theme";
import { Icon } from "../ui/icons";
import {
  MOTION_DURATION,
  paintTransition,
  pressTransition,
  Spinner,
  tactileActiveStyle,
} from "../ui/motion";
import {
  DropdownMenu,
  ModalDialog,
  SelectDropdown,
  type DropdownMenuItem,
  type SelectDropdownOption,
} from "../ui/overlays";
import {
  Button,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  StatusDot,
  TooltipBubble,
  WorkbenchSwitcher,
  type InlineBannerTone,
  type StatusDotKind,
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
const compactMenuOpen = signal(false);
const compactMenuAnchor = signal<ViewRef | null>(null);
const runProfileOpen = signal(false);
const runProfileAnchor = signal<ViewRef | null>(null);

function tabDotKind(status: string): StatusDotKind {
  const lower = status.toLowerCase();
  if (lower.startsWith("exited") || lower === "starting") return "warning";
  if (lower === "failed" || lower === "closed") return "danger";
  if (lower === "running") return "success";
  return "muted";
}

function tabStatusColor(status: string): string {
  const lower = status.toLowerCase();
  if (lower.startsWith("exited") || lower === "starting") return palette().warning;
  if (lower === "failed" || lower === "closed") return palette().danger;
  return palette().textMuted;
}

function localizedTabStatus(status: string): string {
  const trimmed = status.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "running") return tr("terminal.statusRunning");
  if (lower === "starting") return tr("terminal.statusStarting");
  if (lower === "exited") return tr("terminal.statusExited");
  const exitedMatch = /^exited\s*\((-?\d+)\)$/i.exec(trimmed);
  if (exitedMatch) return tr("terminal.statusExitedCode", { code: exitedMatch[1] });
  if (lower === "failed") return tr("terminal.statusFailed");
  if (lower === "closed") return tr("terminal.statusClosed");
  return status;
}

function terminalBannerTone(message: string): InlineBannerTone {
  const lower = message.trim().toLowerCase();
  if (lower === "shell exited" || /\bcode\s+0\b/.test(lower)) return "neutral";
  if (lower.startsWith("shell exited")) return "warning";
  return "danger";
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
  title: string;
  status: string;
  active: boolean;
  compact?: boolean;
  agent?: boolean;
  /** Stacked (narrow) layout: a taller chip so it is a full touch target. */
  touch?: boolean;
}) {
  const hovered = signal(false);
  const innerRadius = concentricRadius(radii.sm, 2);
  // One status mark per tab: the compact strip shows a running shell as a dot,
  // everything else reads as quiet inline status text.
  const showDot = () => Boolean(props.compact) && props.status.toLowerCase() === "running";

  return (
    <View
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      hitSlop={props.touch ? 4 : undefined}
      style={{
        boxSizing: "border-box",
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        gap: 2,
        height: props.touch ? 36 : props.compact ? controlHeight.xs : controlHeight.sm,
        paddingLeft: 8,
        paddingRight: 3,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        backgroundColor: props.active ? palette().panelHover : "transparent",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: palette().panelHover,
      }}
    >
      <View
        role="tab"
        tooltip={
          props.compact ? (
            <TooltipBubble text={`${props.title} · ${localizedTabStatus(props.status)}`} />
          ) : undefined
        }
        accessibilityState={{ selected: props.active }}
        accessibilityLabel={`terminal-tab-${props.title}`}
        onPress={event => {
          if (event?.clickCount === 2) {
            renameDraft.set(props.title);
            renamingTerminal.set(props.tabId);
            return;
          }
          selectTerminal(props.tabId);
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 2,
          paddingHorizontal: 2,
          borderRadius: innerRadius,
          borderCurve: "continuous",
          cursor: "pointer",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        activeStyle={tactileActiveStyle(0.97)}
        focusVisibleStyle={{
          outlineWidth: 2,
          outlineColor: palette().borderFocus,
          outlineOffset: 1,
        }}
      >
        <If when={showDot()}>
          <StatusDot kind={tabDotKind(props.status)} size={5.5} />
        </If>
        <If
          when={renamingTerminal() === props.tabId}
          else={
            <Text
              style={{
                color: props.active ? palette().text : palette().textSecondary,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.3),
                fontWeight: props.active ? "600" : "500",
                maxWidth: props.compact ? 112 : 168,
                numberOfLines: 1,
                textOverflow: "ellipsis-middle",
              }}
            >
              {props.title}
            </Text>
          }
        >
          <View style={{ width: props.compact ? 112 : 150 }}>
            <InputBox
              size="sm"
              value={renameDraft()}
              placeholder={props.title}
              accessibilityLabel="terminal-rename-input"
              autoFocus={true}
              onChange={value => renameDraft.set(value)}
              onSubmit={() => renameTerminalTab(props.tabId, renameDraft() || props.title)}
              onKeyPress={event => {
                if (event.key === "Escape") renamingTerminal.set(null);
              }}
            />
          </View>
        </If>
        <If when={props.agent}>
          <View
            tooltip={<TooltipBubble text={tr("terminal.agentCreatedHint")} />}
            style={{ flexShrink: 0 }}
          >
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(11),
                lineHeight: textLineHeight(11, 1.3),
              }}
            >
              {tr("terminal.agentBadge")}
            </Text>
          </View>
        </If>
        <If when={!showDot()}>
          <Text
            style={{
              color: tabStatusColor(props.status),
              fontSize: textSize(11),
              lineHeight: textLineHeight(11, 1.3),
              fontVariant: ["tabular-nums"],
              flexShrink: 0,
            }}
          >
            {localizedTabStatus(props.status)}
          </Text>
        </If>
      </View>
      <IconButton
        icon="close"
        size="xs"
        iconSize={10.5}
        tooltip={tr("terminal.closeShell")}
        accessibilityLabel={"\u00d7"}
        style={{
          width: 18,
          height: 18,
          borderRadius: innerRadius,
          opacity: props.active || hovered() ? 0.86 : 0.34,
        }}
        onPress={() => requestCloseTerminalTab(props.tabId)}
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
    ...terminalShells().map(shell => ({
      value: shell.id,
      label: tr("terminal.shellLabel", { name: shell.name || shell.path || shell.type }),
      description: shell.path || shell.type,
      icon: "terminal" as const,
      accessibilityLabel: `shell-option-${shell.id}`,
    })),
  ];
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
  const sceneWidth = createSceneWidth();

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
    if (active?.buffer) {
      el.reset();
      el.write(active.buffer);
    }
  };

  cleanup(() => {
    if (localTerminalRef) {
      mountedTerminals.delete(localTerminalRef);
      localTerminalRef = undefined;
    }
  });

  // The host resolves a terminal through its workspace, and the workspace list
  // arrives after this scene mounts: create the shell when the workspace is known
  // rather than once with nothing to attach it to.
  void loadTerminalShells();
  void loadTerminalProfiles();
  effect(() => {
    const workspaceId = activeWorkspaceId();
    if (!workspaceId) return;
    void ensureTerminal(workspaceId, activeWorkspaceRoot());
  });
  effect(() => {
    const next = profileDraft() !== null;
    if (profileModalOpen() !== next) profileModalOpen.set(next);
  });

  const startNewShell = () => void openTerminal(activeWorkspaceId(), activeWorkspaceRoot());
  const toggleProfileModal = () =>
    profileDraft()
      ? closeProfileDraft()
      : openProfileDraft(selectedShellId() ?? "", shellTypeOf(selectedShellId()));
  const openQuickProfile = (id: string) => {
    const match = profilesFor(activeWorkspaceRoot()).find(p => p.id === id);
    if (match) void openProfile(activeWorkspaceId(), activeWorkspaceRoot(), match);
  };
  const showBannerRestart = (message: string): boolean => {
    const status = terminalStatus().toLowerCase();
    return (
      status === "exited" ||
      status === "failed" ||
      status === "closed" ||
      message.toLowerCase().includes("exited")
    );
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
      ...terminalShells().map(shell => ({
        id: `shell-${shell.id}`,
        label: tr("terminal.shellLabel", { name: shell.name || shell.path || shell.type }),
        icon: (currentShell === shell.id ? "check" : "terminal") as "check" | "terminal",
        accessibilityLabel: `shell-option-${shell.id}`,
        onSelect: () => chooseShell(shell.id),
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
    items.push({
      id: "clear-view",
      label: tr("terminal.clear"),
      icon: "trash",
      disabled: !terminalId(),
      accessibilityLabel: "terminal-clear",
      onSelect: clearTerminalView,
    });
    // The workbench switcher does not fit a narrow strip; its two siblings move here.
    if (!props.compact) {
      items.push({ id: "sep-workbench", label: "", separator: true });
      items.push({
        id: "go-files",
        label: tr("nav.files"),
        icon: "folder",
        onSelect: () => activeScene.set("files"),
      });
      items.push({
        id: "go-git",
        label: tr("nav.git"),
        icon: "git-branch",
        onSelect: () => activeScene.set("git"),
      });
    }
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

  // Narrow: the aux pane, or a scene under 600 pt wide. One quiet strip then.
  const narrow = () => Boolean(props.compact) || sceneWidth.stacked();

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
      <RemoteWorkspaceStatusBanner compact={props.compact} />
      {/* Full workbench toolbar: one quiet row of tabs and ghost controls, one primary action. */}
      <If when={!narrow()}>
        <View
          style={{
            minHeight: 44,
            paddingHorizontal: 14,
            paddingVertical: 6,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
          }}
        >
          <WorkbenchSwitcher />
          <ToolbarDivider />

          <Scroll horizontal scrollbar={false} style={{ flex: 1, minWidth: 120 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <Each of={visibleTerminalTabs()} key={tab => tab.id}>
                {tab => (
                  <TabChip
                    tabId={tab().id}
                    title={tab().title}
                    status={tab().status}
                    active={tab().id === terminalId()}
                    agent={Boolean(tab().agentCreated)}
                  />
                )}
              </Each>
              <If when={visibleTerminalTabs().length === 0}>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.35),
                    paddingHorizontal: 4,
                  }}
                >
                  {terminalStatus() === "starting"
                    ? tr("terminal.startingShell")
                    : tr("terminal.noActiveShell")}
                </Text>
              </If>
            </View>
          </Scroll>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <SelectDropdown
              options={shellOptions()}
              value={selectedShellId() ?? "__default__"}
              placeholder={tr("terminal.defaultShellLabel")}
              accessibilityLabel="shell-picker"
              size="sm"
              minWidth={140}
              maxWidth={196}
              onChange={val => chooseShell(val === "__default__" ? null : val)}
            />
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
            <IconButton
              icon="trash"
              size="sm"
              tooltip={tr("terminal.clear")}
              accessibilityLabel="terminal-clear"
              disabled={!terminalId()}
              onPress={clearTerminalView}
            />
            <ToolbarDivider />
            <Button
              label={tr("terminal.newShell")}
              variant="primary"
              size="sm"
              leadingIcon="plus"
              onPress={startNewShell}
            />
          </View>
        </View>
      </If>

      {/* Narrow strip (aux pane or a scene under 600 pt): tabs, a quiet '+', and one "…" menu. 44 pt tall for touch. */}
      <If when={narrow()}>
        <View
          style={{
            height: WORKBENCH_TOUCH_MIN,
            paddingHorizontal: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
          }}
        >
          <Scroll horizontal scrollbar={false} style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <Each of={visibleTerminalTabs()} key={tab => tab.id}>
                {tab => (
                  <TabChip
                    tabId={tab().id}
                    title={tab().title}
                    status={tab().status}
                    active={tab().id === terminalId()}
                    agent={Boolean(tab().agentCreated)}
                    compact={true}
                    touch={true}
                  />
                )}
              </Each>
              <If when={visibleTerminalTabs().length === 0}>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.35),
                    paddingHorizontal: 4,
                  }}
                >
                  {terminalStatus() === "starting"
                    ? tr("terminal.startingShell")
                    : tr("terminal.noActiveShell")}
                </Text>
              </If>
            </View>
          </Scroll>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <IconButton
              icon="plus"
              size="md"
              tooltip={tr("terminal.newShell")}
              accessibilityLabel={tr("terminal.newShell")}
              onPress={startNewShell}
            />
            <View ref={el => compactMenuAnchor.set(el)} style={{ flexShrink: 0 }}>
              <IconButton
                icon="more"
                size="md"
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              accessibilityLabel="profile-cancel"
              onPress={() => closeProfileDraft()}
            />
            <Button
              label={tr("terminal.saveProfile")}
              variant="primary"
              size="sm"
              accessibilityLabel="profile-save"
              onPress={() => void saveProfileDraft()}
            />
          </View>
        }
      >
        <If when={Boolean(profileDraft())}>
          <View style={{ gap: 16 }}>
            <If when={profilesFor(activeWorkspaceRoot()).length === 0}>
              <Text
                style={{
                  color: palette().textSecondary,
                  fontSize: textSize(13),
                  lineHeight: textLineHeight(13, 1.48),
                }}
              >
                {tr("terminal.noProfilesYet")}
              </Text>
            </If>
            <If when={profilesFor(activeWorkspaceRoot()).length > 0}>
              <View
                style={{
                  borderRadius: 12,
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
                        flexDirection: "column",
                        gap: 4,
                        minHeight: 44,
                        justifyContent: "center",
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                        marginLeft: index() > 0 ? 16 : 0,
                        paddingLeft: index() > 0 ? 0 : 16,
                        borderTopWidth: index() > 0 ? 1 : 0,
                        borderColor: palette().borderSubtle,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                          minWidth: 0,
                        }}
                      >
                        <Button
                          label={tr("terminal.openProfile", { name: profile().name })}
                          variant="ghost"
                          size="xs"
                          leadingIcon="play"
                          accessibilityLabel={`profile-open-${profile().name}`}
                          style={{ flexShrink: 1, maxWidth: 340 }}
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
                        tooltip={<TooltipBubble text={profileSpecLabel(profile())} />}
                        style={{ minWidth: 0 }}
                      >
                        <Text
                          style={{
                            color: palette().textSecondary,
                            fontSize: textSize(12),
                            lineHeight: textLineHeight(12, 1.4),
                            fontFamily: fontMono,
                            paddingLeft: 2,
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
                gap: 12,
                paddingTop: 14,
                borderTopWidth: 1,
                borderColor: palette().borderSubtle,
              }}
            >
              <Text
                style={{
                  color: palette().textSecondary,
                  fontSize: textSize(13),
                  lineHeight: textLineHeight(13, 1.32),
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
                  gap: 10,
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
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <Icon name="terminal" size={13} color={palette().textMuted} />
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.35),
                    fontWeight: "500",
                  }}
                >
                  {tr("terminal.profileShell")}
                </Text>
                <View style={{ flex: 1 }} />
                <SelectDropdown
                  options={shellOptions()}
                  value={selectedShellId() ?? "__default__"}
                  placeholder={tr("terminal.defaultShellLabel")}
                  accessibilityLabel="profile-shell-picker"
                  size="md"
                  minWidth={200}
                  maxWidth={260}
                  onChange={val => {
                    const nextId = val === "__default__" ? null : val;
                    chooseShell(nextId);
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

      <If when={confirmingCloseTerminal()}>
        {id => (
          <View style={{ paddingHorizontal: props.compact ? 10 : 14, paddingTop: 8, flexShrink: 0 }}>
            <InlineConfirmBar
              danger={true}
              message={tr("terminal.closeRunningConfirm", {
                name: terminalTabs().find(tab => tab.id === id())?.title ?? "",
              })}
              confirmLabel={tr("terminal.closeShell")}
              cancelLabel={tr("common.cancel")}
              onConfirm={() => void closeTerminalTab(id())}
              onCancel={cancelCloseTerminal}
            />
          </View>
        )}
      </If>

      <If when={terminalMessage()}>
        {message => (
          <View
            style={{
              paddingHorizontal: props.compact ? 14 : 18,
              paddingTop: 8,
              flexShrink: 0,
            }}
          >
            <InlineBanner
              tone={terminalBannerTone(message())}
              message={localizeHostError(message())}
              actionLabel={showBannerRestart(message()) ? tr("terminal.startNewShell") : undefined}
              onAction={showBannerRestart(message()) ? startNewShell : undefined}
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
          padding: 8,
        }}
      >
        <Terminal
          ref={bindTerminalRef}
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
          fontFamily={fontMono}
          fontSize={textSize(13)}
          lineHeight={textLineHeight(13, 1.44)}
          cursorStyle={{
            backgroundColor: palette().accent,
            opacity: 0.72,
            borderRadius: 1,
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
              padding: props.compact ? 16 : 28,
            }}
          >
            <If when={terminalStatus() === "starting"}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Spinner size={16} color={palette().accent} />
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontSize: textSize(13),
                    lineHeight: textLineHeight(13, 1.4),
                  }}
                >
                  {tr("terminal.startingShell")}
                </Text>
              </View>
            </If>
            <If when={terminalStatus() !== "starting"}>
              <View
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  maxWidth: 320,
                }}
              >
                <View style={{ marginBottom: 4 }}>
                  <Icon name="terminal" size={28} color={palette().textMuted} />
                </View>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(15),
                    fontWeight: "600",
                    letterSpacing: textTracking(15),
                    lineHeight: textLineHeight(15, 1.32),
                    textAlign: "center",
                  }}
                >
                  {tr("terminal.noActiveShell")}
                </Text>
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontSize: textSize(13),
                    lineHeight: textLineHeight(13, 1.48),
                    textAlign: "center",
                  }}
                >
                  {tr("terminal.noActiveShellSubtitle")}
                </Text>
                <View style={{ marginTop: 6 }}>
                  <Button
                    label={tr("terminal.startNewShell")}
                    variant="primary"
                    size="sm"
                    leadingIcon="plus"
                    onPress={startNewShell}
                  />
                </View>
              </View>
            </If>
          </View>
        </If>
      </View>
    </View>
  );
}
