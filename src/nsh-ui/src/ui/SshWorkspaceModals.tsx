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
import type { WorkspaceRecord } from "../api";
import { formatBytes, formatPlural } from "../format";
// wave24-replica: account SSH profiles that still need a secret here.
import { loadAccountRecords, sshSecretNote } from "../accountRecordsStore";
import { fleetActive, windowShellId } from "../bridge";
import { fleetDeviceById } from "../fleetStore";
import { localizeHostError, tr } from "../i18n";
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
  authPromptTarget,
  authPromptUsername,
  authPromptVerificationCode,
  beginNewSshConnection,
  browserBusy,
  browserConfirmDeleteEntry,
  browserConnectionId,
  browserConnectionName,
  browserCurrentPath,
  browserEntries,
  browserError,
  browserFilter,
  browserHomePath,
  browserLoading,
  browserNewDirName,
  browserNewDirOpen,
  browserPathInput,
  browserPendingRebind,
  browserPickerMode,
  browserRenamingEntry,
  browserRenameValue,
  browserSelectDirectoriesOnly,
  browserSelectedPath,
  browseFolderForNewWorkspace,
  cancelRemoteWorkspaceRebind,
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
  newWorkspaceConnectedRemote,
  newWorkspaceEnvOptions,
  newWorkspaceEnvLoading,
  newWorkspaceError,
  newWorkspaceFolders,
  newWorkspaceHostOptions,
  newWorkspaceLocalPathInput,
  newWorkspaceModalOpen,
  newWorkspaceName,
  newWorkspaceSelectedEnvId,
  newWorkspaceSelectedHostId,
  newWorkspaceShowAssistantChoice,
  newWorkspaceSource,
  newWorkspaceStep,
  openPortForwardModal,
  openRemoteFileBrowser,
  openSshConnectionModal,
  pickLocalFolderForNewWorkspace,
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
  remoteWorkspaceAliasOf,
  returnToSavedSshConnections,
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
  sshConnectingId,
  sshConnectionModalOpen,
  sshConnectionView,
  sshContainerHost,
  sshEditingProfile,
  sshEditOnly,
  sshError,
  sshFixedSource,
  sshForm,
  sshMatchedConfigHost,
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
  testSshConnection,
  workspaceSourceCoordinates,
  workspaceSourceFor,
  wslDistributions,
  wslError,
  wslLoading,
  type ConnectionTestStage,
  type RemoteFileEntry,
  type SSHConfigEntry,
  type SavedConnection,
  type SshAuthFormKind,
  type WorkspaceConnectionTarget,
  type WorkspaceEnvironment,
  type WorkspaceLocation,
  remoteLinkAttemptOf,
  remoteLinkErrorOf,
  remoteLinkStateOf,
  resolvedConnectionIdOf,
  retryRemoteWorkspace,
} from "../sshRemoteStore";
import { activeWorkspace, deviceContext } from "../state";
import {
  compactLayout,
  controlHeight,
  fontMono,
  isLightAppearance,
  layout,
  palette,
  radii,
  space,
  textLineHeight,
  textSize,
  textStyle,
  textTracking,
  touchSlop,
} from "../theme";
import { StateMark, stateColor, stateWord } from "./fleet";
import { Icon, type IconName } from "./icons";
import {
  MOTION_DURATION,
  Spinner,
  paintTransition,
  pressTransition,
  tactileActiveStyle,
} from "./motion";
import {
  ContextMenuOverlay,
  listRowHoverBg,
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
  focusRingStyle,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InlineDeleteConfirm,
  InputBox,
  SearchInput,
  SegmentedTabs,
  ToggleSwitch,
  TooltipBubble,
  UnderlineTabs,
} from "./primitives";
import { MoreMenu } from "./studio";

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "—";
  return formatBytes(bytes);
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
    <View style={{ minWidth: 0, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}>
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
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.42),
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
// 1. New Workspace Modal
//
// One form, no pre-step: where it runs (This machine / Remote), the folder to
// open, or — with no folder — the name of a new project to create. Hosts,
// containers and new connections live inside their own fields, so the form
// never grows extra rows of buttons. The assistant is a quiet footer action.
// ============================================================================

const NEW_CONNECTION_OPTION = "__new_connection__";

function newWorkspaceSubtitle(): string | undefined {
  if (fleetActive()) {
    const dev = fleetDeviceById(deviceContext());
    if (dev && !dev.isClientDevice && dev.name) {
      return tr("ssh.deviceWorkspaceSubtitle", { device: dev.name });
    }
  }
  return undefined;
}

/** A field-shaped button that shows a chosen path or invites choosing one. */
function PathPickerField(props: {
  path: string;
  placeholder: string;
  busy?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  clearLabel: string;
  onPress: () => void;
  onClear: () => void;
}) {
  const chosen = () => props.path.trim() !== "";
  const inactive = () => Boolean(props.disabled) || Boolean(props.busy);
  return (
    <View
      role="button"
      disabled={inactive()}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled: inactive(), busy: Boolean(props.busy) }}
      hitSlop={touchSlop(controlHeight.md)}
      onPress={() => {
        if (!inactive()) props.onPress();
      }}
      style={{
        boxSizing: "border-box",
        height: compactLayout() ? layout.touchTarget : controlHeight.md,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingLeft: space.md,
        paddingRight: chosen() && !props.busy ? space.xs : space.md,
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: isLightAppearance() ? palette().borderSubtle : "transparent",
        backgroundColor: isLightAppearance() ? palette().canvasSubtle : palette().surfaceSubtle,
        opacity: props.disabled ? 0.55 : 1,
        cursor: inactive() ? "default" : "pointer",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={inactive() || compactLayout() ? undefined : { borderColor: palette().border }}
      activeStyle={inactive() ? undefined : tactileActiveStyle(0.995)}
      focusVisibleStyle={focusRingStyle()}
    >
      <If
        when={props.busy}
        else={
          <Icon
            name={chosen() ? "folder" : "folder-open"}
            size={15}
            color={chosen() ? palette().textSecondary : palette().textMuted}
          />
        }
      >
        <Spinner size={14} />
      </If>
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: chosen() && !props.busy ? palette().text : palette().textMuted,
                    fontSize: textSize(13),
          lineHeight: textLineHeight(13, 1.3),
          numberOfLines: 1,
          textOverflow: "ellipsis-middle",
        }}
      >
        {props.busy ? tr("ssh.connectingEllipsis") : chosen() ? props.path : props.placeholder}
      </Text>
      <If
        when={chosen() && !props.busy}
        else={
          <If when={!props.busy}>
            <Icon name="chevron-right" size={14} color={palette().textMuted} />
          </If>
        }
      >
        <IconButton
          icon="close"
          size="xs"
          iconSize={11}
          tooltip={props.clearLabel}
          accessibilityLabel={`${props.accessibilityLabel}-clear`}
          onPress={props.onClear}
        />
      </If>
    </View>
  );
}

function NewWorkspaceModal() {
  const source = () => newWorkspaceSource();
  const location = () => workspaceSourceCoordinates(source()).location;
  const isRemoteHostSource = () =>
    source() === "ssh" || source() === "remoteDocker" || source() === "containerSshd";
  const isEnvSource = () =>
    source() === "localDocker" || source() === "wsl" || source() === "remoteDocker";

  const locationOptions = () => [
    {
      value: "current" as WorkspaceLocation,
      label: tr("ssh.thisMachine"),
      icon: "laptop" as IconName,
      accessibilityLabel: "new-workspace-location-current",
    },
    {
      value: "other" as WorkspaceLocation,
      label: tr("ssh.otherHostSsh"),
      icon: "server" as IconName,
      accessibilityLabel: "new-workspace-location-other",
    },
  ];

  const environmentOptions = (): ReadonlyArray<SelectDropdownOption<WorkspaceEnvironment>> => {
    if (location() === "other") {
      return [
        { value: "system", label: tr("ssh.ssh"), icon: "server", accessibilityLabel: "new-ws-env-system" },
        { value: "container", label: tr("ssh.dockerContainer"), icon: "container", accessibilityLabel: "new-ws-env-container" },
      ];
    }
    const items: Array<SelectDropdownOption<WorkspaceEnvironment>> = [
      { value: "system", label: tr("ssh.localFolder"), icon: "folder", accessibilityLabel: "new-ws-env-system" },
      { value: "container", label: tr("ssh.dockerContainer"), icon: "container", accessibilityLabel: "new-ws-env-container" },
    ];
    if (wslDistributions()?.supported !== false) {
      items.push({ value: "wsl", label: tr("ssh.wsl"), icon: "terminal-square", accessibilityLabel: "new-ws-env-wsl" });
    }
    return items;
  };

  const newConnectionOption = (): SelectDropdownOption<string> => ({
    value: NEW_CONNECTION_OPTION,
    label: tr("ssh.newConnection"),
    icon: "plus",
    separator: true,
    accessibilityLabel: "new-workspace-new-connection",
  });

  const hostSelectOptions = (): ReadonlyArray<SelectDropdownOption<string>> => [
    ...newWorkspaceHostOptions().map(opt => ({
      value: opt.id,
      label: opt.label,
      description: opt.description,
      icon: "server" as IconName,
      accessibilityLabel: `new-ws-host-opt-${opt.id.replace(/:/g, "-")}`,
    })),
    newConnectionOption(),
  ];

  const envSelectOptions = (): ReadonlyArray<SelectDropdownOption<string>> => [
    ...newWorkspaceEnvOptions().map(opt => ({
      value: opt.id,
      label: opt.label,
      description: opt.description,
      icon: (opt.target === "wsl" ? "terminal-square" : "container") as IconName,
      accessibilityLabel: `new-ws-env-opt-${opt.id.replace(/:/g, "-")}`,
    })),
    newConnectionOption(),
  ];

  /** The new connection lands selected, and its folder picker opens right away. */
  const startNewConnection = (target: WorkspaceConnectionTarget) => {
    const hostOpt = newWorkspaceHostOptions().find(o => o.id === newWorkspaceSelectedHostId());
    void openSshConnectionModal(undefined, {
      targetType: target,
      fixedSource: true,
      startWithForm: true,
      browseAfterConnect: false,
      containerHost: target === "remoteDocker" ? hostOpt?.connection : undefined,
      onConnected: (cfg, cid) => {
        void loadSavedConnections();
        if (target === "ssh" || target === "containerSshd") {
          selectNewWorkspaceHostOption(cid);
        } else {
          newWorkspaceSelectedEnvId.set(cid);
        }
        newWorkspaceConnectedRemote.set({
          connectionId: cid,
          connectionName: cfg.name,
          sshHost: cfg.host,
        });
        void browseFolderForNewWorkspace();
      },
    });
  };

  const remoteFolder = () => newWorkspaceFolders()[0];
  const hasFolderTarget = (): boolean =>
    source() === "host"
      ? newWorkspaceLocalPathInput().trim() !== ""
      : newWorkspaceFolders().length > 0;

  const sourceReady = (): boolean => {
    const src = source();
    if (src === "host") return true;
    if (src === "ssh" || src === "containerSshd") return Boolean(newWorkspaceSelectedHostId());
    if (src === "remoteDocker") {
      return Boolean(newWorkspaceSelectedHostId()) && Boolean(newWorkspaceSelectedEnvId());
    }
    return Boolean(newWorkspaceSelectedEnvId());
  };

  const canConfirm = (): boolean => {
    if (newWorkspaceBusy()) return false;
    if (source() !== "host" && newWorkspaceFolders().length > 0) return true;
    if (!sourceReady()) return false;
    return hasFolderTarget() || newWorkspaceName().trim() !== "";
  };

  const primaryLabel = (): string => {
    if (newWorkspaceBusy()) {
      return hasFolderTarget() ? tr("ssh.openingEllipsis") : tr("ssh.creating");
    }
    return hasFolderTarget() ? tr("common.open") : tr("ssh.createWorkspace");
  };

  const canPickLocalDir = () => {
    const shell = windowShellId();
    if (!shell || shell === "browser") return false;
    return !fleetActive() || Boolean(fleetDeviceById(deviceContext())?.isClientDevice);
  };

  const selectEnvironmentMode = (env: WorkspaceEnvironment) => {
    newWorkspaceError.set("");
    newWorkspaceFolders.set([]);
    setNewWorkspaceSource(workspaceSourceFor(location(), env));
  };

  return (
    <ModalDialog
      open={newWorkspaceModalOpen()}
      title={tr("ssh.newWorkspaceTitle")}
      subtitle={newWorkspaceSubtitle()}
      size="md"
      accessibilityLabel="new-workspace-modal"
      closeOnBackdropPress={!newWorkspaceBusy()}
      closeOnEscape={!newWorkspaceBusy()}
      onClose={closeNewWorkspaceModal}
      footer={
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <If when={newWorkspaceShowAssistantChoice()}>
            <View style={{ marginLeft: -space.sm }}>
              <Button
                label={tr("ssh.personalAssistant")}
                variant="ghost"
                size="md"
                leadingIcon="sparkles"
                disabled={newWorkspaceBusy()}
                tooltip={tr("ssh.personalAssistantDesc")}
                accessibilityLabel="new-workspace-choice-assistant"
                style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                onPress={() => void createAssistantFromNewWorkspace()}
              />
            </View>
          </If>
          <View style={{ flex: 1 }} />
          <Button
            label={primaryLabel()}
            variant="primary"
            size="md"
            loading={newWorkspaceBusy()}
            disabled={!canConfirm()}
            accessibilityLabel="new-workspace-confirm"
            style={[
              { minWidth: 88 },
              compactLayout() ? { minHeight: layout.touchTarget } : undefined,
            ]}
            onPress={() => void confirmNewWorkspace()}
          />
        </View>
      }
    >
      <ModalAlertBanner
        tone={/docker/i.test(newWorkspaceError()) ? "warning" : "danger"}
        message={newWorkspaceError()}
        onDismiss={() => newWorkspaceError.set("")}
      />

      {/* Where it runs, with the environment as a quiet qualifier on the same line. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}>
        <SegmentedTabs
          size="md"
          options={locationOptions()}
          value={location()}
          onChange={loc => {
            newWorkspaceError.set("");
            newWorkspaceFolders.set([]);
            const env = workspaceSourceCoordinates(source()).environment;
            const nextEnv: WorkspaceEnvironment = loc === "other" && env === "wsl" ? "system" : env;
            setNewWorkspaceSource(workspaceSourceFor(loc, nextEnv));
          }}
        />
        <View style={{ flex: 1 }} />
        <View style={{ marginRight: -space.sm }}>
          <SelectDropdown
            variant="ghost"
            size="md"
            align="end"
            accessibilityLabel="new-workspace-env-mode"
            options={environmentOptions()}
            value={workspaceSourceCoordinates(source()).environment}
            onChange={selectEnvironmentMode}
          />
        </View>
      </View>

      <View style={{ gap: space.lg }}>
        {/* Host (remote) */}
        <If when={isRemoteHostSource()}>
          <FieldSection label={tr("ssh.host")}>
            <SelectDropdown
              fullWidth
              size="md"
              searchable={newWorkspaceHostOptions().length > 6}
              searchPlaceholder={tr("ssh.filterHosts")}
              placeholder={tr("ssh.chooseHostPlaceholder")}
              accessibilityLabel="new-workspace-host-select"
              options={hostSelectOptions()}
              value={newWorkspaceSelectedHostId()}
              onChange={id => {
                if (id === NEW_CONNECTION_OPTION) {
                  startNewConnection(source() === "containerSshd" ? "containerSshd" : "ssh");
                  return;
                }
                newWorkspaceFolders.set([]);
                selectNewWorkspaceHostOption(id);
              }}
            />
          </FieldSection>
        </If>

        {/* Container / WSL distribution */}
        <If when={isEnvSource()}>
          <FieldSection label={source() === "wsl" ? tr("ssh.wslDistribution") : tr("ssh.container")}>
            <SelectDropdown
              fullWidth
              size="md"
              searchable={newWorkspaceEnvOptions().length > 6}
              disabled={source() === "remoteDocker" && !newWorkspaceSelectedHostId()}
              placeholder={
                newWorkspaceEnvLoading() || wslLoading()
                  ? tr("ssh.scanning")
                  : source() === "wsl"
                    ? tr("ssh.selectWslPlaceholder")
                    : tr("ssh.selectContainerPlaceholder")
              }
              accessibilityLabel="new-workspace-env-select"
              options={envSelectOptions()}
              value={newWorkspaceSelectedEnvId()}
              onChange={id => {
                if (id === NEW_CONNECTION_OPTION) {
                  startNewConnection(source() as WorkspaceConnectionTarget);
                  return;
                }
                newWorkspaceFolders.set([]);
                newWorkspaceConnectedRemote.set(null);
                newWorkspaceSelectedEnvId.set(id);
              }}
            />
          </FieldSection>
        </If>

        {/* Folder to open */}
        <FieldSection label={tr("ssh.folder")}>
          <If
            when={source() === "host"}
            else={
              <PathPickerField
                path={remoteFolder()?.path ?? ""}
                placeholder={tr("ssh.browseRemote")}
                busy={newWorkspaceBusy() && !remoteFolder()}
                disabled={!sourceReady() && !remoteFolder()}
                clearLabel={tr("common.clear")}
                accessibilityLabel="new-workspace-browse-remote"
                onPress={() => void browseFolderForNewWorkspace()}
                onClear={() => newWorkspaceFolders.set([])}
              />
            }
          >
            <InputBox
              size="md"
              variant="soft"
              leadingIcon="folder"
              clearable
              value={newWorkspaceLocalPathInput()}
              placeholder={tr("ssh.pathPlaceholder")}
              accessibilityLabel="new-workspace-local-path"
              trailing={
                canPickLocalDir() ? (
                  <Button
                    label={tr("common.browse")}
                    variant="secondary"
                    size="xs"
                    disabled={newWorkspaceBusy()}
                    accessibilityLabel="new-workspace-browse-local"
                    onPress={() => void pickLocalFolderForNewWorkspace(tr("ssh.localFolderPath"))}
                  />
                ) : undefined
              }
              onChange={v => {
                newWorkspaceLocalPathInput.set(v);
                newWorkspaceError.set("");
              }}
              onSubmit={() => {
                if (canConfirm()) void confirmNewWorkspace();
              }}
            />
          </If>
        </FieldSection>

        {/* Or a new, empty project — only while no folder is chosen. */}
        <If when={!hasFolderTarget()}>
          <FieldSection label={tr("ssh.orCreateProject")}>
          <InputBox
            size="md"
            variant="soft"
            value={newWorkspaceName()}
            placeholder={tr("ssh.enterProjectName")}
            hint={
              newWorkspaceName().trim()
                ? tr("ssh.willCreateFolder", {
                    dir: DEFAULT_PROJECT_SUBDIRECTORY,
                    name: newWorkspaceName().trim(),
                  })
                : undefined
            }
            accessibilityLabel="new-workspace-name"
            onChange={v => {
              newWorkspaceName.set(v);
              newWorkspaceError.set("");
            }}
            onSubmit={() => {
              if (canConfirm()) void confirmNewWorkspace();
            }}
          />
          </FieldSection>
        </If>
      </View>
    </ModalDialog>
  );
}

// ============================================================================
// 2. SSH Connection Modal (matching SSHConnectionDialog.tsx)
// ============================================================================

/** Fill of a grouped list (rows sit on it; no outline). */
function groupedListBg(): string {
  return isLightAppearance() ? palette().canvasSubtle : palette().surfaceSubtle;
}

/** A divider that starts where row text starts, so rows read as one group. */
function InsetDivider() {
  return (
    <View
      style={{
        height: 1,
        marginLeft: space.xs + space.md + GLYPH_TILE_SIZE + space.md,
        marginRight: space.md,
        backgroundColor: palette().borderSubtle,
      }}
    />
  );
}

const GLYPH_TILE_SIZE = 32;

/** The anchor of a list row: a soft tile carrying the glyph and, when it applies, a state dot. */
function GlyphTile(props: {
  glyph?: "server" | "container" | "desktop";
  icon?: IconName;
  online?: boolean;
  failed?: boolean;
  quiet?: boolean;
}) {
  return (
    <View
      style={{
        position: "relative",
        width: GLYPH_TILE_SIZE,
        height: GLYPH_TILE_SIZE,
        flexShrink: 0,
        borderRadius: radii.md,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: props.quiet ? "transparent" : palette().buttonSecondaryBg,
        borderWidth: props.quiet ? 1 : 0,
        borderStyle: props.quiet ? "dashed" : undefined,
        borderColor: props.quiet ? palette().border : "transparent",
      }}
    >
      <If
        when={Boolean(props.glyph)}
        else={<Icon name={props.icon ?? "server"} size={15} color={palette().textSecondary} />}
      >
        <DeviceGlyph kind={props.glyph ?? "server"} size={16} />
      </If>
      <If when={Boolean(props.online) || Boolean(props.failed)}>
        <View
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: 10,
            height: 10,
            borderRadius: radii.pill,
            borderWidth: 2,
            borderColor: isLightAppearance() ? palette().surfaceElevated : palette().canvas,
            backgroundColor: props.failed ? stateColor("failed") : stateColor("done"),
          }}
        />
      </If>
    </View>
  );
}

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

function formatSshConfigEntryDetail(entry: SSHConfigEntry): string {
  const host = entry.host.trim();
  const hostname = (entry.hostname ?? "").trim();
  const user = (entry.user ?? "").trim();
  const portSuffix = entry.port && entry.port !== 22 ? `:${entry.port}` : "";
  if (hostname && hostname !== host) {
    return `${user ? `${user}@` : ""}${hostname}${portSuffix}`;
  }
  if (user && portSuffix) return `${user} · ${portSuffix}`;
  if (user) return user;
  if (portSuffix) return portSuffix;
  return "";
}

function SshConnectionModal() {
  effect(() => {
    if (sshConnectionModalOpen()) {
      void loadAccountRecords();
    }
  });

  const targetTabs = () => [
    { value: "ssh" as WorkspaceConnectionTarget, label: tr("ssh.ssh") },
    { value: "remoteDocker" as WorkspaceConnectionTarget, label: tr("ssh.remoteDocker") },
    { value: "containerSshd" as WorkspaceConnectionTarget, label: tr("ssh.containerSshd") },
    { value: "localDocker" as WorkspaceConnectionTarget, label: tr("ssh.localDocker") },
    { value: "wsl" as WorkspaceConnectionTarget, label: tr("ssh.wsl") },
  ];

  const authOptions = (): ReadonlyArray<SelectDropdownOption<SshAuthFormKind>> => [
    { value: "password", label: tr("ssh.authPassword"), icon: "key" },
    { value: "privateKey", label: tr("ssh.authPrivateKey"), icon: "key" },
    { value: "agent", label: tr("ssh.authAgent"), icon: "shield" },
    { value: "keyboardInteractive", label: tr("ssh.authKeyboardInteractive"), icon: "key" },
    { value: "none", label: tr("ssh.authNone"), icon: "plug" },
  ];

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

  const aliasPlaceholder = (): string => {
    const form = sshForm();
    const target = sshTargetType();
    if (target === "wsl") return form.wslDistribution.trim() || tr("ssh.aliasPlaceholder");
    if (target === "localDocker" || target === "remoteDocker") {
      return form.containerName.trim() || tr("ssh.aliasPlaceholder");
    }
    return form.host.trim() || tr("ssh.aliasPlaceholder");
  };

  const hasCustomAdvanced = (): boolean => {
    const form = sshForm();
    const target = sshTargetType();
    if (target === "wsl") return Boolean(form.wslUser.trim());
    if (target === "localDocker" || target === "remoteDocker") {
      return (
        form.containerAccess !== "auto" ||
        (form.dockerPath.trim() !== "" && form.dockerPath.trim() !== "docker") ||
        (form.containerShell.trim() !== "" && form.containerShell.trim() !== "/bin/sh") ||
        Boolean(form.containerUser.trim())
      );
    }
    return (
      Boolean(form.proxyJump.trim()) ||
      Boolean(form.certificatePath.trim()) ||
      Boolean(form.keyFingerprint.trim()) ||
      form.connectTimeoutSecs.trim() !== "30" ||
      form.authTimeoutSecs.trim() !== "60" ||
      form.authAttempts.trim() !== "3" ||
      form.connectAttempts.trim() !== "1"
    );
  };

  const modalTitle = (): string => {
    const editing = sshEditingProfile();
    if (sshEditOnly() && editing) {
      return tr("ssh.editConnectionTitle", { name: editing.name });
    }
    const target = sshTargetType();
    if (sshFixedSource() && sshConnectionView() === "new" && !editing) return tr("ssh.newConnection");
    if (target === "wsl") return tr("ssh.connectWslTitle");
    if (target === "localDocker") return tr("ssh.connectLocalDockerTitle");
    if (target === "remoteDocker") return tr("ssh.connectRemoteDockerTitle");
    if (target === "containerSshd") return tr("ssh.connectContainerSshdTitle");
    return tr("ssh.remoteSshTitle");
  };

  const selectedSaved = (): SavedConnection | undefined =>
    savedConnections().find(c => c.id === sshSelectedConnectionId());

  const wslUnsupportedOnHost = () =>
    sshTargetType() === "wsl" && wslDistributions()?.supported === false;

  const canConnect = () => !sshConnecting() && !sshTesting() && !wslUnsupportedOnHost();

  return (
    <ModalDialog
      open={sshConnectionModalOpen()}
      title={modalTitle()}
      leading={
        showNewForm() && !sshEditOnly() && !sshFixedSource() && savedConnectionsForTarget().length > 0 ? (
          <IconButton
            icon="arrow-left"
            size="sm"
            disabled={sshConnecting()}
            tooltip={tr("ssh.savedConnections")}
            accessibilityLabel={tr("ssh.savedConnections")}
            onPress={returnToSavedSshConnections}
          />
        ) : undefined
      }
      size={showNewForm() || (!sshFixedSource() && !sshEditOnly()) ? "lg" : "md"}
      accessibilityLabel="ssh-connection-modal"
      closeOnBackdropPress={!sshConnecting()}
      closeOnEscape={!sshConnecting()}
      onClose={closeSshConnectionModal}
      onSubmit={() => {
        if (!showNewForm() || !canConnect()) return;
        void (sshEditOnly() ? saveSshConnectionForm() : submitSshConnectionForm());
      }}
      footer={
        showNewForm() ? (
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <View style={{ marginLeft: -space.sm }}>
              <Button
                label={sshTesting() ? tr("common.testing") : tr("ssh.testConnection")}
                variant="ghost"
                size="md"
                leadingIcon="activity"
                loading={sshTesting()}
                disabled={sshConnecting() || wslUnsupportedOnHost()}
                accessibilityLabel="ssh-test-btn"
                style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                onPress={() => void testSshConnection()}
              />
            </View>
            <View style={{ flex: 1 }} />
            <Button
              label={tr("common.save")}
              variant={sshEditOnly() ? "primary" : "ghost"}
              size="md"
              disabled={!canConnect()}
              accessibilityLabel="ssh-save-btn"
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => void saveSshConnectionForm()}
            />
            <If when={!sshEditOnly()}>
              <Button
                label={
                  sshConfirmLabel() ||
                  (sshConnecting() ? tr("ssh.connectingEllipsis") : tr("common.connect"))
                }
                variant="primary"
                size="md"
                loading={sshConnecting()}
                disabled={sshTesting() || wslUnsupportedOnHost()}
                accessibilityLabel="ssh-connect-btn"
                style={[
                  { minWidth: 88 },
                  compactLayout() ? { minHeight: layout.touchTarget } : undefined,
                ]}
                onPress={() => void submitSshConnectionForm()}
              />
            </If>
          </View>
        ) : undefined
      }
    >
      <ModalAlertBanner message={sshError()} onDismiss={() => sshError.set("")} />
      <ModalAlertBanner
        message={sshNotice()}
        tone="info"
        onDismiss={() => sshNotice.set("")}
      />

      {/* Target type selector — clean underline tabs, zero heavy box */}
      <If when={!sshFixedSource() && !sshEditOnly()}>
        <Scroll smoothWheel horizontal scrollbar={false} style={{ width: "100%", minWidth: 0 }}>
          <UnderlineTabs
            size="sm"
            scrollable={compactLayout()}
            options={targetTabs()}
            value={sshTargetType()}
            onChange={t => setSshTargetType(t)}
          />
        </Scroll>
      </If>

      {/* Saved connections: grouped list with an anchored glyph per row, inset dividers,
          one primary action, and the rest behind ⋯ (revealed on hover). */}
      <If when={!showNewForm()}>
        <View style={{ gap: space.md }}>
          <If when={savedConnectionsForTarget().length >= 6 || sshSavedSearch().trim() !== ""}>
            <SearchInput
              size="md"
              value={sshSavedSearch()}
              placeholder={tr("ssh.searchConnections")}
              accessibilityLabel="ssh-saved-search"
              onChange={v => sshSavedSearch.set(v)}
            />
          </If>

          <View
            style={{
              borderRadius: radii.lg,
              borderCurve: "continuous",
              backgroundColor: groupedListBg(),
              paddingVertical: space.xs,
              overflow: "hidden",
            }}
          >
            <If when={filteredSavedConnections().length === 0}>
              <View
                style={{
                  paddingVertical: space.xl,
                  paddingHorizontal: space.lg,
                  alignItems: "center",
                  gap: space.sm,
                }}
              >
                <Text style={{ ...textStyle("caption", { color: palette().textMuted }), textAlign: "center" }}>
                  {tr("ssh.noSavedMatch", { query: sshSavedSearch().trim() })}
                </Text>
                <Button
                  label={tr("common.clearSearch")}
                  size="xs"
                  variant="ghost"
                  onPress={() => sshSavedSearch.set("")}
                />
              </View>
            </If>
            <Each of={filteredSavedConnections()} key={conn => conn.id}>
              {(conn, idx) => {
                const hovered = signal(false);
                const status = () => connectionStatuses()[conn().id];
                const isConnected = () => status() === "connected";
                const isRowConnecting = () => sshConnectingId() === conn().id;
                const subtitle = () =>
                  isConnected()
                    ? `${formatSavedConnectionSubtitle(conn())} · ${tr("common.connected")}`
                    : formatSavedConnectionSubtitle(conn());
                const rowMenuItems = (): DropdownMenuItem[] => [
                  ...(isConnected() && !sshFixedSource()
                    ? [
                        {
                          id: "reconnect",
                          label: tr("ssh.reconnect"),
                          icon: "refresh" as IconName,
                          accessibilityLabel: `ssh-connect-${conn().id}`,
                          onSelect: () =>
                            void quickConnectSavedConnection(conn(), {
                              browseAfterConnect: sshBrowseAfterConnect(),
                            }),
                        },
                      ]
                    : []),
                  ...(isConnected()
                    ? [
                        {
                          id: "ports",
                          label: tr("nav.portForwarding"),
                          icon: "network" as IconName,
                          accessibilityLabel: `ssh-pf-${conn().id}`,
                          onSelect: () => void openPortForwardModal(conn().id, conn().name),
                        },
                      ]
                    : []),
                  {
                    id: "edit",
                    label: tr("ssh.editProfile"),
                    icon: "edit" as IconName,
                    accessibilityLabel: `ssh-edit-${conn().id}`,
                    onSelect: () => {
                      populateFormFromSavedConnection(conn());
                      sshConnectionView.set("new");
                    },
                  },
                  {
                    id: "delete",
                    label: tr("ssh.deleteProfile"),
                    icon: "trash" as IconName,
                    danger: true,
                    separator: true,
                    confirmDelete: true,
                    confirmAccessibilityLabel: `ssh-delete-confirm-${conn().id}`,
                    accessibilityLabel: `ssh-delete-${conn().id}`,
                    onSelect: () => void deleteSavedSshConnection(conn().id),
                  },
                ];
                return (
                  <View>
                    <If when={idx() > 0}>
                      <InsetDivider />
                    </If>
                    <View
                      accessibilityLabel={`ssh-saved-${conn().id}`}
                      onMouseEnter={() => hovered.set(true)}
                      onMouseLeave={() => hovered.set(false)}
                      style={{
                        minHeight: compactLayout() ? layout.touchTarget + space.md : 56,
                        marginHorizontal: space.xs,
                        paddingLeft: space.md,
                        paddingRight: space.sm,
                        paddingVertical: space.sm,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.md,
                        borderRadius: radii.md,
                        borderCurve: "continuous",
                        ...paintTransition(MOTION_DURATION.fast),
                      }}
                      hoverStyle={compactLayout() ? undefined : { backgroundColor: listRowHoverBg() }}
                    >
                      <GlyphTile
                        glyph={conn().wsl ? "desktop" : conn().container ? "container" : "server"}
                        online={isConnected()}
                        failed={status() === "error"}
                      />
                      <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                        <Text
                          style={{
                            color: palette().text,
                            fontSize: textSize(13),
                            lineHeight: textLineHeight(13, 1.35),
                            fontWeight: "500",
                            numberOfLines: 1,
                            textOverflow: "ellipsis",
                          }}
                        >
                          {conn().name}
                        </Text>
                        <Text
                          style={{
                            color: status() === "error" ? stateColor("failed") : palette().textMuted,
                            fontSize: textSize(12),
                            lineHeight: textLineHeight(12, 1.35),
                            fontVariant: ["tabular-nums"],
                            numberOfLines: 1,
                            textOverflow: "ellipsis-middle",
                          }}
                        >
                          {status() === "error"
                            ? `${formatSavedConnectionSubtitle(conn())} · ${stateWord("failed")}`
                            : subtitle()}
                        </Text>
                        <If when={sshSecretNote(conn().id)}>
                          {note => (
                            <Text
                              style={textStyle("caption", { color: palette().textMuted })}
                              accessibilityLabel={`ssh-needs-secret-${conn().id}`}
                            >
                              {note()}
                            </Text>
                          )}
                        </If>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
                        <If
                          when={isConnected() && !sshFixedSource()}
                          else={
                            <Button
                              label={status() === "error" ? tr("ssh.reconnect") : tr("common.connect")}
                              size={compactLayout() ? "sm" : "xs"}
                              variant="secondary"
                              loading={isRowConnecting()}
                              disabled={sshConnecting()}
                              accessibilityLabel={`ssh-connect-${conn().id}`}
                              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                              onPress={() =>
                                void quickConnectSavedConnection(conn(), {
                                  browseAfterConnect: sshBrowseAfterConnect(),
                                })
                              }
                            />
                          }
                        >
                          <Button
                            label={tr("common.browse")}
                            size={compactLayout() ? "sm" : "xs"}
                            variant="secondary"
                            accessibilityLabel={`ssh-browse-${conn().id}`}
                            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                            onPress={() =>
                              void openRemoteFileBrowser(conn().id, undefined, {
                                connectionName: conn().name,
                                sshHost: conn().host,
                              })
                            }
                          />
                        </If>
                        <View
                          style={{
                            opacity: compactLayout() || hovered() ? 1 : 0,
                            ...paintTransition(MOTION_DURATION.fast),
                          }}
                          focusWithinStyle={{ opacity: 1 }}
                        >
                          <MoreMenu
                            size="xs"
                            disabled={sshConnecting()}
                            accessibilityLabel={`ssh-saved-more-${conn().id}`}
                            tooltip={tr("common.more")}
                            items={rowMenuItems()}
                          />
                        </View>
                      </View>
                    </View>
                  </View>
                );
              }}
            </Each>
            <If when={!sshEditOnly()}>
              <If when={filteredSavedConnections().length > 0}>
                <InsetDivider />
              </If>
              <View
                role="button"
                accessibilityLabel="ssh-new-connection-btn"
                disabled={sshConnecting()}
                hitSlop={touchSlop(layout.touchTarget)}
                onPress={() => {
                  if (!sshConnecting()) beginNewSshConnection();
                }}
                style={{
                  minHeight: compactLayout() ? layout.touchTarget + space.sm : 48,
                  marginHorizontal: space.xs,
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  cursor: "pointer",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={compactLayout() ? undefined : { backgroundColor: listRowHoverBg() }}
                activeStyle={tactileActiveStyle(0.995)}
                focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -2 }}
                disabledStyle={{ opacity: 0.52 }}
              >
                <GlyphTile icon="plus" quiet />
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontSize: textSize(13),
                    lineHeight: textLineHeight(13, 1.35),
                    fontWeight: "500",
                  }}
                >
                  {tr("ssh.newConnection")}
                </Text>
              </View>
            </If>
          </View>
        </View>
      </If>

      {/* New / Edit Connection Form */}
      <If when={showNewForm()}>
        <View style={{ gap: space.md }}>
          {/* ~/.ssh/config: one quiet picker that fills the form */}
          <If
            when={
              !isLocalProcess() &&
              sshTargetType() !== "remoteDocker" &&
              sshConfigHosts().length > 0
            }
          >
            <View style={{ flexDirection: "row", marginLeft: -space.sm, marginBottom: -space.xs }}>
              <SelectDropdown
                variant="ghost"
                size="sm"
                searchable={sshConfigHosts().length > 6}
                searchPlaceholder={tr("ssh.filterHosts")}
                placeholder={tr("ssh.importFromSshConfig")}
                accessibilityLabel="ssh-config-import"
                options={sshConfigHosts().map(entry => ({
                  value: entry.host,
                  label: entry.host,
                  description: formatSshConfigEntryDetail(entry) || undefined,
                  icon: "terminal-square" as IconName,
                  accessibilityLabel: `ssh-config-host-${entry.host}`,
                }))}
                value={sshMatchedConfigHost() || null}
                onChange={host => {
                  const entry = sshConfigHosts().find(e => e.host === host);
                  if (entry) fillFormFromSshConfig(entry);
                }}
              />
            </View>
          </If>

          {/* WSL Distribution Selection */}
          <If when={sshTargetType() === "wsl"}>
            <View style={{ gap: space.sm }}>
              <FieldSection
                label={tr("ssh.wslDistribution")}
                right={
                  <IconButton
                    icon="refresh"
                    size="xs"
                    disabled={wslUnsupportedOnHost()}
                    tooltip={tr("common.refresh")}
                    accessibilityLabel="ssh-wsl-refresh"
                    onPress={() => void loadWslDistributions()}
                  />
                }
              >
                <SelectDropdown
                  disabled={wslUnsupportedOnHost()}
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

          {/* Compact Host + Port + Username + Auth section */}
          <If when={!isLocalProcess() && sshTargetType() !== "remoteDocker"}>
            <View style={{ gap: space.md }}>
              <View style={{ flexDirection: compactLayout() ? "column" : "row", gap: space.sm, minWidth: 0 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <InputBox
                    variant="soft"
                    label={tr("ssh.host")}
                    leadingIcon="server"
                    value={sshForm().host}
                    placeholder={tr("ssh.hostPlaceholder")}
                    accessibilityLabel="ssh-form-host"
                    onChange={v => setSshFormField("host", v)}
                  />
                </View>
                <View style={{ width: compactLayout() ? undefined : 96, minWidth: 0 }}>
                  <InputBox
                    variant="soft"
                    label={tr("ssh.port")}
                    value={sshForm().port}
                    placeholder="22"
                    accessibilityLabel="ssh-form-port"
                    onChange={v => setSshFormField("port", v)}
                  />
                </View>
              </View>

              <View style={{ flexDirection: compactLayout() ? "column" : "row", gap: space.sm, minWidth: 0 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <InputBox
                    variant="soft"
                    label={tr("ssh.username")}
                    value={sshForm().username}
                    placeholder="root"
                    accessibilityLabel="ssh-form-username"
                    onChange={v => setSshFormField("username", v)}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <FieldSection label={tr("ssh.authMethod")}>
                    <SelectDropdown
                      fullWidth
                      accessibilityLabel="ssh-form-auth-type"
                      options={authOptions()}
                      value={sshForm().authType}
                      onChange={v => setSshFormField("authType", v)}
                    />
                  </FieldSection>
                </View>
              </View>

              <If when={sshForm().authType === "none"}>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.42),
                  }}
                >
                  {tr("ssh.authNoneHint")}
                </Text>
              </If>

              <If when={sshForm().authType === "password"}>
                <InputBox
                  variant="soft"
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
                      accessibilityLabel="ssh-form-toggle-password"
                      onPress={() => sshShowPassword.update(v => !v)}
                    />
                  }
                  onChange={v => setSshFormField("password", v)}
                />
              </If>

              <If when={sshForm().authType === "privateKey"}>
                <View style={{ gap: space.sm }}>
                  <InputBox
                    variant="soft"
                    label={tr("ssh.privateKeyPath")}
                    leadingIcon="key"
                    value={sshForm().keyPath}
                    placeholder="~/.ssh/id_rsa"
                    accessibilityLabel="ssh-form-key-path"
                    onChange={v => setSshFormField("keyPath", v)}
                  />
                  <InputBox
                    variant="soft"
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
                        accessibilityLabel="ssh-form-toggle-passphrase"
                        onPress={() => sshShowPassphrase.update(v => !v)}
                      />
                    }
                    onChange={v => setSshFormField("passphrase", v)}
                  />
                </View>
              </If>

              <If when={sshForm().authType === "keyboardInteractive"}>
                <View style={{ flexDirection: compactLayout() ? "column" : "row", gap: space.sm, minWidth: 0 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <InputBox
                      variant="soft"
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
                      variant="soft"
                      masked
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
            <View style={{ gap: space.sm }}>
              <FieldSection
                label={tr("ssh.containerNameOrId")}
                right={
                  <Button
                    label={dockerContainersLoading() ? tr("ssh.scanning") : tr("ssh.discover")}
                    size="xs"
                    variant="ghost"
                    leadingIcon="refresh"
                    loading={dockerContainersLoading()}
                    accessibilityLabel="ssh-discover-containers"
                    onPress={() => void discoverDockerContainers()}
                  />
                }
              >
                <InputBox
                  variant="soft"
                  leadingIcon="container"
                  value={sshForm().containerName}
                  placeholder="dev-container"
                  accessibilityLabel="ssh-form-container-name"
                  onChange={v => setSshFormField("containerName", v)}
                />
              </FieldSection>
              <If when={dockerContainers().length > 0}>
                <SelectDropdown
                  fullWidth
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

          {/* Display name — optional, defaults to the host */}
          <If when={!wslUnsupportedOnHost()}>
            <InputBox
              variant="soft"
              label={tr("ssh.aliasOptional")}
              value={sshForm().name}
              placeholder={aliasPlaceholder()}
              disabled={wslUnsupportedOnHost()}
              accessibilityLabel="ssh-form-name"
              onChange={v => setSshFormField("name", v)}
            />
          </If>

          {/* Advanced Settings Toggle */}
          <If when={!wslUnsupportedOnHost()}>
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
              <Button
                label={
                  sshShowAdvanced()
                    ? tr("ssh.hideAdvancedSettings")
                    : tr("ssh.advancedSettings")
                }
                variant="ghost"
                size="xs"
                disabled={wslUnsupportedOnHost()}
                leadingIcon={sshShowAdvanced() ? "chevron-up" : "chevron-down"}
                accessibilityLabel="ssh-toggle-advanced"
                onPress={() => sshShowAdvanced.update(v => !v)}
              />
              <If when={!sshShowAdvanced() && hasCustomAdvanced()}>
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: radii.pill,
                    backgroundColor: palette().accent,
                  }}
                />
              </If>
            </View>

            <If when={sshShowAdvanced()}>
              <View
                style={{
                  padding: space.md,
                  gap: space.md,
                  borderRadius: radii.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: "transparent",
                }}
              >
                <If when={sshTargetType() === "wsl"}>
                  <InputBox
                    variant="soft"
                    label={tr("ssh.wslUserOptional")}
                    value={sshForm().wslUser}
                    placeholder={tr("ssh.wslUserPlaceholder")}
                    disabled={wslUnsupportedOnHost()}
                    accessibilityLabel="ssh-form-wsl-user"
                    onChange={v => setSshFormField("wslUser", v)}
                  />
                </If>

                <If when={usesDocker()}>
                  <View style={{ gap: space.sm }}>
                    <FieldSection label={tr("ssh.containerAccessMode")}>
                      <SelectDropdown
                        fullWidth
                        accessibilityLabel="ssh-form-container-access"
                        options={containerAccessOptions()}
                        value={sshForm().containerAccess}
                        onChange={v => setSshFormField("containerAccess", v)}
                      />
                    </FieldSection>
                    <View
                      style={{
                        display: "grid",
                        gridTemplateColumns: compactLayout()
                          ? "minmax(0, 1fr)"
                          : "repeat(3, minmax(0, 1fr))",
                        gap: space.sm,
                      }}
                    >
                      <InputBox
                        variant="soft"
                        label={tr("ssh.dockerCliPath")}
                        value={sshForm().dockerPath}
                        placeholder="docker"
                        accessibilityLabel="ssh-form-docker-path"
                        onChange={v => setSshFormField("dockerPath", v)}
                      />
                      <InputBox
                        variant="soft"
                        label={tr("ssh.containerShell")}
                        value={sshForm().containerShell}
                        placeholder="/bin/sh"
                        accessibilityLabel="ssh-form-container-shell"
                        onChange={v => setSshFormField("containerShell", v)}
                      />
                      <InputBox
                        variant="soft"
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
                  <View style={{ gap: space.sm }}>
                    <If when={sshForm().authType === "privateKey"}>
                      <InputBox
                        variant="soft"
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
                          gridTemplateColumns: compactLayout()
                            ? "minmax(0, 1fr)"
                            : "repeat(2, minmax(0, 1fr))",
                          gap: space.sm,
                        }}
                      >
                        <InputBox
                          variant="soft"
                          label={tr("ssh.agentFingerprint")}
                          value={sshForm().keyFingerprint}
                          placeholder="SHA256:..."
                          accessibilityLabel="ssh-form-fingerprint"
                          onChange={v => setSshFormField("keyFingerprint", v)}
                        />
                        <InputBox
                          variant="soft"
                          label={tr("ssh.fallbackKeyPath")}
                          value={sshForm().fallbackKeyPath}
                          placeholder="~/.ssh/id_rsa"
                          accessibilityLabel="ssh-form-fallback-key"
                          onChange={v => setSshFormField("fallbackKeyPath", v)}
                        />
                      </View>
                    </If>

                    <InputBox
                      variant="soft"
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
                        gridTemplateColumns: compactLayout()
                          ? "minmax(0, 1fr)"
                          : "repeat(2, minmax(0, 1fr))",
                        gap: space.sm,
                      }}
                    >
                      <InputBox
                        variant="soft"
                        label={tr("ssh.connectTimeout")}
                        value={sshForm().connectTimeoutSecs}
                        accessibilityLabel="ssh-form-connect-timeout"
                        onChange={v => setSshFormField("connectTimeoutSecs", v)}
                      />
                      <InputBox
                        variant="soft"
                        label={tr("ssh.authTimeout")}
                        value={sshForm().authTimeoutSecs}
                        accessibilityLabel="ssh-form-auth-timeout"
                        onChange={v => setSshFormField("authTimeoutSecs", v)}
                      />
                      <InputBox
                        variant="soft"
                        label={tr("ssh.authAttempts")}
                        value={sshForm().authAttempts}
                        accessibilityLabel="ssh-form-auth-attempts"
                        onChange={v => setSshFormField("authAttempts", v)}
                      />
                      <InputBox
                        variant="soft"
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
          </If>

          {/* In-progress SSH Hop Test feedback */}
          <If when={sshTesting()}>
            <View
              style={{
                padding: space.md,
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                borderRadius: radii.lg,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().border,
                backgroundColor: palette().panelRaised,
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
                  padding: space.md,
                  gap: space.sm,
                  borderRadius: radii.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: report().success ? palette().border : stateColor("failed"),
                  backgroundColor: palette().panelRaised,
                }}
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                    <StateMark state={report().success ? "done" : "failed"} size={12} />
                    <Text
                      style={{
                        color: report().success ? palette().text : stateColor("failed"),
                        fontSize: textSize(13),
                        fontWeight: "600",
                        lineHeight: textLineHeight(13, 1.35),
                      }}
                    >
                      {report().success ? tr("ssh.testPassed") : tr("ssh.testFailed")}
                    </Text>
                  </View>
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
                        color: stateColor("failed"),
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.45),
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
                        <View style={{ flexDirection: "row", alignItems: "stretch", gap: space.sm }}>
                          <View style={{ width: 18, alignItems: "center", flexShrink: 0 }}>
                            <View
                              style={{
                                width: 18,
                                height: 18,
                                marginTop: 1,
                                borderRadius: radii.pill,
                                backgroundColor: palette().surfaceSubtle,
                                borderWidth: 1,
                                borderColor: stage().success
                                  ? palette().border
                                  : stateColor("failed"),
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Icon
                                name={stage().success ? "check" : "close"}
                                size={10}
                                color={
                                  stage().success ? palette().textSecondary : stateColor("failed")
                                }
                              />
                            </View>
                            <If when={idx() < total() - 1}>
                              <View
                                style={{
                                  width: 1,
                                  flex: 1,
                                  minHeight: space.sm,
                                  backgroundColor: palette().border,
                                  marginVertical: space.hair,
                                }}
                              />
                            </If>
                          </View>
                          <View
                            style={{
                              flex: 1,
                              minWidth: 0,
                              paddingBottom: idx() < total() - 1 ? space.sm : 0,
                              gap: space.hair,
                            }}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: space.sm,
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
                                  fontWeight: "400",
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
                                    fontSize: textSize(12),
                                    lineHeight: textLineHeight(12, 1.35),
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
                                    color: stateColor("failed"),
                                    fontSize: textSize(12),
                                    lineHeight: textLineHeight(12, 1.4),
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
      size="sm"
      accessibilityLabel="ssh-auth-prompt-modal"
      closeOnBackdropPress={!sshConnecting()}
      closeOnEscape={!sshConnecting()}
      onClose={closeAuthPrompt}
      footer={
        <View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
          <Button
            label={tr("common.cancel")}
            variant="ghost"
            size="md"
            disabled={sshConnecting()}
            accessibilityLabel="ssh-auth-cancel"
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={closeAuthPrompt}
          />
          <Button
            label={sshConnecting() ? tr("ssh.connectingEllipsis") : tr("common.connect")}
            variant="primary"
            size="md"
            loading={sshConnecting()}
            accessibilityLabel="ssh-auth-submit"
            style={[
              { minWidth: 88 },
              compactLayout() ? { minHeight: layout.touchTarget } : undefined,
            ]}
            onPress={() => void submitAuthPrompt()}
          />
        </View>
      }
    >
      <ModalAlertBanner message={authPromptError()} onDismiss={() => authPromptError.set("")} />

      <If when={authPromptTarget()}>
        {target => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.md,
              paddingVertical: space.md,
              borderRadius: radii.lg,
              borderCurve: "continuous",
              backgroundColor: groupedListBg(),
            }}
          >
            <GlyphTile glyph={target().container ? "container" : "server"} />
            <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
              <Text
                style={{
                  color: palette().text,
                  fontSize: textSize(13),
                  lineHeight: textLineHeight(13, 1.3),
                  fontWeight: "600",
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {target().name || target().host}
              </Text>
              <Text
                style={{
                  color: palette().textMuted,
                  fontVariant: ["tabular-nums"],
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.35),
                  numberOfLines: 1,
                  textOverflow: "ellipsis-middle",
                }}
              >
                {formatSavedConnectionSubtitle(target())}
              </Text>
            </View>
          </View>
        )}
      </If>

      <If when={!authPromptTarget() && authPromptLockUsername() && authPromptUsername().trim() !== ""}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.sm,
            paddingVertical: space.sm,
            borderRadius: radii.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().surfaceSubtle,
          }}
        >
          <Icon name="shield" size={14} color={palette().textMuted} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.35),
              numberOfLines: 1,
              textOverflow: "ellipsis-middle",
            }}
          >
            {authPromptUsername()}
          </Text>
        </View>
      </If>

      <If when={!authPromptLockUsername()}>
        <InputBox
          variant="soft"
          label={tr("ssh.username")}
          value={authPromptUsername()}
          placeholder="root"
          accessibilityLabel="ssh-auth-username"
          onChange={v => authPromptUsername.set(v)}
        />
      </If>

      <FieldSection label={tr("ssh.authMethod")}>
        <SelectDropdown
          fullWidth
          size="md"
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
          variant="soft"
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
        <View style={{ gap: space.sm }}>
          <InputBox
            variant="soft"
            label={tr("ssh.privateKeyPath")}
            value={authPromptKeyPath()}
            placeholder="~/.ssh/id_rsa"
            accessibilityLabel="ssh-auth-key-path"
            onChange={v => authPromptKeyPath.set(v)}
          />
          <InputBox
            variant="soft"
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
        <View style={{ gap: space.sm }}>
          <InputBox
            variant="soft"
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
            variant="soft"
            masked
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
    return entry ? entryMenuItems(entry) : [];
  };

  const entryMenuItems = (entry: RemoteFileEntry): ReadonlyArray<DropdownMenuItem> => {
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
        confirmDelete: true,
        confirmAccessibilityLabel: `remote-delete-confirm-${entry.name}`,
        onSelect: () => {
          browserConfirmDeleteEntry.set(entry);
          void confirmRemoteDelete();
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
      title={browserPickerMode() ? tr("ssh.chooseFolderTitle") : tr("ssh.selectRemoteWorkspace")}
      subtitle={browserConnectionName()}
      size="lg"
      accessibilityLabel="remote-file-browser-modal"
      closeOnBackdropPress={!browserBusy()}
      closeOnEscape={!browserBusy()}
      onClose={closeRemoteFileBrowser}
      footer={
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
          <View
            tooltip={compactLayout() ? undefined : <TooltipBubble text={footerPathLabel()} />}
            style={{ flex: 1, minWidth: 140, opacity: browserSelectDirectoriesOnly() ? 0 : 1 }}
          >
            <Text
              style={{
                color: palette().textElevatedMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.38),
                numberOfLines: 1,
                textOverflow: "ellipsis-middle",
              }}
            >
              {footerPathLabel()}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 0 }}>
            <Button
              label={
                browserBusy()
                  ? tr("ssh.openingEllipsis")
                  : browserPickerMode()
                    ? tr("ssh.selectThisFolder")
                    : tr("ssh.openWorkspace")
              }
              variant="primary"
              size="md"
              loading={browserBusy()}
              disabled={browserLoading()}
              accessibilityLabel="remote-browser-open"
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
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

      {/* One toolbar row: up, the editable path, new folder, refresh. */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0 }}>
          <IconButton
            icon="arrow-left"
            size={compactLayout() ? "md" : "sm"}
            tooltip={tr("ssh.parentDirectory")}
            accessibilityLabel="remote-browser-up"
            disabled={browserLoading() || getRemoteParentPath(browserCurrentPath()) === null}
            onPress={() => {
              const parent = getRemoteParentPath(browserCurrentPath());
              if (parent !== null) void loadRemoteDirectory(parent);
            }}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <InputBox
              variant="soft"
              size={compactLayout() ? "md" : "sm"}
              value={browserPathInput()}
              placeholder={tr("ssh.pathPlaceholder")}
              accessibilityLabel="remote-browser-path-input"
              onChange={v => browserPathInput.set(v)}
              onSubmit={() => void loadRemoteDirectory(browserPathInput())}
            />
          </View>
          <IconButton
            icon="folder-plus"
            size={compactLayout() ? "md" : "sm"}
            active={browserNewDirOpen()}
            tooltip={tr("ssh.newRemoteFolder")}
            accessibilityLabel="remote-browser-new-folder-toggle"
            onPress={() => browserNewDirOpen.update(v => !v)}
          />
          <IconButton
            icon="refresh"
            size={compactLayout() ? "md" : "sm"}
            tooltip={tr("ssh.refreshDirectory")}
            accessibilityLabel="remote-browser-refresh"
            disabled={browserLoading()}
            onPress={() => void loadRemoteDirectory(browserCurrentPath())}
          />
        </View>

        <If when={browserEntries().length > 12 || browserFilter().trim() !== ""}>
          <SearchInput
            size={compactLayout() ? "lg" : "sm"}
            value={browserFilter()}
            placeholder={tr("ssh.filterDirectory")}
            accessibilityLabel="remote-browser-filter"
            onChange={v => browserFilter.set(v)}
          />
        </If>
      </View>

      {/* New Folder Bar */}
      <If when={browserNewDirOpen()}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            gap: space.sm,
          }}
        >
          <View style={{ flex: 1, minWidth: 160 }}>
            <InputBox
              autoFocus
              variant="soft"
              leadingIcon="folder-plus"
              size="sm"
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
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => void createRemoteDirectory(browserNewDirName())}
          />
          <Button
            label={tr("common.cancel")}
            variant="ghost"
            size="sm"
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
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
              gap: space.xs,
              padding: space.sm,
              borderRadius: radii.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().border,
              backgroundColor: palette().panelRaised,
            }}
          >
            <Text
              style={{
                color: palette().textSecondary,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.35),
                fontWeight: "500",
                numberOfLines: 1,
                textOverflow: "ellipsis-middle",
              }}
            >
              {tr("ssh.renameEntry", { name: entry().name })}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, minWidth: 0 }}>
              <View style={{ flex: 1, minWidth: 160 }}>
                <InputBox
                  autoFocus
                  size="sm"
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
                style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                onPress={() => void submitRemoteRename()}
              />
              <Button
                label={tr("common.cancel")}
                variant="ghost"
                size="sm"
                style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                onPress={() => browserRenamingEntry.set(null)}
              />
            </View>
          </View>
        )}
      </If>

      {/* Remote File List */}
      <View
        style={{
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: "transparent",
          overflow: "hidden",
        }}
      >
        <If
          when={browserLoading()}
          else={
            <Scroll
              smoothWheel
              style={compactLayout() ? { maxHeight: 320, minHeight: 160 } : { height: 320, minHeight: 0 }}
              scrollbar={true}
            >
              <View>
                <Each of={filteredBrowserEntries()} key={entry => entry.path}>
                  {entry => {
                    const isSelected = () => browserSelectedPath() === entry().path;
                    const inert = () =>
                      browserSelectDirectoriesOnly() && !entry().isDir && !entry().isSymlink;
                    return (
                      <View
                        style={{
                          minHeight: compactLayout() ? layout.touchTarget : 34,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.sm,
                          paddingRight: compactLayout() ? space.xs : space.md,
                          backgroundColor: isSelected() ? palette().accentSoft : "transparent",
                          opacity: inert() ? 0.5 : 1,
                          ...paintTransition(MOTION_DURATION.fast),
                        }}
                        hoverStyle={
                          compactLayout() || inert()
                            ? undefined
                            : {
                                backgroundColor: isSelected()
                                  ? palette().accentSoft
                                  : listRowHoverBg(),
                              }
                        }
                      >
                        <View
                          role="button"
                          accessibilityLabel={`remote-entry-${entry().name}`}
                          accessibilityState={{ selected: isSelected() }}
                          hitSlop={touchSlop(34)}
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
                            flex: 1,
                            minWidth: 0,
                            minHeight: compactLayout() ? layout.touchTarget : 34,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: space.sm,
                            paddingLeft: space.md,
                            paddingVertical: space.xs,
                            cursor: inert() ? "default" : "pointer",
                            ...pressTransition(MOTION_DURATION.fast),
                          }}
                          activeStyle={tactileActiveStyle(0.99)}
                          focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -2 }}
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
                              fontSize: textSize(13),
                              lineHeight: textLineHeight(13, 1.35),
                              fontWeight: "400",
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
                              fontSize: textSize(12),
                              lineHeight: textLineHeight(12, 1.35),
                              fontVariant: ["tabular-nums"],
                            }}
                          >
                            {entry().isDir ? "" : formatFileSize(entry().size)}
                          </Text>
                          <If when={entry().isDir}>
                            <Icon name="chevron-right" size={13} color={palette().textMuted} />
                          </If>
                        </View>
                        <If when={compactLayout()}>
                          <MoreMenu
                            size="sm"
                            accessibilityLabel={`remote-entry-more-${entry().name}`}
                            tooltip={tr("common.more")}
                            items={entryMenuItems(entry())}
                          />
                        </If>
                      </View>
                    );
                  }}
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
              height: 320,
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
          variant="ghost"
          size="md"
          accessibilityLabel="pf-close"
          style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
          onPress={closePortForwardModal}
        />
      }
    >
      <ModalAlertBanner
        message={portForwardError()}
        onDismiss={() => portForwardError.set("")}
      />

      {/* Detected Listening Ports */}
      <ConfigSection
        flush
        title={tr("ssh.detectedPorts")}
        extra={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <If when={listeningPorts().length > 0}>
              <Badge label={String(listeningPorts().length)} size="xs" tone="neutral" />
            </If>
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.md }}>
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
            <View style={{ paddingHorizontal: space.md, paddingVertical: space.md }}>
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.4),
                }}
              >
                {tr("ssh.noListeningPorts")}
              </Text>
            </View>
          </If>

          <If when={listeningPorts().length > 0}>
            <Scroll smoothWheel style={{ maxHeight: 164, minHeight: 0 }} scrollbar={true}>
              <View>
                <Each of={listeningPorts()} key={p => `${p.port}-${p.bindAddress}`}>
                  {(port, idx) => {
                    const isForwarded = () => forwardedRemotePortSet().has(port().port);
                    const isBusy = () => portForwardBusyPort() === port().port;
                    return (
                      <View
                        style={{
                          minHeight: compactLayout() ? layout.touchTarget : 38,
                          paddingHorizontal: space.md,
                          paddingVertical: space.xs,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.sm,
                          borderBottomWidth: idx() < listeningPorts().length - 1 ? 1 : 0,
                          borderColor: palette().borderSubtle,
                        }}
                      >
                        <Text
                          style={{
                            minWidth: 52,
                            color: palette().text,
                            fontFamily: fontMono(),
                            fontVariant: ["tabular-nums"],
                            fontSize: textSize(12),
                            lineHeight: textLineHeight(12, 1.35),
                            fontWeight: "600",
                            flexShrink: 0,
                          }}
                        >
                          {`:${port().port}`}
                        </Text>
                        <Text
                          style={{
                            flex: 1,
                            minWidth: 0,
                            color: palette().textSecondary,
                            fontSize: textSize(12),
                            lineHeight: textLineHeight(12, 1.35),
                            numberOfLines: 1,
                            textOverflow: "ellipsis",
                          }}
                        >
                          {port().process || port().bindAddress}
                        </Text>
                        <If when={Boolean(port().process && port().bindAddress)}>
                          <Text
                            style={{
                              color: palette().textMuted,
                              fontFamily: fontMono(),
                              fontVariant: ["tabular-nums"],
                              fontSize: textSize(11),
                              lineHeight: textLineHeight(11, 1.35),
                              flexShrink: 0,
                            }}
                          >
                            {port().bindAddress}
                          </Text>
                        </If>
                        <Button
                          label={isForwarded() ? tr("ssh.forwarded") : tr("ssh.forwardPort")}
                          size={compactLayout() ? "sm" : "xs"}
                          variant={isForwarded() ? "ghost" : "secondary"}
                          leadingIcon={isForwarded() ? "check" : "plus"}
                          loading={isBusy()}
                          disabled={isForwarded() || (portForwardBusyPort() !== null && !isBusy())}
                          accessibilityLabel={`pf-detected-${port().port}`}
                          onPress={() => {
                            if (!isForwarded() && portForwardBusyPort() === null) {
                              void forwardDetectedPort(port());
                            }
                          }}
                        />
                      </View>
                    );
                  }}
                </Each>
              </View>
            </Scroll>
          </If>
        </View>
      </ConfigSection>

      {/* Active Port Forwards */}
      <ConfigSection
        flush
        title={tr("ssh.activeForwards")}
        extra={
          <If when={portForwards().length > 0}>
            <Badge label={String(portForwards().length)} size="xs" tone="accent" />
          </If>
        }
      >
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
                    accessibilityLabel={`pf-open-${fwd().localPort}`}
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
                    accessibilityLabel={`pf-copy-${fwd().localPort}`}
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
        <View style={{ gap: space.sm }}>
          <View
            style={{
              display: "grid",
              gridTemplateColumns: compactLayout() ? "minmax(0, 1fr)" : "1.4fr 1fr 1fr",
              gap: space.sm,
            }}
          >
            <InputBox
              variant="soft"
              monospace
              label={tr("ssh.remoteHost")}
              value={portForwardRemoteHost()}
              placeholder="127.0.0.1"
              accessibilityLabel="pf-remote-host"
              onChange={v => portForwardRemoteHost.set(v)}
            />
            <InputBox
              variant="soft"
              monospace
              label={tr("ssh.remotePort")}
              value={portForwardRemotePort()}
              placeholder="3000"
              accessibilityLabel="pf-remote-port"
              onChange={v => portForwardRemotePort.set(v)}
              onSubmit={() => void submitPortForwardForm()}
            />
            <InputBox
              variant="soft"
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
            variant="soft"
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
              size="md"
              loading={portForwardSubmitting()}
              disabled={!portForwardRemotePort().trim() || portForwardSubmitting()}
              accessibilityLabel="pf-submit"
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
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
export function RemoteWorkspaceStatusBanner(props: {
  compact?: boolean;
  workspace?: () => WorkspaceRecord | null;
} = {}) {
  const workspace = () => (props.workspace ? props.workspace() : activeWorkspace());
  const state = () => remoteLinkStateOf(workspace());
  const visible = () => {
    const current = state();
    return (
      current === "offline" ||
      current === "reconnecting" ||
      current === "auth-required" ||
      current === "host-outdated"
    );
  };
  const isWarning = () => state() === "reconnecting" || state() === "host-outdated";
  const accentColor = () => (isWarning() ? stateColor("needs_you") : stateColor("failed"));
  const host = () => {
    const ws = workspace();
    return remoteWorkspaceAliasOf(ws) || resolvedConnectionIdOf(ws) || ws?.name || "";
  };
  const detail = () => remoteLinkErrorOf(workspace());
  return (
    <If when={visible()}>
      <View
        role="alert"
        accessibilityLabel={`remote-link-${state() ?? "unknown"}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: space.sm,
          paddingHorizontal: props.compact ? space.sm : space.md,
          paddingVertical: space.sm,
          borderLeftWidth: 2,
          borderLeftColor: accentColor(),
          borderBottomWidth: 1,
          borderBottomColor: palette().borderSubtle,
          backgroundColor: palette().canvasSubtle,
        }}
      >
        <If
          when={state() === "reconnecting"}
          else={<Icon name="server" size={14} color={accentColor()} />}
        >
          <Spinner size={12} color={stateColor("working")} />
        </If>
        <View style={{ flex: 1, minWidth: 160, gap: space.hair }}>
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(12),
              fontWeight: "600",
              lineHeight: textLineHeight(12, 1.35),
            }}
          >
            {state() === "reconnecting"
              ? remoteLinkAttemptOf(workspace()) > 1
                ? tr("ssh.link.reconnectingAttempt", {
                    host: host(),
                    attempt: String(remoteLinkAttemptOf(workspace())),
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
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
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
            size={compactLayout() ? "sm" : "xs"}
            leadingIcon={state() === "auth-required" ? "key" : "refresh"}
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => void retryRemoteWorkspace(workspace())}
          />
        </If>
      </View>
    </If>
  );
}
