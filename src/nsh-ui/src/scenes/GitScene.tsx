import { Canvas, cleanup, Clipboard, computed, effect, Scroll, signal, Text, untracked, View, type ViewRef } from "nsh";
import { ensureWorkspaceWatch, openFileAt } from "../fileStore";
import { DiffView, Input } from "nsh/base";
import { basename, formatCount, formatPlural, formatRelativeTime } from "../format";
import { localizeHostError, tr } from "../i18n";
import {
  addGitWorktree,
  addWorktreeModalOpen,
  cancelDiscardGitFile,
  cancelRemoveWorktree,
  checkoutGitBranch,
  closeAddWorktreeModal,
  closeCreateBranchModal,
  commitStagedChanges,
  confirmDiscardGitFile,
  confirmingDeleteBranch,
  confirmingDiscardFile,
  confirmingRemoveWorktree,
  createGitBranch,
  deleteGitBranch,
  diffLoading,
  displayRepoFilePath,
  generateAiCommitMessage,
  gitActionBusy,
  gitAiGenerating,
  gitBranches,
  gitBusy,
  gitCommitAmend,
  gitCommitMessage,
  gitCommits,
  gitError,
  gitGraphByHash,
  gitGraphMaxLane,
  gitGraphNote,
  gitNotice,
  gitRepoState,
  gitStatus,
  gitTab,
  gitTrustReport,
  gitWorktreeNote,
  gitWorktrees,
  initializeRepositoryWithAgent,
  newBranchName,
  newBranchOpen,
  newBranchStartPoint,
  newWorktreeBranch,
  newWorktreeCreateBranch,
  openAddWorktreeModal,
  openCreateBranchModal,
  probeAndLoadGit,
  pullCurrentBranch,
  pushCurrentBranch,
  refreshGitWorkbench,
  removeGitWorktree,
  requestDiscardGitFile,
  requestRemoveWorktree,
  selectedGitDiff,
  selectedGitDiffNote,
  selectedGitFile,
  selectGitFile,
  stageGitFiles,
  syncGitWorkspace,
  totalWorkingChanges,
  trustCurrentRepository,
  unstageGitFiles,
  workingFileFilter,
  type GitBranchRow,
  type GitCommitRow,
  type GitTab,
  holdGitStatusWatch,
  gitLiveNotice,
  branchFilter,
  checkedGitPaths,
  setCheckedGitPaths,
  stageCheckedGitPaths,
  toggleCheckedGitPath,
  unstageCheckedGitPaths,
  cancelCommitReset,
  cherryPickCommit,
  clearSelectedCommit,
  commitFileDiff,
  commitFileDiffLoading,
  commitFiles,
  commitFilesLoading,
  commitFilesNote,
  confirmCommitReset,
  confirmingCommitReset,
  gitHistoryHasMore,
  gitHistoryLoadingMore,
  historyFilter,
  loadMoreGitHistory,
  requestCommitReset,
  selectCommit,
  selectCommitFile,
  selectedCommit,
  selectedCommitFile,
  branchSwitchBlocker,
  cancelForceDeleteBranch,
  commitAndSwitchBranch,
  confirmingForceDeleteBranch,
  dismissBranchSwitchBlocker,
  localNameForRemoteBranch,
  setCommitAmend,
  switchCommitMessage,
} from "../gitWorkbenchStore";
import { peerScope } from "../peerState";
import { activeWorkspace, navigateScene, openInAuxPane } from "../state";
import {
  fontMono,
  palette,
  radii,
  textLineHeight,
  textSize,
  textTracking,
} from "../theme";
import { Icon, type IconName } from "../ui/icons";
import { createDiffViewStyles, inferCodeLanguage } from "../ui/markdown";
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
  pushToast,
  SelectDropdown,
  type SelectDropdownOption,
} from "../ui/overlays";
import {
  Button,
  EmptyStateCard,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  SectionCard,
  SplitHandle,
  StatusDot,
  ToggleSwitch,
  TooltipBubble,
  type SegmentedTabOption,
  type StatusDotKind,
} from "../ui/primitives";
import { RemoteWorkspaceStatusBanner } from "../ui/SshWorkspaceModals";
import {
  createSceneWidth,
  StackBackButton,
  ToolbarDivider,
  WORKBENCH_TOUCH_MIN,
} from "../ui/workbenchLayout";

export interface GitSceneProps {
  compact?: boolean;
}

const GIT_SIDEBAR_MIN = 200;
const GIT_SIDEBAR_MAX = 520;
const LANE_STEP = 14;
const LANE_PAD = 11;
/** Lanes past this share the last column, so a very wide graph cannot crowd out the messages. */
const MAX_DRAWN_LANES = 24;
const HISTORY_ROW_HEIGHT = 38;

const gitSidebarWidth = signal(260);
const gitDiffLayout = signal<"unified" | "split">("unified");

const gitTabs = computed<ReadonlyArray<SegmentedTabOption<GitTab>>>(() => [
  { value: "working", label: tr("git.tabWorkingCopy"), badge: totalWorkingChanges() },
  { value: "branches", label: tr("git.tabBranches"), badge: gitBranches().length },
  { value: "history", label: tr("git.tabHistory"), badge: gitCommits().length },
  { value: "worktrees", label: tr("git.tabWorktrees"), badge: gitWorktrees().length },
]);

const compactGitTabs = computed<ReadonlyArray<SegmentedTabOption<GitTab>>>(() => [
  { value: "working", label: tr("git.tabChanges"), badge: totalWorkingChanges() },
  { value: "branches", label: tr("git.tabBranches") },
  { value: "history", label: tr("git.tabHistory") },
  { value: "worktrees", label: tr("git.tabWorktrees") },
]);

const branchSelectOptions = computed<ReadonlyArray<SelectDropdownOption<string>>>(() => {
  const currentName = gitStatus()?.current_branch ?? "";
  const locals = gitBranches().filter(branch => !branch.remote);
  const options: SelectDropdownOption<string>[] = locals.map(branch => {
    const syncParts: string[] = [];
    if (branch.ahead > 0) syncParts.push(`+${branch.ahead}`);
    if (branch.behind > 0) syncParts.push(`-${branch.behind}`);
    const syncHint = syncParts.join(" ");
    const desc = [branch.upstream, syncHint].filter(Boolean).join(" · ");
    return {
      value: branch.name,
      label: branch.name,
      description: desc || undefined,
      icon: "git-branch",
      accessibilityLabel: `git-branch-option-${branch.name}`,
    };
  });
  if (currentName && !options.some(opt => opt.value === currentName)) {
    options.unshift({
      value: currentName,
      label: currentName,
      icon: "git-branch",
      accessibilityLabel: `git-branch-option-${currentName}`,
    });
  }
  return options;
});

function matchesBranchFilter(branch: GitBranchRow): boolean {
  const needle = branchFilter().trim().toLowerCase();
  return !needle || branch.name.toLowerCase().includes(needle);
}

const localBranches = computed<GitBranchRow[]>(() =>
  gitBranches().filter(branch => !branch.remote && matchesBranchFilter(branch)),
);

const remoteBranches = computed<GitBranchRow[]>(() =>
  gitBranches().filter(branch => branch.remote && matchesBranchFilter(branch)),
);

function filterPaths(paths: string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return paths;
  return paths.filter(path => displayRepoFilePath(path).toLowerCase().includes(needle));
}

const filteredConflicts = computed(() =>
  filterPaths(gitStatus()?.conflicts ?? [], workingFileFilter()),
);

const filteredStaged = computed(() => {
  const needle = workingFileFilter().trim().toLowerCase();
  const rows = gitStatus()?.staged ?? [];
  if (!needle) return rows;
  return rows.filter(file => displayRepoFilePath(file.path).toLowerCase().includes(needle));
});

const filteredUnstaged = computed(() => {
  const needle = workingFileFilter().trim().toLowerCase();
  const rows = gitStatus()?.unstaged ?? [];
  if (!needle) return rows;
  return rows.filter(file => displayRepoFilePath(file.path).toLowerCase().includes(needle));
});

const filteredUntracked = computed(() =>
  filterPaths(gitStatus()?.untracked ?? [], workingFileFilter()),
);

function diffPatchStats(patch: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  if (!patch) return { added, deleted };
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deleted += 1;
  }
  return { added, deleted };
}

const selectedDiffStats = computed(() => diffPatchStats(selectedGitDiff()));

function splitDisplayPath(path: string): { fileName: string; dirName: string } {
  const clean = path.replace(/[\\/]+$/, "");
  const sepIdx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (sepIdx <= 0) return { fileName: basename(clean) || clean, dirName: "" };
  return {
    fileName: clean.slice(sepIdx + 1),
    dirName: clean.slice(0, sepIdx),
  };
}

function laneColor(lane: number): string {
  const lanes = palette().gitLanes;
  const idx = ((lane % lanes.length) + lanes.length) % lanes.length;
  return lanes[idx];
}

function fileLetterColor(tone: "danger" | "success" | "warning" | "muted"): string {
  if (tone === "danger") return palette().danger;
  if (tone === "success") return palette().success;
  if (tone === "warning") return palette().warning;
  return palette().accent;
}

function groupDotKind(tone?: "accent" | "warning" | "danger" | "success" | "neutral"): StatusDotKind {
  if (tone === "danger") return "danger";
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "accent") return "accent";
  return "muted";
}

function rowFocusRing(): { outlineWidth: number; outlineColor: string; outlineOffset: number } {
  return {
    outlineWidth: 2,
    outlineColor: palette().borderFocus,
    outlineOffset: -1,
  };
}

const isRemoteWorkspace = computed(
  () => activeWorkspace()?.workspaceKind === "remote" || Boolean(activeWorkspace()?.connectionId),
);

const isRemoteGraphNote = computed(() =>
  gitGraphNote().toLowerCase().includes("local workspaces only"),
);

const isRemoteWorktreeNote = computed(() =>
  gitWorktreeNote().toLowerCase().includes("local workspaces only"),
);

function diffBadgeFor(
  kind: "staged" | "unstaged" | "untracked" | "conflict",
): { label: string; tone: "danger" | "success" | "warning" | "accent" } {
  if (kind === "conflict") return { label: tr("git.conflict"), tone: "danger" };
  if (kind === "staged") return { label: tr("git.staged"), tone: "success" };
  if (kind === "untracked") return { label: tr("git.untracked"), tone: "accent" };
  return { label: tr("git.working"), tone: "warning" };
}

/** One quiet inline status per row (replaces a pile of badges): parts joined by " · ". */
function QuietStatusText(props: { parts: ReadonlyArray<string | false | null | undefined> }) {
  return (
    <If when={props.parts.filter(Boolean).join(" · ")}>
      {text => (
        <Text
          style={{
            flexShrink: 0,
            color: palette().textSecondary,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.35),
            fontVariant: ["tabular-nums"],
            numberOfLines: 1,
          }}
        >
          {text()}
        </Text>
      )}
    </If>
  );
}

/** Calm centered borderless empty prompt for split panes (avoids heavy nested card frames). */
function QuietGitEmpty(props: { icon: IconName; title: string; subtitle?: string }) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        maxWidth: 320,
        paddingVertical: 16,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().surfaceSubtle,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 2,
        }}
      >
        <Icon name={props.icon} size={16} color={palette().textMuted} />
      </View>
      <Text
        style={{
          color: palette().text,
          fontSize: textSize(13.5),
          fontWeight: "600",
          letterSpacing: textTracking(13.5),
          lineHeight: textLineHeight(13.5, 1.32),
          textAlign: "center",
        }}
      >
        {props.title}
      </Text>
      <If when={props.subtitle ?? ""}>
        {sub => (
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.46),
              textAlign: "center",
            }}
          >
            {sub()}
          </Text>
        )}
      </If>
    </View>
  );
}

/**
 * Sleek 32px hairline-underline tab strip for compact AuxPane Git drawer
 * (replaces bulky boxed SegmentedTabs in narrow side drawers).
 */
function GitUnderlineTabs(props: {
  options: ReadonlyArray<SegmentedTabOption<GitTab>>;
  value: GitTab;
  onChange: (next: GitTab) => void;
}) {
  return (
    <Scroll horizontal scrollbar={false} style={{ width: "100%", minWidth: 0 }}>
      <View
        role="tablist"
        style={{
          height: 32,
          flexDirection: "row",
          alignItems: "stretch",
          gap: 14,
          paddingHorizontal: 10,
        }}
      >
        <Each of={props.options} key={option => option.value}>
          {option => (
            <View
              role="tab"
              accessibilityLabel={option().accessibilityLabel}
              accessibilityState={{ selected: option().value === props.value }}
              onPress={() => props.onChange(option().value)}
              style={{
                position: "relative",
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingVertical: 4,
                cursor: "pointer",
                ...pressTransition(MOTION_DURATION.fast),
              }}
              activeStyle={tactileActiveStyle(0.97)}
              focusVisibleStyle={rowFocusRing()}
            >
              <Text
                style={{
                  color:
                    option().value === props.value ? palette().text : palette().textMuted,
                  fontSize: textSize(12),
                  fontWeight: option().value === props.value ? "600" : "500",
                  lineHeight: textLineHeight(12, 1.3),
                  numberOfLines: 1,
                }}
              >
                {option().label}
              </Text>
              <If
                when={
                  option().badge !== undefined && option().badge !== null
                    ? String(option().badge)
                    : ""
                }
              >
                {badgeText => (
                  <Text
                    style={{
                      color:
                        option().value === props.value
                          ? palette().accent
                          : palette().textMuted,
                      fontSize: textSize(10.5),
                      fontWeight: "600",
                      fontVariant: ["tabular-nums"],
                      lineHeight: textLineHeight(10.5, 1.25),
                    }}
                  >
                    {badgeText()}
                  </Text>
                )}
              </If>
              <If when={option().value === props.value}>
                <View
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 2,
                    borderRadius: 2,
                    backgroundColor: palette().accent,
                  }}
                />
              </If>
            </View>
          )}
        </Each>
      </View>
    </Scroll>
  );
}

function GroupHeader(props: {
  label: string;
  count: number;
  expanded: boolean;
  tone?: "accent" | "warning" | "danger" | "success" | "neutral";
  /** Stacked (narrow) layout: a full 44 pt touch row. */
  touch?: boolean;
  onToggle: () => void;
}) {
  return (
    <View
      role="button"
      accessibilityState={{ expanded: props.expanded }}
      onPress={() => props.onToggle()}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: props.touch ? WORKBENCH_TOUCH_MIN : undefined,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={{ opacity: 0.88 }}
      focusVisibleStyle={rowFocusRing()}
    >
      <Icon
        name={props.expanded ? "chevron-down" : "chevron-right"}
        size={12}
        color={palette().textMuted}
      />
      <StatusDot kind={groupDotKind(props.tone)} size={5.5} />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: palette().textSecondary,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.32),
          fontWeight: "600",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
      <Text
        style={{
          flexShrink: 0,
          color: palette().textMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.28),
          fontVariant: ["tabular-nums"],
        }}
      >
        {formatCount(props.count)}
      </Text>
    </View>
  );
}

interface GitFileRowProps {
  displayPath: string;
  letter: string;
  tone: "danger" | "success" | "warning" | "muted";
  selected: boolean;
  rowLabel: string;
  primaryIcon: "plus" | "arrow-left";
  primaryLabel: string;
  primaryTooltip: string;
  discardIcon?: "undo" | "trash";
  discardLabel: string;
  discardTooltip: string;
  disabled: boolean;
  /** The row's path, for the batch selection checkbox. */
  checkPath?: string;
  /** Stacked (narrow) layout: a 44 pt row whose actions stay visible (no hover on touch). */
  touch?: boolean;
  onSelect: () => void;
  onPrimaryAction: () => void;
  onDiscard: () => void;
}

/** A 14 px checkbox for the batch selection of working-copy rows. */
function RowCheckbox(props: { path: string; label: string }) {
  const checked = () => checkedGitPaths().includes(props.path);
  return (
    <View
      role="checkbox"
      accessibilityLabel={`git-check-${props.label}`}
      accessibilityState={{ checked: checked() }}
      onPress={() => toggleCheckedGitPath(props.path)}
      style={{
        width: 14,
        height: 14,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: checked() ? palette().accent : palette().borderStrong,
        backgroundColor: checked() ? palette().accent : "transparent",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      focusVisibleStyle={rowFocusRing()}
    >
      <If when={checked()}>
        <Icon name="check" size={10} color={palette().actionPrimaryFg} />
      </If>
    </View>
  );
}

/**
 * Working-copy file row using sibling pressable label and sibling hover-aligned
 * action IconButtons (never nesting interactive controls inside role="button").
 */
function GitFileRow(props: GitFileRowProps) {
  const hovered = signal(false);

  return (
    <View
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: 8,
        paddingRight: 4,
        paddingVertical: 2,
        minHeight: props.touch ? WORKBENCH_TOUCH_MIN : 28,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        backgroundColor: props.selected ? palette().accentSoft : "transparent",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: props.selected ? palette().accentSoft : palette().panelHover,
      }}
    >
      <If when={props.checkPath && (hovered() || props.touch || checkedGitPaths().length > 0)}>
        <RowCheckbox path={props.checkPath!} label={props.displayPath} />
      </If>
      <View
        role="button"
        tooltip={<TooltipBubble text={props.displayPath} />}
        accessibilityLabel={props.rowLabel}
        accessibilityState={{ selected: props.selected }}
        onPress={props.onSelect}
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          paddingVertical: 3,
          paddingHorizontal: 1,
          borderRadius: radii.xs,
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        activeStyle={{ opacity: 0.88 }}
        focusVisibleStyle={rowFocusRing()}
      >
        <View
          style={{
            minWidth: 16,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Text
            style={{
              color: fileLetterColor(props.tone),
              fontFamily: fontMono,
              fontSize: textSize(10),
              lineHeight: textLineHeight(10, 1.15),
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            {props.letter}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 5 }}>
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.3),
              fontWeight: props.selected ? "600" : "500",
              flexShrink: 1,
              minWidth: 0,
              numberOfLines: 1,
              textOverflow: "ellipsis-middle",
            }}
          >
            {splitDisplayPath(props.displayPath).fileName}
          </Text>
          <If when={splitDisplayPath(props.displayPath).dirName}>
            {dir => (
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.3),
                  numberOfLines: 1,
                  textOverflow: "ellipsis-start",
                }}
              >
                {dir()}
              </Text>
            )}
          </If>
        </View>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
          flexShrink: 0,
          opacity: props.touch || props.selected || hovered() ? 1 : 0.34,
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <IconButton
          icon={props.primaryIcon}
          size={props.touch ? "md" : "xs"}
          iconSize={props.touch ? undefined : 12.5}
          accessibilityLabel={props.primaryLabel}
          tooltip={props.primaryTooltip}
          disabled={props.disabled}
          onPress={props.onPrimaryAction}
        />
        <IconButton
          icon={props.discardIcon ?? "undo"}
          size={props.touch ? "md" : "xs"}
          iconSize={props.touch ? undefined : 12}
          tone="danger"
          accessibilityLabel={props.discardLabel}
          tooltip={props.discardTooltip}
          disabled={props.disabled}
          onPress={props.onDiscard}
        />
      </View>
    </View>
  );
}

/** Opens a changed file's working copy in the Files editor (the aux pane when compact). */
function openWorkingCopyInFiles(path: string, compact: boolean): void {
  const root = activeWorkspace()?.rootPath ?? "";
  const fullPath =
    path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || !root
      ? path
      : `${root.replace(/[\\/]+$/, "")}/${path.replace(/^[\\/]+/, "")}`;
  if (compact) {
    openInAuxPane("files", fullPath);
    return;
  }
  void openFileAt(fullPath);
  navigateScene("files");
}

function WorkingCopyView(props: { compact?: boolean; stacked?: boolean; aux?: boolean }) {
  // Stacked (narrow) layout: the change list first; a pressed row pushes its diff.
  const detailOpen = signal(false);
  const showList = () => !props.stacked || !detailOpen();
  const showDetail = () => !props.stacked || detailOpen();
  const select = (target: Parameters<typeof selectGitFile>[0]) => {
    if (props.stacked) detailOpen.set(true);
    void selectGitFile(target);
  };
  const expanded = signal({
    conflicts: true,
    staged: true,
    unstaged: true,
    untracked: true,
  });

  const toggleGroup = (key: "conflicts" | "staged" | "unstaged" | "untracked") => {
    expanded.update(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        flexDirection: props.compact ? "column" : "row",
      }}
    >
      <If when={showList()}>
      <View
        style={{
          width: props.compact ? "100%" : gitSidebarWidth(),
          flex: props.stacked ? 1 : props.compact ? 1.08 : undefined,
          minHeight: 0,
          flexShrink: props.compact ? 1 : 0,
          overflow: "hidden",
          flexDirection: "column",
          borderRightWidth: 0,
          borderBottomWidth: props.compact && !props.stacked ? 1 : 0,
          borderColor: palette().borderSubtle,
          backgroundColor: props.stacked ? palette().canvas : palette().canvasSubtle,
        }}
      >
        <If
          when={Boolean(props.compact)}
          else={
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 8,
                gap: 7,
                borderBottomWidth: 1,
                borderColor: palette().borderSubtle,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Text
                  style={{
                    flex: 1,
                    minWidth: 72,
                    color: palette().textMuted,
                    fontSize: textSize(11.5),
                    lineHeight: textLineHeight(11.5, 1.32),
                    fontWeight: "600",
                    fontVariant: ["tabular-nums"],
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {formatPlural(totalWorkingChanges(), "format.changeOne", "format.changeOther")}
                </Text>
                <Button
                  label={tr("git.stageAll")}
                  size="xs"
                  variant="ghost"
                  disabled={gitActionBusy() || totalWorkingChanges() === 0}
                  accessibilityLabel="git-stage-all"
                  onPress={() => void stageGitFiles([], true)}
                />
                <Button
                  label={tr("git.unstageAll")}
                  size="xs"
                  variant="ghost"
                  disabled={gitActionBusy() || (gitStatus()?.staged.length ?? 0) === 0}
                  accessibilityLabel="git-unstage-all"
                  onPress={() =>
                    void unstageGitFiles((gitStatus()?.staged ?? []).map(file => file.path))
                  }
                />
              </View>
              <InputBox
                size="sm"
                leadingIcon="search"
                clearable={true}
                clearLabel={tr("common.clearFilter")}
                value={workingFileFilter()}
                placeholder={tr("git.filterChanged")}
                accessibilityLabel="git-filter-files"
                onChange={value => workingFileFilter.set(value)}
              />
            </View>
          }
        >
          {/* Compact AuxPane: single quiet inline filter + batch action row */}
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
            }}
          >
            <InputBox
              size="sm"
              leadingIcon="search"
              clearable={true}
              clearLabel={tr("common.clearFilter")}
              value={workingFileFilter()}
              placeholder={tr("git.filterFiles")}
              accessibilityLabel="git-filter-files"
              style={{ flex: 1, minWidth: 112 }}
              onChange={value => workingFileFilter.set(value)}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
              <Button
                label={tr("git.stageAll")}
                size="xs"
                variant="ghost"
                disabled={gitActionBusy() || totalWorkingChanges() === 0}
                accessibilityLabel="git-stage-all"
                onPress={() => void stageGitFiles([], true)}
              />
              <Button
                label={tr("git.unstageAll")}
                size="xs"
                variant="ghost"
                disabled={gitActionBusy() || (gitStatus()?.staged.length ?? 0) === 0}
                accessibilityLabel="git-unstage-all"
                onPress={() =>
                  void unstageGitFiles((gitStatus()?.staged ?? []).map(file => file.path))
                }
              />
            </View>
          </View>
        </If>

        <If when={checkedGitPaths().length > 0}>
          <View
            accessibilityLabel="git-batch-bar"
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().accentSoft,
            }}
          >
            <Text
              style={{
                flex: 1,
                minWidth: 70,
                color: palette().text,
                fontSize: textSize(12),
                fontWeight: "600",
                lineHeight: textLineHeight(12, 1.3),
                fontVariant: ["tabular-nums"],
              }}
            >
              {tr("git.selectedCount", { count: formatCount(checkedGitPaths().length) })}
            </Text>
            <Button
              label={tr("git.selectAllVisible")}
              size="xs"
              variant="ghost"
              accessibilityLabel="git-select-all"
              onPress={() =>
                setCheckedGitPaths([
                  ...filteredConflicts(),
                  ...filteredStaged().map(file => file.path),
                  ...filteredUnstaged().map(file => file.path),
                  ...filteredUntracked(),
                ])
              }
            />
            <Button
              label={tr("git.stageSelected")}
              size="xs"
              variant="secondary"
              disabled={gitActionBusy()}
              accessibilityLabel="git-stage-selected"
              onPress={() => void stageCheckedGitPaths()}
            />
            <Button
              label={tr("git.unstageSelected")}
              size="xs"
              variant="ghost"
              disabled={gitActionBusy()}
              accessibilityLabel="git-unstage-selected"
              onPress={() => void unstageCheckedGitPaths()}
            />
            <IconButton
              icon="close"
              size="xs"
              iconSize={11}
              tooltip={tr("git.clearSelection")}
              accessibilityLabel="git-clear-selection"
              onPress={() => setCheckedGitPaths([])}
            />
          </View>
        </If>

        <If when={confirmingDiscardFile()}>
          {target => (
            <View style={{ padding: 8, borderBottomWidth: 1, borderColor: palette().borderSubtle }}>
              <InlineConfirmBar
                danger
                message={
                  target().kind === "untracked"
                    ? tr("git.deleteUntrackedConfirm", {
                        path: displayRepoFilePath(target().path),
                      })
                    : tr("git.discardEditsConfirm", {
                        path: displayRepoFilePath(target().path),
                      })
                }
                confirmLabel={
                  target().kind === "untracked" ? tr("common.delete") : tr("common.discard")
                }
                cancelLabel={tr("common.cancel")}
                onConfirm={() => void confirmDiscardGitFile()}
                onCancel={() => cancelDiscardGitFile()}
              />
            </View>
          )}
        </If>

        <Scroll
          style={{ flex: 1, minHeight: 0 }}
          contentStyle={{ padding: props.compact ? 6 : 8, gap: props.compact ? 6 : 8 }}
        >
          <If when={totalWorkingChanges() === 0}>
            <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 16 }}>
              <QuietGitEmpty
                icon="check-circle"
                title={tr("git.cleanTitle")}
                subtitle={tr("git.cleanSubtitle")}
              />
            </View>
          </If>

          <If when={filteredConflicts().length > 0}>
            <View style={{ gap: 2 }}>
              <GroupHeader
                label={tr("git.mergeConflicts")}
                count={filteredConflicts().length}
                expanded={expanded().conflicts}
                touch={props.stacked}
                tone="danger"
                onToggle={() => toggleGroup("conflicts")}
              />
              <If when={expanded().conflicts}>
                <Each of={filteredConflicts()} key={path => `conflict:${path}`}>
                  {path => (
                    <GitFileRow
                      displayPath={displayRepoFilePath(path())}
                      letter="!"
                      tone="danger"
                      selected={
                        selectedGitFile()?.path === path() &&
                        selectedGitFile()?.kind === "conflict"
                      }
                      rowLabel={`git-conflict-${displayRepoFilePath(path())}`}
                      checkPath={path()}
                      primaryIcon="plus"
                      primaryLabel={`git-stage-${displayRepoFilePath(path())}`}
                      primaryTooltip={tr("git.markResolved")}
                      discardIcon="undo"
                      discardLabel={`git-discard-${displayRepoFilePath(path())}`}
                      discardTooltip={tr("common.discardChanges")}
                      disabled={gitActionBusy()}
                      touch={props.stacked}
                      onSelect={() =>
                        select({ path: path(), staged: false, kind: "conflict" })
                      }
                      onPrimaryAction={() => void stageGitFiles([path()])}
                      onDiscard={() =>
                        requestDiscardGitFile({ path: path(), kind: "conflict" })
                      }
                    />
                  )}
                </Each>
              </If>
            </View>
          </If>

          <If when={filteredStaged().length > 0}>
            <View style={{ gap: 2 }}>
              <GroupHeader
                label={tr("git.stagedChanges")}
                count={filteredStaged().length}
                expanded={expanded().staged}
                touch={props.stacked}
                tone="success"
                onToggle={() => toggleGroup("staged")}
              />
              <If when={expanded().staged}>
                <Each of={filteredStaged()} key={file => `staged:${file.path}`}>
                  {file => (
                    <GitFileRow
                      displayPath={displayRepoFilePath(file().path)}
                      letter={file().index_status || file().status || "M"}
                      tone="success"
                      selected={
                        selectedGitFile()?.path === file().path && Boolean(selectedGitFile()?.staged)
                      }
                      rowLabel={`git-staged-${displayRepoFilePath(file().path)}`}
                      checkPath={file().path}
                      primaryIcon="arrow-left"
                      primaryLabel={`git-unstage-${displayRepoFilePath(file().path)}`}
                      primaryTooltip={tr("git.unstage")}
                      discardIcon="undo"
                      discardLabel={`git-discard-${displayRepoFilePath(file().path)}`}
                      discardTooltip={tr("common.discardChanges")}
                      disabled={gitActionBusy()}
                      touch={props.stacked}
                      onSelect={() =>
                        select({ path: file().path, staged: true, kind: "staged" })
                      }
                      onPrimaryAction={() => void unstageGitFiles([file().path])}
                      onDiscard={() =>
                        requestDiscardGitFile({ path: file().path, kind: "staged" })
                      }
                    />
                  )}
                </Each>
              </If>
            </View>
          </If>

          <If when={filteredUnstaged().length > 0}>
            <View style={{ gap: 2 }}>
              <GroupHeader
                label={tr("git.unstagedChanges")}
                count={filteredUnstaged().length}
                expanded={expanded().unstaged}
                touch={props.stacked}
                tone="warning"
                onToggle={() => toggleGroup("unstaged")}
              />
              <If when={expanded().unstaged}>
                <Each of={filteredUnstaged()} key={file => `unstaged:${file.path}`}>
                  {file => (
                    <GitFileRow
                      displayPath={displayRepoFilePath(file().path)}
                      letter={file().workdir_status || file().status || "M"}
                      tone="warning"
                      selected={
                        selectedGitFile()?.path === file().path &&
                        !selectedGitFile()?.staged &&
                        selectedGitFile()?.kind === "unstaged"
                      }
                      rowLabel={`git-unstaged-${displayRepoFilePath(file().path)}`}
                      checkPath={file().path}
                      primaryIcon="plus"
                      primaryLabel={`git-stage-${displayRepoFilePath(file().path)}`}
                      primaryTooltip={tr("git.stageFile")}
                      discardIcon="undo"
                      discardLabel={`git-discard-${displayRepoFilePath(file().path)}`}
                      discardTooltip={tr("common.discardChanges")}
                      disabled={gitActionBusy()}
                      touch={props.stacked}
                      onSelect={() =>
                        select({
                          path: file().path,
                          staged: false,
                          kind: "unstaged",
                        })
                      }
                      onPrimaryAction={() => void stageGitFiles([file().path])}
                      onDiscard={() =>
                        requestDiscardGitFile({ path: file().path, kind: "unstaged" })
                      }
                    />
                  )}
                </Each>
              </If>
            </View>
          </If>

          <If when={filteredUntracked().length > 0}>
            <View style={{ gap: 2 }}>
              <GroupHeader
                label={tr("git.untracked")}
                count={filteredUntracked().length}
                expanded={expanded().untracked}
                touch={props.stacked}
                tone="accent"
                onToggle={() => toggleGroup("untracked")}
              />
              <If when={expanded().untracked}>
                <Each of={filteredUntracked()} key={path => `untracked:${path}`}>
                  {path => (
                    <GitFileRow
                      displayPath={displayRepoFilePath(path())}
                      letter="U"
                      tone="muted"
                      selected={
                        selectedGitFile()?.path === path() &&
                        selectedGitFile()?.kind === "untracked"
                      }
                      rowLabel={`git-untracked-${displayRepoFilePath(path())}`}
                      checkPath={path()}
                      primaryIcon="plus"
                      primaryLabel={`git-stage-${displayRepoFilePath(path())}`}
                      primaryTooltip={tr("git.stageFile")}
                      discardIcon="trash"
                      discardLabel={`git-discard-${displayRepoFilePath(path())}`}
                      discardTooltip={tr("git.deleteUntracked")}
                      disabled={gitActionBusy()}
                      touch={props.stacked}
                      onSelect={() =>
                        select({
                          path: path(),
                          staged: false,
                          kind: "untracked",
                        })
                      }
                      onPrimaryAction={() => void stageGitFiles([path()])}
                      onDiscard={() =>
                        requestDiscardGitFile({ path: path(), kind: "untracked" })
                      }
                    />
                  )}
                </Each>
              </If>
            </View>
          </If>
        </Scroll>

        {/* Cohesive unified rounded Commit Composer box */}
        <View
          style={{
            padding: props.compact ? 8 : 10,
            gap: 6,
            borderTopWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvasSubtle,
            flexShrink: 0,
          }}
        >
          <View
            style={{
              borderRadius: radii.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().border,
              backgroundColor: palette().panelRaised,
              overflow: "hidden",
              ...paintTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ borderColor: palette().borderStrong }}
            focusWithinStyle={{
              borderColor: palette().fieldFocusBorder,
              boxShadow: `0 0 0 3px ${palette().accentSoft}`,
            }}
          >
            <View
              style={{
                paddingHorizontal: 10,
                paddingTop: props.compact ? 7 : 9,
                paddingBottom: props.compact ? 5 : 7,
              }}
            >
              <Input
                value={gitCommitMessage()}
                multiline={!props.compact}
                placeholder={tr("git.commitPlaceholder")}
                accessibilityLabel="git-commit-message"
                style={{
                  minHeight: props.compact ? 22 : 52,
                  maxHeight: 110,
                  color: palette().text,
                  placeholderColor: palette().textMuted,
                  caretColor: palette().accent,
                  fontSize: textSize(12.5),
                  lineHeight: textLineHeight(12.5, 1.46),
                }}
                onChange={event => gitCommitMessage.set(event.value)}
              />
            </View>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 8,
                paddingVertical: 6,
                borderTopWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceSubtle,
              }}
            >
              <View style={{ flex: 1, minWidth: 82 }}>
                <ToggleSwitch
                  value={gitCommitAmend()}
                  onChange={next => setCommitAmend(next)}
                  label={tr("git.amend")}
                  accessibilityLabel="git-commit-amend"
                />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <If
                  when={gitAiGenerating()}
                  else={
                    <IconButton
                      icon="sparkles"
                      size={props.compact ? "xs" : "sm"}
                      disabled={gitAiGenerating() || totalWorkingChanges() === 0}
                      accessibilityLabel="git-generate-message"
                      tooltip={
                        isRemoteWorkspace()
                          ? tr("git.aiCommitLocalOnly")
                          : tr("git.aiCommitMessage")
                      }
                      onPress={() => void generateAiCommitMessage()}
                    />
                  }
                >
                  <View
                    role="button"
                    disabled={true}
                    accessibilityLabel="git-generate-message"
                    accessibilityState={{ disabled: true, busy: true }}
                    tooltip={<TooltipBubble text={tr("git.generatingCommitMessage")} />}
                    style={{
                      width: props.compact ? 24 : 28,
                      height: props.compact ? 24 : 28,
                      flexShrink: 0,
                      borderRadius: radii.xs,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().accentBorder,
                      backgroundColor: palette().accentSoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Spinner size={13} color={palette().accent} />
                  </View>
                </If>
                <Button
                  label={tr("git.commit")}
                  variant="primary"
                  size={props.compact ? "xs" : "sm"}
                  leadingIcon="git-commit"
                  loading={gitActionBusy()}
                  disabled={
                    gitActionBusy() ||
                    !gitCommitMessage().trim() ||
                    ((gitStatus()?.staged.length ?? 0) === 0 && !gitCommitAmend())
                  }
                  tooltip={
                    (gitStatus()?.staged.length ?? 0) === 0 && !gitCommitAmend()
                      ? tr("git.stageToCommitHint")
                      : undefined
                  }
                  accessibilityLabel="git-commit-submit"
                  onPress={() => void commitStagedChanges()}
                />
              </View>
            </View>
          </View>
          <If
            when={
              !props.compact &&
              Boolean(gitCommitMessage().trim()) &&
              (gitStatus()?.staged.length ?? 0) === 0 &&
              !gitCommitAmend()
            }
          >
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(10.5),
                lineHeight: textLineHeight(10.5, 1.35),
                paddingHorizontal: 2,
              }}
            >
              {tr("git.stageToCommitHint")}
            </Text>
          </If>
        </View>
      </View>

      </If>

      <If when={!props.compact}>
        <SplitHandle
          accessibilityLabel="Resize changed files pane"
          onReset={() => gitSidebarWidth.set(260)}
          onDelta={dx =>
            gitSidebarWidth.update(w =>
              Math.max(GIT_SIDEBAR_MIN, Math.min(GIT_SIDEBAR_MAX, w + dx)),
            )
          }
        />
      </If>

      <If when={showDetail()}>
      <View
        style={{
          flex: props.stacked ? 1 : props.compact ? 0.92 : 1,
          minWidth: 0,
          minHeight: props.compact && !props.stacked ? 176 : 0,
          overflow: "hidden",
          flexDirection: "column",
          backgroundColor: palette().canvas,
        }}
      >
        <If when={props.stacked}>
          <View
            style={{
              paddingHorizontal: 4,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <StackBackButton
              label={tr("git.tabChanges")}
              accessibilityLabel="git-stack-back"
              onPress={() => detailOpen.set(false)}
            />
          </View>
        </If>
        <View
          style={{
            minHeight: props.compact ? 34 : 38,
            paddingHorizontal: props.compact ? 10 : 14,
            paddingVertical: props.compact ? 4 : 6,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
          }}
        >
          <If
            when={selectedGitFile()}
            else={
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.35),
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {tr("git.selectFileDiff")}
              </Text>
            }
          >
            {sel => (
              <View
                tooltip={<TooltipBubble text={displayRepoFilePath(sel().path)} />}
                style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Icon name="file-code" size={13.5} color={palette().textMuted} />
                <Text
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: palette().text,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.36),
                    fontWeight: "600",
                    numberOfLines: 1,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {displayRepoFilePath(sel().path)}
                </Text>
                <If when={!diffLoading() && Boolean(selectedGitDiff().trim())}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 }}>
                    <Text
                      style={{
                        color: palette().diffAddRail,
                        fontFamily: fontMono,
                        fontSize: textSize(11),
                        lineHeight: textLineHeight(11, 1.32),
                        fontWeight: "600",
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {`+${formatCount(selectedDiffStats().added)}`}
                    </Text>
                    <Text
                      style={{
                        color: palette().diffDelRail,
                        fontFamily: fontMono,
                        fontSize: textSize(11),
                        lineHeight: textLineHeight(11, 1.32),
                        fontWeight: "600",
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {`-${formatCount(selectedDiffStats().deleted)}`}
                    </Text>
                  </View>
                </If>
                <Text
                  style={{
                    flexShrink: 0,
                    color: palette().textSecondary,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.32),
                  }}
                >
                  {diffBadgeFor(sel().kind).label}
                </Text>
                <Button
                  label={tr("git.editWorkingCopy")}
                  size="xs"
                  variant="ghost"
                  leadingIcon="edit"
                  accessibilityLabel="git-edit-working-copy"
                  onPress={() => openWorkingCopyInFiles(sel().path, Boolean(props.aux))}
                />
                <If when={diffLoading()}>
                  <Spinner size={13} />
                </If>
              </View>
            )}
          </If>
          <If when={!props.compact}>
            <IconButton
              icon={gitDiffLayout() === "split" ? "list" : "panel-right"}
              size="sm"
              active={gitDiffLayout() === "split"}
              tooltip={gitDiffLayout() === "split" ? tr("files.diffUnified") : tr("files.diffSplit")}
              accessibilityLabel={gitDiffLayout() === "split" ? "git-diff-unified" : "git-diff-split"}
              onPress={() => gitDiffLayout.set(gitDiffLayout() === "split" ? "unified" : "split")}
            />
          </If>
        </View>

        <If when={diffLoading()}>
          <View
            style={{
              flex: 1,
              minHeight: 0,
              padding: 20,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Spinner size={14} />
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.35),
              }}
            >
              {tr("git.loadingPatch")}
            </Text>
          </View>
        </If>

        <If when={!diffLoading() && Boolean(selectedGitDiff().trim())}>
          <View style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <DiffView
              patch={selectedGitDiff()}
              language={inferCodeLanguage(selectedGitFile()?.path)}
              layout={props.compact ? "unified" : gitDiffLayout()}
              indicators="bars"
              inline="wordAlt"
              lineNumbers={true}
              fontFamily={fontMono}
              fontSize={textSize(12)}
              lineHeight={textLineHeight(12, 1.55)}
              styles={createDiffViewStyles()}
              style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}
            />
          </View>
        </If>

        <If when={!diffLoading() && !selectedGitDiff().trim()}>
          <View
            style={{
              flex: 1,
              minHeight: 0,
              padding: props.compact ? 14 : 28,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <QuietGitEmpty
              icon="git"
              title={selectedGitFile() ? tr("files.noDiffOutput") : tr("git.noFileSelected")}
              subtitle={
                selectedGitDiffNote()
                  ? localizeHostError(selectedGitDiffNote())
                  : tr("git.selectFileDiffHint")
              }
            />
          </View>
        </If>
      </View>
      </If>
    </View>
  );
}

function BranchesView(props: { compact?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        alignItems: "center",
        backgroundColor: palette().canvas,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: 880,
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          padding: props.compact ? 12 : 20,
          gap: props.compact ? 10 : 14,
        }}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              flex: 1,
              minWidth: 110,
              color: palette().text,
              fontSize: textSize(15),
              lineHeight: textLineHeight(15, 1.28),
              letterSpacing: textTracking(15),
              fontWeight: "600",
              fontVariant: ["tabular-nums"],
            }}
          >
            {tr("git.branchesCount", { count: formatCount(gitBranches().length) })}
          </Text>
          <Button
            label={tr("git.newBranch")}
            variant="primary"
            size={props.compact ? "xs" : "sm"}
            leadingIcon="plus"
            accessibilityLabel="git-new-branch-toggle"
            onPress={() => openCreateBranchModal()}
          />
        </View>

        <InputBox
          size="sm"
          leadingIcon="search"
          clearable={true}
          clearLabel={tr("common.clearFilter")}
          value={branchFilter()}
          placeholder={tr("git.filterBranches")}
          accessibilityLabel="git-filter-branches"
          onChange={value => branchFilter.set(value)}
        />

        <If when={confirmingDeleteBranch()}>
          {branch => (
            <InlineConfirmBar
              danger
              message={tr("git.deleteBranchConfirm", { name: branch() })}
              confirmLabel={tr("git.deleteBranch")}
              cancelLabel={tr("common.cancel")}
              onConfirm={() => void deleteGitBranch(branch())}
              onCancel={() => confirmingDeleteBranch.set(null)}
            />
          )}
        </If>
        <If when={confirmingForceDeleteBranch()}>
          {branch => (
            <InlineConfirmBar
              danger
              message={tr("git.forceDeleteBranchConfirm", { name: branch() })}
              confirmLabel={tr("git.forceDeleteBranch")}
              cancelLabel={tr("common.cancel")}
              onConfirm={() => void deleteGitBranch(branch(), true)}
              onCancel={cancelForceDeleteBranch}
            />
          )}
        </If>

        <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ gap: 16, paddingBottom: 18 }}>
          <View style={{ gap: 8 }}>
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.35),
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
                paddingHorizontal: 2,
              }}
            >
              {tr("git.localCount", { count: formatCount(localBranches().length) })}
            </Text>
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
              <If when={localBranches().length === 0}>
                <View style={{ padding: 14 }}>
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.4),
                    }}
                  >
                    {tr("git.noLocalBranches")}
                  </Text>
                </View>
              </If>
              <Each of={localBranches()} key={branch => `local:${branch.name}`}>
                {(branch, index) => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: props.compact ? 8 : 10,
                      paddingHorizontal: props.compact ? 12 : 16,
                      paddingVertical: props.compact ? 9 : 11,
                      borderBottomWidth: index() < localBranches().length - 1 ? 1 : 0,
                      borderColor: palette().borderSubtle,
                      backgroundColor: branch().current
                        ? palette().surfaceSubtle
                        : "transparent",
                      ...paintTransition(MOTION_DURATION.fast),
                    }}
                    hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
                  >
                    <Icon
                      name="git-branch"
                      size={14}
                      color={branch().current ? palette().accent : palette().textMuted}
                    />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View
                        tooltip={<TooltipBubble text={branch().name} />}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          minWidth: 0,
                          flexWrap: "wrap",
                        }}
                      >
                        <Text
                          style={{
                            flexShrink: 1,
                            minWidth: 0,
                            color: palette().text,
                            fontSize: textSize(13.5),
                            lineHeight: textLineHeight(13.5, 1.35),
                            fontWeight: "600",
                            numberOfLines: 1,
                            textOverflow: "ellipsis-middle",
                          }}
                        >
                          {branch().name}
                        </Text>
                        <QuietStatusText
                          parts={[
                            branch().current && tr("common.current"),
                            branch().ahead > 0 && `↑${formatCount(branch().ahead)}`,
                            branch().behind > 0 && `↓${formatCount(branch().behind)}`,
                          ]}
                        />
                      </View>
                      <Text
                        style={{
                          color: palette().textMuted,
                          fontSize: textSize(11),
                          lineHeight: textLineHeight(11, 1.36),
                          fontFamily: fontMono,
                          fontVariant: ["tabular-nums"],
                          numberOfLines: 1,
                          textOverflow: "ellipsis-middle",
                        }}
                      >
                        {[
                          branch().upstream || tr("git.localOnly"),
                          branch().lastCommit ? branch().lastCommit?.slice(0, 7) : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                    <If when={!branch().current}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <Button
                          label={tr("git.checkout")}
                          size="xs"
                          variant="secondary"
                          disabled={gitActionBusy()}
                          accessibilityLabel={`git-checkout-${branch().name}`}
                          onPress={() => void checkoutGitBranch(branch().name)}
                        />
                        <IconButton
                          icon="trash"
                          size="xs"
                          tone="danger"
                          disabled={gitActionBusy()}
                          accessibilityLabel={`git-delete-branch-${branch().name}`}
                          tooltip={tr("git.deleteBranch")}
                          onPress={() => confirmingDeleteBranch.set(branch().name)}
                        />
                      </View>
                    </If>
                  </View>
                )}
              </Each>
            </View>
          </View>

          <If when={remoteBranches().length > 0}>
            <View style={{ gap: 8 }}>
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(11.5),
                  lineHeight: textLineHeight(11.5, 1.35),
                  fontWeight: "600",
                  fontVariant: ["tabular-nums"],
                  paddingHorizontal: 2,
                }}
              >
                {tr("git.remoteCount", { count: formatCount(remoteBranches().length) })}
              </Text>
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
                <Each of={remoteBranches()} key={branch => `remote:${branch.name}`}>
                  {(branch, index) => (
                    <View
                      tooltip={<TooltipBubble text={branch().name} />}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: props.compact ? 8 : 10,
                        paddingHorizontal: props.compact ? 12 : 16,
                        paddingVertical: props.compact ? 8 : 10,
                        borderBottomWidth: index() < remoteBranches().length - 1 ? 1 : 0,
                        borderColor: palette().borderSubtle,
                      }}
                    >
                      <Icon name="network" size={13} color={palette().textMuted} />
                      <Text
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: palette().textSecondary,
                          fontSize: textSize(12.5),
                          lineHeight: textLineHeight(12.5, 1.36),
                          numberOfLines: 1,
                          textOverflow: "ellipsis-middle",
                        }}
                      >
                        {branch().name}
                      </Text>
                      <QuietStatusText parts={[tr("common.remote")]} />
                      <Button
                        label={tr("git.checkoutAsLocal")}
                        size="xs"
                        variant="ghost"
                        disabled={gitActionBusy()}
                        tooltip={tr("git.checkoutAsLocalHint", { name: localNameForRemoteBranch(branch().name) })}
                        accessibilityLabel={`git-checkout-remote-${branch().name}`}
                        onPress={() => void checkoutGitBranch(branch().name)}
                      />
                    </View>
                  )}
                </Each>
              </View>
            </View>
          </If>
        </Scroll>
      </View>
    </View>
  );
}

function CommitGraphRail(props: {
  commit: GitCommitRow;
  index: number;
  total: number;
  railWidth: number;
}) {
  return (
    <Canvas
      style={{
        width: props.railWidth,
        alignSelf: "stretch",
        minHeight: HISTORY_ROW_HEIGHT,
        flexShrink: 0,
        pointerEvents: "none",
      }}
      draw={(cx, size) => {
        if (size.width <= 0 || size.height <= 0) return;
        const p = palette();
        const node = gitGraphByHash()[props.commit.hash];
        const lane = node?.lane ?? 0;
        const passing = node?.passingLanes ?? [];
        const merging = node?.mergingLanes ?? [];
        const forking = node?.forkingLanes ?? [];
        const isHead = Boolean(node?.refs?.some(r => r.isHead || r.isCurrent));
        const isFirst = props.index === 0;
        const isLast = props.index >= props.total - 1;
        const hasParents = props.commit.parents.length > 0;

        const xOf = (l: number) => LANE_PAD + Math.min(Math.max(0, l), MAX_DRAWN_LANES - 1) * LANE_STEP;
        const nodeX = xOf(lane);
        const cy = size.height / 2;

        cx.save();
        cx.lineCap = "round";
        cx.lineJoin = "round";
        cx.lineWidth = 2;

        // 1. Passing lanes continuing uninterrupted top-to-bottom.
        for (const pLane of passing) {
          const px = xOf(pLane);
          cx.strokeStyle = laneColor(pLane);
          cx.beginPath();
          cx.moveTo(px, 0);
          cx.lineTo(px, size.height);
          cx.stroke();
        }

        // 2. Primary commit vertical spine segments.
        cx.strokeStyle = laneColor(lane);
        if (!isFirst) {
          cx.beginPath();
          cx.moveTo(nodeX, 0);
          cx.lineTo(nodeX, cy);
          cx.stroke();
        }
        if (!isLast && (hasParents || !node)) {
          cx.beginPath();
          cx.moveTo(nodeX, cy);
          cx.lineTo(nodeX, size.height);
          cx.stroke();
        }

        // 3. Merging branches curving upward from below into this commit node.
        for (const mLane of merging) {
          const mx = xOf(mLane);
          cx.strokeStyle = laneColor(mLane);
          cx.beginPath();
          cx.moveTo(mx, size.height);
          cx.bezierCurveTo(
            mx,
            cy + size.height * 0.28,
            nodeX,
            cy + size.height * 0.22,
            nodeX,
            cy,
          );
          cx.stroke();
        }

        // 4. Forking branches curving upward from this commit node into upper lanes.
        for (const fLane of forking) {
          const fx = xOf(fLane);
          cx.strokeStyle = laneColor(fLane);
          cx.beginPath();
          cx.moveTo(nodeX, cy);
          cx.bezierCurveTo(
            nodeX,
            cy - size.height * 0.22,
            fx,
            cy - size.height * 0.28,
            fx,
            0,
          );
          cx.stroke();
        }

        // 5. Commit node dot with crisp knockout halo matching lifted panelRaised card.
        const dotColor = laneColor(lane);
        cx.fillStyle = p.panelRaised;
        cx.beginPath();
        cx.arc(nodeX, cy, isHead ? 6.5 : 5.5, 0, Math.PI * 2);
        cx.fill();

        if (isHead) {
          cx.strokeStyle = dotColor;
          cx.lineWidth = 1.5;
          cx.beginPath();
          cx.arc(nodeX, cy, 6.2, 0, Math.PI * 2);
          cx.stroke();
        }

        cx.fillStyle = dotColor;
        cx.beginPath();
        cx.arc(nodeX, cy, isHead ? 3.8 : 3.6, 0, Math.PI * 2);
        cx.fill();

        cx.restore();
      }}
    />
  );
}

function commitTimeMs(date: string): number | undefined {
  if (!date) return undefined;
  const parsed = Date.parse(date.includes("T") ? date : date.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function commitRelativeDate(date: string): string {
  const ms = commitTimeMs(date);
  return ms === undefined ? date : formatRelativeTime(ms);
}

const filteredCommits = computed<GitCommitRow[]>(() => {
  const needle = historyFilter().trim().toLowerCase();
  if (!needle) return gitCommits();
  return gitCommits().filter(
    commit =>
      commit.message.toLowerCase().includes(needle) ||
      commit.author.toLowerCase().includes(needle) ||
      commit.authorEmail.toLowerCase().includes(needle) ||
      commit.hash.startsWith(needle),
  );
});

function changedFileLetter(status: string): { letter: string; tone: "danger" | "success" | "warning" | "muted" } {
  const value = status.toLowerCase();
  if (value.startsWith("add")) return { letter: "A", tone: "success" };
  if (value.startsWith("del")) return { letter: "D", tone: "danger" };
  if (value.startsWith("ren")) return { letter: "R", tone: "warning" };
  if (value.startsWith("cop")) return { letter: "C", tone: "warning" };
  return { letter: "M", tone: "warning" };
}

const resetMenuOpen = signal(false);
const resetMenuAnchor = signal<ViewRef | null>(null);

function HistoryRow(props: { commit: GitCommitRow; index: number; total: number; railWidth: number; compact?: boolean }) {
  const selected = () => selectedCommit()?.hash === props.commit.hash;
  const subject = () => props.commit.message.split("\n")[0] || tr("git.noCommitMessage");
  return (
    <View
      role="button"
      accessibilityLabel={`git-commit-row-${props.commit.shortHash}`}
      accessibilityState={{ selected: selected() }}
      tooltip={<TooltipBubble text={`${subject()}\n${props.commit.author} · ${props.commit.date}`} />}
      onPress={() => void selectCommit(props.commit)}
      style={{
        flexDirection: "row",
        alignItems: "stretch",
        height: HISTORY_ROW_HEIGHT,
        paddingRight: props.compact ? 10 : 14,
        backgroundColor: selected() ? palette().accentSoft : "transparent",
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: selected() ? palette().accentSoft : palette().panelHover }}
      focusVisibleStyle={rowFocusRing()}
    >
      <CommitGraphRail commit={props.commit} index={props.index} total={props.total} railWidth={props.railWidth} />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 4 }}>
        <Text
          style={{
            flexShrink: 1,
            minWidth: 0,
            color: palette().text,
            fontSize: textSize(13),
            fontWeight: selected() ? "600" : "500",
            lineHeight: textLineHeight(13, 1.3),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {subject()}
        </Text>
        <QuietStatusText
          parts={(gitGraphByHash()[props.commit.hash]?.refs ?? []).map(refItem => refItem.name)}
        />
        <View style={{ flex: 1, minWidth: 0 }} />
        <If when={!props.compact}>
          <Text
            style={{
              maxWidth: 140,
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.3),
              numberOfLines: 1,
              textOverflow: "ellipsis",
              flexShrink: 0,
            }}
          >
            {props.commit.author}
          </Text>
        </If>
        <Text
          style={{
            minWidth: props.compact ? 0 : 76,
            color: palette().textMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.3),
            fontVariant: ["tabular-nums"],
            textAlign: "right",
            numberOfLines: 1,
            flexShrink: 0,
          }}
        >
          {commitRelativeDate(props.commit.date)}
        </Text>
        <Text
          style={{
            width: 58,
            color: palette().textSecondary,
            fontFamily: fontMono,
            fontSize: textSize(11),
            lineHeight: textLineHeight(11, 1.3),
            fontVariant: ["tabular-nums"],
            textAlign: "right",
            flexShrink: 0,
          }}
        >
          {props.commit.shortHash}
        </Text>
      </View>
    </View>
  );
}

/** The selected commit: message, identity, actions, its files and the diff of one. */
function CommitDetailsPane(props: { compact?: boolean; stacked?: boolean }) {
  return (
    <If when={selectedCommit()}>
      {commit => (
        <View
          accessibilityLabel="git-commit-details"
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            flexDirection: "column",
            borderLeftWidth: props.compact ? 0 : 1,
            borderTopWidth: props.compact && !props.stacked ? 1 : 0,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
          }}
        >
          <If when={props.stacked}>
            <View
              style={{
                paddingHorizontal: 4,
                borderBottomWidth: 1,
                borderColor: palette().borderSubtle,
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <StackBackButton
                label={tr("git.tabHistory")}
                accessibilityLabel="git-stack-back"
                onPress={clearSelectedCommit}
              />
            </View>
          </If>
          <View style={{ padding: props.compact ? 10 : 14, gap: 6, borderBottomWidth: 1, borderColor: palette().borderSubtle }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().text,
                  fontSize: textSize(14),
                  fontWeight: "600",
                  lineHeight: textLineHeight(14, 1.35),
                  userSelect: "text",
                }}
              >
                {commit().message.split("\n")[0] || tr("git.noCommitMessage")}
              </Text>
              <If when={!props.stacked}>
                <IconButton
                  icon="close"
                  size="xs"
                  iconSize={11}
                  tooltip={tr("common.close")}
                  accessibilityLabel="git-commit-details-close"
                  onPress={clearSelectedCommit}
                />
              </If>
            </View>
            <If when={commit().message.split("\n").slice(1).join("\n").trim()}>
              {body => (
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.5),
                    userSelect: "text",
                  }}
                >
                  {body()}
                </Text>
              )}
            </If>
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
                numberOfLines: 2,
              }}
            >
              {`${commit().author}${commit().authorEmail ? ` <${commit().authorEmail}>` : ""} · ${commit().date}`}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <Text
                style={{
                  color: palette().textSecondary,
                  fontFamily: fontMono,
                  fontSize: textSize(11),
                  lineHeight: textLineHeight(11, 1.3),
                  userSelect: "text",
                }}
              >
                {commit().hash.slice(0, 12)}
              </Text>
              <Button
                label={tr("git.copyHash")}
                size="xs"
                variant="ghost"
                leadingIcon="copy"
                accessibilityLabel="git-commit-copy-hash"
                onPress={() =>
                  void Clipboard.writeText(commit().hash).then(
                    () => pushToast(tr("git.hashCopied"), "success"),
                    error => pushToast(error instanceof Error ? error.message : String(error), "error"),
                  )
                }
              />
              <View style={{ flex: 1 }} />
              <Button
                label={tr("git.cherryPick")}
                size="xs"
                variant="secondary"
                disabled={gitActionBusy()}
                accessibilityLabel="git-commit-cherry-pick"
                onPress={() => void cherryPickCommit(commit())}
              />
              <View ref={el => resetMenuAnchor.set(el)}>
                <Button
                  label={tr("git.resetTo")}
                  size="xs"
                  variant="secondary"
                  trailingIcon="chevron-down"
                  disabled={gitActionBusy()}
                  accessibilityLabel="git-commit-reset"
                  onPress={() => resetMenuOpen.set(!resetMenuOpen())}
                />
              </View>
            </View>
            <DropdownMenu
              open={resetMenuOpen()}
              anchor={resetMenuAnchor()}
              align="end"
              minWidth={220}
              items={(["soft", "mixed", "hard"] as const).map(mode => ({
                id: `reset-${mode}`,
                label: tr(mode === "soft" ? "git.resetSoft" : mode === "mixed" ? "git.resetMixed" : "git.resetHard"),
                danger: mode === "hard",
                accessibilityLabel: `git-commit-reset-${mode}`,
                onSelect: () => requestCommitReset(commit().hash, mode),
              }))}
              onClose={() => resetMenuOpen.set(false)}
            />
            <If when={confirmingCommitReset()}>
              {pending => (
                <InlineConfirmBar
                  danger={pending().mode === "hard"}
                  message={tr(pending().mode === "hard" ? "git.resetHardConfirm" : "git.resetConfirm", {
                    mode: pending().mode,
                    hash: pending().hash.slice(0, 7),
                  })}
                  confirmLabel={tr("git.resetConfirmAction")}
                  cancelLabel={tr("common.cancel")}
                  onConfirm={() => void confirmCommitReset()}
                  onCancel={cancelCommitReset}
                />
              )}
            </If>
          </View>
          <View style={{ flex: 1, minHeight: 0, flexDirection: props.compact ? "column" : "column" }}>
            <Scroll style={{ maxHeight: props.compact ? 140 : 200, minHeight: 0, flexShrink: 0 }}>
              <View style={{ padding: 6, gap: 1 }}>
                <If when={commitFilesLoading()}>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center", padding: 6 }}>
                    <Spinner size={12} />
                    <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3) }}>
                      {tr("common.loading")}
                    </Text>
                  </View>
                </If>
                <If when={commitFilesNote()}>
                  {note => <InlineBanner tone="warning" message={localizeHostError(note())} />}
                </If>
                <Each of={commitFiles()} key={file => file.path}>
                  {file => (
                    <View
                      role="button"
                      accessibilityLabel={`git-commit-file-${displayRepoFilePath(file().path)}`}
                      accessibilityState={{ selected: selectedCommitFile() === file().path }}
                      onPress={() => void selectCommitFile(file().path)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 7,
                        height: 26,
                        paddingHorizontal: 8,
                        borderRadius: radii.xs,
                        backgroundColor: selectedCommitFile() === file().path ? palette().accentSoft : "transparent",
                        cursor: "pointer",
                      }}
                      hoverStyle={{
                        backgroundColor: selectedCommitFile() === file().path ? palette().accentSoft : palette().panelHover,
                      }}
                    >
                      <Text
                        style={{
                          width: 14,
                          color: fileLetterColor(changedFileLetter(file().status).tone),
                          fontFamily: fontMono,
                          fontSize: textSize(11),
                          fontWeight: "700",
                          lineHeight: textLineHeight(11, 1.2),
                          textAlign: "center",
                        }}
                      >
                        {changedFileLetter(file().status).letter}
                      </Text>
                      <Text
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: palette().text,
                          fontSize: textSize(12),
                          lineHeight: textLineHeight(12, 1.3),
                          numberOfLines: 1,
                          textOverflow: "ellipsis-start",
                        }}
                      >
                        {displayRepoFilePath(file().path)}
                      </Text>
                    </View>
                  )}
                </Each>
              </View>
            </Scroll>
            <View style={{ flex: 1, minHeight: 0, minWidth: 0, borderTopWidth: 1, borderColor: palette().borderSubtle }}>
              <If
                when={!commitFileDiffLoading() && commitFileDiff().trim()}
                else={
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
                    <If when={commitFileDiffLoading()} else={
                      <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
                        {selectedCommitFile() ? tr("files.noDiffOutput") : tr("git.selectCommitFile")}
                      </Text>
                    }>
                      <Spinner size={14} />
                    </If>
                  </View>
                }
              >
                <DiffView
                  patch={commitFileDiff()}
                  language={inferCodeLanguage(selectedCommitFile() ?? undefined)}
                  layout="unified"
                  indicators="bars"
                  inline="wordAlt"
                  lineNumbers={true}
                  fontFamily={fontMono}
                  fontSize={textSize(12)}
                  lineHeight={textLineHeight(12, 1.55)}
                  styles={createDiffViewStyles()}
                  style={{ flex: 1, minWidth: 0, minHeight: 0 }}
                />
              </If>
            </View>
          </View>
        </View>
      )}
    </If>
  );
}

function HistoryView(props: { compact?: boolean; stacked?: boolean }) {
  const graphRailWidth = computed(() => {
    const laneCount = Math.max(1, Math.min(MAX_DRAWN_LANES, (gitGraphMaxLane() || 0) + 1));
    return LANE_PAD * 2 + Math.max(0, laneCount - 1) * LANE_STEP;
  });

  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        flexDirection: props.compact ? "column" : "row",
        backgroundColor: palette().canvas,
      }}
    >
      {/* Stacked: a selected commit is pushed over the list (back clears the selection). */}
      <If when={!props.stacked || !selectedCommit()}>
      <View
        style={{
          flex: selectedCommit() && !props.compact ? 1.25 : 1,
          minHeight: 0,
          minWidth: 0,
          flexDirection: "column",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: props.compact ? 10 : 14,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
          }}
        >
          <Icon name="history" size={14} color={palette().textSecondary} />
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.3),
              fontWeight: "600",
              flexShrink: 0,
            }}
          >
            {tr("git.commitHistory")}
          </Text>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.3),
              fontVariant: ["tabular-nums"],
              flexShrink: 0,
            }}
          >
            {formatPlural(gitCommits().length, "format.commitOne", "format.commitOther")}
          </Text>
          <View style={{ flex: 1, minWidth: 0, maxWidth: 280, marginLeft: "auto" }}>
            <InputBox
              size="sm"
              leadingIcon="search"
              clearable={true}
              clearLabel={tr("common.clearFilter")}
              value={historyFilter()}
              placeholder={tr("git.filterHistory")}
              accessibilityLabel="git-filter-history"
              onChange={value => historyFilter.set(value)}
            />
          </View>
        </View>

        <If when={gitGraphNote()}>
          {note => (
            <View style={{ paddingHorizontal: props.compact ? 10 : 14, paddingTop: 8 }}>
              <InlineBanner tone={isRemoteGraphNote() ? "info" : "warning"} message={localizeHostError(note())} />
            </View>
          )}
        </If>

        <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ paddingVertical: 4, paddingBottom: 16 }}>
          <If when={gitCommits().length === 0}>
            <View style={{ padding: 20 }}>
              <EmptyStateCard icon="history" title={tr("git.noCommitsTitle")} subtitle={tr("git.noCommitsSubtitle")} />
            </View>
          </If>
          <If when={gitCommits().length > 0 && filteredCommits().length === 0}>
            <Text
              style={{
                padding: 16,
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
                textAlign: "center",
              }}
            >
              {tr("git.noHistoryMatches")}
            </Text>
          </If>
          <Each of={filteredCommits()} key={commit => commit.hash || commit.shortHash}>
            {(commit, index) => (
              <HistoryRow
                commit={commit()}
                index={historyFilter().trim() ? 0 : index()}
                total={historyFilter().trim() ? 1 : filteredCommits().length}
                railWidth={graphRailWidth()}
                compact={props.compact}
              />
            )}
          </Each>
          <If when={gitHistoryHasMore() && !historyFilter().trim()}>
            <View style={{ alignItems: "center", paddingTop: 8 }}>
              <Button
                label={gitHistoryLoadingMore() ? tr("common.loading") : tr("git.loadMoreCommits")}
                size="xs"
                variant="ghost"
                loading={gitHistoryLoadingMore()}
                accessibilityLabel="git-history-load-more"
                onPress={() => void loadMoreGitHistory()}
              />
            </View>
          </If>
        </Scroll>
      </View>
      </If>
      <CommitDetailsPane compact={props.compact} stacked={props.stacked} />
    </View>
  );
}

function WorktreesView(props: { compact?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        alignItems: "center",
        backgroundColor: palette().canvas,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: 880,
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          padding: props.compact ? 12 : 20,
          gap: props.compact ? 10 : 12,
        }}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 140, gap: 2 }}>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(15),
                lineHeight: textLineHeight(15, 1.28),
                letterSpacing: textTracking(15),
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
              }}
            >
              {tr("git.worktreesCount", { count: formatCount(gitWorktrees().length) })}
            </Text>
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.4),
              }}
            >
              {tr("git.worktreesSubtitle")}
            </Text>
          </View>
          <Button
            label={tr("git.addWorktree")}
            variant="primary"
            size={props.compact ? "xs" : "sm"}
            leadingIcon="folder-plus"
            disabled={activeWorkspace()?.workspaceKind === "remote" || gitActionBusy()}
            accessibilityLabel="git-add-worktree-open"
            onPress={() => openAddWorktreeModal()}
          />
        </View>

        <If when={gitWorktreeNote()}>
          {note => (
            <InlineBanner
              tone={isRemoteWorktreeNote() ? "info" : "warning"}
              message={localizeHostError(note())}
            />
          )}
        </If>

        <If when={confirmingRemoveWorktree()}>
          {worktreePath => (
            <InlineConfirmBar
              danger
              message={tr("git.removeWorktreeConfirm", { path: worktreePath() })}
              confirmLabel={tr("git.removeWorktree")}
              cancelLabel={tr("common.cancel")}
              onConfirm={() => void removeGitWorktree(worktreePath())}
              onCancel={() => cancelRemoveWorktree()}
            />
          )}
        </If>

        <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ paddingBottom: 16 }}>
          <If when={gitWorktrees().length === 0 && !gitWorktreeNote()}>
            <EmptyStateCard
              icon="folder-plus"
              title={tr("git.noWorktreesTitle")}
              subtitle={tr("git.noWorktreesSubtitle")}
            />
          </If>

          <If when={gitWorktrees().length > 0}>
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
              <Each of={gitWorktrees()} key={wt => wt.path}>
                {(wt, index) => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: props.compact ? 8 : 10,
                      paddingHorizontal: props.compact ? 12 : 16,
                      paddingVertical: props.compact ? 10 : 12,
                      borderBottomWidth: index() < gitWorktrees().length - 1 ? 1 : 0,
                      borderColor: palette().borderSubtle,
                      backgroundColor: wt().isMain
                        ? palette().surfaceSubtle
                        : "transparent",
                    }}
                  >
                    <Icon
                      name="git-branch"
                      size={15}
                      color={wt().isMain ? palette().accent : palette().textMuted}
                    />
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          minWidth: 0,
                          flexWrap: "wrap",
                        }}
                      >
                        <Text
                          style={{
                            flexShrink: 1,
                            minWidth: 0,
                            color: palette().text,
                            fontSize: textSize(13.5),
                            lineHeight: textLineHeight(13.5, 1.35),
                            fontWeight: "600",
                            numberOfLines: 1,
                            textOverflow: "ellipsis-middle",
                          }}
                        >
                          {wt().branch || tr("git.detachedHead")}
                        </Text>
                        <QuietStatusText
                          parts={[
                            wt().isMain && tr("git.worktreeMain"),
                            wt().isLocked && tr("git.worktreeLocked"),
                            wt().isPrunable && tr("git.worktreePrunable"),
                            wt().head ? wt().head.slice(0, 7) : null,
                          ]}
                        />
                      </View>
                      <View tooltip={<TooltipBubble text={wt().path} />} style={{ minWidth: 0 }}>
                        <Text
                          style={{
                            color: palette().textMuted,
                            fontSize: textSize(11),
                            lineHeight: textLineHeight(11, 1.36),
                            fontFamily: fontMono,
                            numberOfLines: 1,
                            textOverflow: "ellipsis-middle",
                          }}
                        >
                          {wt().path}
                        </Text>
                      </View>
                    </View>

                    <If when={!wt().isMain}>
                      <IconButton
                        icon="trash"
                        size="xs"
                        tone="danger"
                        disabled={gitActionBusy() || activeWorkspace()?.workspaceKind === "remote"}
                        accessibilityLabel={`git-remove-worktree-${wt().path}`}
                        tooltip={tr("git.removeWorktree")}
                        onPress={() => requestRemoveWorktree(wt().path)}
                      />
                    </If>
                  </View>
                )}
              </Each>
            </View>
          </If>
        </Scroll>
      </View>
    </View>
  );
}

function GitBranchControls(props: { compact?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 }}>
      <If when={gitRepoState() === "trusted"}>
        <SelectDropdown
          options={branchSelectOptions()}
          value={gitStatus()?.current_branch ?? ""}
          placeholder={tr("git.branchMenu")}
          size="sm"
          searchable={!props.compact}
          searchPlaceholder={tr("git.filterBranches")}
          disabled={gitActionBusy() || branchSelectOptions().length === 0}
          minWidth={props.compact ? 96 : 152}
          maxWidth={props.compact ? 168 : 240}
          accessibilityLabel="git-branch-switcher"
          onChange={branch => {
            if (branch && branch !== gitStatus()?.current_branch) {
              void checkoutGitBranch(branch);
            }
          }}
        />
      </If>
      <If when={gitRepoState() !== "trusted"}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Icon name="git-branch" size={14} color={palette().textMuted} />
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.3),
              letterSpacing: textTracking(13),
              fontWeight: "600",
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {tr("git.title")}
          </Text>
        </View>
      </If>

      <QuietStatusText
        parts={[
          (gitStatus()?.ahead ?? 0) > 0 && `↑${formatCount(gitStatus()?.ahead ?? 0)}`,
          (gitStatus()?.behind ?? 0) > 0 && `↓${formatCount(gitStatus()?.behind ?? 0)}`,
        ]}
      />

      <If when={gitRepoState() === "trusted"}>
        <IconButton
          icon="plus"
          size="sm"
          accessibilityLabel="git-new-branch-toolbar"
          tooltip={tr("git.newBranch")}
          disabled={gitActionBusy()}
          onPress={() => openCreateBranchModal()}
        />
      </If>
    </View>
  );
}

function GitSyncActions(props: { compact?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: props.compact ? 2 : 4, flexShrink: 0 }}>
      <If when={gitBusy() || gitActionBusy()}>
        <View style={{ paddingRight: 4 }}>
          <Spinner size={13} />
        </View>
      </If>
      <IconButton
        icon="download"
        size="sm"
        accessibilityLabel="git-pull"
        tooltip={tr("git.pull")}
        disabled={gitRepoState() !== "trusted" || gitActionBusy()}
        onPress={() => void pullCurrentBranch()}
      />
      <IconButton
        icon="upload"
        size="sm"
        accessibilityLabel="git-push"
        tooltip={tr("git.push")}
        disabled={gitRepoState() !== "trusted" || gitActionBusy()}
        onPress={() => void pushCurrentBranch()}
      />
      <IconButton
        icon="refresh"
        size="sm"
        accessibilityLabel="git-refresh"
        tooltip={tr("git.refreshRepo")}
        disabled={gitBusy() || gitActionBusy()}
        onPress={() => void refreshGitWorkbench()}
      />
    </View>
  );
}

/**
 * The checkout git refused because local changes would be overwritten: name
 * the files and offer Commit & switch, as the desktop's branch switcher does.
 */
function BranchSwitchBlockerBar(props: { compact?: boolean }) {
  return (
    <If when={branchSwitchBlocker()}>
      {blocker => (
        <View
          role="alert"
          accessibilityLabel="git-switch-blocker"
          style={{
            gap: 8,
            paddingHorizontal: props.compact ? 10 : 14,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderColor: palette().warningBorder,
            backgroundColor: palette().warningSoft,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="warning" size={14} color={palette().warning} />
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().text,
                fontSize: textSize(12),
                fontWeight: "600",
                lineHeight: textLineHeight(12, 1.38),
              }}
            >
              {blocker().kind === "untracked"
                ? tr("git.switchBlockedUntracked", { branch: blocker().targetBranch })
                : tr("git.switchBlocked", { branch: blocker().targetBranch })}
            </Text>
            <IconButton
              icon="close"
              size="xs"
              iconSize={11}
              tooltip={tr("common.dismissNotice")}
              accessibilityLabel="git-switch-blocker-dismiss"
              onPress={dismissBranchSwitchBlocker}
            />
          </View>
          <Text
            style={{
              color: palette().textSecondary,
              fontFamily: fontMono,
              fontSize: textSize(11),
              lineHeight: textLineHeight(11, 1.45),
              numberOfLines: 4,
            }}
          >
            {blocker().files.map(file => displayRepoFilePath(file)).join("\n")}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <InputBox
              size="sm"
              value={switchCommitMessage()}
              placeholder={tr("git.commitPlaceholder")}
              accessibilityLabel="git-switch-commit-message"
              style={{ flex: 1, minWidth: 140 }}
              onChange={value => switchCommitMessage.set(value)}
              onSubmit={() => void commitAndSwitchBranch()}
            />
            <Button
              label={tr("git.commitAndSwitch")}
              variant="primary"
              size="xs"
              leadingIcon="git-commit"
              loading={gitActionBusy()}
              disabled={gitActionBusy() || !switchCommitMessage().trim()}
              accessibilityLabel="git-commit-and-switch"
              onPress={() => void commitAndSwitchBranch()}
            />
          </View>
        </View>
      )}
    </If>
  );
}

export function GitScene(props: GitSceneProps = {}) {
  const sceneWidth = createSceneWidth();
  // Narrow: the aux pane, or a scene under 600 pt wide (stacked list -> detail).
  const narrow = () => Boolean(props.compact) || sceneWidth.stacked();
  effect(() => {
    const ws = activeWorkspace();
    const peer = peerScope();
    void peer;
    // Only the workspace and the device re-run this; the probe's own state does not.
    untracked(() => void syncGitWorkspace(ws));
  });
  // Live status while the scene is on screen: the host publishes every status
  // change (`git://status-changed`); the explorer watch it registers feeds the
  // working-tree side. Nothing here polls.
  effect(() => {
    if (!activeWorkspace()) return;
    untracked(() => ensureWorkspaceWatch());
  });
  cleanup(holdGitStatusWatch());

  return (
    <View
      onLayout={sceneWidth.onLayout}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        flexDirection: "column",
        backgroundColor: palette().canvas,
      }}
    >
      <RemoteWorkspaceStatusBanner compact={props.compact} />
      <BranchSwitchBlockerBar compact={narrow()} />
      <If
        when={narrow()}
        else={
          <View
            style={{
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 14,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().canvas,
            }}
          >
            <GitBranchControls />
            <ToolbarDivider />
            <View style={{ flex: 1, minWidth: 0 }}>
              <GitUnderlineTabs
                options={gitTabs()}
                value={gitTab()}
                onChange={nextTab => gitTab.set(nextTab)}
              />
            </View>
            <GitSyncActions />
          </View>
        }
      >
        {/* Narrow (aux pane or stacked): a branch/sync strip over hairline-underline tabs */}
        <View
          style={{
            flexDirection: "column",
            alignItems: "stretch",
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
          }}
        >
          <View
            style={{
              minHeight: sceneWidth.stacked() ? WORKBENCH_TOUCH_MIN : 36,
              paddingHorizontal: 8,
              paddingTop: 5,
              paddingBottom: 3,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              minWidth: 0,
            }}
          >
            <GitBranchControls compact />
            <GitSyncActions compact />
          </View>
          <GitUnderlineTabs
            options={compactGitTabs()}
            value={gitTab()}
            onChange={nextTab => gitTab.set(nextTab)}
          />
        </View>
      </If>

      <If
        when={
          Boolean(gitError()) &&
          !newBranchOpen() &&
          !addWorktreeModalOpen() &&
          gitRepoState() !== "error"
        }
      >
        <View
          style={{
            paddingHorizontal:
              gitRepoState() === "trusted" && gitTab() === "working"
                ? props.compact
                  ? 8
                  : 14
                : props.compact
                  ? 12
                  : 20,
            paddingTop: 8,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth:
                gitRepoState() !== "trusted"
                  ? 560
                  : gitTab() === "working"
                    ? undefined
                    : 880,
              alignSelf: "center",
            }}
          >
            <InlineBanner
              tone="danger"
              message={localizeHostError(gitError())}
              onDismiss={() => gitError.set("")}
            />
          </View>
        </View>
      </If>

      <If when={Boolean(gitLiveNotice()) && gitRepoState() === "trusted"}>
        <View style={{ paddingHorizontal: props.compact ? 8 : 14, paddingTop: 8 }}>
          <InlineBanner
            tone="info"
            message={gitLiveNotice()}
            actionLabel={tr("git.refreshRepo")}
            onAction={() => void refreshGitWorkbench()}
          />
        </View>
      </If>

      <If when={gitNotice() && !gitError()}>
        <View
          style={{
            paddingHorizontal:
              gitRepoState() === "trusted" && gitTab() === "working"
                ? props.compact
                  ? 8
                  : 14
                : props.compact
                  ? 12
                  : 20,
            paddingTop: 8,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth:
                gitRepoState() !== "trusted"
                  ? 560
                  : gitTab() === "working"
                    ? undefined
                    : 880,
              alignSelf: "center",
            }}
          >
            <InlineBanner
              tone="success"
              message={localizeHostError(gitNotice())}
              onDismiss={() => gitNotice.set("")}
            />
          </View>
        </View>
      </If>

      <If when={!activeWorkspace()}>
        <View
          style={{
            flex: 1,
            minHeight: 0,
            alignItems: "center",
            justifyContent: "center",
            padding: props.compact ? 16 : 28,
          }}
        >
          <EmptyStateCard
            icon="git-branch"
            title={tr("git.noWorkspaceTitle")}
            subtitle={tr("git.noWorkspaceSubtitle")}
          />
        </View>
      </If>

      <If when={Boolean(activeWorkspace()) && gitRepoState() === "probing"}>
        <View style={{ flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", gap: 10 }}>
          <Spinner size={20} />
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.35),
            }}
          >
            {tr("git.inspecting")}
          </Text>
        </View>
      </If>

      <If when={Boolean(activeWorkspace()) && gitRepoState() === "error"}>
        <Scroll
          style={{ flex: 1, minHeight: 0 }}
          contentStyle={{
            flexGrow: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: props.compact ? 14 : 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 520 }}>
            <EmptyStateCard
              icon="alert-circle"
              title={tr("git.inspectErrorTitle")}
              subtitle={gitError() ? localizeHostError(gitError()) : tr("git.inspectErrorFallback")}
              actionLabel={tr("common.retry")}
              onAction={() => void probeAndLoadGit(activeWorkspace())}
            />
          </View>
        </Scroll>
      </If>

      <If when={Boolean(activeWorkspace()) && gitRepoState() === "trust_required"}>
        <Scroll
          style={{ flex: 1, minHeight: 0 }}
          contentStyle={{
            flexGrow: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: props.compact ? 12 : 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 560 }}>
            <SectionCard
              title={tr("git.trustRequiredTitle")}
              subtitle={tr("git.trustRequiredSubtitle")}
            >
              <Text
                style={{
                  color: palette().textSecondary,
                  fontSize: textSize(12.5),
                  lineHeight: textLineHeight(12.5, 1.48),
                }}
              >
                {gitTrustReport()?.detail
                  ? localizeHostError(gitTrustReport()!.detail)
                  : tr("git.trustDetailFallback", {
                      path: activeWorkspace()?.rootPath ?? tr("terminal.thisWorkspace"),
                    })}
              </Text>
              <If when={gitTrustReport()?.manualCommand ?? ""}>
                {cmd => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: 10,
                      borderRadius: radii.sm,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().border,
                      backgroundColor: palette().inputBg,
                    }}
                  >
                    <Text
                      style={{
                        flex: 1,
                        minWidth: 0,
                        color: palette().text,
                        fontFamily: fontMono,
                        fontSize: textSize(11.5),
                        lineHeight: textLineHeight(11.5, 1.45),
                        userSelect: "text",
                      }}
                    >
                      {cmd()}
                    </Text>
                    <IconButton
                      icon="copy"
                      size="xs"
                      tooltip={tr("git.copyCommand")}
                      accessibilityLabel="git-copy-trust-command"
                      onPress={() => {
                        void Clipboard.writeText(cmd())
                          .then(() => pushToast(tr("git.copiedTrustCommand"), "success"))
                          .catch(() => {});
                      }}
                    />
                  </View>
                )}
              </If>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <Button
                  label={gitActionBusy() ? tr("git.trusting") : tr("git.trustRepo")}
                  variant="primary"
                  size="sm"
                  leadingIcon="shield"
                  loading={gitActionBusy()}
                  disabled={gitActionBusy()}
                  accessibilityLabel="git-trust-repo"
                  onPress={() => void trustCurrentRepository()}
                />
                <Button
                  label={tr("git.recheck")}
                  variant="secondary"
                  size="sm"
                  disabled={gitBusy()}
                  onPress={() => void probeAndLoadGit(activeWorkspace())}
                />
              </View>
            </SectionCard>
          </View>
        </Scroll>
      </If>

      <If when={Boolean(activeWorkspace()) && gitRepoState() === "not_a_repository"}>
        <Scroll
          style={{ flex: 1, minHeight: 0 }}
          contentStyle={{
            flexGrow: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: props.compact ? 14 : 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 540, gap: 12 }}>
            <EmptyStateCard
              icon="git-branch"
              title={tr("git.notRepoTitle")}
              subtitle={tr("git.notRepoSubtitle")}
              actionLabel={tr("git.initWithAgent")}
              onAction={() => void initializeRepositoryWithAgent()}
            />
            <View style={{ alignItems: "center" }}>
              <Button
                label={tr("git.checkAgain")}
                variant="secondary"
                size="sm"
                onPress={() => void probeAndLoadGit(activeWorkspace())}
              />
            </View>
          </View>
        </Scroll>
      </If>

      <If when={Boolean(activeWorkspace()) && gitRepoState() === "trusted"}>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
          <If when={gitTab() === "working"}>
            <WorkingCopyView
              compact={narrow()}
              stacked={sceneWidth.stacked()}
              aux={props.compact}
            />
          </If>
          <If when={gitTab() === "branches"}>
            <BranchesView compact={narrow()} />
          </If>
          <If when={gitTab() === "history"}>
            <HistoryView compact={narrow()} stacked={sceneWidth.stacked()} />
          </If>
          <If when={gitTab() === "worktrees"}>
            <WorktreesView compact={narrow()} />
          </If>
        </View>
      </If>

      <ModalDialog
        open={newBranchOpen()}
        title={tr("git.createBranchTitle")}
        subtitle={tr("git.createBranchSubtitle")}
        size="sm"
        onClose={() => closeCreateBranchModal()}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              onPress={() => closeCreateBranchModal()}
            />
            <Button
              label={tr("git.createAndCheckout")}
              variant="primary"
              size="sm"
              leadingIcon="git-branch"
              loading={gitActionBusy()}
              disabled={!newBranchName().trim() || gitActionBusy()}
              accessibilityLabel="git-create-branch-submit"
              onPress={() => void createGitBranch()}
            />
          </View>
        }
      >
        <View style={{ gap: 12 }}>
          <If when={gitError()}>
            {err => (
              <InlineBanner
                tone="danger"
                message={localizeHostError(err())}
                onDismiss={() => gitError.set("")}
              />
            )}
          </If>
          <InputBox
            label={tr("git.branchName")}
            value={newBranchName()}
            placeholder={tr("git.branchNamePlaceholder")}
            monospace={true}
            autoFocus={true}
            accessibilityLabel="git-new-branch-name"
            onChange={value => newBranchName.set(value)}
            onSubmit={() => {
              if (newBranchName().trim() && !gitActionBusy()) void createGitBranch();
            }}
          />
          <InputBox
            label={tr("git.startPoint")}
            value={newBranchStartPoint()}
            placeholder={tr("git.startPointPlaceholder")}
            monospace={true}
            accessibilityLabel="git-new-branch-start"
            onChange={value => newBranchStartPoint.set(value)}
            onSubmit={() => {
              if (newBranchName().trim() && !gitActionBusy()) void createGitBranch();
            }}
          />
        </View>
      </ModalDialog>

      <ModalDialog
        open={addWorktreeModalOpen()}
        title={tr("git.addWorktreeTitle")}
        subtitle={tr("git.addWorktreeSubtitle")}
        size="sm"
        onClose={() => closeAddWorktreeModal()}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              onPress={() => closeAddWorktreeModal()}
            />
            <Button
              label={tr("git.createWorktree")}
              variant="primary"
              size="sm"
              leadingIcon="folder-plus"
              loading={gitActionBusy()}
              disabled={!newWorktreeBranch().trim() || gitActionBusy()}
              accessibilityLabel="git-add-worktree-submit"
              onPress={() => void addGitWorktree()}
            />
          </View>
        }
      >
        <View style={{ gap: 12 }}>
          <If when={gitError()}>
            {err => (
              <InlineBanner
                tone="danger"
                message={localizeHostError(err())}
                onDismiss={() => gitError.set("")}
              />
            )}
          </If>
          <InputBox
            label={tr("git.branchName")}
            value={newWorktreeBranch()}
            placeholder={tr("git.branchNamePlaceholder")}
            monospace={true}
            autoFocus={true}
            accessibilityLabel="git-worktree-branch-name"
            onChange={value => newWorktreeBranch.set(value)}
            onSubmit={() => {
              if (newWorktreeBranch().trim() && !gitActionBusy()) void addGitWorktree();
            }}
          />
          <ToggleSwitch
            value={newWorktreeCreateBranch()}
            onChange={next => newWorktreeCreateBranch.set(next)}
            label={tr("git.createWorktreeBranch")}
            accessibilityLabel="git-worktree-create-branch"
          />
        </View>
      </ModalDialog>
    </View>
  );
}
