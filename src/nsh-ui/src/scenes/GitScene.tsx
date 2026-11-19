import { Canvas, Clipboard, computed, effect, Scroll, signal, Text, View } from "nsh";
import { DiffView, Input } from "nsh/base";
import { basename, formatCount, formatPlural } from "../format";
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
} from "../gitWorkbenchStore";
import { peerScope } from "../peerState";
import { activeWorkspace } from "../state";
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
  ModalDialog,
  pushToast,
  SelectDropdown,
  type SelectDropdownOption,
} from "../ui/overlays";
import {
  Badge,
  Button,
  EmptyStateCard,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  SectionCard,
  SegmentedTabs,
  SplitHandle,
  StatusDot,
  ToggleSwitch,
  TooltipBubble,
  type SegmentedTabOption,
  type StatusDotKind,
} from "../ui/primitives";

export interface GitSceneProps {
  compact?: boolean;
}

const GIT_SIDEBAR_MIN = 256;
const GIT_SIDEBAR_MAX = 520;
const LANE_STEP = 16;
const LANE_PAD = 12;

const gitSidebarWidth = signal(304);
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

const localBranches = computed<GitBranchRow[]>(() =>
  gitBranches().filter(branch => !branch.remote),
);

const remoteBranches = computed<GitBranchRow[]>(() =>
  gitBranches().filter(branch => branch.remote),
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

function fileLetterBg(tone: "danger" | "success" | "warning" | "muted"): string {
  if (tone === "danger") return palette().dangerSoft;
  if (tone === "success") return palette().successSoft;
  if (tone === "warning") return palette().warningSoft;
  return palette().accentSoft;
}

function groupDotKind(tone?: "accent" | "warning" | "danger" | "success" | "neutral"): StatusDotKind {
  if (tone === "danger") return "danger";
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "accent") return "accent";
  return "muted";
}

function groupCountBg(tone?: "accent" | "warning" | "danger" | "success" | "neutral"): string {
  if (tone === "danger") return palette().dangerSoft;
  if (tone === "success") return palette().successSoft;
  if (tone === "warning") return palette().warningSoft;
  if (tone === "accent") return palette().accentSoft;
  return palette().surfaceSubtle;
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
        size={11}
        color={palette().textMuted}
      />
      <StatusDot kind={groupDotKind(props.tone)} size={5.5} />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: palette().textSecondary,
          fontSize: textSize(11),
          lineHeight: textLineHeight(11, 1.32),
          fontWeight: "600",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
      <View
        style={{
          paddingHorizontal: 5.5,
          paddingVertical: 1,
          borderRadius: radii.xs,
          borderCurve: "continuous",
          backgroundColor: groupCountBg(props.tone),
          flexShrink: 0,
        }}
      >
        <Text
          style={{
            color:
              props.tone === "danger"
                ? palette().danger
                : props.tone === "success"
                  ? palette().success
                  : props.tone === "warning"
                    ? palette().warning
                    : props.tone === "accent"
                      ? palette().accent
                      : palette().textMuted,
            fontSize: textSize(10),
            lineHeight: textLineHeight(10, 1.28),
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatCount(props.count)}
        </Text>
      </View>
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
  onSelect: () => void;
  onPrimaryAction: () => void;
  onDiscard: () => void;
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
        minHeight: 28,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        backgroundColor: props.selected ? palette().accentSoft : "transparent",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: props.selected ? palette().accentSoft : palette().panelHover,
      }}
    >
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
            height: 16,
            paddingHorizontal: 3,
            borderRadius: 4,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            backgroundColor: fileLetterBg(props.tone),
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
              fontSize: textSize(12.5),
              lineHeight: textLineHeight(12.5, 1.35),
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
                  fontSize: textSize(11),
                  lineHeight: textLineHeight(11, 1.32),
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
          opacity: props.selected || hovered() ? 1 : 0.34,
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <IconButton
          icon={props.primaryIcon}
          size="xs"
          iconSize={12.5}
          accessibilityLabel={props.primaryLabel}
          tooltip={props.primaryTooltip}
          disabled={props.disabled}
          onPress={props.onPrimaryAction}
        />
        <IconButton
          icon={props.discardIcon ?? "undo"}
          size="xs"
          iconSize={12}
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

function WorkingCopyView(props: { compact?: boolean }) {
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
      <View
        style={{
          width: props.compact ? "100%" : gitSidebarWidth(),
          flex: props.compact ? 1.08 : undefined,
          minHeight: 0,
          flexShrink: props.compact ? 1 : 0,
          overflow: "hidden",
          flexDirection: "column",
          borderRightWidth: 0,
          borderBottomWidth: props.compact ? 1 : 0,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().canvasSubtle,
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
                      primaryIcon="plus"
                      primaryLabel={`git-stage-${displayRepoFilePath(path())}`}
                      primaryTooltip={tr("git.markResolved")}
                      discardIcon="undo"
                      discardLabel={`git-discard-${displayRepoFilePath(path())}`}
                      discardTooltip={tr("common.discardChanges")}
                      disabled={gitActionBusy()}
                      onSelect={() =>
                        void selectGitFile({ path: path(), staged: false, kind: "conflict" })
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
                      primaryIcon="arrow-left"
                      primaryLabel={`git-unstage-${displayRepoFilePath(file().path)}`}
                      primaryTooltip={tr("git.unstage")}
                      discardIcon="undo"
                      discardLabel={`git-discard-${displayRepoFilePath(file().path)}`}
                      discardTooltip={tr("common.discardChanges")}
                      disabled={gitActionBusy()}
                      onSelect={() =>
                        void selectGitFile({ path: file().path, staged: true, kind: "staged" })
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
                      primaryIcon="plus"
                      primaryLabel={`git-stage-${displayRepoFilePath(file().path)}`}
                      primaryTooltip={tr("git.stageFile")}
                      discardIcon="undo"
                      discardLabel={`git-discard-${displayRepoFilePath(file().path)}`}
                      discardTooltip={tr("common.discardChanges")}
                      disabled={gitActionBusy()}
                      onSelect={() =>
                        void selectGitFile({
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
                      primaryIcon="plus"
                      primaryLabel={`git-stage-${displayRepoFilePath(path())}`}
                      primaryTooltip={tr("git.stageFile")}
                      discardIcon="trash"
                      discardLabel={`git-discard-${displayRepoFilePath(path())}`}
                      discardTooltip={tr("git.deleteUntracked")}
                      disabled={gitActionBusy()}
                      onSelect={() =>
                        void selectGitFile({
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
              boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
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
                  onChange={next => gitCommitAmend.set(next)}
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

      <If when={!props.compact}>
        <SplitHandle
          accessibilityLabel="Resize changed files pane"
          onReset={() => gitSidebarWidth.set(304)}
          onDelta={dx =>
            gitSidebarWidth.update(w =>
              Math.max(GIT_SIDEBAR_MIN, Math.min(GIT_SIDEBAR_MAX, w + dx)),
            )
          }
        />
      </If>

      <View
        style={{
          flex: props.compact ? 0.92 : 1,
          minWidth: 0,
          minHeight: props.compact ? 176 : 0,
          overflow: "hidden",
          flexDirection: "column",
          backgroundColor: palette().canvas,
        }}
      >
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
                <Badge
                  label={diffBadgeFor(sel().kind).label}
                  tone={diffBadgeFor(sel().kind).tone}
                />
                <If when={diffLoading()}>
                  <Spinner size={13} />
                </If>
              </View>
            )}
          </If>
          <If when={!props.compact}>
            <SegmentedTabs
              size="sm"
              value={gitDiffLayout()}
              options={[
                { value: "unified", label: tr("files.diffUnified"), accessibilityLabel: "git-diff-unified" },
                { value: "split", label: tr("files.diffSplit"), accessibilityLabel: "git-diff-split" },
              ]}
              onChange={next => gitDiffLayout.set(next)}
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
                borderRadius: radii.lg,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().border,
                backgroundColor: palette().panelRaised,
                boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
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
                        <If when={branch().current}>
                          <Badge label={tr("common.current")} tone="success" />
                        </If>
                        <If when={branch().ahead > 0}>
                          <Badge label={`↑${formatCount(branch().ahead)}`} tone="accent" />
                        </If>
                        <If when={branch().behind > 0}>
                          <Badge label={`↓${formatCount(branch().behind)}`} tone="warning" />
                        </If>
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
                  borderRadius: radii.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().border,
                  backgroundColor: palette().panelRaised,
                  boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
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
                      <Badge label={tr("common.remote")} tone="neutral" />
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
        minHeight: 54,
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

        const xOf = (l: number) => LANE_PAD + Math.min(Math.max(0, l), 7) * LANE_STEP;
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

function HistoryView(props: { compact?: boolean }) {
  const graphRailWidth = computed(() => {
    const laneCount = Math.max(1, Math.min(8, (gitGraphMaxLane() || 0) + 1));
    return LANE_PAD * 2 + Math.max(0, laneCount - 1) * LANE_STEP;
  });

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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="history" size={15} color={palette().textSecondary} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().text,
              fontSize: textSize(15),
              lineHeight: textLineHeight(15, 1.28),
              letterSpacing: textTracking(15),
              fontWeight: "600",
            }}
          >
            {tr("git.commitHistory")}
          </Text>
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(11.5),
              lineHeight: textLineHeight(11.5, 1.35),
              fontVariant: ["tabular-nums"],
              flexShrink: 0,
            }}
          >
            {formatPlural(gitCommits().length, "format.commitOne", "format.commitOther")}
          </Text>
        </View>

        <If when={gitGraphNote()}>
          {note => (
            <InlineBanner
              tone={isRemoteGraphNote() ? "info" : "warning"}
              message={localizeHostError(note())}
            />
          )}
        </If>

        <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ paddingBottom: 16 }}>
          <If when={gitCommits().length === 0}>
            <EmptyStateCard
              icon="history"
              title={tr("git.noCommitsTitle")}
              subtitle={tr("git.noCommitsSubtitle")}
            />
          </If>

          <If when={gitCommits().length > 0}>
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
              <Each of={gitCommits()} key={commit => commit.hash || commit.shortHash}>
                {(commit, index) => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "stretch",
                      minHeight: 54,
                      paddingRight: props.compact ? 12 : 16,
                      paddingLeft: 4,
                    }}
                  >
                    <CommitGraphRail
                      commit={commit()}
                      index={index()}
                      total={gitCommits().length}
                      railWidth={graphRailWidth()}
                    />

                    <View
                      style={{
                        flex: 1,
                        minWidth: 0,
                        justifyContent: "center",
                        gap: 4,
                        paddingVertical: 10,
                        paddingLeft: 6,
                        borderBottomWidth: index() < gitCommits().length - 1 ? 1 : 0,
                        borderColor: palette().borderSubtle,
                      }}
                    >
                      <View
                        tooltip={
                          <TooltipBubble
                            text={commit().message.split("\n")[0] || tr("git.noCommitMessage")}
                          />
                        }
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
                            color: palette().text,
                            fontSize: textSize(13),
                            fontWeight: "600",
                            lineHeight: textLineHeight(13, 1.36),
                            flex: 1,
                            minWidth: 0,
                            numberOfLines: 1,
                            textOverflow: "ellipsis",
                          }}
                        >
                          {commit().message.split("\n")[0] || tr("git.noCommitMessage")}
                        </Text>
                        <Each
                          of={gitGraphByHash()[commit().hash]?.refs ?? []}
                          key={r => `${r.refType}:${r.name}`}
                        >
                          {refItem => (
                            <Badge
                              label={refItem().name}
                              tone={refItem().isCurrent || refItem().isHead ? "accent" : "neutral"}
                            />
                          )}
                        </Each>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 }}>
                        <Text
                          style={{
                            color: palette().accent,
                            fontFamily: fontMono,
                            fontSize: textSize(11),
                            lineHeight: textLineHeight(11, 1.35),
                            fontWeight: "600",
                            fontVariant: ["tabular-nums"],
                            flexShrink: 0,
                          }}
                        >
                          {commit().shortHash}
                        </Text>
                        <If when={Boolean(gitGraphByHash()[commit().hash])}>
                          <Text
                            style={{
                              color: laneColor(gitGraphByHash()[commit().hash]?.lane ?? 0),
                              fontFamily: fontMono,
                              fontSize: textSize(10),
                              lineHeight: textLineHeight(10, 1.35),
                              fontWeight: "600",
                              fontVariant: ["tabular-nums"],
                              flexShrink: 0,
                            }}
                          >
                            {`L${gitGraphByHash()[commit().hash]?.lane ?? 0}`}
                          </Text>
                        </If>
                        <Text
                          style={{
                            flex: 1,
                            minWidth: 0,
                            color: palette().textMuted,
                            fontSize: textSize(11),
                            lineHeight: textLineHeight(11, 1.35),
                            fontVariant: ["tabular-nums"],
                            numberOfLines: 1,
                            textOverflow: "ellipsis",
                          }}
                        >
                          {`${commit().author} · ${commit().date}`}
                        </Text>
                      </View>
                    </View>
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
                borderRadius: radii.lg,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().border,
                backgroundColor: palette().panelRaised,
                boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
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
                        <If when={wt().isMain}>
                          <Badge label={tr("git.worktreeMain")} tone="accent" />
                        </If>
                        <If when={wt().isLocked}>
                          <Badge label={tr("git.worktreeLocked")} tone="warning" />
                        </If>
                        <If when={wt().isPrunable}>
                          <Badge label={tr("git.worktreePrunable")} tone="neutral" />
                        </If>
                        <If when={Boolean(wt().head)}>
                          <Badge label={wt().head.slice(0, 7)} tone="neutral" />
                        </If>
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

      <If when={(gitStatus()?.ahead ?? 0) > 0 || (gitStatus()?.behind ?? 0) > 0}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <If when={(gitStatus()?.ahead ?? 0) > 0}>
            <Badge label={`↑${formatCount(gitStatus()?.ahead ?? 0)}`} tone="accent" />
          </If>
          <If when={(gitStatus()?.behind ?? 0) > 0}>
            <Badge label={`↓${formatCount(gitStatus()?.behind ?? 0)}`} tone="warning" />
          </If>
        </View>
      </If>

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

export function GitScene(props: GitSceneProps = {}) {
  effect(() => {
    const ws = activeWorkspace();
    const peer = peerScope();
    void peer;
    void syncGitWorkspace(ws);
  });

  return (
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
      <If
        when={Boolean(props.compact)}
        else={
          <View
            style={{
              minHeight: 44,
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              paddingHorizontal: 18,
              paddingVertical: 6,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().canvas,
            }}
          >
            <GitBranchControls />
            <View style={{ minWidth: 0 }}>
              <SegmentedTabs
                size="sm"
                options={gitTabs()}
                value={gitTab()}
                onChange={nextTab => gitTab.set(nextTab)}
              />
            </View>
            <GitSyncActions />
          </View>
        }
      >
        {/* Compact AuxPane: 2 tight rows — 36px branch/sync strip + 32px sleek hairline-underline tabs */}
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
              minHeight: 36,
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
                      boxShadow: palette().shadowInset,
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
            <WorkingCopyView compact={props.compact} />
          </If>
          <If when={gitTab() === "branches"}>
            <BranchesView compact={props.compact} />
          </If>
          <If when={gitTab() === "history"}>
            <HistoryView compact={props.compact} />
          </If>
          <If when={gitTab() === "worktrees"}>
            <WorktreesView compact={props.compact} />
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
