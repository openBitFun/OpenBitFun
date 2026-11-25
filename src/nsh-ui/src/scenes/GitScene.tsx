import { ToolPaneHeader } from "../ui/toolPane";
import { Canvas, cleanup, Clipboard, computed, effect, List, Scroll, signal, Text, untracked, View, type JSX, type ViewRef } from "nsh";
import { ensureWorkspaceWatch, openFileAt } from "../fileStore";
import { isRemoteWorkspace as isRemoteWorkspaceRecord, joinWorkspacePath } from "../shared/workspaceUtils";
import { DiffView, Input } from "nsh/base";
import { basename, formatCount, formatPlural, formatRelativeTime } from "../format";
import { currentLocale, localizeHostError, tr } from "../i18n";
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
  gitGraphRemoteUnsupported,
  gitNotice,
  gitRepoState,
  gitStatus,
  gitTab,
  gitTrustReport,
  gitWorktreeNote,
  gitWorktreeRemoteUnsupported,
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
  checkedGitPathSet,
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
import { fleetDeviceById } from "../fleetStore";
import { activeWorkspace, deviceContext, navigateScene, openInAuxPane } from "../state";
import {
  compactLayout,
  fontMono,
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
import { deviceException, stateColor } from "../ui/fleet";
import { Icon, type IconName } from "../ui/icons";
import { createDiffViewStyles } from "../ui/markdown";
import {
  MOTION_DURATION,
  paintTransition,
  pressTransition,
  rotatingChevronStyle,
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
  focusRingStyle,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InlineDeleteConfirm,
  InputBox,
  SectionCard,
  SplitHandle,
  ToggleSwitch,
  TooltipBubble,
  type SegmentedTabOption,
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
const MAX_DRAWN_LANES = 12;
const MAX_DRAWN_LANES_COMPACT = 6;
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
  if (tone === "danger") return stateColor("failed");
  if (tone === "muted") return palette().textMuted;
  return palette().textSecondary;
}

const isRemoteWorkspace = computed(
  () => isRemoteWorkspaceRecord(activeWorkspace()),
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
function QuietStatusText(props: {
  parts: ReadonlyArray<string | false | null | undefined>;
  shrink?: boolean;
  maxWidth?: number;
}) {
  return (
    <If when={props.parts.filter(Boolean).join(" · ")}>
      {text => (
        <Text
          style={{
            flexShrink: props.shrink ? 1 : 0,
            minWidth: 0,
            maxWidth: props.maxWidth,
            ...textStyle("caption", { color: palette().textSecondary, tabular: true }),
            numberOfLines: 1,
            textOverflow: "ellipsis",
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
        gap: space.sm,
        maxWidth: 320,
        paddingVertical: space.lg,
      }}
    >
      <Icon name={props.icon} size={28} color={palette().textMuted} />
      <Text
        style={{
          ...textStyle("sectionTitle", { color: palette().text }),
          textAlign: "center",
        }}
      >
        {props.title}
      </Text>
      <If when={props.subtitle ?? ""}>
        {sub => (
          <Text
            style={{
              ...textStyle("caption", { color: palette().textMuted }),
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
 * Sleek hairline-underline tab strip for Git workbench views.
 */
function GitUnderlineTabs(props: {
  options: ReadonlyArray<SegmentedTabOption<GitTab>>;
  value: GitTab;
  height?: number;
  paddingHorizontal?: number;
  onChange: (next: GitTab) => void;
}) {
  return (
    <Scroll smoothWheel horizontal scrollbar={false} style={{ width: "100%", minWidth: 0 }}>
      <View
        role="tablist"
        style={{
          height: compactLayout() ? WORKBENCH_TOUCH_MIN : (props.height ?? 32),
          flexDirection: "row",
          alignItems: "stretch",
          gap: space.lg,
          paddingHorizontal: props.paddingHorizontal ?? space.md,
        }}
      >
        <Each of={props.options} key={option => option.value}>
          {option => (
            <View
              role="tab"
              accessibilityLabel={option().accessibilityLabel}
              accessibilityState={{ selected: option().value === props.value }}
              hitSlop={touchSlop(32)}
              onPress={() => props.onChange(option().value)}
              style={{
                position: "relative",
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs,
                paddingVertical: space.xs,
                cursor: "pointer",
                userSelect: "none",
                ...pressTransition(MOTION_DURATION.fast),
              }}
              activeStyle={tactileActiveStyle(0.97)}
              focusVisibleStyle={focusRingStyle()}
            >
              <Text
                style={{
                  ...textStyle("caption", {
                    color:
                      option().value === props.value ? palette().text : palette().textMuted,
                  }),
                  fontWeight: option().value === props.value ? "600" : "500",
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
                      ...textStyle("caption", {
                        color:
                          option().value === props.value
                            ? palette().accent
                            : palette().textMuted,
                        tabular: true,
                      }),
                      fontWeight: "600",
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
                    borderRadius: radii.xs,
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
        gap: space.xs,
        minHeight: props.touch ? WORKBENCH_TOUCH_MIN : 28,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        cursor: "pointer",
        userSelect: "none",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={{ opacity: 0.88 }}
      focusVisibleStyle={focusRingStyle()}
    >
      <View style={rotatingChevronStyle(props.expanded)}>
        <Icon name="chevron-right" size={12} color={palette().textMuted} />
      </View>
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          ...textStyle("caption", { color: palette().textSecondary }),
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
          ...textStyle("caption", { color: palette().textMuted, tabular: true }),
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

/** A 16 px high-contrast checkbox for batch selection of working-copy rows. */
function RowCheckbox(props: { path: string; label: string; quiet?: boolean }) {
  const checked = () => checkedGitPathSet().has(props.path);
  return (
    <View
      role="checkbox"
      accessibilityLabel={`git-check-${props.label}`}
      accessibilityState={{ checked: checked() }}
      hitSlop={touchSlop(space.lg)}
      onPress={() => toggleCheckedGitPath(props.path)}
      style={{
        width: space.lg,
        height: space.lg,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: checked()
          ? palette().actionPrimaryBg
          : props.quiet
            ? palette().border
            : palette().borderStrong,
        backgroundColor: checked() ? palette().actionPrimaryBg : "transparent",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: "pointer",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      activeStyle={tactileActiveStyle(0.95)}
      focusVisibleStyle={focusRingStyle()}
    >
      <If when={checked()}>
        <Icon name="check" size={12} color={palette().actionPrimaryFg} />
      </If>
    </View>
  );
}

/** Past this many rows a working-copy group mounts only the rows near the viewport. */
export const GIT_ROWS_VIRTUALIZE_AT = 200;

/**
 * The rows of one working-copy group. A short group renders every row; a long
 * one (a generated tree, a vendored directory) is a `List` laid out in the
 * scene's scroll view (`viewport="parent"`), so only the rows near the
 * viewport exist and a status change never rebuilds thousands of rows.
 */
function GitGroupRows<T>(props: {
  items: readonly T[];
  keyOf: (item: T) => string;
  testID: string;
  children: (item: () => T) => JSX.Element;
}) {
  return (
    <If
      when={props.items.length > GIT_ROWS_VIRTUALIZE_AT}
      else={
        <Each of={props.items} key={item => props.keyOf(item)}>
          {item => props.children(item)}
        </Each>
      }
    >
      <List<T>
        viewport="parent"
        testID={props.testID}
        each={props.items}
        keyExtractor={item => props.keyOf(item)}
        estimatedItemSize={compactLayout() ? WORKBENCH_TOUCH_MIN : 32}
        contentStyle={{ gap: 2 }}
        style={{ width: "100%" }}
      >
        {item => props.children(item)}
      </List>
    </If>
  );
}

/**
 * Working-copy file row using sibling pressable label and sibling hover-aligned
 * action IconButtons (never nesting interactive controls inside role="button").
 */
function GitFileRow(props: GitFileRowProps) {
  const hovered = signal(false);
  // A virtualized group recycles the row for another file: its hover is not the new file's.
  effect(() => {
    void props.rowLabel;
    hovered.set(false);
  });

  return (
    <View
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingLeft: space.sm,
        paddingRight: space.xs,
        paddingVertical: space.xs,
        minHeight: props.touch ? WORKBENCH_TOUCH_MIN : 32,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        backgroundColor: props.selected ? palette().accentSoft : "transparent",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: props.selected ? palette().accentSoft : palette().panelHover,
      }}
    >
      <If when={props.checkPath}>
        {checkPath => (
          <RowCheckbox
            path={checkPath()}
            label={props.displayPath}
            quiet={!hovered() && !props.touch && !props.selected && checkedGitPaths().length === 0}
          />
        )}
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
          gap: space.sm,
          paddingVertical: space.xs,
          borderRadius: radii.xs,
          cursor: "pointer",
          userSelect: "none",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        activeStyle={{ opacity: 0.88 }}
        focusVisibleStyle={focusRingStyle()}
      >
        <View
          style={{
            minWidth: space.lg,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Text
            style={{
              ...textStyle("mono", {
                color: fileLetterColor(props.tone),
              }),
              fontWeight: "600",
              textAlign: "center",
            }}
          >
            {props.letter}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: space.xs }}>
          <Text
            style={{
              ...textStyle("label", {
                color: palette().text,
              }),
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
                  ...textStyle("caption", { color: palette().textMuted }),
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
          gap: space.xs,
          flexShrink: 0,
          opacity: props.touch || props.selected || hovered() ? 1 : 0.72,
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <IconButton
          icon={props.primaryIcon}
          size={props.touch ? "md" : "xs"}
          iconSize={props.touch ? undefined : 12}
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
  const ws = activeWorkspace();
  const root = ws?.rootPath ?? "";
  const remote = isRemoteWorkspaceRecord(ws);
  const isAbs = path.startsWith("/") || (!remote && /^[A-Za-z]:[\\/]/.test(path));
  const fullPath = isAbs || !root ? path : joinWorkspacePath(root, path, remote);
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
  effect(() => {
    const _wsId = activeWorkspace()?.id ?? "";
    void _wsId;
    detailOpen.set(false);
  });
  effect(() => {
    if (!selectedGitFile()) {
      detailOpen.set(false);
    }
  });
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
        flexDirection: props.stacked ? "column" : "row",
      }}
    >
      <If when={showList()}>
      <View
        style={{
          width: props.stacked ? "100%" : props.aux ? Math.min(gitSidebarWidth(), 280) : gitSidebarWidth(),
          flex: props.stacked ? 1 : undefined,
          minHeight: 0,
          flexShrink: props.stacked ? 1 : 0,
          overflow: "hidden",
          flexDirection: "column",
          borderRightWidth: 0,
          borderBottomWidth: 0,
          borderColor: palette().borderSubtle,
          backgroundColor: props.stacked ? palette().canvas : palette().canvasSubtle,
        }}
      >
        <If
          when={Boolean(props.compact || props.aux)}
          else={
            <View
              style={{
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                gap: space.sm,
                borderBottomWidth: 1,
                borderColor: palette().borderSubtle,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" }}>
                <Text
                  style={{
                    flex: 1,
                    minWidth: 72,
                    ...textStyle("caption", { color: palette().textMuted, tabular: true }),
                    fontWeight: "600",
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
          {/* Compact / AuxPane: single slim filter + batch action row */}
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: space.xs,
              paddingHorizontal: space.sm,
              paddingVertical: space.xs + 2,
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
              style={{ flex: 1, minWidth: 100 }}
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
              gap: space.xs,
              paddingHorizontal: space.sm,
              paddingVertical: space.xs,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().accentSoft,
            }}
          >
            <Text
              style={{
                flex: 1,
                minWidth: 72,
                ...textStyle("caption", { color: palette().text, tabular: true }),
                fontWeight: "600",
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
              iconSize={12}
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
          smoothWheel
          style={{ flex: 1, minHeight: 0 }}
          contentStyle={{ padding: props.compact ? 6 : 8, gap: props.compact ? 6 : 8 }}
        >
          <If when={totalWorkingChanges() === 0}>
            <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 16 }}>
              <QuietGitEmpty
                icon="check-circle"
                title={tr("pane.changes.none")}
                subtitle={tr("pane.changes.clean")}
              />
            </View>
          </If>

          <If when={filteredConflicts().length > 0}>
            <View style={{ gap: 2 }}>
              <GroupHeader
                label={tr("git.mergeConflicts")}
                count={filteredConflicts().length}
                expanded={expanded().conflicts}
                touch={compactLayout()}
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
                      touch={compactLayout()}
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
                touch={compactLayout()}
                tone="success"
                onToggle={() => toggleGroup("staged")}
              />
              <If when={expanded().staged}>
                <GitGroupRows items={filteredStaged()} keyOf={file => `staged:${file.path}`} testID="git-rows-staged">
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
                      touch={compactLayout()}
                      onSelect={() =>
                        select({ path: file().path, staged: true, kind: "staged" })
                      }
                      onPrimaryAction={() => void unstageGitFiles([file().path])}
                      onDiscard={() =>
                        requestDiscardGitFile({ path: file().path, kind: "staged" })
                      }
                    />
                  )}
                </GitGroupRows>
              </If>
            </View>
          </If>

          <If when={filteredUnstaged().length > 0}>
            <View style={{ gap: 2 }}>
              <GroupHeader
                label={tr("git.unstagedChanges")}
                count={filteredUnstaged().length}
                expanded={expanded().unstaged}
                touch={compactLayout()}
                tone="warning"
                onToggle={() => toggleGroup("unstaged")}
              />
              <If when={expanded().unstaged}>
                <GitGroupRows items={filteredUnstaged()} keyOf={file => `unstaged:${file.path}`} testID="git-rows-unstaged">
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
                      touch={compactLayout()}
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
                </GitGroupRows>
              </If>
            </View>
          </If>

          <If when={filteredUntracked().length > 0}>
            <View style={{ gap: 2 }}>
              <GroupHeader
                label={tr("git.untracked")}
                count={filteredUntracked().length}
                expanded={expanded().untracked}
                touch={compactLayout()}
                tone="accent"
                onToggle={() => toggleGroup("untracked")}
              />
              <If when={expanded().untracked}>
                <GitGroupRows items={filteredUntracked()} keyOf={path => `untracked:${path}`} testID="git-rows-untracked">
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
                      touch={compactLayout()}
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
                </GitGroupRows>
              </If>
            </View>
          </If>
        </Scroll>

        {/* Cohesive unified rounded Commit Composer box (matches Session Composer craft, never clips in short bottom dock) */}
        <View
          style={{
            padding: props.aux || props.compact ? space.sm : space.md,
            gap: space.xs,
            borderTopWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: props.stacked ? palette().canvas : palette().canvasSubtle,
            flexShrink: 0,
          }}
        >
          <View
            style={{
              borderRadius: radii.lg,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().border,
              backgroundColor: palette().inputBg,
              overflow: "hidden",
              ...paintTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ borderColor: palette().borderStrong }}
            focusWithinStyle={{
              borderColor: palette().fieldFocusBorder,
            }}
          >
            <View
              style={{
                paddingHorizontal: space.sm + 2,
                paddingTop: space.sm,
                paddingBottom: space.xs,
              }}
            >
              <Input
                value={gitCommitMessage()}
                multiline={true}
                placeholder={tr("git.commitPlaceholder")}
                accessibilityLabel="git-commit-message"
                style={{
                  minHeight: compactLayout() ? 56 : props.aux ? 34 : 44,
                  maxHeight: 104,
                  color: palette().text,
                  placeholderColor: palette().textMuted,
                  caretColor: palette().accent,
                  fontSize: compactLayout() ? Math.max(16, textSize(14)) : textSize(13),
                  lineHeight: textLineHeight(compactLayout() ? 16 : 13, 1.45),
                }}
                onChange={event => gitCommitMessage.set(event.value)}
              />
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: space.xs,
                paddingHorizontal: space.sm + 2,
                paddingVertical: space.xs + 2,
                borderTopWidth: 1,
                borderColor: palette().borderSubtle,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <ToggleSwitch
                  value={gitCommitAmend()}
                  onChange={next => setCommitAmend(next)}
                  label={tr("git.amend")}
                  accessibilityLabel="git-commit-amend"
                />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
                <If
                  when={gitAiGenerating()}
                  else={
                    <IconButton
                      icon="sparkles"
                      size="xs"
                      disabled={gitAiGenerating() || isRemoteWorkspace() || totalWorkingChanges() === 0}
                      accessibilityLabel="git-generate-message"
                      tooltip={
                        isRemoteWorkspace()
                          ? tr("git.remoteAiCommitUnsupported")
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
                      width: 24,
                      height: 24,
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
                    <Spinner size={12} color={palette().accent} />
                  </View>
                </If>
                <Button
                  label={tr("git.commit")}
                  variant="primary"
                  size="xs"
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
              !props.aux &&
              !props.compact &&
              Boolean(gitCommitMessage().trim()) &&
              (gitStatus()?.staged.length ?? 0) === 0 &&
              !gitCommitAmend()
            }
          >
            <Text
              style={{
                ...textStyle("caption", { color: palette().textMuted }),
                paddingHorizontal: space.xs,
              }}
            >
              {tr("git.stageToCommitHint")}
            </Text>
          </If>
        </View>
      </View>

      </If>

      <If when={!props.stacked}>
        <SplitHandle
          accessibilityLabel="Resize changed files pane"
          onReset={() => gitSidebarWidth.set(props.aux ? 268 : 260)}
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
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          flexDirection: "column",
          backgroundColor: palette().canvas,
        }}
      >
        <If when={props.stacked}>
          <View
            style={{
              height: compactLayout() ? WORKBENCH_TOUCH_MIN : 36,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
              flexDirection: "row",
              alignItems: "stretch",
            }}
          >
            <StackBackButton
              label={tr("git.tabChanges")}
              accessibilityLabel="git-stack-back"
              flush={true}
              onPress={() => detailOpen.set(false)}
            />
          </View>
        </If>
        <If when={selectedGitFile()}>
          {sel => (
            <View
              style={{
                minHeight: props.compact ? 36 : 40,
                paddingHorizontal: props.compact ? space.md : space.lg,
                paddingVertical: props.compact ? space.xs : space.sm,
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: space.sm,
                borderBottomWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().canvas,
              }}
            >
              <View
                tooltip={<TooltipBubble text={displayRepoFilePath(sel().path)} />}
                style={{
                  flex: 1,
                  minWidth: 0,
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: space.sm,
                }}
              >
                <View style={{ flex: 1, minWidth: 120, flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Icon name="file-code" size={14} color={palette().textMuted} />
                  <Text
                    style={{
                      flex: 1,
                      minWidth: 0,
                      ...textStyle("caption", { color: palette().text }),
                      fontWeight: "600",
                      numberOfLines: 1,
                      textOverflow: "ellipsis-middle",
                    }}
                  >
                    {displayRepoFilePath(sel().path)}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 0 }}>
                  <If when={!diffLoading() && Boolean(selectedGitDiff().trim())}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
                      <Text
                        style={{
                          ...textStyle("mono", { color: palette().textMuted, tabular: true }),
                        }}
                      >
                        {`+${formatCount(selectedDiffStats().added)}`}
                      </Text>
                      <Text
                        style={{
                          ...textStyle("mono", { color: palette().textMuted, tabular: true }),
                        }}
                      >
                        {`-${formatCount(selectedDiffStats().deleted)}`}
                      </Text>
                    </View>
                  </If>
                  <Text
                    style={{
                      flexShrink: 0,
                      ...textStyle("caption", { color: palette().textSecondary }),
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
                    <Spinner size={12} />
                  </If>
                </View>
              </View>
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
          )}
        </If>

        <If when={diffLoading()}>
          <View
            style={{
              flex: 1,
              minHeight: 0,
              padding: space.xl,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.sm,
            }}
          >
            <Spinner size={14} />
            <Text style={{ ...textStyle("caption", { color: palette().textMuted }) }}>
              {tr("git.loadingPatch")}
            </Text>
          </View>
        </If>

        <If when={!diffLoading() && Boolean(selectedGitDiff().trim())}>
          <View style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <DiffView
              patch={selectedGitDiff()}
              language="text"
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
              padding: props.compact ? space.lg : space.xxl,
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
          maxWidth: layout.pageWidth,
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          padding: props.compact ? space.md : space.xl,
          gap: props.compact ? space.md : space.lg,
        }}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
          <Text
            style={{
              flex: 1,
              minWidth: 110,
              ...textStyle("sectionTitle", { color: palette().text, tabular: true }),
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

        <Scroll smoothWheel style={{ flex: 1, minHeight: 0 }} contentStyle={{ gap: space.lg, paddingBottom: space.xl }}>
          <View style={{ gap: space.sm }}>
            <Text
              style={{
                ...textStyle("caption", { color: palette().textMuted, tabular: true }),
                    fontWeight: "600",
                paddingHorizontal: space.xs,
              }}
            >
              {tr("git.localCount", { count: formatCount(localBranches().length) })}
            </Text>
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
              <If when={localBranches().length === 0}>
                <View style={{ padding: space.lg }}>
                  <Text style={{ ...textStyle("caption", { color: palette().textMuted }) }}>
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
                      gap: props.compact ? space.sm : space.md,
                      paddingHorizontal: props.compact ? space.md : space.lg,
                      paddingVertical: props.compact ? space.sm : space.md,
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
                      color={branch().current ? palette().textSecondary : palette().textMuted}
                    />
                    <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                      <View
                        tooltip={<TooltipBubble text={branch().name} />}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.sm,
                          minWidth: 0,
                          flexWrap: "wrap",
                        }}
                      >
                        <Text
                          style={{
                            flexShrink: 1,
                            minWidth: 0,
                            ...textStyle("body", { color: palette().text }),
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
                          ...textStyle("mono", { color: palette().textMuted, tabular: true }),
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
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
                        <Button
                          label={tr("git.checkout")}
                          size="xs"
                          variant="secondary"
                          disabled={gitActionBusy()}
                          accessibilityLabel={`git-checkout-${branch().name}`}
                          onPress={() => void checkoutGitBranch(branch().name)}
                        />
                        <InlineDeleteConfirm
                          confirming={confirmingDeleteBranch() === branch().name}
                          onConfirmingChange={next =>
                            confirmingDeleteBranch.set(next ? branch().name : null)
                          }
                          icon="trash"
                          size="xs"
                          disabled={gitActionBusy()}
                          tooltip={tr("git.deleteBranch")}
                          accessibilityLabel={`git-delete-branch-${branch().name}`}
                          confirmAccessibilityLabel={`git-delete-branch-confirm-${branch().name}`}
                          onConfirm={() => void deleteGitBranch(branch().name)}
                        />
                      </View>
                    </If>
                  </View>
                )}
              </Each>
            </View>
          </View>

          <If when={remoteBranches().length > 0}>
            <View style={{ gap: space.sm }}>
              <Text
                style={{
                  ...textStyle("caption", { color: palette().textMuted, tabular: true }),
                    fontWeight: "600",
                  paddingHorizontal: space.xs,
                }}
              >
                {tr("git.remoteCount", { count: formatCount(remoteBranches().length) })}
              </Text>
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
                <Each of={remoteBranches()} key={branch => `remote:${branch.name}`}>
                  {(branch, index) => (
                    <View
                      tooltip={<TooltipBubble text={branch().name} />}
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: props.compact ? space.sm : space.md,
                        paddingHorizontal: props.compact ? space.md : space.lg,
                        paddingVertical: props.compact ? space.sm : space.md,
                        borderBottomWidth: index() < remoteBranches().length - 1 ? 1 : 0,
                        borderColor: palette().borderSubtle,
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 140, flexDirection: "row", alignItems: "center", gap: space.sm }}>
                        <Icon name="network" size={14} color={palette().textMuted} />
                        <Text
                          style={{
                            flex: 1,
                            minWidth: 0,
                            ...textStyle("label", { color: palette().textSecondary }),
                            numberOfLines: 1,
                            textOverflow: "ellipsis-middle",
                          }}
                        >
                          {branch().name}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 0 }}>
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
  maxLanes: number;
  selected?: boolean;
}) {
  return (
    <Canvas
      style={{
        width: props.railWidth,
        alignSelf: "stretch",
        minHeight: compactLayout() ? WORKBENCH_TOUCH_MIN : HISTORY_ROW_HEIGHT,
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

        const xOf = (l: number) => LANE_PAD + Math.min(Math.max(0, l), Math.max(1, props.maxLanes) - 1) * LANE_STEP;
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

        // 5. Commit node dot with crisp knockout halo matching the row surface.
        const dotColor = laneColor(lane);
        cx.fillStyle = props.selected ? p.accentSoft : p.canvas;
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

function HistoryRow(props: {
  commit: GitCommitRow;
  index: number;
  total: number;
  railWidth: number;
  maxLanes: number;
  compact?: boolean;
}) {
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
        minHeight: compactLayout() ? WORKBENCH_TOUCH_MIN : HISTORY_ROW_HEIGHT,
        paddingRight: props.compact ? space.md : space.lg,
        backgroundColor: selected() ? palette().accentSoft : "transparent",
        cursor: "pointer",
        userSelect: "none",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: selected() ? palette().accentSoft : palette().panelHover }}
      focusVisibleStyle={focusRingStyle()}
    >
      <CommitGraphRail
        commit={props.commit}
        index={props.index}
        total={props.total}
        railWidth={props.railWidth}
        maxLanes={props.maxLanes}
        selected={selected()}
      />
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingLeft: space.xs,
        }}
      >
        <Text
          style={{
            flexShrink: 1,
            minWidth: props.compact ? 84 : 120,
            ...textStyle("label", {
              color: palette().text,
            }),
            fontWeight: selected() ? "600" : "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {subject()}
        </Text>
        <QuietStatusText
          shrink
          maxWidth={props.compact ? 84 : 168}
          parts={(gitGraphByHash()[props.commit.hash]?.refs ?? []).map(refItem => refItem.name)}
        />
        <View style={{ flex: 1, minWidth: 0 }} />
        <If when={!props.compact}>
          <Text
            style={{
              maxWidth: 140,
              ...textStyle("caption", { color: palette().textMuted }),
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
            minWidth: props.compact ? 0 : 72,
            ...textStyle("caption", { color: palette().textMuted, tabular: true }),
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
            ...textStyle("mono", { color: palette().textSecondary, tabular: true }),
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
  const resetMenuOpen = signal(false);
  const resetMenuAnchor = signal<ViewRef | null>(null);
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
                height: compactLayout() ? WORKBENCH_TOUCH_MIN : 36,
                borderBottomWidth: 1,
                borderColor: palette().borderSubtle,
                flexDirection: "row",
                alignItems: "stretch",
              }}
            >
              <StackBackButton
                label={tr("git.tabHistory")}
                accessibilityLabel="git-stack-back"
                flush={true}
                onPress={clearSelectedCommit}
              />
            </View>
          </If>
          <View
            style={{
              padding: props.compact ? space.md : space.lg,
              gap: space.sm,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  ...textStyle("body", { color: palette().text }),
                            fontWeight: "600",
                  userSelect: "text",
                }}
              >
                {commit().message.split("\n")[0] || tr("git.noCommitMessage")}
              </Text>
              <If when={!props.stacked}>
                <IconButton
                  icon="close"
                  size="xs"
                  iconSize={12}
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
                    ...textStyle("caption", { color: palette().textSecondary }),
                    userSelect: "text",
                  }}
                >
                  {body()}
                </Text>
              )}
            </If>
            <Text
              style={{
                ...textStyle("caption", { color: palette().textMuted }),
                numberOfLines: 2,
              }}
            >
              {`${commit().author}${commit().authorEmail ? ` <${commit().authorEmail}>` : ""} · ${commit().date}`}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
              <Text
                style={{
                  ...textStyle("mono", { color: palette().textSecondary, tabular: true }),
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
                    error => pushToast(localizeHostError(error), "error"),
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
          <View style={{ flex: 1, minHeight: 0, flexDirection: "column" }}>
            <Scroll smoothWheel style={{ maxHeight: props.compact ? 140 : 200, minHeight: 0, flexShrink: 0 }}>
              <View style={{ padding: space.xs, gap: 2 }}>
                <If when={commitFilesLoading()}>
                  <View style={{ flexDirection: "row", gap: space.xs, alignItems: "center", padding: space.xs }}>
                    <Spinner size={12} />
                    <Text style={{ ...textStyle("caption", { color: palette().textMuted }) }}>
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
                        gap: space.sm,
                        minHeight: compactLayout() ? WORKBENCH_TOUCH_MIN : 28,
                        paddingHorizontal: space.sm,
                        borderRadius: radii.xs,
                        borderCurve: "continuous",
                        backgroundColor: selectedCommitFile() === file().path ? palette().accentSoft : "transparent",
                        cursor: "pointer",
                        userSelect: "none",
                        ...paintTransition(MOTION_DURATION.fast),
                      }}
                      hoverStyle={{
                        backgroundColor: selectedCommitFile() === file().path ? palette().accentSoft : palette().panelHover,
                      }}
                      focusVisibleStyle={focusRingStyle()}
                    >
                      <Text
                        style={{
                          width: space.lg,
                          ...textStyle("mono", {
                            color: fileLetterColor(changedFileLetter(file().status).tone),
                          }),
                          fontWeight: "600",
                          textAlign: "center",
                        }}
                      >
                        {changedFileLetter(file().status).letter}
                      </Text>
                      <Text
                        style={{
                          flex: 1,
                          minWidth: 0,
                          ...textStyle("caption", { color: palette().text }),
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
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg }}>
                    <If when={commitFileDiffLoading()} else={
                      <Text style={{ ...textStyle("caption", { color: palette().textMuted }) }}>
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
                  language="text"
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
  const maxLanes = () => (props.compact || compactLayout() ? MAX_DRAWN_LANES_COMPACT : MAX_DRAWN_LANES);
  const graphRailWidth = computed(() => {
    const laneCount = Math.max(1, Math.min(maxLanes(), (gitGraphMaxLane() || 0) + 1));
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
            flexWrap: "wrap",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: props.compact ? space.md : space.lg,
            paddingVertical: space.sm,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
          }}
        >
          <Icon name="history" size={14} color={palette().textSecondary} />
          <Text
            style={{
              ...textStyle("label", { color: palette().text }),
              fontWeight: "600",
              flexShrink: 0,
            }}
          >
            {tr("git.commitHistory")}
          </Text>
          <Text
            style={{
              ...textStyle("caption", { color: palette().textMuted, tabular: true }),
              flexShrink: 0,
            }}
          >
            {formatPlural(gitCommits().length, "format.commitOne", "format.commitOther")}
          </Text>
          <View style={{ flex: 1, minWidth: 140, maxWidth: 280, marginLeft: "auto" }}>
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

        <If when={gitGraphRemoteUnsupported() || gitGraphNote()}>
          <View style={{ paddingHorizontal: props.compact ? space.md : space.lg, paddingTop: space.sm }}>
            <InlineBanner
              tone={gitGraphRemoteUnsupported() ? "info" : "warning"}
              message={
                gitGraphRemoteUnsupported()
                  ? tr("git.remoteGraphUnsupported")
                  : localizeHostError(gitGraphNote())
              }
              accessibilityLabel={
                gitGraphRemoteUnsupported() && currentLocale() === "en-US"
                  ? "Commit lane graphs are available on local workspaces only. Showing linear commit history for this remote workspace."
                  : undefined
              }
            />
          </View>
        </If>

        <Scroll smoothWheel style={{ flex: 1, minHeight: 0 }} contentStyle={{ paddingVertical: space.xs, paddingBottom: space.lg }}>
          <If when={gitCommits().length === 0}>
            <View style={{ padding: space.xl }}>
              <EmptyStateCard icon="history" title={tr("git.noCommitsTitle")} subtitle={tr("git.noCommitsSubtitle")} />
            </View>
          </If>
          <If when={gitCommits().length > 0 && filteredCommits().length === 0}>
            <Text
              style={{
                padding: space.lg,
                ...textStyle("caption", { color: palette().textMuted }),
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
                maxLanes={maxLanes()}
                compact={props.compact}
              />
            )}
          </Each>
          <If when={gitHistoryHasMore() && !historyFilter().trim()}>
            <View style={{ alignItems: "center", paddingTop: space.sm }}>
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
          maxWidth: layout.pageWidth,
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          padding: props.compact ? space.md : space.xl,
          gap: props.compact ? space.md : space.lg,
        }}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
          <View style={{ flex: 1, minWidth: 140, gap: space.xs }}>
            <Text style={{ ...textStyle("sectionTitle", { color: palette().text, tabular: true }) }}>
              {tr("git.worktreesCount", { count: formatCount(gitWorktrees().length) })}
            </Text>
            <Text style={{ ...textStyle("caption", { color: palette().textMuted }) }}>
              {tr("git.worktreesSubtitle")}
            </Text>
          </View>
          <Button
            label={tr("git.addWorktree")}
            variant="primary"
            size={props.compact ? "xs" : "sm"}
            leadingIcon="folder-plus"
            disabled={isRemoteWorkspace() || gitActionBusy()}
            accessibilityLabel="git-add-worktree-open"
            onPress={() => openAddWorktreeModal()}
          />
        </View>

        <If when={gitWorktreeRemoteUnsupported() || gitWorktreeNote()}>
          <InlineBanner
            tone={gitWorktreeRemoteUnsupported() ? "info" : "warning"}
            message={
              gitWorktreeRemoteUnsupported()
                ? tr("git.remoteWorktreeUnsupported")
                : localizeHostError(gitWorktreeNote())
            }
            accessibilityLabel={
              gitWorktreeRemoteUnsupported() && currentLocale() === "en-US"
                ? "Git worktrees are supported on local workspaces only. Remote SSH worktrees are not available yet."
                : undefined
            }
          />
        </If>

        <Scroll smoothWheel style={{ flex: 1, minHeight: 0 }} contentStyle={{ paddingBottom: space.lg }}>
          <If when={gitWorktrees().length === 0 && !gitWorktreeRemoteUnsupported() && !gitWorktreeNote()}>
            <EmptyStateCard
              icon="folder-plus"
              title={tr("git.noWorktreesTitle")}
              subtitle={tr("git.noWorktreesSubtitle")}
            />
          </If>

          <If when={gitWorktrees().length > 0}>
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
              <Each of={gitWorktrees()} key={wt => wt.path}>
                {(wt, index) => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: props.compact ? space.sm : space.md,
                      paddingHorizontal: props.compact ? space.md : space.lg,
                      paddingVertical: props.compact ? space.sm : space.md,
                      borderBottomWidth: index() < gitWorktrees().length - 1 ? 1 : 0,
                      borderColor: palette().borderSubtle,
                      backgroundColor: wt().isMain
                        ? palette().surfaceSubtle
                        : "transparent",
                    }}
                  >
                    <Icon
                      name="git-branch"
                      size={16}
                      color={wt().isMain ? palette().textSecondary : palette().textMuted}
                    />
                    <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.sm,
                          minWidth: 0,
                          flexWrap: "wrap",
                        }}
                      >
                        <Text
                          style={{
                            flexShrink: 1,
                            minWidth: 0,
                            ...textStyle("body", { color: palette().text }),
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
                            ...textStyle("mono", { color: palette().textMuted }),
                            numberOfLines: 1,
                            textOverflow: "ellipsis-middle",
                          }}
                        >
                          {wt().path}
                        </Text>
                      </View>
                    </View>

                    <If when={!wt().isMain}>
                      <InlineDeleteConfirm
                        confirming={confirmingRemoveWorktree() === wt().path}
                        onConfirmingChange={next => {
                          if (next) requestRemoveWorktree(wt().path);
                          else cancelRemoveWorktree();
                        }}
                        icon="trash"
                        size="xs"
                        disabled={gitActionBusy() || isRemoteWorkspace()}
                        accessibilityLabel={`git-remove-worktree-${wt().path}`}
                        confirmAccessibilityLabel={`git-remove-worktree-confirm-${wt().path}`}
                        tooltip={tr("git.removeWorktree")}
                        onConfirm={() => void removeGitWorktree(wt().path)}
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
            gap: space.sm,
            paddingHorizontal: props.compact ? space.md : space.lg,
            paddingVertical: space.md,
            borderBottomWidth: 1,
            borderLeftWidth: 2,
            borderColor: palette().borderSubtle,
            borderLeftColor: palette().warning,
            backgroundColor: palette().canvasSubtle,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Icon name="warning" size={14} color={palette().warning} />
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                ...textStyle("caption", { color: palette().text }),
                fontWeight: "600",
              }}
            >
              {blocker().kind === "untracked"
                ? tr("git.switchBlockedUntracked", { branch: blocker().targetBranch })
                : tr("git.switchBlocked", { branch: blocker().targetBranch })}
            </Text>
            <IconButton
              icon="close"
              size="xs"
              iconSize={12}
              tooltip={tr("common.dismissNotice")}
              accessibilityLabel="git-switch-blocker-dismiss"
              onPress={dismissBranchSwitchBlocker}
            />
          </View>
          <Text
            style={{
              ...textStyle("mono", { color: palette().textSecondary }),
              numberOfLines: 4,
            }}
          >
            {blocker().files.map(file => displayRepoFilePath(file)).join("\n")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
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
  // Width-driven: stacked (< 600px, narrow side AuxPane or phone) stacks header & list -> detail;
  // wide (>= 600px, including bottom-docked AuxPane & full-page) renders a single header row + side-by-side split.
  const narrow = () => sceneWidth.stacked();
  const scopeDevice = () => fleetDeviceById(deviceContext());
  const deviceOffline = () => deviceException(scopeDevice()?.state) === "offline";
  const deviceLabel = () => scopeDevice()?.name || tr("device.thisDevice");

  effect(() => {
    const ws = activeWorkspace();
    // Only the workspace re-runs this; the probe's own state does not.
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
      <If when={!props.compact}>
        <ToolPaneHeader />
      </If>
      <RemoteWorkspaceStatusBanner compact={props.compact} />
      <If when={deviceOffline()}>
        <View style={{ paddingHorizontal: props.compact ? space.sm : space.lg, paddingTop: space.sm }}>
          <InlineBanner
            tone="warning"
            message={tr("pane.terminal.offline", { device: deviceLabel() })}
          />
        </View>
      </If>
      <BranchSwitchBlockerBar compact={narrow()} />
      <If
        when={narrow()}
        else={
          <View
            style={{
              height: props.compact ? 38 : 42,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: props.compact ? space.md : space.lg,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().canvas,
              flexShrink: 0,
            }}
          >
            <GitBranchControls compact={props.compact} />
            <ToolbarDivider />
            <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch" }}>
              <GitUnderlineTabs
                options={gitTabs()}
                value={gitTab()}
                height={props.compact ? 38 : 42}
                paddingHorizontal={0}
                onChange={nextTab => gitTab.set(nextTab)}
              />
            </View>
            <GitSyncActions compact={props.compact} />
          </View>
        }
      >
        {/* Narrow (< 600px): compact branch/sync strip over hairline-underline tabs */}
        <View
          style={{
            flexDirection: "column",
            alignItems: "stretch",
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
            flexShrink: 0,
          }}
        >
          <View
            style={{
              minHeight: compactLayout() ? WORKBENCH_TOUCH_MIN : 36,
              paddingHorizontal: space.sm,
              paddingVertical: space.xs,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: space.xs,
              minWidth: 0,
            }}
          >
            <GitBranchControls compact />
            <GitSyncActions compact />
          </View>
          <GitUnderlineTabs
            options={compactGitTabs()}
            value={gitTab()}
            height={30}
            paddingHorizontal={space.sm}
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
                  ? space.sm
                  : space.lg
                : props.compact
                  ? space.md
                  : space.xl,
            paddingTop: space.sm,
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
                    : layout.pageWidth,
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
        <View style={{ paddingHorizontal: props.compact ? space.sm : space.lg, paddingTop: space.sm }}>
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
                  ? space.sm
                  : space.lg
                : props.compact
                  ? space.md
                  : space.xl,
            paddingTop: space.sm,
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
                    : layout.pageWidth,
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
            padding: props.compact ? space.lg : space.xxl,
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
        <View style={{ flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", gap: space.md }}>
          <Spinner size={20} />
          <Text style={{ ...textStyle("label", { color: palette().textMuted }) }}>
            {tr("git.inspecting")}
          </Text>
        </View>
      </If>

      <If when={Boolean(activeWorkspace()) && gitRepoState() === "error"}>
        <Scroll
          smoothWheel
          style={{ flex: 1, minHeight: 0 }}
          contentStyle={{
            flexGrow: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: props.compact ? space.lg : space.xxl,
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
          smoothWheel
          style={{ flex: 1, minHeight: 0 }}
          contentStyle={{
            flexGrow: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: props.compact ? space.md : space.xxl,
          }}
        >
          <View style={{ width: "100%", maxWidth: 560 }}>
            <SectionCard
              title={tr("git.trustRequiredTitle")}
              subtitle={tr("git.trustRequiredSubtitle")}
            >
              <Text style={{ ...textStyle("label", { color: palette().textSecondary }) }}>
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
                      gap: space.sm,
                      padding: space.md,
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
                        ...textStyle("mono", { color: palette().text }),
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
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
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
          smoothWheel
          style={{ flex: 1, minHeight: 0 }}
          contentStyle={{
            flexGrow: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: props.compact ? space.lg : space.xxl,
          }}
        >
          <View style={{ width: "100%", maxWidth: 540, gap: space.md }}>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="md"
              onPress={() => closeCreateBranchModal()}
            />
            <Button
              label={tr("git.createAndCheckout")}
              variant="primary"
              size="md"
              leadingIcon="git-branch"
              loading={gitActionBusy()}
              disabled={!newBranchName().trim() || gitActionBusy()}
              accessibilityLabel="git-create-branch-submit"
              onPress={() => void createGitBranch()}
            />
          </View>
        }
      >
        <View style={{ gap: space.md }}>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="md"
              onPress={() => closeAddWorktreeModal()}
            />
            <Button
              label={tr("git.createWorktree")}
              variant="primary"
              size="md"
              leadingIcon="folder-plus"
              loading={gitActionBusy()}
              disabled={!newWorktreeBranch().trim() || gitActionBusy()}
              accessibilityLabel="git-add-worktree-submit"
              onPress={() => void addGitWorktree()}
            />
          </View>
        }
      >
        <View style={{ gap: space.md }}>
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
