// OpenBitFun Tauri-grade Remote Workspace & SSH modals for NSH:
// - NewWorkspaceModal (Assistant vs Local/SSH/Docker/WSL Project creation)
// - SshConnectionModal (Saved profiles, ~/.ssh/config import, Docker/WSL, Test)
// - SshAuthPromptModal (Credential repair & keyboard-interactive challenges)
// - RemoteFileBrowserModal (POSIX directory navigation, mkdir, rename, delete)
// - PortForwardModal (Listening port detection, active forwards, local -L rules)
//
// NSH components execute once; every signal, `palette()`, `textSize()`, and
// `tr()` call lives inside reactive JSX expressions or callbacks.

import {
  Clipboard,
  effect,
  openUrl,
  Scroll,
  signal,
  Text,
  View,
  type Point,
} from "nsh";
import { formatPlural } from "../format";
import { localizeHostError, tr } from "../i18n";
import { peerScope } from "../peerState";
import {
  addLocalFolderToNewWorkspace,
  authPromptDescription,
  authPromptError,
  authPromptKeyPath,
  authPromptLockUsername,
  authPromptMethod,
  authPromptOpen,
  authPromptPassphrase,
  authPromptPassword,
  authPromptUsername,
  authPromptVerificationCode,
  browserBusy,
  browserConfirmDeleteEntry,
  browserConnectionId,
  browserConnectionName,
  browserCurrentPath,
  browserError,
  browserFilter,
  browserHomePath,
  browserLoading,
  browserNewDirName,
  browserNewDirOpen,
  browserPathInput,
  browserPendingRebind,
  browserRenamingEntry,
  browserRenameValue,
  browserSelectDirectoriesOnly,
  browserSelectedPath,
  browseFolderForNewWorkspace,
  cancelRemoteWorkspaceRebind,
  canUseSshNoneAuth,
  checkHasStoredPassword,
  closeAuthPrompt,
  closeNewWorkspaceModal,
  closePortForwardModal,
  closeRemoteFileBrowser,
  closeSshConnectionModal,
  confirmBrowserSelection,
  confirmNewWorkspace,
  confirmRemoteDelete,
  confirmRemoteWorkspaceRebind,
  connectionStatuses,
  connectionTestReport,
  createAssistantFromNewWorkspace,
  createRemoteDirectory,
  DEFAULT_PROJECT_SUBDIRECTORY,
  deleteSavedSshConnection,
  detectingPorts,
  detectRemoteListeningPorts,
  discoverDockerContainers,
  dockerContainers,
  dockerContainersLoading,
  fillFormFromSshConfig,
  filteredBrowserEntries,
  filteredSavedConnections,
  filteredSshConfigHosts,
  formatForwardLocalAddress,
  formatSavedConnectionSubtitle,
  forwardDetectedPort,
  forwardedRemotePortSet,
  getRemoteParentPath,
  listeningPorts,
  loadNewWorkspaceEnvironmentContainers,
  loadRemoteDirectory,
  loadSavedConnections,
  loadSshConfigHosts,
  loadWslDistributions,
  newWorkspaceBusy,
  newWorkspaceEnvOptions,
  newWorkspaceEnvLoading,
  newWorkspaceError,
  newWorkspaceFolders,
  newWorkspaceHostOptions,
  newWorkspaceLocalPathInput,
  newWorkspaceModalOpen,
  newWorkspaceName,
  newWorkspaceRecentLocal,
  newWorkspaceSelectedEnvId,
  newWorkspaceSelectedHostId,
  newWorkspaceShowAssistantChoice,
  newWorkspaceSource,
  newWorkspaceStep,
  openPortForwardModal,
  openRemoteFileBrowser,
  openSshConnectionModal,
  populateFormFromSavedConnection,
  portForwardBusyPort,
  portForwardConnectionName,
  portForwardDescription,
  portForwardError,
  portForwardExposeOnLan,
  portForwardLocalPort,
  portForwardModalOpen,
  portForwardRemoteHost,
  portForwardRemotePort,
  portForwards,
  portForwardSubmitting,
  projectFolderKey,
  projectFolderName,
  quickConnectSavedConnection,
  remoteFileBrowserOpen,
  sameWorkspaceSource,
  savedConnections,
  savedConnectionTarget,
  saveSshConnectionForm,
  selectNewWorkspaceHostOption,
  setNewWorkspaceSource,
  setSshFormField,
  setSshTargetType,
  sshBrowseAfterConnect,
  sshConfigHosts,
  sshConfigSearch,
  sshConfirmLabel,
  sshConnecting,
  sshConnectionModalOpen,
  sshConnectionView,
  sshContainerHost,
  sshEditingProfile,
  sshEditOnly,
  sshError,
  sshFixedSource,
  sshForm,
  sshNotice,
  sshSavedSearch,
  sshSelectedConnectionId,
  sshShowAdvanced,
  sshShowPassphrase,
  sshShowPassword,
  sshTargetType,
  sshTesting,
  stopPortForward,
  submitAuthPrompt,
  submitPortForwardForm,
  submitRemoteRename,
  submitSshConnectionForm,
  syncSshRemoteScope,
  testSshConnection,
  workspaceSourceCoordinates,
  workspaceSourceFor,
  wslDistributions,
  wslError,
  wslLoading,
  type ConnectionTestStage,
  type RemoteFileEntry,
  type SavedConnection,
  type SshAuthFormKind,
  type WorkspaceConnectionTarget,
  type WorkspaceEnvironment,
  type WorkspaceLocation,
  remoteLinkAttemptOf,
  remoteLinkErrors,
  remoteLinkStateOf,
  retryRemoteWorkspace,
} from "../sshRemoteStore";
import { activeWorkspace } from "../state";
import {
  controlHeight,
  fontMono,
  palette,
  radii,
  textLineHeight,
  textSize,
  textTracking,
} from "../theme";
import { BotCharacter, Icon, type IconName } from "./icons";
import {
  MOTION_DURATION,
  Spinner,
  paintTransition,
  pressTransition,
  tactileActiveStyle,
} from "./motion";
import {
  ContextMenuOverlay,
  ModalDialog,
  pushToast,
  SelectDropdown,
  type DropdownMenuItem,
  type SelectDropdownOption,
} from "./overlays";
import {
  Badge,
  Button,
  ConfigRow,
  ConfigSection,
  DeviceGlyph,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  PillChip,
  SearchInput,
  SegmentedTabs,
  StatusPill,
  ToggleSwitch,
  TooltipBubble,
} from "./primitives";

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function ModalAlertBanner(props: {
  message: string;
  tone?: "danger" | "warning" | "info";
  onDismiss?: () => void;
}) {
  return (
    <If when={props.message.trim()}>
      {msg => (
        <InlineBanner
          tone={props.tone ?? "danger"}
          message={localizeHostError(msg())}
          onDismiss={props.onDismiss}
        />
      )}
    </If>
  );
}

function FieldSection(props: {
  label: string;
  hint?: string;
  children?: unknown;
  right?: unknown;
}) {
  return (
    <View style={{ minWidth: 0, gap: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            color: palette().textSecondary,
            fontSize: textSize(12),
            fontWeight: "500",
            lineHeight: textLineHeight(12, 1.35),
          }}
        >
          {props.label}
        </Text>
        <If when={Boolean(props.right)}>
          <View style={{ flexShrink: 0 }}>{props.right as never}</View>
        </If>
      </View>
      {props.children as never}
      <If when={props.hint ?? ""}>
        {h => (
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(11.5),
              lineHeight: textLineHeight(11.5, 1.42),
            }}
          >
            {h()}
          </Text>
        )}
      </If>
    </View>
  );
}

// ============================================================================
// 1. New Workspace Modal (matching NewProjectDialog.tsx)
// ============================================================================

function newWorkspaceSubtitle(): string {
  const peer = peerScope();
  if (peer) {
    return tr("ssh.targetDeviceSubtitle", {
      label: peer.label,
      hostKind: peer.hostKind,
    });
  }
  return tr("devices.thisMachine");
}

function NewWorkspaceModal() {
  const locationOptions = () => [
    { value: "current" as WorkspaceLocation, label: tr("ssh.thisMachine") },
    { value: "other" as WorkspaceLocation, label: tr("ssh.otherHostSsh") },
  ];

  const environmentOptions = () => {
    const loc = workspaceSourceCoordinates(newWorkspaceSource()).location;
    if (loc === "other") {
      return [
        { value: "system" as WorkspaceEnvironment, label: tr("ssh.systemSsh") },
        { value: "container" as WorkspaceEnvironment, label: tr("ssh.remoteDocker") },
      ];
    }
    const items: Array<{ value: WorkspaceEnvironment; label: string }> = [
      { value: "system", label: tr("ssh.localFolder") },
      { value: "container", label: tr("ssh.dockerContainer") },
    ];
    if (wslDistributions()?.supported !== false) {
      items.push({ value: "wsl", label: tr("ssh.wsl") });
    }
    return items;
  };

  const hostSelectOptions = (): ReadonlyArray<SelectDropdownOption<string>> =>
    newWorkspaceHostOptions().map(opt => ({
      value: opt.id,
      label: opt.label,
      description: opt.description,
      icon: "server" as IconName,
      accessibilityLabel: `new-ws-host-opt-${opt.id.replace(/:/g, "-")}`,
    }));

  const envSelectOptions = (): ReadonlyArray<SelectDropdownOption<string>> =>
    newWorkspaceEnvOptions().map(opt => ({
      value: opt.id,
      label: opt.label,
      description: opt.description,
      icon: (opt.target === "wsl" ? "terminal-square" : "container") as IconName,
      accessibilityLabel: `new-ws-env-opt-${opt.id.replace(/:/g, "-")}`,
    }));

  const canConfirm = (): boolean => {
    if (newWorkspaceBusy()) return false;
    const folders = newWorkspaceFolders();
    const name = newWorkspaceName().trim();
    const pendingLocal = newWorkspaceLocalPathInput().trim();
    const src = newWorkspaceSource();
    if (folders.length === 0 && !name && !(src === "host" && pendingLocal)) return false;
    if (src === "ssh" && folders.length === 0 && !newWorkspaceSelectedHostId()) return false;
    if (
      (src === "localDocker" || src === "wsl") &&
      folders.length === 0 &&
      !newWorkspaceSelectedEnvId()
    ) {
      return false;
    }
    if (
      src === "remoteDocker" &&
      folders.length === 0 &&
      (!newWorkspaceSelectedHostId() || !newWorkspaceSelectedEnvId())
    ) {
      return false;
    }
    return true;
  };

  return (
    <ModalDialog
      open={newWorkspaceModalOpen()}
      title={
        newWorkspaceStep() === "choice"
          ? tr("ssh.newWorkspaceTitle")
          : tr("ssh.createProjectTitle")
      }
      subtitle={newWorkspaceSubtitle()}
      size="lg"
      accessibilityLabel="new-workspace-modal"
      closeOnBackdropPress={!newWorkspaceBusy()}
      closeOnEscape={!newWorkspaceBusy()}
      onClose={closeNewWorkspaceModal}
      footer={
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <If when={newWorkspaceShowAssistantChoice() && newWorkspaceStep() === "project"}>
            <Button
              label={tr("common.back")}
              variant="ghost"
              size="sm"
              leadingIcon="arrow-left"
              disabled={newWorkspaceBusy()}
              accessibilityLabel="new-workspace-back"
              onPress={() => {
                newWorkspaceError.set("");
                newWorkspaceStep.set("choice");
              }}
            />
          </If>
          <View style={{ flex: 1 }} />
          <Button
            label={tr("common.cancel")}
            variant="secondary"
            size="sm"
            disabled={newWorkspaceBusy()}
            accessibilityLabel="new-workspace-cancel"
            onPress={closeNewWorkspaceModal}
          />
          <If when={newWorkspaceStep() === "project"}>
            <Button
              label={newWorkspaceBusy() ? tr("ssh.creating") : tr("ssh.createWorkspace")}
              variant="primary"
              size="sm"
              loading={newWorkspaceBusy()}
              disabled={!canConfirm()}
              accessibilityLabel="new-workspace-confirm"
              onPress={() => void confirmNewWorkspace()}
            />
          </If>
        </View>
      }
    >
      <ModalAlertBanner
        message={newWorkspaceError()}
        onDismiss={() => newWorkspaceError.set("")}
      />

      <If when={newWorkspaceStep() === "choice"}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View
            role="button"
            disabled={newWorkspaceBusy()}
            accessibilityLabel="new-workspace-choice-assistant"
            accessibilityState={{
              disabled: newWorkspaceBusy(),
              busy: newWorkspaceBusy(),
            }}
            onPress={() => {
              if (newWorkspaceBusy()) return;
              void createAssistantFromNewWorkspace();
            }}
            style={{
              flex: 1,
              minWidth: 0,
              padding: 16,
              gap: 10,
              borderRadius: radii.lg,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().border,
              backgroundColor: palette().panelRaised,
              boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
              cursor: newWorkspaceBusy() ? "not-allowed" : "pointer",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{
              backgroundColor: palette().panelHover,
              borderColor: palette().borderStrong,
            }}
            activeStyle={tactileActiveStyle(0.985)}
            focusVisibleStyle={{
              outlineWidth: 2,
              outlineColor: palette().borderFocus,
              outlineOffset: 2,
            }}
            disabledStyle={{ opacity: 0.52 }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <BotCharacter variant="muse" size={36} ringColor={palette().panelRaised} />
              <Icon name="arrow-right" size={14} color={palette().textMuted} />
            </View>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(13.5),
                lineHeight: textLineHeight(13.5, 1.3),
                letterSpacing: textTracking(13.5),
                fontWeight: "600",
              }}
            >
              {tr("ssh.personalAssistant")}
            </Text>
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.48),
              }}
            >
              {tr("ssh.personalAssistantDesc")}
            </Text>
          </View>

          <View
            role="button"
            disabled={newWorkspaceBusy()}
            accessibilityLabel="new-workspace-choice-project"
            accessibilityState={{
              disabled: newWorkspaceBusy(),
            }}
            onPress={() => {
              if (newWorkspaceBusy()) return;
              newWorkspaceError.set("");
              newWorkspaceStep.set("project");
            }}
            style={{
              flex: 1,
              minWidth: 0,
              padding: 16,
              gap: 10,
              borderRadius: radii.lg,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().border,
              backgroundColor: palette().panelRaised,
              boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
              cursor: newWorkspaceBusy() ? "not-allowed" : "pointer",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{
              backgroundColor: palette().panelHover,
              borderColor: palette().borderStrong,
            }}
            activeStyle={tactileActiveStyle(0.985)}
            focusVisibleStyle={{
              outlineWidth: 2,
              outlineColor: palette().borderFocus,
              outlineOffset: 2,
            }}
            disabledStyle={{ opacity: 0.52 }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
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
                  borderColor: palette().accentBorder,
                  backgroundColor: palette().accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="folder-plus" size={18} color={palette().accent} />
              </View>
              <Icon name="arrow-right" size={14} color={palette().textMuted} />
            </View>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(13.5),
                lineHeight: textLineHeight(13.5, 1.3),
                letterSpacing: textTracking(13.5),
                fontWeight: "600",
              }}
            >
              {tr("ssh.projectWorkspace")}
            </Text>
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.48),
              }}
            >
              {tr("ssh.projectWorkspaceDesc")}
            </Text>
          </View>
        </View>
      </If>

      <If when={newWorkspaceStep() === "project"}>
        <View style={{ gap: 14 }}>
          <InputBox
            label={tr("ssh.workspaceName")}
            leadingIcon="folder"
            value={newWorkspaceName()}
            placeholder={
              newWorkspaceFolders().length === 1
                ? projectFolderName(newWorkspaceFolders()[0].path)
                : tr("ssh.enterProjectName")
            }
            accessibilityLabel="new-workspace-name"
            onChange={v => {
              newWorkspaceName.set(v);
              newWorkspaceError.set("");
            }}
          />

          <ConfigSection
            flush
            controlWidth={300}
            title={tr("ssh.workspaceSource")}
            subtitle={tr("ssh.workspaceSourceSubtitle")}
          >
            <ConfigRow label={tr("ssh.hostLocation")}>
              <SegmentedTabs
                size="sm"
                options={locationOptions()}
                value={workspaceSourceCoordinates(newWorkspaceSource()).location}
                onChange={loc => {
                  const env = workspaceSourceCoordinates(newWorkspaceSource()).environment;
                  const nextEnv: WorkspaceEnvironment =
                    loc === "other" && env === "wsl" ? "system" : env;
                  setNewWorkspaceSource(workspaceSourceFor(loc, nextEnv));
                }}
              />
            </ConfigRow>
            <ConfigRow label={tr("ssh.environment")} divider={false}>
              <SegmentedTabs
                size="sm"
                options={environmentOptions()}
                value={workspaceSourceCoordinates(newWorkspaceSource()).environment}
                onChange={env => {
                  const loc = workspaceSourceCoordinates(newWorkspaceSource()).location;
                  setNewWorkspaceSource(workspaceSourceFor(loc, env));
                }}
              />
            </ConfigRow>
          </ConfigSection>

          {/* Local Host Directory Selector */}
          <If when={newWorkspaceSource() === "host"}>
            <View style={{ gap: 10 }}>
              <FieldSection label={tr("ssh.localFolderPath")}>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center", minWidth: 0 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <InputBox
                      monospace
                      value={newWorkspaceLocalPathInput()}
                      placeholder="/path/to/workspace"
                      accessibilityLabel="new-workspace-local-path"
                      onChange={v => newWorkspaceLocalPathInput.set(v)}
                      onSubmit={() => addLocalFolderToNewWorkspace()}
                    />
                  </View>
                  <Button
                    label={tr("ssh.addFolder")}
                    variant="secondary"
                    size="md"
                    accessibilityLabel="new-workspace-add-local"
                    disabled={!newWorkspaceLocalPathInput().trim()}
                    onPress={() => addLocalFolderToNewWorkspace()}
                  />
                </View>
              </FieldSection>

              <If when={newWorkspaceRecentLocal().length > 0}>
                <View style={{ gap: 6 }}>
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(11.5),
                      lineHeight: textLineHeight(11.5, 1.35),
                      fontWeight: "500",
                    }}
                  >
                    {tr("ssh.recentLocalWorkspaces")}
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    <Each of={newWorkspaceRecentLocal()} key={ws => ws.id}>
                      {ws => (
                        <PillChip
                          label={ws().name || projectFolderName(ws().rootPath)}
                          maxWidth={220}
                          accessibilityLabel={`new-ws-recent-${ws().id}`}
                          active={newWorkspaceFolders().some(f => f.path === ws().rootPath)}
                          onPress={() => addLocalFolderToNewWorkspace(ws().rootPath)}
                        />
                      )}
                    </Each>
                  </View>
                </View>
              </If>
            </View>
          </If>

          {/* Remote SSH / Remote Docker Host Selector */}
          <If
            when={
              newWorkspaceSource() === "ssh" ||
              newWorkspaceSource() === "remoteDocker" ||
              newWorkspaceSource() === "containerSshd"
            }
          >
            <FieldSection
              label={tr("ssh.remoteSshHost")}
              right={
                <View style={{ flexDirection: "row", gap: 4 }}>
                  <IconButton
                    icon="plus"
                    size="xs"
                    tooltip={tr("ssh.newConnection")}
                    accessibilityLabel="new-workspace-new-host"
                    onPress={() =>
                      void openSshConnectionModal(undefined, {
                        targetType: "ssh",
                        fixedSource: true,
                        browseAfterConnect: false,
                        onConnected: (cfg, cid) => {
                          void loadSavedConnections();
                          selectNewWorkspaceHostOption(cid);
                          newWorkspaceName.set(newWorkspaceName() || cfg.name);
                        },
                      })
                    }
                  />
                  <IconButton
                    icon="refresh"
                    size="xs"
                    tooltip={tr("common.refresh")}
                    accessibilityLabel="new-workspace-refresh-hosts"
                    onPress={() => {
                      void loadSavedConnections();
                      void loadSshConfigHosts();
                    }}
                  />
                </View>
              }
            >
              <SelectDropdown
                searchable
                searchPlaceholder={tr("ssh.filterHosts")}
                placeholder={tr("ssh.chooseHostPlaceholder")}
                accessibilityLabel="new-workspace-host-select"
                options={hostSelectOptions()}
                value={newWorkspaceSelectedHostId()}
                onChange={id => selectNewWorkspaceHostOption(id)}
              />
            </FieldSection>
          </If>

          {/* Container / WSL Environment Option Picker */}
          <If
            when={
              newWorkspaceSource() === "localDocker" ||
              newWorkspaceSource() === "remoteDocker" ||
              newWorkspaceSource() === "wsl"
            }
          >
            <FieldSection
              label={
                newWorkspaceSource() === "wsl"
                  ? tr("ssh.wslDistribution")
                  : tr("ssh.container")
              }
              right={
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <If when={newWorkspaceEnvLoading() || wslLoading()}>
                    <Spinner size={12} />
                  </If>
                  <IconButton
                    icon="plus"
                    size="xs"
                    tooltip={tr("ssh.newConnection")}
                    accessibilityLabel="new-workspace-new-env"
                    onPress={() => {
                      const src = newWorkspaceSource();
                      const target: WorkspaceConnectionTarget =
                        src === "wsl"
                          ? "wsl"
                          : src === "remoteDocker"
                            ? "remoteDocker"
                            : "localDocker";
                      const hostOpt = newWorkspaceHostOptions().find(
                        o => o.id === newWorkspaceSelectedHostId(),
                      );
                      void openSshConnectionModal(undefined, {
                        targetType: target,
                        fixedSource: true,
                        browseAfterConnect: false,
                        containerHost: target === "remoteDocker" ? hostOpt?.connection : undefined,
                        onConnected: (_cfg, cid) => {
                          void loadSavedConnections();
                          newWorkspaceSelectedEnvId.set(cid);
                        },
                      });
                    }}
                  />
                  <IconButton
                    icon="refresh"
                    size="xs"
                    tooltip={tr("common.refresh")}
                    accessibilityLabel="new-workspace-refresh-env"
                    onPress={() => {
                      const src = newWorkspaceSource();
                      if (src === "wsl") void loadWslDistributions();
                      else if (src === "localDocker" || src === "remoteDocker") {
                        void loadNewWorkspaceEnvironmentContainers(src);
                      }
                    }}
                  />
                </View>
              }
            >
              <SelectDropdown
                searchable={newWorkspaceSource() !== "wsl"}
                placeholder={
                  newWorkspaceSource() === "wsl"
                    ? tr("ssh.selectWslPlaceholder")
                    : tr("ssh.selectContainerPlaceholder")
                }
                accessibilityLabel="new-workspace-env-select"
                options={envSelectOptions()}
                value={newWorkspaceSelectedEnvId()}
                onChange={id => newWorkspaceSelectedEnvId.set(id)}
              />
            </FieldSection>
          </If>

          {/* Selected Folders / Remote Browse */}
          <ConfigSection
            flush
            title={tr("ssh.sourceFolders")}
            subtitle={
              newWorkspaceFolders().length === 0 && newWorkspaceName().trim()
                ? tr("ssh.willCreateFolder", {
                    dir: DEFAULT_PROJECT_SUBDIRECTORY,
                    name: newWorkspaceName().trim(),
                  })
                : undefined
            }
            extra={
              <If when={newWorkspaceSource() !== "host"}>
                <Button
                  label={tr("ssh.browseRemote")}
                  variant="secondary"
                  size="sm"
                  leadingIcon="folder-plus"
                  disabled={newWorkspaceBusy()}
                  accessibilityLabel="new-workspace-browse-remote"
                  onPress={() => void browseFolderForNewWorkspace()}
                />
              </If>
            }
          >
            <If
              when={newWorkspaceFolders().length > 0}
              else={
                <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.45),
                    }}
                  >
                    {newWorkspaceSource() === "host"
                      ? tr("ssh.sourceFolderEmptyLocal")
                      : tr("ssh.sourceFolderEmptyRemote")}
                  </Text>
                </View>
              }
            >
              <View>
                <Each of={newWorkspaceFolders()} key={folder => projectFolderKey(folder)}>
                  {(folder, idx) => (
                    <ConfigRow
                      label={projectFolderName(folder().path)}
                      description={
                        folder().remote
                          ? `${folder().remote!.connectionName}: ${folder().path}`
                          : folder().path
                      }
                      divider={idx() < newWorkspaceFolders().length - 1}
                    >
                      <Badge
                        label={folder().remote ? tr("common.remote") : tr("common.local")}
                        size="xs"
                        tone={folder().remote ? "accent" : "neutral"}
                      />
                      <IconButton
                        icon="close"
                        size="xs"
                        tooltip={tr("common.remove")}
                        accessibilityLabel={`Remove folder ${folder().path}`}
                        onPress={() => {
                          newWorkspaceFolders.update(cur =>
                            cur.filter(
                              item => projectFolderKey(item) !== projectFolderKey(folder()),
                            ),
                          );
                        }}
                      />
                    </ConfigRow>
                  )}
                </Each>
              </View>
            </If>
          </ConfigSection>
        </View>
      </If>
    </ModalDialog>
  );
}

// ============================================================================
// 2. SSH Connection Modal (matching SSHConnectionDialog.tsx)
// ============================================================================

function formatStageLabel(stage: ConnectionTestStage): string {
  if (stage.id.startsWith("jump-")) {
    return tr("ssh.stageJump", {
      hop: stage.id.slice("jump-".length),
      label: stage.label,
    });
  }
  if (stage.id === "target") return tr("ssh.stageTarget", { label: stage.label });
  if (stage.id === "container") return tr("ssh.stageContainer", { label: stage.label });
  if (stage.id === "wsl") return tr("ssh.stageWsl", { label: stage.label });
  if (stage.id === "docker-host") return tr("ssh.localDocker");
  return stage.label;
}

function stageLatencyMs(stage: ConnectionTestStage): number | null {
  const raw = (stage as ConnectionTestStage & { latencyMs?: unknown }).latencyMs;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function SshConnectionModal() {
  const confirmingDeleteId = signal<string | null>(null);

  const targetTabs = () => [
    { value: "ssh" as WorkspaceConnectionTarget, label: tr("ssh.ssh") },
    { value: "remoteDocker" as WorkspaceConnectionTarget, label: tr("ssh.remoteDocker") },
    { value: "containerSshd" as WorkspaceConnectionTarget, label: tr("ssh.containerSshd") },
    { value: "localDocker" as WorkspaceConnectionTarget, label: tr("ssh.localDocker") },
    { value: "wsl" as WorkspaceConnectionTarget, label: tr("ssh.wsl") },
  ];

  const authOptions = (): ReadonlyArray<SelectDropdownOption<SshAuthFormKind>> => {
    const items: Array<SelectDropdownOption<SshAuthFormKind>> = [
      { value: "password", label: tr("ssh.authPassword"), icon: "key" },
      { value: "privateKey", label: tr("ssh.authPrivateKey"), icon: "key" },
      { value: "agent", label: tr("ssh.authAgent"), icon: "shield" },
      { value: "keyboardInteractive", label: tr("ssh.authKeyboardInteractive"), icon: "key" },
    ];
    if (canUseSshNoneAuth() || sshForm().authType === "none") {
      items.push({
        value: "none",
        label: tr("ssh.authNone"),
        icon: "plug",
      });
    }
    return items;
  };

  const containerAccessOptions = (): ReadonlyArray<SelectDropdownOption<"auto" | "docker-exec">> => [
    { value: "auto", label: tr("ssh.accessAuto") },
    { value: "docker-exec", label: tr("ssh.accessExecOnly") },
  ];

  const containerDropdownOptions = (): ReadonlyArray<SelectDropdownOption<string>> =>
    dockerContainers().map(c => ({
      value: c.name,
      label: c.name,
      description: `${c.image} · ${c.state}`,
      icon: "container" as IconName,
    }));

  const parentSshHostOptions = (): ReadonlyArray<SelectDropdownOption<string>> =>
    savedConnections()
      .filter(c => !c.container && !c.wsl)
      .map(c => ({
        value: c.id,
        label: c.name,
        description: `${c.username}@${c.host}:${c.port}`,
        icon: "server" as IconName,
      }));

  const wslDropdownOptions = (): ReadonlyArray<SelectDropdownOption<string>> =>
    (wslDistributions()?.distributions ?? []).map(dist => ({
      value: dist,
      label: dist,
      icon: "terminal-square" as IconName,
    }));

  const savedConnectionsForTarget = (): SavedConnection[] =>
    savedConnections().filter(conn =>
      sameWorkspaceSource(savedConnectionTarget(conn), sshTargetType()),
    );

  const showNewForm = (): boolean =>
    sshEditOnly() ||
    savedConnectionsForTarget().length === 0 ||
    sshConnectionView() === "new";

  const isLocalProcess = (): boolean =>
    sshTargetType() === "wsl" || sshTargetType() === "localDocker";

  const usesDocker = (): boolean =>
    sshTargetType() === "localDocker" || sshTargetType() === "remoteDocker";

  const modalTitle = (): string => {
    const editing = sshEditingProfile();
    if (sshEditOnly() && editing) {
      return tr("ssh.editConnectionTitle", { name: editing.name });
    }
    const target = sshTargetType();
    if (target === "wsl") return tr("ssh.connectWslTitle");
    if (target === "localDocker") return tr("ssh.connectLocalDockerTitle");
    if (target === "remoteDocker") return tr("ssh.connectRemoteDockerTitle");
    if (target === "containerSshd") return tr("ssh.connectContainerSshdTitle");
    return tr("ssh.remoteSshTitle");
  };

  const selectedSaved = (): SavedConnection | undefined =>
    savedConnections().find(c => c.id === sshSelectedConnectionId());

  return (
    <ModalDialog
      open={sshConnectionModalOpen()}
      title={modalTitle()}
      subtitle={
        peerScope()
          ? tr("ssh.peerHostSubtitle", { label: peerScope()!.label })
          : tr("ssh.modalSubtitle")
      }
      size="lg"
      accessibilityLabel="ssh-connection-modal"
      closeOnBackdropPress={!sshConnecting()}
      closeOnEscape={!sshConnecting()}
      onClose={closeSshConnectionModal}
      footer={
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <If when={showNewForm()}>
            <Button
              label={sshTesting() ? tr("common.testing") : tr("ssh.testConnection")}
              variant="secondary"
              size="sm"
              loading={sshTesting()}
              disabled={sshConnecting()}
              accessibilityLabel="ssh-test-btn"
              onPress={() => void testSshConnection()}
            />
          </If>
          <View style={{ flex: 1 }} />
          <Button
            label={tr("common.cancel")}
            variant="ghost"
            size="sm"
            disabled={sshConnecting()}
            accessibilityLabel="ssh-modal-cancel"
            onPress={closeSshConnectionModal}
          />
          <If when={showNewForm()}>
            <Button
              label={tr("common.save")}
              variant="secondary"
              size="sm"
              disabled={sshConnecting() || sshTesting()}
              accessibilityLabel="ssh-save-btn"
              onPress={() => void saveSshConnectionForm()}
            />
          </If>
          <If
            when={showNewForm()}
            else={
              <Button
                label={sshConfirmLabel() || tr("common.connect")}
                variant="primary"
                size="sm"
                loading={sshConnecting()}
                disabled={!selectedSaved() || sshConnecting()}
                accessibilityLabel="ssh-quick-connect-btn"
                onPress={() => {
                  const sel = selectedSaved();
                  if (sel) {
                    void quickConnectSavedConnection(sel, {
                      browseAfterConnect: sshBrowseAfterConnect(),
                    });
                  }
                }}
              />
            }
          >
            <Button
              label={
                sshConfirmLabel() ||
                (sshConnecting() ? tr("ssh.connectingEllipsis") : tr("common.connect"))
              }
              variant="primary"
              size="sm"
              loading={sshConnecting()}
              disabled={sshTesting()}
              accessibilityLabel="ssh-connect-btn"
              onPress={() => void submitSshConnectionForm()}
            />
          </If>
        </View>
      }
    >
      <ModalAlertBanner message={sshError()} onDismiss={() => sshError.set("")} />
      <ModalAlertBanner
        message={sshNotice()}
        tone="info"
        onDismiss={() => sshNotice.set("")}
      />

      {/* Target type selector — horizontally scrollable at high font scales */}
      <If when={!sshFixedSource() && !sshEditOnly()}>
        <Scroll horizontal scrollbar={false} style={{ width: "100%", minWidth: 0 }}>
          <View style={{ paddingBottom: 2 }}>
            <SegmentedTabs
              size="sm"
              options={targetTabs()}
              value={sshTargetType()}
              onChange={t => setSshTargetType(t)}
            />
          </View>
        </Scroll>
      </If>

      {/* Saved vs New switcher */}
      <If when={!sshEditOnly() && savedConnectionsForTarget().length > 0}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <SegmentedTabs
            size="sm"
            options={[
              {
                value: "saved" as const,
                label: tr("ssh.savedConnections"),
                badge: savedConnectionsForTarget().length,
              },
              { value: "new" as const, label: tr("ssh.newConnection") },
            ]}
            value={sshConnectionView()}
            onChange={v => {
              sshConnectionView.set(v);
              sshError.set("");
            }}
          />
        </View>
      </If>

      {/* Saved Connections View */}
      <If when={!showNewForm()}>
        <View style={{ gap: 10 }}>
          <SearchInput
            value={sshSavedSearch()}
            placeholder={tr("ssh.searchConnections")}
            accessibilityLabel="ssh-saved-search"
            onChange={v => sshSavedSearch.set(v)}
          />

          <If when={Boolean(confirmingDeleteId())}>
            <InlineConfirmBar
              danger
              message={tr("ssh.deleteProfileConfirm")}
              confirmLabel={tr("ssh.confirmDeleteTitleCase")}
              cancelLabel={tr("common.cancel")}
              onConfirm={() => {
                const id = confirmingDeleteId();
                confirmingDeleteId.set(null);
                if (id) void deleteSavedSshConnection(id);
              }}
              onCancel={() => confirmingDeleteId.set(null)}
            />
          </If>

          <ConfigSection flush title={tr("ssh.savedProfiles")}>
            <If
              when={filteredSavedConnections().length > 0}
              else={
                <View
                  style={{
                    paddingVertical: 20,
                    paddingHorizontal: 16,
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.45),
                      textAlign: "center",
                    }}
                  >
                    {tr("ssh.noSavedMatch", { query: sshSavedSearch().trim() })}
                  </Text>
                  <Button
                    label={tr("common.clearSearch")}
                    size="xs"
                    variant="ghost"
                    onPress={() => sshSavedSearch.set("")}
                  />
                </View>
              }
            >
              <View>
                <Each of={filteredSavedConnections()} key={conn => conn.id}>
                  {(conn, idx) => (
                    <View
                      role="button"
                      accessibilityLabel={`ssh-saved-${conn().id}`}
                      accessibilityState={{ selected: sshSelectedConnectionId() === conn().id }}
                      onPress={() => {
                        sshSelectedConnectionId.set(conn().id);
                        if (conn().authType.type === "Password") {
                          void checkHasStoredPassword(conn().id);
                        }
                      }}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 11,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 11,
                        backgroundColor:
                          sshSelectedConnectionId() === conn().id
                            ? palette().accentSoft
                            : "transparent",
                        borderBottomWidth:
                          idx() < filteredSavedConnections().length - 1 ? 1 : 0,
                        borderColor: palette().borderSubtle,
                        cursor: "pointer",
                        ...paintTransition(MOTION_DURATION.fast),
                      }}
                      hoverStyle={{
                        backgroundColor:
                          sshSelectedConnectionId() === conn().id
                            ? palette().accentSoft
                            : palette().panelHover,
                      }}
                      activeStyle={{ opacity: 0.92 }}
                      focusVisibleStyle={{
                        outlineWidth: 2,
                        outlineColor: palette().borderFocus,
                        outlineOffset: -2,
                      }}
                    >
                      <DeviceGlyph
                        kind={
                          conn().wsl
                            ? "desktop"
                            : conn().container
                              ? "container"
                              : "server"
                        }
                        size={32}
                        status={connectionStatuses()[conn().id] ?? undefined}
                        active={sshSelectedConnectionId() === conn().id}
                        ringColor={palette().panelRaised}
                      />
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
                          <Text
                            style={{
                              flexShrink: 1,
                              minWidth: 0,
                              color: palette().text,
                              fontSize: textSize(13),
                              lineHeight: textLineHeight(13, 1.35),
                              fontWeight: "600",
                              numberOfLines: 1,
                              textOverflow: "ellipsis",
                            }}
                          >
                            {conn().name}
                          </Text>
                          <If when={connectionStatuses()[conn().id] === "connected"}>
                            <StatusPill label={tr("common.connected")} kind="success" size="xs" />
                          </If>
                          <If when={connectionStatuses()[conn().id] === "connecting"}>
                            <StatusPill
                              label={tr("common.connecting")}
                              kind="warning"
                              size="xs"
                              pulse
                            />
                          </If>
                          <If when={connectionStatuses()[conn().id] === "error"}>
                            <StatusPill label={tr("common.error")} kind="danger" size="xs" />
                          </If>
                        </View>
                        <Text
                          style={{
                            color: palette().textMuted,
                            fontSize: textSize(11.5),
                            lineHeight: textLineHeight(11.5, 1.38),
                            fontFamily: fontMono,
                            numberOfLines: 1,
                            textOverflow: "ellipsis-middle",
                          }}
                        >
                          {formatSavedConnectionSubtitle(conn())}
                        </Text>
                      </View>

                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
                        <If when={connectionStatuses()[conn().id] === "connected"}>
                          <Button
                            label={tr("common.browse")}
                            size="xs"
                            variant="ghost"
                            accessibilityLabel={`ssh-browse-${conn().id}`}
                            onPress={() =>
                              void openRemoteFileBrowser(conn().id, undefined, {
                                connectionName: conn().name,
                                sshHost: conn().host,
                              })
                            }
                          />
                          <Button
                            label={tr("ssh.ports")}
                            size="xs"
                            variant="ghost"
                            accessibilityLabel={`ssh-pf-${conn().id}`}
                            onPress={() => void openPortForwardModal(conn().id, conn().name)}
                          />
                        </If>
                        <Button
                          label={tr("common.connect")}
                          size="xs"
                          variant="secondary"
                          accessibilityLabel={`ssh-connect-${conn().id}`}
                          onPress={() =>
                            void quickConnectSavedConnection(conn(), {
                              browseAfterConnect: sshBrowseAfterConnect(),
                            })
                          }
                        />
                        <IconButton
                          icon="edit"
                          size="xs"
                          tooltip={tr("ssh.editProfile")}
                          accessibilityLabel={`ssh-edit-${conn().id}`}
                          onPress={() => {
                            populateFormFromSavedConnection(conn());
                            sshConnectionView.set("new");
                          }}
                        />
                        <IconButton
                          icon="trash"
                          size="xs"
                          tone="danger"
                          tooltip={tr("ssh.deleteProfile")}
                          accessibilityLabel={`ssh-delete-${conn().id}`}
                          onPress={() => confirmingDeleteId.set(conn().id)}
                        />
                      </View>
                    </View>
                  )}
                </Each>
              </View>
            </If>
          </ConfigSection>
        </View>
      </If>

      {/* New / Edit Connection Form */}
      <If when={showNewForm()}>
        <View style={{ gap: 14 }}>
          {/* ~/.ssh/config Quick Import */}
          <If
            when={
              !isLocalProcess() &&
              sshTargetType() !== "remoteDocker" &&
              sshConfigHosts().length > 0
            }
          >
            <ConfigSection
              flush
              title={tr("ssh.importSshConfig")}
              subtitle={tr("ssh.importSshConfigHint")}
              extra={
                <View style={{ width: 176, flexShrink: 0 }}>
                  <SearchInput
                    size="sm"
                    value={sshConfigSearch()}
                    placeholder={tr("ssh.filterHosts")}
                    accessibilityLabel="ssh-config-search"
                    onChange={v => sshConfigSearch.set(v)}
                  />
                </View>
              }
            >
              <Scroll style={{ maxHeight: 136, minHeight: 0 }} scrollbar={true}>
                <View style={{ padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Each of={filteredSshConfigHosts()} key={entry => entry.host}>
                    {entry => (
                      <PillChip
                        label={entry().host}
                        maxWidth={260}
                        badge={
                          entry().user
                            ? `${entry().user}@${entry().hostname || entry().host}`
                            : entry().hostname || undefined
                        }
                        accessibilityLabel={`ssh-config-host-${entry().host}`}
                        onPress={() => fillFormFromSshConfig(entry())}
                      />
                    )}
                  </Each>
                  <If when={filteredSshConfigHosts().length === 0}>
                    <Text
                      style={{
                        color: palette().textMuted,
                        fontSize: textSize(11.5),
                        lineHeight: textLineHeight(11.5, 1.4),
                      }}
                    >
                      {tr("ssh.noMatchingHosts")}
                    </Text>
                  </If>
                </View>
              </Scroll>
            </ConfigSection>
          </If>

          {/* WSL Distribution Selection */}
          <If when={sshTargetType() === "wsl"}>
            <View style={{ gap: 8 }}>
              <FieldSection
                label={tr("ssh.wslDistribution")}
                right={
                  <IconButton
                    icon="refresh"
                    size="xs"
                    tooltip={tr("common.refresh")}
                    accessibilityLabel="ssh-wsl-refresh"
                    onPress={() => void loadWslDistributions()}
                  />
                }
              >
                <SelectDropdown
                  placeholder={
                    wslLoading()
                      ? tr("ssh.discoveringWsl")
                      : tr("ssh.selectWslPlaceholder")
                  }
                  accessibilityLabel="ssh-wsl-distribution"
                  options={wslDropdownOptions()}
                  value={sshForm().wslDistribution || null}
                  onChange={dist => setSshFormField("wslDistribution", dist)}
                />
              </FieldSection>
              <If when={wslError() || wslDistributions()?.supported === false}>
                <ModalAlertBanner
                  tone="warning"
                  message={wslError() || tr("ssh.wslUnavailable")}
                />
              </If>
            </View>
          </If>

          {/* Remote Docker Parent Host */}
          <If when={sshTargetType() === "remoteDocker"}>
            <FieldSection label={tr("ssh.sshHostDocker")}>
              <SelectDropdown
                searchable
                placeholder={tr("ssh.chooseSavedSshHost")}
                accessibilityLabel="ssh-remote-docker-host"
                options={parentSshHostOptions()}
                value={sshContainerHost()?.id ?? null}
                onChange={id => {
                  const found = savedConnections().find(c => c.id === id) ?? null;
                  sshContainerHost.set(found);
                  setSshFormField("containerName", "");
                  if (found) {
                    void discoverDockerContainers({
                      ...found,
                      auth:
                        found.authType.type === "Password"
                          ? { type: "Password", password: "" }
                          : found.authType.type === "KeyboardInteractive"
                            ? { type: "KeyboardInteractive", responses: [] }
                            : found.authType,
                      container: {
                        name: "discovery",
                        local: false,
                        access: "auto",
                        dockerPath: "docker",
                        shell: "/bin/sh",
                        interactive: true,
                      },
                    });
                  }
                }}
              />
            </FieldSection>
          </If>

          {/* Host, Port, Username, Auth */}
          <If when={!isLocalProcess() && sshTargetType() !== "remoteDocker"}>
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", gap: 10, minWidth: 0 }}>
                <View style={{ flex: 3, minWidth: 0 }}>
                  <InputBox
                    monospace
                    label={tr("ssh.host")}
                    leadingIcon="server"
                    value={sshForm().host}
                    placeholder={tr("ssh.hostPlaceholder")}
                    accessibilityLabel="ssh-form-host"
                    onChange={v => setSshFormField("host", v)}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 88 }}>
                  <InputBox
                    monospace
                    label={tr("ssh.port")}
                    value={sshForm().port}
                    placeholder="22"
                    accessibilityLabel="ssh-form-port"
                    onChange={v => setSshFormField("port", v)}
                  />
                </View>
              </View>

              <InputBox
                label={tr("ssh.username")}
                value={sshForm().username}
                placeholder="ubuntu"
                accessibilityLabel="ssh-form-username"
                onChange={v => setSshFormField("username", v)}
              />

              <FieldSection label={tr("ssh.authMethod")}>
                <SelectDropdown
                  accessibilityLabel="ssh-form-auth-type"
                  options={authOptions()}
                  value={sshForm().authType}
                  onChange={v => setSshFormField("authType", v)}
                />
              </FieldSection>

              <If when={sshForm().authType === "none"}>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(11.5),
                    lineHeight: textLineHeight(11.5, 1.42),
                  }}
                >
                  {tr("ssh.authNoneHint")}
                </Text>
              </If>

              <If when={sshForm().authType === "password"}>
                <InputBox
                  label={tr("ssh.authPassword")}
                  leadingIcon="key"
                  masked={!sshShowPassword()}
                  value={sshForm().password}
                  placeholder={
                    sshEditingProfile()
                      ? tr("ssh.keepStoredPassword")
                      : tr("ssh.enterSshPassword")
                  }
                  accessibilityLabel="ssh-form-password"
                  trailing={
                    <IconButton
                      icon={sshShowPassword() ? "eye-off" : "eye"}
                      size="xs"
                      tooltip={
                        sshShowPassword() ? tr("ssh.hidePassword") : tr("ssh.showPassword")
                      }
                      accessibilityLabel="Toggle password visibility"
                      onPress={() => sshShowPassword.update(v => !v)}
                    />
                  }
                  onChange={v => setSshFormField("password", v)}
                />
              </If>

              <If when={sshForm().authType === "privateKey"}>
                <View style={{ gap: 10 }}>
                  <InputBox
                    monospace
                    label={tr("ssh.privateKeyPath")}
                    leadingIcon="key"
                    value={sshForm().keyPath}
                    placeholder="~/.ssh/id_rsa"
                    accessibilityLabel="ssh-form-key-path"
                    onChange={v => setSshFormField("keyPath", v)}
                  />
                  <InputBox
                    label={tr("ssh.passphraseOptional")}
                    masked={!sshShowPassphrase()}
                    value={sshForm().passphrase}
                    placeholder={tr("ssh.passphrasePlaceholder")}
                    accessibilityLabel="ssh-form-passphrase"
                    trailing={
                      <IconButton
                        icon={sshShowPassphrase() ? "eye-off" : "eye"}
                        size="xs"
                        tooltip={
                          sshShowPassphrase()
                            ? tr("ssh.hidePassphrase")
                            : tr("ssh.showPassphrase")
                        }
                        accessibilityLabel="Toggle passphrase visibility"
                        onPress={() => sshShowPassphrase.update(v => !v)}
                      />
                    }
                    onChange={v => setSshFormField("passphrase", v)}
                  />
                </View>
              </If>

              <If when={sshForm().authType === "keyboardInteractive"}>
                <View style={{ flexDirection: "row", gap: 10, minWidth: 0 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <InputBox
                      masked
                      label={tr("ssh.challengePassword")}
                      value={sshForm().password}
                      placeholder={tr("ssh.authPassword")}
                      accessibilityLabel="ssh-form-challenge-password"
                      onChange={v => setSshFormField("password", v)}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <InputBox
                      masked
                      monospace
                      label={tr("ssh.verificationCode")}
                      value={sshForm().verificationCode}
                      placeholder="2FA / OTP"
                      accessibilityLabel="ssh-form-verification-code"
                      onChange={v => setSshFormField("verificationCode", v)}
                    />
                  </View>
                </View>
              </If>
            </View>
          </If>

          {/* Docker Container Name & Discovery */}
          <If when={usesDocker()}>
            <View style={{ gap: 8 }}>
              <FieldSection
                label={tr("ssh.containerNameOrId")}
                right={
                  <Button
                    label={dockerContainersLoading() ? tr("ssh.scanning") : tr("ssh.discover")}
                    size="xs"
                    variant="secondary"
                    leadingIcon="refresh"
                    loading={dockerContainersLoading()}
                    accessibilityLabel="ssh-discover-containers"
                    onPress={() => void discoverDockerContainers()}
                  />
                }
              >
                <InputBox
                  monospace
                  leadingIcon="container"
                  value={sshForm().containerName}
                  placeholder="dev-container"
                  accessibilityLabel="ssh-form-container-name"
                  onChange={v => setSshFormField("containerName", v)}
                />
              </FieldSection>
              <If when={dockerContainers().length > 0}>
                <SelectDropdown
                  searchable
                  placeholder={tr("ssh.pickContainer")}
                  accessibilityLabel="ssh-discovered-container-select"
                  options={containerDropdownOptions()}
                  value={sshForm().containerName || null}
                  onChange={name => setSshFormField("containerName", name)}
                />
              </If>
            </View>
          </If>

          {/* Advanced Settings Toggle */}
          <View style={{ gap: 10 }}>
            <View style={{ alignSelf: "flex-start" }}>
              <Button
                label={
                  sshShowAdvanced()
                    ? tr("ssh.hideAdvancedSettings")
                    : tr("ssh.advancedSettings")
                }
                variant="ghost"
                size="xs"
                leadingIcon={sshShowAdvanced() ? "chevron-up" : "chevron-down"}
                accessibilityLabel="ssh-toggle-advanced"
                onPress={() => sshShowAdvanced.update(v => !v)}
              />
            </View>

            <If when={sshShowAdvanced()}>
              <View
                style={{
                  padding: 14,
                  gap: 12,
                  borderRadius: radii.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().border,
                  backgroundColor: palette().panelRaised,
                  boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
                }}
              >
                <InputBox
                  label={tr("ssh.connectionDisplayName")}
                  value={sshForm().name}
                  placeholder={tr("ssh.placeholderDisplayName")}
                  accessibilityLabel="ssh-form-name"
                  onChange={v => setSshFormField("name", v)}
                />

                <If when={sshTargetType() === "wsl"}>
                  <InputBox
                    label={tr("ssh.wslUserOptional")}
                    value={sshForm().wslUser}
                    placeholder={tr("ssh.wslUserPlaceholder")}
                    accessibilityLabel="ssh-form-wsl-user"
                    onChange={v => setSshFormField("wslUser", v)}
                  />
                </If>

                <If when={usesDocker()}>
                  <View style={{ gap: 10 }}>
                    <FieldSection label={tr("ssh.containerAccessMode")}>
                      <SelectDropdown
                        accessibilityLabel="ssh-form-container-access"
                        options={containerAccessOptions()}
                        value={sshForm().containerAccess}
                        onChange={v => setSshFormField("containerAccess", v)}
                      />
                    </FieldSection>
                    <View
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: 8,
                      }}
                    >
                      <InputBox
                        monospace
                        label={tr("ssh.dockerCliPath")}
                        value={sshForm().dockerPath}
                        placeholder="docker"
                        accessibilityLabel="ssh-form-docker-path"
                        onChange={v => setSshFormField("dockerPath", v)}
                      />
                      <InputBox
                        monospace
                        label={tr("ssh.containerShell")}
                        value={sshForm().containerShell}
                        placeholder="/bin/sh"
                        accessibilityLabel="ssh-form-container-shell"
                        onChange={v => setSshFormField("containerShell", v)}
                      />
                      <InputBox
                        label={tr("ssh.containerUser")}
                        value={sshForm().containerUser}
                        placeholder={tr("common.optional")}
                        accessibilityLabel="ssh-form-container-user"
                        onChange={v => setSshFormField("containerUser", v)}
                      />
                    </View>
                  </View>
                </If>

                <If when={!isLocalProcess() && sshTargetType() !== "remoteDocker"}>
                  <View style={{ gap: 10 }}>
                    <If when={sshForm().authType === "privateKey"}>
                      <InputBox
                        monospace
                        label={tr("ssh.certPathOptional")}
                        value={sshForm().certificatePath}
                        placeholder="~/.ssh/id_rsa-cert.pub"
                        accessibilityLabel="ssh-form-cert-path"
                        onChange={v => setSshFormField("certificatePath", v)}
                      />
                    </If>

                    <If when={sshForm().authType === "agent"}>
                      <View
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          gap: 10,
                        }}
                      >
                        <InputBox
                          monospace
                          label={tr("ssh.agentFingerprint")}
                          value={sshForm().keyFingerprint}
                          placeholder="SHA256:..."
                          accessibilityLabel="ssh-form-fingerprint"
                          onChange={v => setSshFormField("keyFingerprint", v)}
                        />
                        <InputBox
                          monospace
                          label={tr("ssh.fallbackKeyPath")}
                          value={sshForm().fallbackKeyPath}
                          placeholder="~/.ssh/id_rsa"
                          accessibilityLabel="ssh-form-fallback-key"
                          onChange={v => setSshFormField("fallbackKeyPath", v)}
                        />
                      </View>
                    </If>

                    <InputBox
                      monospace
                      label={tr("ssh.proxyJump")}
                      hint={tr("ssh.proxyJumpHint")}
                      value={sshForm().proxyJump}
                      placeholder="bastion1,user@bastion2:2222"
                      accessibilityLabel="ssh-form-proxy-jump"
                      onChange={v => setSshFormField("proxyJump", v)}
                    />

                    <If when={Boolean(sshForm().proxyJump.trim()) && sshForm().authType === "password"}>
                      <ModalAlertBanner
                        tone="warning"
                        message={tr("ssh.proxyJumpPasswordWarning")}
                      />
                    </If>

                    <View
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 10,
                      }}
                    >
                      <InputBox
                        monospace
                        label={tr("ssh.connectTimeout")}
                        value={sshForm().connectTimeoutSecs}
                        accessibilityLabel="ssh-form-connect-timeout"
                        onChange={v => setSshFormField("connectTimeoutSecs", v)}
                      />
                      <InputBox
                        monospace
                        label={tr("ssh.authTimeout")}
                        value={sshForm().authTimeoutSecs}
                        accessibilityLabel="ssh-form-auth-timeout"
                        onChange={v => setSshFormField("authTimeoutSecs", v)}
                      />
                      <InputBox
                        monospace
                        label={tr("ssh.authAttempts")}
                        value={sshForm().authAttempts}
                        accessibilityLabel="ssh-form-auth-attempts"
                        onChange={v => setSshFormField("authAttempts", v)}
                      />
                      <InputBox
                        monospace
                        label={tr("ssh.connectAttempts")}
                        value={sshForm().connectAttempts}
                        accessibilityLabel="ssh-form-connect-attempts"
                        onChange={v => setSshFormField("connectAttempts", v)}
                      />
                    </View>
                  </View>
                </If>
              </View>
            </If>
          </View>

          {/* In-progress SSH Hop Test feedback */}
          <If when={sshTesting()}>
            <View
              style={{
                padding: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                borderRadius: radii.lg,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().accentBorder,
                backgroundColor: palette().panelRaised,
                boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
              }}
            >
              <Spinner size={14} color={palette().accent} />
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().textSecondary,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.4),
                }}
              >
                {tr("ssh.testingConnection")}
              </Text>
            </View>
          </If>

          {/* Connection Test Report — hop-by-hop stage timeline */}
          <If when={!sshTesting() && connectionTestReport() ? connectionTestReport() : null}>
            {report => (
              <View
                style={{
                  padding: 14,
                  gap: 10,
                  borderRadius: radii.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: report().success
                    ? palette().successBorder
                    : palette().dangerBorder,
                  backgroundColor: palette().panelRaised,
                  boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
                }}
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <StatusPill
                    label={report().success ? tr("ssh.testPassed") : tr("ssh.testFailed")}
                    kind={report().success ? "success" : "danger"}
                  />
                  <If when={typeof report().latencyMs === "number"}>
                    <Badge label={tr("format.durationMs", { count: report().latencyMs ?? 0 })} />
                  </If>
                  <If when={report().resolvedContainerAccess ?? ""}>
                    {acc => (
                      <Badge
                        label={tr("ssh.containerAccessBadge", { access: acc() })}
                        tone="accent"
                      />
                    )}
                  </If>
                </View>

                <If when={report().error ?? ""}>
                  {err => (
                    <Text
                      style={{
                        color: palette().danger,
                        fontSize: textSize(11.5),
                        lineHeight: textLineHeight(11.5, 1.45),
                      }}
                    >
                      {localizeHostError(err())}
                    </Text>
                  )}
                </If>

                <View style={{ gap: 0 }}>
                  <Each of={report().stages ?? report().steps ?? []} key={st => st.id}>
                    {(stage, idx) => {
                      const total = () => (report().stages ?? report().steps ?? []).length;
                      return (
                        <View style={{ flexDirection: "row", alignItems: "stretch", gap: 10 }}>
                          <View style={{ width: 18, alignItems: "center", flexShrink: 0 }}>
                            <View
                              style={{
                                width: 18,
                                height: 18,
                                marginTop: 1,
                                borderRadius: radii.pill,
                                backgroundColor: stage().success
                                  ? palette().successSoft
                                  : palette().dangerSoft,
                                borderWidth: 1,
                                borderColor: stage().success
                                  ? palette().successBorder
                                  : palette().dangerBorder,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Icon
                                name={stage().success ? "check" : "close"}
                                size={10}
                                color={
                                  stage().success ? palette().success : palette().danger
                                }
                              />
                            </View>
                            <If when={idx() < total() - 1}>
                              <View
                                style={{
                                  width: 1,
                                  flex: 1,
                                  minHeight: 10,
                                  backgroundColor: palette().border,
                                  marginVertical: 2,
                                }}
                              />
                            </If>
                          </View>
                          <View
                            style={{
                              flex: 1,
                              minWidth: 0,
                              paddingBottom: idx() < total() - 1 ? 8 : 0,
                              gap: 2,
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
                              <Text
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  color: palette().text,
                                  fontSize: textSize(12),
                                  lineHeight: textLineHeight(12, 1.4),
                                  fontWeight: "500",
                                  fontFamily: fontMono,
                                  fontVariant: ["tabular-nums"],
                                  numberOfLines: 1,
                                  textOverflow: "ellipsis-middle",
                                }}
                              >
                                {formatStageLabel(stage())}
                              </Text>
                              <If when={stageLatencyMs(stage()) !== null}>
                                <Text
                                  style={{
                                    color: palette().textMuted,
                                    fontFamily: fontMono,
                                    fontSize: textSize(10.5),
                                    lineHeight: textLineHeight(10.5, 1.35),
                                    fontVariant: ["tabular-nums"],
                                    flexShrink: 0,
                                  }}
                                >
                                  {tr("format.durationMs", {
                                    count: stageLatencyMs(stage()) ?? 0,
                                  })}
                                </Text>
                              </If>
                            </View>
                            <If when={stage().error ?? ""}>
                              {stErr => (
                                <Text
                                  style={{
                                    color: palette().danger,
                                    fontSize: textSize(11),
                                    lineHeight: textLineHeight(11, 1.4),
                                  }}
                                >
                                  {localizeHostError(stErr())}
                                </Text>
                              )}
                            </If>
                          </View>
                        </View>
                      );
                    }}
                  </Each>
                </View>
              </View>
            )}
          </If>
        </View>
      </If>
    </ModalDialog>
  );
}

// ============================================================================
// 3. SSH Auth Prompt Modal
// ============================================================================

function SshAuthPromptModal() {
  const showSecret = signal(false);

  effect(() => {
    if (!authPromptOpen()) {
      showSecret.set(false);
    }
  });

  return (
    <ModalDialog
      open={authPromptOpen()}
      title={tr("ssh.authModalTitle")}
      subtitle={authPromptDescription()}
      size="sm"
      accessibilityLabel="ssh-auth-prompt-modal"
      closeOnBackdropPress={!sshConnecting()}
      closeOnEscape={!sshConnecting()}
      onClose={closeAuthPrompt}
      footer={
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            label={tr("common.cancel")}
            variant="secondary"
            size="sm"
            disabled={sshConnecting()}
            accessibilityLabel="ssh-auth-cancel"
            onPress={closeAuthPrompt}
          />
          <Button
            label={sshConnecting() ? tr("ssh.connectingEllipsis") : tr("common.connect")}
            variant="primary"
            size="sm"
            loading={sshConnecting()}
            accessibilityLabel="ssh-auth-submit"
            onPress={() => void submitAuthPrompt()}
          />
        </View>
      }
    >
      <ModalAlertBanner message={authPromptError()} onDismiss={() => authPromptError.set("")} />

      <If when={authPromptLockUsername() && authPromptUsername().trim() !== ""}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().panelRaised,
          }}
        >
          <Icon name="shield" size={13.5} color={palette().textMuted} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontFamily: fontMono,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.35),
              numberOfLines: 1,
              textOverflow: "ellipsis-middle",
            }}
          >
            {authPromptUsername()}
          </Text>
          <Badge label={tr("ssh.account")} size="xs" tone="neutral" />
        </View>
      </If>

      <If when={!authPromptLockUsername()}>
        <InputBox
          label={tr("ssh.username")}
          value={authPromptUsername()}
          placeholder="root"
          accessibilityLabel="ssh-auth-username"
          onChange={v => authPromptUsername.set(v)}
        />
      </If>

      <FieldSection label={tr("ssh.authMethod")}>
        <SelectDropdown
          accessibilityLabel="ssh-auth-method"
          options={[
            { value: "password", label: tr("ssh.authPassword"), icon: "key" },
            { value: "privateKey", label: tr("ssh.authPrivateKey"), icon: "key" },
            { value: "agent", label: tr("ssh.authAgent"), icon: "shield" },
            {
              value: "keyboardInteractive",
              label: tr("ssh.authKeyboardInteractive"),
              icon: "key",
            },
          ]}
          value={authPromptMethod()}
          onChange={v => authPromptMethod.set(v)}
        />
      </FieldSection>

      <If when={authPromptMethod() === "password"}>
        <InputBox
          autoFocus
          label={tr("ssh.authPassword")}
          leadingIcon="key"
          masked={!showSecret()}
          value={authPromptPassword()}
          placeholder={tr("ssh.enterPassword")}
          accessibilityLabel="ssh-auth-password"
          trailing={
            <IconButton
              icon={showSecret() ? "eye-off" : "eye"}
              size="xs"
              tooltip={showSecret() ? tr("ssh.hidePassword") : tr("ssh.showPassword")}
              accessibilityLabel="ssh-auth-toggle-secret"
              onPress={() => showSecret.update(v => !v)}
            />
          }
          onChange={v => authPromptPassword.set(v)}
          onSubmit={() => void submitAuthPrompt()}
        />
      </If>

      <If when={authPromptMethod() === "privateKey"}>
        <View style={{ gap: 10 }}>
          <InputBox
            monospace
            label={tr("ssh.privateKeyPath")}
            value={authPromptKeyPath()}
            placeholder="~/.ssh/id_rsa"
            accessibilityLabel="ssh-auth-key-path"
            onChange={v => authPromptKeyPath.set(v)}
          />
          <InputBox
            label={tr("ssh.passphraseOptional")}
            masked={!showSecret()}
            value={authPromptPassphrase()}
            placeholder={tr("ssh.passphrasePlaceholder")}
            accessibilityLabel="ssh-auth-passphrase"
            trailing={
              <IconButton
                icon={showSecret() ? "eye-off" : "eye"}
                size="xs"
                tooltip={showSecret() ? tr("ssh.hidePassphrase") : tr("ssh.showPassphrase")}
                accessibilityLabel="ssh-auth-toggle-secret"
                onPress={() => showSecret.update(v => !v)}
              />
            }
            onChange={v => authPromptPassphrase.set(v)}
            onSubmit={() => void submitAuthPrompt()}
          />
        </View>
      </If>

      <If when={authPromptMethod() === "keyboardInteractive"}>
        <View style={{ gap: 10 }}>
          <InputBox
            autoFocus
            label={tr("ssh.challengePassword")}
            masked={!showSecret()}
            value={authPromptPassword()}
            placeholder={tr("ssh.enterChallengePassword")}
            accessibilityLabel="ssh-auth-challenge"
            trailing={
              <IconButton
                icon={showSecret() ? "eye-off" : "eye"}
                size="xs"
                tooltip={showSecret() ? tr("ssh.hidePassword") : tr("ssh.showPassword")}
                accessibilityLabel="ssh-auth-toggle-secret"
                onPress={() => showSecret.update(v => !v)}
              />
            }
            onChange={v => authPromptPassword.set(v)}
            onSubmit={() => void submitAuthPrompt()}
          />
          <InputBox
            masked
            monospace
            label={tr("ssh.verificationCode")}
            value={authPromptVerificationCode()}
            placeholder="OTP"
            accessibilityLabel="ssh-auth-otp"
            onChange={v => authPromptVerificationCode.set(v)}
            onSubmit={() => void submitAuthPrompt()}
          />
        </View>
      </If>
    </ModalDialog>
  );
}

// ============================================================================
// 4. Remote File Browser Modal (matching RemoteFileBrowser.tsx)
// ============================================================================

function parsePosixBreadcrumbs(rawPath: string): Array<{ label: string; path: string }> {
  const cleaned = rawPath.trim().replace(/\/+/g, "/");
  if (!cleaned || cleaned === "/") {
    return [{ label: "/", path: "/" }];
  }
  const absolute = cleaned.startsWith("/");
  const trimmed = cleaned.replace(/^\/+|\/+$/g, "");
  const parts = trimmed ? trimmed.split("/").filter(Boolean) : [];
  const crumbs: Array<{ label: string; path: string }> = absolute
    ? [{ label: "/", path: "/" }]
    : [];
  let acc = "";
  for (const part of parts) {
    acc = absolute ? `${acc}/${part}` : acc ? `${acc}/${part}` : part;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs.length > 0 ? crumbs : [{ label: "/", path: "/" }];
}

function RemoteFileBrowserModal() {
  const ctxMenuOpen = signal(false);
  const ctxMenuPos = signal<Point | null>(null);
  const ctxMenuEntry = signal<RemoteFileEntry | null>(null);

  const ctxMenuItems = (): ReadonlyArray<DropdownMenuItem> => {
    const entry = ctxMenuEntry();
    if (!entry) return [];
    const items: DropdownMenuItem[] = [
      {
        id: "open",
        label: entry.isDir ? tr("ssh.openFolder") : tr("ssh.selectItem"),
        icon: "folder",
        onSelect: () => {
          if (entry.isDir || entry.isSymlink) {
            void loadRemoteDirectory(entry.path);
          } else if (!browserSelectDirectoriesOnly()) {
            browserSelectedPath.set(entry.path);
          }
        },
      },
      {
        id: "rename",
        label: tr("common.rename"),
        icon: "edit",
        onSelect: () => {
          browserRenamingEntry.set(entry);
          browserRenameValue.set(entry.name);
        },
      },
      {
        id: "delete",
        label: tr("common.delete"),
        icon: "trash",
        danger: true,
        separator: true,
        onSelect: () => {
          browserConfirmDeleteEntry.set(entry);
        },
      },
    ];
    return items;
  };

  const entryIconName = (entry: RemoteFileEntry): IconName => {
    if (entry.isDir) return "folder";
    if (entry.isSymlink) return "link";
    const lower = entry.name.toLowerCase();
    if (/\.(ts|tsx|js|jsx|rs|py|go|java|kt|swift|c|cpp|h|sh|json|toml|yaml|yml)$/.test(lower)) {
      return "file-code";
    }
    return "file-text";
  };

  const footerPathLabel = (): string =>
    !browserSelectDirectoriesOnly() && browserSelectedPath()
      ? tr("ssh.selectedPath", { path: browserSelectedPath()! })
      : browserCurrentPath();

  const breadcrumbs = () => parsePosixBreadcrumbs(browserCurrentPath());

  return (
    <ModalDialog
      open={remoteFileBrowserOpen()}
      title={tr("ssh.selectRemoteWorkspace")}
      subtitle={browserConnectionName()}
      size="lg"
      accessibilityLabel="remote-file-browser-modal"
      closeOnBackdropPress={!browserBusy()}
      closeOnEscape={!browserBusy()}
      onClose={closeRemoteFileBrowser}
      footer={
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            tooltip={<TooltipBubble text={footerPathLabel()} />}
            style={{ flex: 1, minWidth: 0 }}
          >
            <Text
              style={{
                color: palette().textElevatedMuted,
                fontFamily: fontMono,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.38),
                numberOfLines: 1,
                textOverflow: "ellipsis-middle",
              }}
            >
              {footerPathLabel()}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="sm"
              disabled={browserBusy()}
              accessibilityLabel="remote-browser-cancel"
              onPress={closeRemoteFileBrowser}
            />
            <Button
              label={browserBusy() ? tr("ssh.openingEllipsis") : tr("ssh.openWorkspace")}
              variant="primary"
              size="sm"
              loading={browserBusy()}
              disabled={browserLoading()}
              accessibilityLabel="remote-browser-open"
              onPress={() => void confirmBrowserSelection()}
            />
          </View>
        </View>
      }
    >
      <ModalAlertBanner message={browserError()} onDismiss={() => browserError.set("")} />

      <If when={browserPendingRebind()}>
        {pending => (
          <InlineConfirmBar
            message={tr("ssh.rebindConfirm", {
              path: pending().remotePath,
              owner: pending().owner,
              target: pending().connectionName,
            })}
            confirmLabel={tr("ssh.moveWorkspace")}
            cancelLabel={tr("common.cancel")}
            onConfirm={() => void confirmRemoteWorkspaceRebind()}
            onCancel={cancelRemoteWorkspaceRebind}
          />
        )}
      </If>

      {/* Toolbar (controlHeight.sm baseline), Breadcrumbs & Path Input */}
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
          <IconButton
            icon="home"
            size="sm"
            tooltip={tr("ssh.homeDirectory")}
            accessibilityLabel="remote-browser-home"
            disabled={browserLoading()}
            onPress={() => void loadRemoteDirectory(browserHomePath())}
          />
          <IconButton
            icon="arrow-left"
            size="sm"
            tooltip={tr("ssh.parentDirectory")}
            accessibilityLabel="remote-browser-up"
            disabled={browserLoading() || getRemoteParentPath(browserCurrentPath()) === null}
            onPress={() => {
              const parent = getRemoteParentPath(browserCurrentPath());
              if (parent !== null) void loadRemoteDirectory(parent);
            }}
          />
          <IconButton
            icon="refresh"
            size="sm"
            tooltip={tr("ssh.refreshDirectory")}
            accessibilityLabel="remote-browser-refresh"
            disabled={browserLoading()}
            onPress={() => void loadRemoteDirectory(browserCurrentPath())}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <InputBox
              size="sm"
              monospace
              value={browserPathInput()}
              placeholder="/srv/project"
              accessibilityLabel="remote-browser-path-input"
              onChange={v => browserPathInput.set(v)}
              onSubmit={() => void loadRemoteDirectory(browserPathInput())}
            />
          </View>
          <Button
            label={tr("common.go")}
            variant="secondary"
            size="sm"
            disabled={browserLoading()}
            accessibilityLabel="remote-browser-path-go"
            onPress={() => void loadRemoteDirectory(browserPathInput())}
          />
          <IconButton
            icon="folder-plus"
            size="sm"
            active={browserNewDirOpen()}
            tooltip={tr("ssh.newRemoteFolder")}
            accessibilityLabel="remote-browser-new-folder-toggle"
            onPress={() => browserNewDirOpen.update(v => !v)}
          />
          <IconButton
            icon="network"
            size="sm"
            tooltip={tr("nav.portForwarding")}
            accessibilityLabel="remote-browser-port-forward"
            onPress={() => {
              const cid = browserConnectionId();
              if (cid) void openPortForwardModal(cid, browserConnectionName());
            }}
          />
        </View>

        {/* POSIX Breadcrumb Strip */}
        <Scroll horizontal scrollbar={false} style={{ width: "100%", minWidth: 0 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 2,
              paddingVertical: 1,
            }}
          >
            <Each of={breadcrumbs()} key={crumb => crumb.path}>
              {(crumb, idx) => {
                const isLast = () => idx() === breadcrumbs().length - 1;
                return (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
                    <If when={idx() > 0}>
                      <Icon name="chevron-right" size={11} color={palette().textMuted} />
                    </If>
                    <View
                      role="button"
                      disabled={browserLoading() || isLast()}
                      accessibilityLabel={`remote-breadcrumb-${idx()}`}
                      onPress={() => {
                        if (!browserLoading() && !isLast()) {
                          void loadRemoteDirectory(crumb().path);
                        }
                      }}
                      style={{
                        height: controlHeight.xs,
                        maxWidth: 160,
                        paddingHorizontal: 7,
                        borderRadius: radii.xs,
                        borderCurve: "continuous",
                        justifyContent: "center",
                        backgroundColor: isLast() ? palette().surfaceSubtle : "transparent",
                        cursor: isLast() || browserLoading() ? "default" : "pointer",
                        ...paintTransition(MOTION_DURATION.fast),
                      }}
                      hoverStyle={
                        isLast() || browserLoading()
                          ? undefined
                          : { backgroundColor: palette().panelHover }
                      }
                      activeStyle={
                        isLast() || browserLoading() ? undefined : { opacity: 0.85 }
                      }
                      focusVisibleStyle={{
                        outlineWidth: 2,
                        outlineColor: palette().borderFocus,
                        outlineOffset: -1,
                      }}
                    >
                      <Text
                        style={{
                          color: isLast() ? palette().text : palette().textMuted,
                          fontFamily: fontMono,
                          fontSize: textSize(11.5),
                          lineHeight: textLineHeight(11.5, 1.3),
                          fontWeight: isLast() ? "600" : "500",
                          numberOfLines: 1,
                          textOverflow: "ellipsis-middle",
                        }}
                      >
                        {crumb().label}
                      </Text>
                    </View>
                  </View>
                );
              }}
            </Each>
          </View>
        </Scroll>

        <SearchInput
          size="sm"
          value={browserFilter()}
          placeholder={tr("ssh.filterDirectory")}
          accessibilityLabel="remote-browser-filter"
          onChange={v => browserFilter.set(v)}
        />
      </View>

      {/* New Folder Bar */}
      <If when={browserNewDirOpen()}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            padding: 10,
            borderRadius: radii.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().panelRaised,
            boxShadow: palette().innerHighlight,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <InputBox
              autoFocus
              size="sm"
              monospace
              value={browserNewDirName()}
              placeholder={tr("ssh.newDirPlaceholder")}
              accessibilityLabel="remote-browser-new-dir-name"
              onChange={v => browserNewDirName.set(v)}
              onSubmit={() => void createRemoteDirectory(browserNewDirName())}
            />
          </View>
          <Button
            label={tr("common.create")}
            variant="primary"
            size="sm"
            disabled={!browserNewDirName().trim() || browserBusy()}
            accessibilityLabel="remote-browser-new-dir-create"
            onPress={() => void createRemoteDirectory(browserNewDirName())}
          />
          <Button
            label={tr("common.cancel")}
            variant="ghost"
            size="sm"
            onPress={() => {
              browserNewDirOpen.set(false);
              browserNewDirName.set("");
            }}
          />
        </View>
      </If>

      {/* Rename Bar — stacked label prevents long filenames from squeezing the input */}
      <If when={browserRenamingEntry()}>
        {entry => (
          <View
            style={{
              gap: 6,
              padding: 10,
              borderRadius: radii.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().border,
              backgroundColor: palette().panelRaised,
              boxShadow: palette().innerHighlight,
            }}
          >
            <Text
              style={{
                color: palette().textSecondary,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.35),
                fontWeight: "600",
                numberOfLines: 1,
                textOverflow: "ellipsis-middle",
              }}
            >
              {tr("ssh.renameEntry", { name: entry().name })}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <InputBox
                  autoFocus
                  size="sm"
                  monospace
                  value={browserRenameValue()}
                  accessibilityLabel="remote-browser-rename-input"
                  onChange={v => browserRenameValue.set(v)}
                  onSubmit={() => void submitRemoteRename()}
                />
              </View>
              <Button
                label={tr("common.save")}
                variant="primary"
                size="sm"
                accessibilityLabel="remote-browser-rename-save"
                onPress={() => void submitRemoteRename()}
              />
              <Button
                label={tr("common.cancel")}
                variant="ghost"
                size="sm"
                onPress={() => browserRenamingEntry.set(null)}
              />
            </View>
          </View>
        )}
      </If>

      {/* Delete Confirm Bar */}
      <If when={browserConfirmDeleteEntry()}>
        {entry => (
          <InlineConfirmBar
            danger
            message={tr("ssh.deleteEntryConfirm", { name: entry().name })}
            confirmLabel={tr("common.delete")}
            cancelLabel={tr("common.cancel")}
            onConfirm={() => void confirmRemoteDelete()}
            onCancel={() => browserConfirmDeleteEntry.set(null)}
          />
        )}
      </If>

      {/* Remote File List — matched 280px height across loading & loaded states prevents jump */}
      <View
        style={{
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().panelRaised,
          boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
          overflow: "hidden",
        }}
      >
        <If
          when={browserLoading()}
          else={
            <Scroll style={{ height: 280, minHeight: 0 }} scrollbar={true}>
              <View>
                <If when={getRemoteParentPath(browserCurrentPath()) !== null}>
                  <View
                    role="button"
                    accessibilityLabel="remote-entry-parent"
                    onPress={() => {
                      const parent = getRemoteParentPath(browserCurrentPath());
                      if (parent !== null) void loadRemoteDirectory(parent);
                    }}
                    style={{
                      minHeight: 34,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderBottomWidth: 1,
                      borderColor: palette().borderSubtle,
                      cursor: "pointer",
                      ...paintTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{ backgroundColor: palette().panelHover }}
                    activeStyle={{ opacity: 0.9 }}
                    focusVisibleStyle={{
                      outlineWidth: 2,
                      outlineColor: palette().borderFocus,
                      outlineOffset: -2,
                    }}
                  >
                    <Icon name="folder-open" size={14} color={palette().textMuted} />
                    <Text
                      style={{
                        color: palette().textSecondary,
                        fontFamily: fontMono,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.35),
                      }}
                    >
                      ..
                    </Text>
                  </View>
                </If>

                <Each of={filteredBrowserEntries()} key={entry => entry.path}>
                  {entry => (
                    <View
                      role="button"
                      accessibilityLabel={`remote-entry-${entry().name}`}
                      accessibilityState={{
                        selected: browserSelectedPath() === entry().path,
                      }}
                      onPress={() => {
                        if (entry().isDir || (browserSelectDirectoriesOnly() && entry().isSymlink)) {
                          void loadRemoteDirectory(entry().path);
                        } else if (!browserSelectDirectoriesOnly()) {
                          browserSelectedPath.set(entry().path);
                        }
                      }}
                      onContextMenu={e => {
                        ctxMenuEntry.set(entry());
                        ctxMenuPos.set(e.pagePosition);
                        ctxMenuOpen.set(true);
                      }}
                      style={{
                        minHeight: 34,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderBottomWidth: 1,
                        borderColor: palette().borderSubtle,
                        backgroundColor:
                          browserSelectedPath() === entry().path
                            ? palette().accentSoft
                            : "transparent",
                        cursor: "pointer",
                        ...paintTransition(MOTION_DURATION.fast),
                      }}
                      hoverStyle={{
                        backgroundColor:
                          browserSelectedPath() === entry().path
                            ? palette().accentSoft
                            : palette().panelHover,
                      }}
                      activeStyle={{ opacity: 0.9 }}
                      focusVisibleStyle={{
                        outlineWidth: 2,
                        outlineColor: palette().borderFocus,
                        outlineOffset: -2,
                      }}
                    >
                      <Icon
                        name={entryIconName(entry())}
                        size={14}
                        color={entry().isDir ? palette().accent : palette().textMuted}
                      />
                      <Text
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: palette().text,
                          fontSize: textSize(12.5),
                          lineHeight: textLineHeight(12.5, 1.35),
                          fontWeight: entry().isDir ? "500" : "400",
                          numberOfLines: 1,
                          textOverflow: "ellipsis-middle",
                        }}
                      >
                        {entry().name}
                      </Text>
                      <Text
                        style={{
                          minWidth: 60,
                          textAlign: "right",
                          flexShrink: 0,
                          color: palette().textMuted,
                          fontFamily: fontMono,
                          fontSize: textSize(11),
                          lineHeight: textLineHeight(11, 1.35),
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {entry().isDir ? "—" : formatFileSize(entry().size)}
                      </Text>
                      <IconButton
                        icon="edit"
                        size="xs"
                        tooltip={tr("ssh.renameEntry", { name: entry().name })}
                        accessibilityLabel={`Rename ${entry().name}`}
                        onPress={() => {
                          browserRenamingEntry.set(entry());
                          browserRenameValue.set(entry().name);
                        }}
                      />
                      <IconButton
                        icon="trash"
                        size="xs"
                        tone="danger"
                        tooltip={tr("common.delete")}
                        accessibilityLabel={`Delete ${entry().name}`}
                        onPress={() => browserConfirmDeleteEntry.set(entry())}
                      />
                    </View>
                  )}
                </Each>

                <If when={!browserLoading() && filteredBrowserEntries().length === 0}>
                  <View
                    style={{
                      paddingVertical: 28,
                      paddingHorizontal: 16,
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Text
                      style={{
                        color: palette().textMuted,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.45),
                        textAlign: "center",
                      }}
                    >
                      {browserFilter().trim() !== ""
                        ? tr("ssh.noEntriesMatch", { query: browserFilter().trim() })
                        : tr("ssh.directoryEmpty")}
                    </Text>
                    <If when={browserFilter().trim() !== ""}>
                      <Button
                        label={tr("common.clearFilter")}
                        size="xs"
                        variant="ghost"
                        onPress={() => browserFilter.set("")}
                      />
                    </If>
                  </View>
                </If>
              </View>
            </Scroll>
          }
        >
          <View
            style={{
              height: 280,
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <Spinner size={20} />
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
              }}
            >
              {tr("ssh.loadingRemoteDir")}
            </Text>
          </View>
        </If>
      </View>

      <ContextMenuOverlay
        open={ctxMenuOpen()}
        position={ctxMenuPos()}
        items={ctxMenuItems()}
        onClose={() => ctxMenuOpen.set(false)}
      />
    </ModalDialog>
  );
}

// ============================================================================
// 5. Port Forwarding Modal (matching PortForwardDialog.tsx)
// ============================================================================

function PortForwardModal() {
  return (
    <ModalDialog
      open={portForwardModalOpen()}
      title={tr("ssh.portForwardingTitle")}
      subtitle={portForwardConnectionName()}
      size="lg"
      accessibilityLabel="port-forward-modal"
      onClose={closePortForwardModal}
      footer={
        <Button
          label={tr("common.close")}
          variant="secondary"
          size="sm"
          accessibilityLabel="pf-close"
          onPress={closePortForwardModal}
        />
      }
    >
      <Text
        style={{
          color: palette().textElevatedMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.48),
        }}
      >
        {tr("ssh.portForwardingIntro")}
      </Text>

      <ModalAlertBanner
        message={portForwardError()}
        onDismiss={() => portForwardError.set("")}
      />

      {/* Detected Listening Ports */}
      <ConfigSection
        title={tr("ssh.detectedPorts")}
        extra={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <If when={detectingPorts() && listeningPorts().length > 0}>
              <Spinner size={12} color={palette().accent} />
            </If>
            <IconButton
              icon="refresh"
              size="xs"
              tooltip={tr("ssh.scanPorts")}
              disabled={detectingPorts()}
              accessibilityLabel="pf-detect-ports"
              onPress={() => void detectRemoteListeningPorts()}
            />
          </View>
        }
      >
        <View>
          <If when={detectingPorts() && listeningPorts().length === 0}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Spinner size={13} />
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.4),
                }}
              >
                {tr("ssh.scanningPorts")}
              </Text>
            </View>
          </If>

          <If when={!detectingPorts() && listeningPorts().length === 0}>
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
              }}
            >
              {tr("ssh.noListeningPorts")}
            </Text>
          </If>

          <If when={listeningPorts().length > 0}>
            <Scroll style={{ maxHeight: 132, minHeight: 0 }} scrollbar={true}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <Each of={listeningPorts()} key={p => `${p.port}-${p.bindAddress}`}>
                  {port => (
                    <PillChip
                      label={
                        port().process
                          ? `${port().port} · ${port().process}`
                          : String(port().port)
                      }
                      maxWidth={220}
                      badge={
                        forwardedRemotePortSet().has(port().port)
                          ? tr("ssh.forwarded")
                          : portForwardBusyPort() === port().port
                            ? "…"
                            : "+"
                      }
                      tone={forwardedRemotePortSet().has(port().port) ? "success" : "neutral"}
                      active={forwardedRemotePortSet().has(port().port)}
                      accessibilityLabel={`pf-detected-${port().port}`}
                      onPress={() => {
                        if (
                          !forwardedRemotePortSet().has(port().port) &&
                          portForwardBusyPort() === null
                        ) {
                          void forwardDetectedPort(port());
                        }
                      }}
                    />
                  )}
                </Each>
              </View>
            </Scroll>
          </If>
        </View>
      </ConfigSection>

      {/* Active Port Forwards */}
      <ConfigSection flush title={tr("ssh.activeForwards")}>
        <If
          when={portForwards().length > 0}
          else={
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.45),
                }}
              >
                {tr("ssh.noActiveForwards")}
              </Text>
            </View>
          }
        >
          <View>
            <Each of={portForwards()} key={fwd => fwd.id}>
              {(fwd, idx) => (
                <ConfigRow
                  label={`${fwd().remoteHost !== "127.0.0.1" ? `${fwd().remoteHost}:${fwd().remotePort}` : fwd().remotePort} → ${formatForwardLocalAddress(fwd())}`}
                  description={[
                    fwd().label || fwd().description || null,
                    fwd().lastError
                      ? tr("ssh.warningPrefix", {
                          message: localizeHostError(fwd().lastError ?? ""),
                        })
                      : formatPlural(
                          fwd().activeConnections,
                          "ssh.activeConnectionOne",
                          "ssh.activeConnectionOther",
                        ),
                    fwd().requestedLocalPort !== undefined && fwd().requestedLocalPort !== null
                      ? tr("ssh.movedFromPort", {
                          from: fwd().requestedLocalPort!,
                          to: fwd().localPort,
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  divider={idx() < portForwards().length - 1}
                >
                  <If when={Boolean(fwd().lastError)}>
                    <Badge label={tr("common.error")} size="xs" tone="warning" />
                  </If>
                  <If when={fwd().localHost === "0.0.0.0"}>
                    <Badge label={tr("ssh.lan")} size="xs" tone="warning" />
                  </If>
                  <IconButton
                    icon="external-link"
                    size="xs"
                    tooltip={tr("ssh.openInBrowser")}
                    accessibilityLabel={`Open forwarded port ${fwd().localPort}`}
                    onPress={() => {
                      void openUrl(`http://${formatForwardLocalAddress(fwd())}`).catch(() =>
                        undefined,
                      );
                    }}
                  />
                  <IconButton
                    icon="copy"
                    size="xs"
                    tooltip={tr("ssh.copyLocalAddress")}
                    accessibilityLabel={`Copy forwarded address ${fwd().localPort}`}
                    onPress={() => {
                      const addr = formatForwardLocalAddress(fwd());
                      void Clipboard.writeText(addr)
                        .then(() =>
                          pushToast(tr("ssh.copiedAddress", { address: addr }), "success"),
                        )
                        .catch(() => undefined);
                    }}
                  />
                  <IconButton
                    icon="close"
                    size="xs"
                    tone="danger"
                    tooltip={tr("ssh.stopPortForward")}
                    accessibilityLabel={`pf-stop-${fwd().id}`}
                    onPress={() => void stopPortForward(fwd().id)}
                  />
                </ConfigRow>
              )}
            </Each>
          </View>
        </If>
      </ConfigSection>

      {/* Manual Port Forward Form */}
      <ConfigSection title={tr("ssh.addCustomForward")}>
        <View style={{ gap: 10 }}>
          <View
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr 1fr",
              gap: 10,
            }}
          >
            <InputBox
              monospace
              label={tr("ssh.remoteHost")}
              value={portForwardRemoteHost()}
              placeholder="127.0.0.1"
              accessibilityLabel="pf-remote-host"
              onChange={v => portForwardRemoteHost.set(v)}
            />
            <InputBox
              monospace
              label={tr("ssh.remotePort")}
              value={portForwardRemotePort()}
              placeholder="3000"
              accessibilityLabel="pf-remote-port"
              onChange={v => portForwardRemotePort.set(v)}
              onSubmit={() => void submitPortForwardForm()}
            />
            <InputBox
              monospace
              label={tr("ssh.localPortOptional")}
              value={portForwardLocalPort()}
              placeholder={tr("common.auto")}
              accessibilityLabel="pf-local-port"
              onChange={v => portForwardLocalPort.set(v)}
              onSubmit={() => void submitPortForwardForm()}
            />
          </View>

          <InputBox
            label={tr("ssh.descriptionOptional")}
            value={portForwardDescription()}
            placeholder={tr("ssh.placeholderDescription")}
            accessibilityLabel="pf-description"
            onChange={v => portForwardDescription.set(v)}
            onSubmit={() => void submitPortForwardForm()}
          />

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              paddingTop: 4,
            }}
          >
            <ToggleSwitch
              value={portForwardExposeOnLan()}
              label={tr("ssh.exposeOnLan")}
              accessibilityLabel="pf-expose-lan"
              onChange={v => portForwardExposeOnLan.set(v)}
            />
            <Button
              label={
                portForwardSubmitting()
                  ? tr("ssh.forwardingEllipsis")
                  : tr("ssh.forwardPort")
              }
              variant="primary"
              size="sm"
              loading={portForwardSubmitting()}
              disabled={!portForwardRemotePort().trim() || portForwardSubmitting()}
              accessibilityLabel="pf-submit"
              onPress={() => void submitPortForwardForm()}
            />
          </View>
        </View>
      </ConfigSection>
    </ModalDialog>
  );
}

// ============================================================================
// Root Mount Component (for App.tsx)
// ============================================================================

export function SshWorkspaceModals() {
  // Automatically clear & close SSH modals whenever Peer Device Mode switches devices.
  effect(() => {
    syncSshRemoteScope(peerScope()?.deviceId ?? null);
  });

  return (
    <View style={{ pointerEvents: "box-none" }}>
      <NewWorkspaceModal />
      <SshConnectionModal />
      <SshAuthPromptModal />
      <RemoteFileBrowserModal />
      <PortForwardModal />
    </View>
  );
}

/**
 * The active remote workspace's link, said where the work happens: Files, Git
 * and Terminal show it above their content while the transport is down, being
 * restored, or waiting for credentials. Nothing shows while it is connected.
 */
export function RemoteWorkspaceStatusBanner(props: { compact?: boolean } = {}) {
  const state = () => remoteLinkStateOf(activeWorkspace());
  const visible = () => {
    const current = state();
    return (
      current === "offline" ||
      current === "reconnecting" ||
      current === "auth-required" ||
      current === "host-outdated"
    );
  };
  const host = () => {
    const ws = activeWorkspace();
    return ws?.sshHost || ws?.connectionId || ws?.name || "";
  };
  const detail = () => {
    const ws = activeWorkspace();
    return ws?.connectionId ? remoteLinkErrors()[ws.connectionId] ?? "" : "";
  };
  return (
    <If when={visible()}>
      <View
        role="alert"
        accessibilityLabel={`remote-link-${state() ?? "unknown"}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          paddingHorizontal: props.compact ? 8 : 12,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderColor:
            state() === "reconnecting" || state() === "host-outdated"
              ? palette().warningBorder
              : palette().dangerBorder,
          backgroundColor:
            state() === "reconnecting" || state() === "host-outdated"
              ? palette().warningSoft
              : palette().dangerSoft,
        }}
      >
        <If
          when={state() === "reconnecting"}
          else={<Icon name="server" size={14} color={palette().danger} />}
        >
          <Spinner size={12} />
        </If>
        <View style={{ flex: 1, minWidth: 160, gap: 1 }}>
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(12),
              fontWeight: "600",
              lineHeight: textLineHeight(12, 1.35),
            }}
          >
            {state() === "reconnecting"
              ? remoteLinkAttemptOf(activeWorkspace()) > 1
                ? tr("ssh.link.reconnectingAttempt", {
                    host: host(),
                    attempt: String(remoteLinkAttemptOf(activeWorkspace())),
                  })
                : tr("ssh.link.reconnecting", { host: host() })
              : state() === "auth-required"
                ? tr("ssh.link.authRequired", { host: host() })
                : state() === "host-outdated"
                  ? tr("ssh.link.hostOutdated", { host: host() })
                  : tr("ssh.link.offline", { host: host() })}
          </Text>
          <If when={state() !== "reconnecting"}>
            <Text
              style={{
                color: palette().textSecondary,
                fontSize: textSize(11),
                lineHeight: textLineHeight(11, 1.4),
              }}
            >
              {state() === "host-outdated"
                ? tr("ssh.link.hostOutdatedHint")
                : detail()
                  ? localizeHostError(detail())
                  : tr("ssh.link.offlineHint")}
            </Text>
          </If>
        </View>
        <If when={state() !== "reconnecting" && state() !== "host-outdated"}>
          <Button
            label={state() === "auth-required" ? tr("ssh.link.signIn") : tr("ssh.link.reconnect")}
            accessibilityLabel="remote-link-reconnect"
            variant="secondary"
            size="xs"
            leadingIcon={state() === "auth-required" ? "key" : "refresh"}
            onPress={() => void retryRemoteWorkspace()}
          />
        </If>
      </View>
    </If>
  );
}
