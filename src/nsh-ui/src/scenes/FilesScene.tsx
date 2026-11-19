import {
  computed,
  effect,
  Image,
  Scroll,
  signal,
  Text,
  Video,
  View,
  type Point,
  type ViewRef,
} from "nsh";
import {
  DiffView,
  Editor,
  TextView,
  Tree,
  type TreeEntry,
  type TreeItem,
} from "nsh/base";
import { basename, extensionOf, formatCount, formatPlural } from "../format";
import { localizeHostError, tr } from "../i18n";
import {
  beginEditFile,
  cancelDelete,
  cancelEdit,
  cancelEditFile,
  changedPaths,
  commitEdit,
  confirmingDelete,
  dirChildren,
  dirnameOf,
  editingContent,
  expandedDirs,
  fileNotice,
  fileSaving,
  gitChanges,
  gitListOpen,
  gitStatus,
  joinPath,
  loadDirectory,
  loadRoot,
  openDiffReview,
  openFile,
  openFileAt,
  pasteFromClipboard,
  pendingEdit,
  refreshDirectory,
  removeSelected,
  requestDelete,
  revealPath,
  runFileSearch,
  saveEditedFile,
  searchMode,
  searchQuery,
  searchResults,
  selectedPath,
  setEditingContent,
  setExpanded,
  startCreate,
  startRename,
} from "../fileStore";
import { activeWorkspaceRoot, auxSelectedFilePath } from "../state";
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
import { Icon, type IconName } from "../ui/icons";
import {
  createDiffViewStyles,
  createEditorStyles,
  createMarkdownCodeActions,
  createMarkdownStyles,
  inferCodeLanguage,
} from "../ui/markdown";
import {
  MOTION_DURATION,
  paintTransition,
  pressTransition,
  Spinner,
  tactileActiveStyle,
} from "../ui/motion";
import { ContextMenuOverlay, DropdownMenu, type DropdownMenuItem } from "../ui/overlays";
import {
  Badge,
  Button,
  IconButton,
  InlineConfirmBar,
  InputBox,
  SegmentedTabs,
  SplitHandle,
  TooltipBubble,
  WorkbenchSwitcher,
} from "../ui/primitives";

/** A directory that has not been read yet needs one row so that it can expand. */
const PLACEHOLDER_SUFFIX = "/\u0000loading";

const EXPLORER_MIN_WIDTH = 204;
const EXPLORER_MAX_WIDTH = 440;
const MAX_GUIDE_DEPTH = 5;

const editValue = signal("");
const openFilePaths = signal<string[]>([]);
const explorerOpen = signal(true);
const explorerWidth = signal(260);
const fileDiffLayout = signal<"unified" | "split">("unified");
const fileActionsMenuOpen = signal(false);
const fileActionsAnchor = signal<ViewRef | null>(null);
const treeContextPos = signal<Point | null>(null);
const treeContextOpen = signal(false);

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "rs", "py", "pyi",
  "go", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "cxx", "hpp",
  "hh", "cs", "rb", "php", "sh", "bash", "zsh", "fish", "ps1", "sql",
  "json", "jsonc", "jsonl", "toml", "yaml", "yml", "xml", "html", "htm",
  "css", "scss", "sass", "less", "graphql", "gql", "proto", "lua", "zig",
  "dart", "vue", "svelte", "nix", "tf", "hcl", "ex", "exs", "erl", "hs",
  "scala", "groovy", "gradle", "ini", "conf", "cfg",
]);

const TEXT_EXTENSIONS = new Set(["md", "mdx", "markdown", "txt", "log", "csv", "rst"]);

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif", "heic",
]);

const TS_JS_EXTENSIONS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);
const SYSTEMS_CONFIG_EXTENSIONS = new Set([
  "rs", "go", "toml", "json", "jsonc", "jsonl", "yaml", "yml", "py", "pyi", "sh", "bash", "zsh",
]);
const STYLE_MARKUP_EXTENSIONS = new Set([
  "css", "scss", "sass", "less", "html", "htm", "vue", "svelte", "xml",
]);

const CODE_BASENAMES = new Set([
  "dockerfile", "makefile", "gnumakefile", "justfile", "gemfile", "rakefile",
  "podfile", "cmakelists.txt", ".gitignore", ".gitattributes", ".dockerignore",
  ".env", ".zshrc", ".bashrc",
]);

function fileIconForPath(path: string, isDir: boolean, isExpanded: boolean): IconName {
  if (isDir) return isExpanded ? "folder-open" : "folder";
  const base = basename(path).toLowerCase();
  if (CODE_BASENAMES.has(base) || base.startsWith("dockerfile.")) return "file-code";
  const ext = extensionOf(path);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (TEXT_EXTENSIONS.has(ext)) return "file-text";
  if (CODE_EXTENSIONS.has(ext)) return "file-code";
  return "file";
}

function fileIconColor(path: string, isDir: boolean, selected: boolean): string {
  if (selected) return palette().accent;
  if (isDir) return palette().textSecondary;
  const ext = extensionOf(path);
  if (TS_JS_EXTENSIONS.has(ext)) return palette().accent;
  if (SYSTEMS_CONFIG_EXTENSIONS.has(ext)) return palette().warning;
  if (IMAGE_EXTENSIONS.has(ext)) return palette().success;
  if (STYLE_MARKUP_EXTENSIONS.has(ext)) return palette().gitLanes[2];
  if (TEXT_EXTENSIONS.has(ext)) return palette().textSecondary;
  return palette().textMuted;
}

function hasChangedDescendant(dirPath: string): boolean {
  const slashPrefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
  const backPrefix = dirPath.endsWith("\\") ? dirPath : `${dirPath}\\`;
  return changedPaths().some(p => p.startsWith(slashPrefix) || p.startsWith(backPrefix));
}

const treeItems = computed<TreeItem[]>(() => {
  const children = dirChildren();
  const build = (directory: string): TreeItem[] =>
    (children[directory] ?? []).map(entry => {
      const item: TreeItem = { id: entry.path, label: basename(entry.path) || entry.path };
      if (entry.isDirectory) {
        const loaded = children[entry.path];
        item.children = loaded
          ? build(entry.path)
          : [{ id: `${entry.path}${PLACEHOLDER_SUFFIX}`, label: tr("common.loading"), disabled: true }];
      }
      return item;
    });
  return build(activeWorkspaceRoot());
});

/** Every directory the tree knows about, so selecting one never reads it as a file. */
const knownDirectoryPaths = computed(() => {
  const directories = new Set<string>();
  const visit = (entries: ReadonlyArray<{ path: string; isDirectory: boolean }>) => {
    for (const entry of entries) {
      if (entry.isDirectory) directories.add(entry.path);
    }
  };
  for (const entries of Object.values(dirChildren())) visit(entries);
  return directories;
});

interface BreadcrumbSegment {
  label: string;
  path: string;
  isLast: boolean;
}

function buildBreadcrumbs(filePath: string, rootPath: string): BreadcrumbSegment[] {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
  if (normalizedRoot && filePath.startsWith(normalizedRoot)) {
    const rest = filePath.slice(normalizedRoot.length).replace(/^[\\/]+/, "");
    const parts = rest ? rest.split(/[\\/]+/).filter(Boolean) : [];
    const segments: BreadcrumbSegment[] = [
      {
        label: basename(normalizedRoot) || normalizedRoot,
        path: normalizedRoot,
        isLast: parts.length === 0,
      },
    ];
    let current = normalizedRoot;
    parts.forEach((part, index) => {
      current = joinPath(current, part);
      segments.push({
        label: part,
        path: current,
        isLast: index === parts.length - 1,
      });
    });
    return segments;
  }
  const parts = filePath.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return [{ label: filePath, path: filePath, isLast: true }];
  const prefix = filePath.startsWith("/") ? "/" : "";
  let current = "";
  return parts.map((part, index) => {
    current = current ? joinPath(current, part) : `${prefix}${part}`;
    return {
      label: part,
      path: current,
      isLast: index === parts.length - 1,
    };
  });
}

function isEditableKind(kind: string): boolean {
  return kind === "code" || kind === "markdown" || kind === "text";
}

function fileMenuItems(): DropdownMenuItem[] {
  const hasSelection = Boolean(selectedPath());
  const selected = selectedPath() ?? "";
  return [
    {
      id: "new-file",
      label: tr("files.newFile"),
      icon: "plus",
      accessibilityLabel: "New file",
      onSelect: () => startCreate("file"),
    },
    {
      id: "new-folder",
      label: tr("files.newFolder"),
      icon: "folder-plus",
      accessibilityLabel: "New folder",
      onSelect: () => startCreate("directory"),
    },
    {
      id: "paste",
      label: tr("common.paste"),
      icon: "copy",
      accessibilityLabel: "Paste",
      onSelect: () => void pasteFromClipboard(),
    },
    {
      id: "sep-1",
      label: "",
      separator: true,
    },
    {
      id: "rename",
      label: tr("common.rename"),
      icon: "edit",
      disabled: !hasSelection,
      accessibilityLabel: "Rename",
      onSelect: () => startRename(),
    },
    {
      id: "review-diff",
      label: tr("files.reviewDiff"),
      icon: "git-branch",
      disabled: !hasSelection || !gitChanges()[selected],
      accessibilityLabel: "Review diff",
      onSelect: () => {
        if (selected) void openDiffReview(selected);
      },
    },
    {
      id: "delete",
      label: tr("common.delete"),
      icon: "trash",
      danger: true,
      disabled: !hasSelection,
      accessibilityLabel: "Delete",
      onSelect: () => requestDelete(),
    },
  ];
}

function closeOpenFileTab(path: string): void {
  const tabs = openFilePaths();
  const idx = tabs.indexOf(path);
  const remaining = tabs.filter(item => item !== path);
  openFilePaths.set(remaining);
  if (openFile()?.path === path) {
    cancelEditFile();
    const nextPath = remaining[Math.max(0, idx - 1)] ?? remaining[0] ?? null;
    if (nextPath) {
      void openFileAt(nextPath);
    } else {
      openFile.set(null);
    }
  }
}

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

const openFileDiffStats = computed(() => {
  const file = openFile();
  return file?.kind === "diff" ? diffPatchStats(file.content) : { added: 0, deleted: 0 };
});

const hasUnsavedEdit = computed(() => {
  const draft = editingContent();
  const file = openFile();
  return draft !== null && file !== null && draft !== file.content;
});

function relativeDisplayPath(filePath: string, rootPath: string): string {
  const cleanRoot = rootPath.replace(/[\\/]+$/, "");
  if (cleanRoot) {
    if (filePath === cleanRoot) return basename(cleanRoot) || cleanRoot;
    if (filePath.startsWith(`${cleanRoot}/`) || filePath.startsWith(`${cleanRoot}\\`)) {
      return filePath.slice(cleanRoot.length + 1);
    }
  }
  return filePath;
}

function parentHintOf(filePath: string, rootPath: string): string {
  const rel = relativeDisplayPath(filePath, rootPath);
  const dir = dirnameOf(rel);
  return dir && dir !== "." ? dir : "";
}

/** Progressively clamps deep folder indentation so filenames stay readable at depth 10+. */
function explorerIndentLeft(depth: number): number {
  const safe = Math.max(0, depth);
  if (safe <= MAX_GUIDE_DEPTH) return 6 + safe * 12;
  return Math.min(120, 66 + (safe - MAX_GUIDE_DEPTH) * 8);
}

function guideLevelsFor(depth: number): number[] {
  const count = Math.min(Math.max(0, depth), MAX_GUIDE_DEPTH);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(i);
  return out;
}

function rowFocusRing(): { outlineWidth: number; outlineColor: string; outlineOffset: number } {
  return {
    outlineWidth: 2,
    outlineColor: palette().borderFocus,
    outlineOffset: -1,
  };
}

function decorationColor(letter: string | undefined): string {
  if (letter === "A") return palette().success;
  if (letter === "U") return palette().accent;
  if (letter === "C" || letter === "D") return palette().danger;
  return palette().warning;
}

function decorationBg(letter: string | undefined): string {
  if (letter === "A") return palette().successSoft;
  if (letter === "U") return palette().accentSoft;
  if (letter === "C" || letter === "D") return palette().dangerSoft;
  return palette().warningSoft;
}

/** Calm centered borderless empty prompt (never a lonely boxed wireframe card). */
function QuietEmptyPrompt(props: { icon: IconName; title: string; subtitle?: string }) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        maxWidth: 340,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
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
        <Icon name={props.icon} size={18} color={palette().textMuted} />
      </View>
      <Text
        style={{
          color: palette().text,
          fontSize: textSize(14),
          fontWeight: "600",
          letterSpacing: textTracking(14),
          lineHeight: textLineHeight(14, 1.32),
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
              lineHeight: textLineHeight(12, 1.48),
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

function PendingEditBar() {
  return (
    <If when={pendingEdit()}>
      {edit => (
        <View
          style={{
            flexDirection: "column",
            gap: 8,
            paddingHorizontal: 10,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().panelRaised,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
            <Icon
              name={
                edit().mode === "directory"
                  ? "folder-plus"
                  : edit().mode === "rename"
                    ? "edit"
                    : "file-code"
              }
              size={12}
              color={palette().textSecondary}
            />
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(11.5),
                fontWeight: "600",
                lineHeight: textLineHeight(11.5, 1.35),
                flexShrink: 0,
              }}
            >
              {edit().mode === "rename"
                ? tr("files.renameTo")
                : edit().mode === "file"
                  ? tr("files.newFile")
                  : tr("files.newFolder")}
            </Text>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().textMuted,
                fontSize: textSize(10.5),
                fontFamily: fontMono,
                lineHeight: textLineHeight(10.5, 1.35),
                numberOfLines: 1,
                textOverflow: "ellipsis-middle",
              }}
            >
              {tr("files.inDirectory", {
                path:
                  relativeDisplayPath(
                    edit().mode === "rename"
                      ? dirnameOf(edit().base) || activeWorkspaceRoot()
                      : edit().base,
                    activeWorkspaceRoot(),
                  ) || tr("files.rootDir"),
              })}
            </Text>
          </View>
          <InputBox
            size="sm"
            value={editValue()}
            placeholder={edit().mode === "rename" ? basename(edit().base) : tr("common.name")}
            accessibilityLabel="entry-name"
            autoFocus={true}
            onChange={value => editValue.set(value)}
            onSubmit={() => {
              if (editValue().trim()) void commitEdit(editValue());
            }}
            onKeyPress={event => {
              if (event.key === "Escape") cancelEdit();
            }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Button
              label={tr("common.save")}
              variant="primary"
              size="xs"
              disabled={!editValue().trim()}
              onPress={() => void commitEdit(editValue())}
            />
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="xs"
              onPress={cancelEdit}
            />
          </View>
        </View>
      )}
    </If>
  );
}

/**
 * Compact inline search mode switcher (`Names` / `Contents`) nested cleanly
 * inside the Explorer search `InputBox` trailing slot.
 */
function InlineSearchModeToggle() {
  const modes: ReadonlyArray<{
    value: "name" | "content";
    label: () => string;
    a11y: string;
  }> = [
    { value: "name", label: () => tr("files.searchNames"), a11y: "search-mode-name" },
    { value: "content", label: () => tr("files.searchContents"), a11y: "search-mode-content" },
  ];

  return (
    <View
      role="tablist"
      style={{
        height: 20,
        padding: 1.5,
        borderRadius: 6,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().segmentedTrackBg,
        flexDirection: "row",
        alignItems: "center",
        gap: 1,
        flexShrink: 0,
      }}
    >
      <Each of={modes} key={item => item.value}>
        {item => (
          <View
            role="tab"
            accessibilityLabel={item().a11y}
            accessibilityState={{ selected: searchMode() === item().value }}
            onPress={() => {
              searchMode.set(item().value);
              void runFileSearch();
            }}
            style={{
              height: "100%",
              paddingHorizontal: 5.5,
              borderRadius: 4.5,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                searchMode() === item().value ? palette().panelRaised : "transparent",
              boxShadow:
                searchMode() === item().value ? palette().shadowButton : undefined,
              cursor: "pointer",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{
              backgroundColor:
                searchMode() === item().value
                  ? palette().panelRaised
                  : palette().surfaceSubtle,
            }}
            activeStyle={tactileActiveStyle(0.97)}
            focusVisibleStyle={rowFocusRing()}
          >
            <Text
              style={{
                color:
                  searchMode() === item().value ? palette().text : palette().textMuted,
                fontSize: textSize(10),
                fontWeight: searchMode() === item().value ? "600" : "500",
                lineHeight: textLineHeight(10, 1.2),
                numberOfLines: 1,
              }}
            >
              {item().label()}
            </Text>
          </View>
        )}
      </Each>
    </View>
  );
}

/**
 * Calm collapsible changed-files banner above the tree: subtle branch pill,
 * tabular count, and expandable diff-review list.
 */
function ChangedFiles(props: { compact?: boolean }) {
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().canvasSubtle,
      }}
    >
      <View
        role="button"
        accessibilityState={{ expanded: gitListOpen() }}
        onPress={() => gitListOpen.set(!gitListOpen())}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          minHeight: 28,
          paddingHorizontal: props.compact ? 8 : 10,
          paddingVertical: 4,
          minWidth: 0,
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().panelHover }}
        activeStyle={{ opacity: 0.88 }}
        focusVisibleStyle={rowFocusRing()}
      >
        <Icon
          name={gitListOpen() ? "chevron-down" : "chevron-right"}
          size={11}
          color={palette().textMuted}
        />
        <Text
          style={{
            color: palette().textSecondary,
            fontSize: textSize(11),
            fontWeight: "600",
            lineHeight: textLineHeight(11, 1.32),
            fontVariant: ["tabular-nums"],
            flexShrink: 0,
          }}
        >
          {`${tr("git.tabChanges")} ${formatCount(changedPaths().length)}`}
        </Text>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}>
          <If when={gitStatus()?.current_branch ?? ""}>
            {branch => (
              <View
                tooltip={<TooltipBubble text={branch()} />}
                style={{
                  flexShrink: 1,
                  minWidth: 0,
                  maxWidth: "100%",
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: radii.xs,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceSubtle,
                  overflow: "hidden",
                }}
              >
                <Text
                  style={{
                    minWidth: 0,
                    flexShrink: 1,
                    color: palette().textMuted,
                    fontFamily: fontMono,
                    fontSize: textSize(10),
                    fontWeight: "500",
                    lineHeight: textLineHeight(10, 1.32),
                    numberOfLines: 1,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {branch()}
                </Text>
              </View>
            )}
          </If>
        </View>
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(10.5),
            fontWeight: "500",
            lineHeight: textLineHeight(10.5, 1.32),
            flexShrink: 0,
          }}
        >
          {gitListOpen() ? tr("common.hide") : tr("common.show")}
        </Text>
      </View>
      <If when={gitListOpen()}>
        <Scroll style={{ maxHeight: props.compact ? 116 : 172, minHeight: 0 }}>
          <View style={{ paddingHorizontal: 6, paddingBottom: 6, gap: 1 }}>
            <Each of={changedPaths()} key="index">
              {path => <ChangedFileRow path={path()} />}
            </Each>
          </View>
        </Scroll>
      </If>
    </View>
  );
}

function ChangedFileRow(props: { path: string }) {
  const decoration = computed(() => gitChanges()[props.path]);
  const relPath = computed(() => relativeDisplayPath(props.path, activeWorkspaceRoot()));
  const parentHint = computed(() => parentHintOf(props.path, activeWorkspaceRoot()));
  return (
    <View
      role="button"
      tooltip={<TooltipBubble text={relPath()} />}
      accessibilityLabel={`changed-${basename(props.path)}`}
      accessibilityState={{ selected: openFile()?.path === props.path }}
      onPress={() => void openDiffReview(props.path)}
      style={{
        minHeight: 26,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        backgroundColor: openFile()?.path === props.path ? palette().accentSoft : "transparent",
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor:
          openFile()?.path === props.path ? palette().accentSoft : palette().panelHover,
      }}
      activeStyle={{ opacity: 0.88 }}
      focusVisibleStyle={rowFocusRing()}
    >
      <Icon
        name={fileIconForPath(props.path, false, false)}
        size={13}
        color={fileIconColor(props.path, false, openFile()?.path === props.path)}
      />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.36),
            fontWeight: openFile()?.path === props.path ? "600" : "500",
            flexShrink: 1,
            minWidth: 0,
            numberOfLines: 1,
            textOverflow: "ellipsis-middle",
          }}
        >
          {basename(props.path)}
        </Text>
        <If when={parentHint()}>
          {dir => (
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().textMuted,
                fontSize: textSize(10.5),
                lineHeight: textLineHeight(10.5, 1.32),
                numberOfLines: 1,
                textOverflow: "ellipsis-start",
              }}
            >
              {dir()}
            </Text>
          )}
        </If>
      </View>
      <View
        style={{
          minWidth: 16,
          height: 16,
          paddingHorizontal: 3,
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          backgroundColor: decorationBg(decoration()?.letter),
        }}
      >
        <Text
          style={{
            color: decorationColor(decoration()?.letter),
            fontFamily: fontMono,
            fontSize: textSize(10),
            fontWeight: "700",
            lineHeight: textLineHeight(10, 1.15),
          }}
        >
          {decoration()?.letter ?? "M"}
        </Text>
      </View>
    </View>
  );
}

function SearchResults(props: { compact?: boolean }) {
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          paddingHorizontal: 10,
          paddingTop: 6,
          paddingBottom: 2,
        }}
      >
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(10.5),
            fontWeight: "600",
            lineHeight: textLineHeight(10.5, 1.32),
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatPlural(searchResults().length, "format.matchOne", "format.matchOther")}
        </Text>
        <IconButton
          icon="close"
          size="xs"
          iconSize={11}
          tooltip={tr("files.clearResults")}
          accessibilityLabel="clear-file-search-results"
          onPress={() => {
            searchResults.set([]);
            fileNotice.set("");
          }}
        />
      </View>
      <Scroll style={{ maxHeight: props.compact ? 128 : 196, minHeight: 0 }}>
        <View style={{ paddingHorizontal: 6, paddingBottom: 6, paddingTop: 2, gap: 2 }}>
          <Each
            of={searchResults()}
            key={row => (row.line === undefined ? row.path : `${row.path}:${row.line}`)}
          >
            {row => (
              <View
                role="button"
                tooltip={
                  <TooltipBubble text={relativeDisplayPath(row().path, activeWorkspaceRoot())} />
                }
                onPress={() => void revealPath(row().path)}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 5,
                  borderRadius: radii.xs,
                  borderCurve: "continuous",
                  gap: 2,
                  cursor: "pointer",
                  ...paintTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().panelHover }}
                activeStyle={{ opacity: 0.88 }}
                focusVisibleStyle={rowFocusRing()}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <Icon
                    name={fileIconForPath(row().path, false, false)}
                    size={13}
                    color={fileIconColor(row().path, false, false)}
                  />
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.36),
                      fontWeight: "500",
                      fontVariant: ["tabular-nums"],
                      flex: 1,
                      minWidth: 0,
                      numberOfLines: 1,
                      textOverflow: "ellipsis-middle",
                    }}
                  >
                    {row().line === undefined ? row().name : `${row().name}:${row().line}`}
                  </Text>
                </View>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(10.5),
                    lineHeight: textLineHeight(10.5, 1.35),
                    numberOfLines: 1,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {relativeDisplayPath(row().path, activeWorkspaceRoot())}
                </Text>
                <If when={row().preview}>
                  {preview => (
                    <Text
                      style={{
                        color: palette().textSecondary,
                        fontSize: textSize(10.5),
                        fontFamily: fontMono,
                        lineHeight: textLineHeight(10.5, 1.42),
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {preview()}
                    </Text>
                  )}
                </If>
              </View>
            )}
          </Each>
        </View>
      </Scroll>
    </View>
  );
}

function renderExplorerRow(entry: TreeEntry) {
  if (entry.disabled && entry.id.endsWith(PLACEHOLDER_SUFFIX)) {
    return (
      <View
        style={{
          minHeight: 26,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingLeft: explorerIndentLeft(entry.depth) + 18,
          paddingRight: 8,
          paddingVertical: 3,
        }}
      >
        <Spinner size={10} />
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(11),
            lineHeight: textLineHeight(11, 1.35),
          }}
        >
          {tr("common.loading")}
        </Text>
      </View>
    );
  }

  const guideLevels = guideLevelsFor(entry.depth);

  return (
    <View
      tooltip={<TooltipBubble text={relativeDisplayPath(entry.id, activeWorkspaceRoot())} />}
      style={{
        position: "relative",
        minHeight: 26,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: explorerIndentLeft(entry.depth),
        paddingRight: 8,
        paddingVertical: 2,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        backgroundColor: selectedPath() === entry.id ? palette().accentSoft : "transparent",
        cursor: entry.disabled ? "default" : "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor:
          selectedPath() === entry.id ? palette().accentSoft : palette().panelHover,
      }}
    >
      <If when={guideLevels.length > 0}>
        <Each of={guideLevels} key={level => level}>
          {level => (
            <View
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 12 + level() * 12,
                width: 1,
                backgroundColor: palette().borderSubtle,
                pointerEvents: "none",
              }}
            />
          )}
        </Each>
      </If>
      <View
        style={{
          width: 14,
          height: 14,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <If when={entry.folder || knownDirectoryPaths().has(entry.id)}>
          <Icon
            name={expandedDirs().includes(entry.id) ? "chevron-down" : "chevron-right"}
            size={11}
            color={selectedPath() === entry.id ? palette().accent : palette().textMuted}
          />
        </If>
      </View>
      <Icon
        name={fileIconForPath(
          entry.id,
          entry.folder || knownDirectoryPaths().has(entry.id),
          expandedDirs().includes(entry.id),
        )}
        size={13.5}
        color={fileIconColor(
          entry.id,
          entry.folder || knownDirectoryPaths().has(entry.id),
          selectedPath() === entry.id,
        )}
      />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color:
            selectedPath() === entry.id
              ? palette().text
              : entry.disabled
                ? palette().textMuted
                : entry.folder || knownDirectoryPaths().has(entry.id)
                  ? palette().text
                  : palette().textSecondary,
          fontSize: textSize(12.5),
          lineHeight: textLineHeight(12.5, 1.36),
          fontWeight:
            selectedPath() === entry.id
              ? "600"
              : entry.folder || knownDirectoryPaths().has(entry.id)
                ? "500"
                : "400",
          numberOfLines: 1,
          textOverflow: "ellipsis-middle",
        }}
      >
        {entry.label}
      </Text>
      <If when={gitChanges()[entry.id]?.letter ?? ""}>
        {letter => (
          <View
            style={{
              minWidth: 15,
              height: 15,
              paddingHorizontal: 3,
              borderRadius: 4,
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              backgroundColor: decorationBg(letter()),
            }}
          >
            <Text
              style={{
                color: decorationColor(letter()),
                fontFamily: fontMono,
                fontSize: textSize(10),
                fontWeight: "700",
                lineHeight: textLineHeight(10, 1.15),
              }}
            >
              {letter()}
            </Text>
          </View>
        )}
      </If>
      <If
        when={
          (entry.folder || knownDirectoryPaths().has(entry.id)) &&
          !gitChanges()[entry.id] &&
          hasChangedDescendant(entry.id)
        }
      >
        <View
          style={{
            width: 5,
            height: 5,
            borderRadius: radii.pill,
            backgroundColor: palette().warning,
            flexShrink: 0,
          }}
        />
      </If>
    </View>
  );
}

function FileTree(props: { compact?: boolean; width: number }) {
  return (
    <View
      style={{
        width: props.compact ? "100%" : props.width,
        height: props.compact && openFile() ? "38%" : undefined,
        minWidth: 0,
        minHeight: props.compact ? (openFile() ? 168 : 0) : 0,
        maxHeight: props.compact && openFile() ? 304 : undefined,
        flex: props.compact && !openFile() ? 1 : undefined,
        flexShrink: props.compact && !openFile() ? 1 : 0,
        overflow: "hidden",
        flexDirection: "column",
        borderRightWidth: 0,
        borderBottomWidth: props.compact && openFile() ? 1 : 0,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().canvasSubtle,
      }}
    >
      {/* Sleek unified 2-row IDE Explorer header (single bottom hairline) */}
      <View
        style={{
          paddingHorizontal: props.compact ? 8 : 10,
          paddingTop: props.compact ? 6 : 8,
          paddingBottom: props.compact ? 7 : 9,
          gap: props.compact ? 5 : 7,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().canvasSubtle,
        }}
      >
        {/* Row 1: Explorer label + quiet tabular item count + New / Refresh / More */}
        <View
          style={{
            height: 24,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
          }}
        >
          <Text
            style={{
              color: props.compact ? palette().textSecondary : palette().text,
              fontSize: textSize(props.compact ? 11.5 : 12),
              fontWeight: "600",
              letterSpacing: textTracking(12),
              lineHeight: textLineHeight(12, 1.3),
              flexShrink: 0,
            }}
          >
            {tr("files.explorer")}
          </Text>
          <View
            style={{
              paddingHorizontal: 5,
              paddingVertical: 1,
              borderRadius: radii.xs,
              backgroundColor: palette().surfaceSubtle,
              flexShrink: 0,
            }}
          >
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(10),
                fontWeight: "600",
                lineHeight: textLineHeight(10, 1.25),
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatCount(treeItems().length)}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 0 }}>
            <IconButton
              icon="plus"
              size="xs"
              iconSize={12.5}
              tooltip={tr("files.newFile")}
              accessibilityLabel="file-quick-new"
              onPress={() => startCreate("file")}
            />
            <IconButton
              icon="refresh"
              size="xs"
              iconSize={12}
              tooltip={tr("files.refreshExplorer")}
              accessibilityLabel="Refresh"
              onPress={() => void refreshDirectory(activeWorkspaceRoot())}
            />
            <View ref={el => fileActionsAnchor.set(el)} style={{ flexShrink: 0 }}>
              <IconButton
                icon="more"
                size="xs"
                iconSize={12.5}
                active={fileActionsMenuOpen()}
                tooltip={tr("files.fileActions")}
                accessibilityLabel="file-actions-menu"
                onPress={() => fileActionsMenuOpen.set(!fileActionsMenuOpen())}
              />
            </View>
          </View>
        </View>

        {/* Row 2: Unified InputBox search with compact inline Names / Contents toggle */}
        <InputBox
          size="sm"
          leadingIcon="search"
          clearable={true}
          clearLabel={tr("common.clearSearch")}
          value={searchQuery()}
          placeholder={
            searchMode() === "content"
              ? tr("files.searchContentPlaceholder")
              : tr("files.searchPlaceholder")
          }
          accessibilityLabel="file-search"
          trailing={<InlineSearchModeToggle />}
          onChange={val => {
            searchQuery.set(val);
            if (!val.trim()) {
              searchResults.set([]);
              fileNotice.set("");
            }
          }}
          onSubmit={() => void runFileSearch()}
        />

        <If when={confirmingDelete()}>
          {target => (
            <InlineConfirmBar
              message={tr("files.deleteConfirm", { name: basename(target()) })}
              confirmLabel={tr("common.confirmDelete")}
              cancelLabel={tr("common.cancel")}
              danger={true}
              onConfirm={() => void removeSelected()}
              onCancel={cancelDelete}
            />
          )}
        </If>

        <If when={fileNotice()}>
          {notice => (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: radii.xs,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().panelRaised,
              }}
            >
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: palette().textSecondary,
                  fontSize: textSize(10.5),
                  lineHeight: textLineHeight(10.5, 1.38),
                }}
              >
                {localizeHostError(notice())}
              </Text>
              <IconButton
                icon="close"
                size="xs"
                iconSize={10}
                tooltip={tr("common.dismissNotice")}
                accessibilityLabel="dismiss-file-notice"
                onPress={() => fileNotice.set("")}
              />
            </View>
          )}
        </If>
      </View>

      <DropdownMenu
        open={fileActionsMenuOpen()}
        anchor={fileActionsAnchor()}
        align="end"
        minWidth={176}
        items={fileMenuItems()}
        onClose={() => fileActionsMenuOpen.set(false)}
      />

      <PendingEditBar />
      <If when={changedPaths().length > 0}>
        <ChangedFiles compact={props.compact} />
      </If>
      <If when={searchResults().length > 0}>
        <SearchResults compact={props.compact} />
      </If>
      <View
        style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
        onContextMenu={event => {
          treeContextPos.set(event.pagePosition);
          treeContextOpen.set(true);
        }}
      >
        <Tree
          items={treeItems()}
          expanded={expandedDirs()}
          selected={selectedPath()}
          reveal={false}
          renderItem={renderExplorerRow}
          itemClass="group rounded-md focus-visible:outline-2 focus-visible:outline-ring"
          itemStyle={{ color: palette().text, fontSize: textSize(12.5) }}
          listStyle={{ padding: 6, gap: 1 }}
          style={{ flex: 1, minHeight: 0 }}
          onExpandedChange={event => {
            const next = new Set(event.expanded);
            for (const directory of expandedDirs()) {
              if (!next.has(directory)) void setExpanded(directory, false);
            }
            for (const directory of next) {
              if (!expandedDirs().includes(directory)) void setExpanded(directory, true);
            }
          }}
          onExpand={event => {
            if (event.id.endsWith(PLACEHOLDER_SUFFIX)) return;
            void loadDirectory(event.id);
          }}
          onSelectedChange={event => {
            selectedPath.set(event.selected);
            if (!knownDirectoryPaths().has(event.selected)) void openFileAt(event.selected);
          }}
          onAction={event => {
            if (!knownDirectoryPaths().has(event.id)) void openFileAt(event.id);
          }}
        />
      </View>
      <ContextMenuOverlay
        open={treeContextOpen()}
        position={treeContextPos()}
        items={fileMenuItems()}
        onClose={() => treeContextOpen.set(false)}
      />
    </View>
  );
}

const FILE_TAB_RADIUS = radii.sm;
const FILE_TAB_INNER_RADIUS = concentricRadius(FILE_TAB_RADIUS, 2);

function OpenFileTabChip(props: { path: string; compact?: boolean }) {
  const hovered = signal(false);
  const active = () => openFile()?.path === props.path;

  return (
    <View
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={{
        boxSizing: "border-box",
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        gap: 2,
        paddingLeft: 8,
        paddingRight: 3,
        height: props.compact ? controlHeight.xs : controlHeight.sm,
        borderRadius: FILE_TAB_RADIUS,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: active() ? palette().border : "transparent",
        backgroundColor: active() ? palette().panelRaised : "transparent",
        boxShadow: active()
          ? `${palette().shadowButton}, ${palette().innerHighlight}`
          : undefined,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: active() ? palette().panelRaised : palette().panelHover,
      }}
    >
      <View
        role="tab"
        tooltip={<TooltipBubble text={relativeDisplayPath(props.path, activeWorkspaceRoot())} />}
        accessibilityLabel={`file-tab-${basename(props.path)}`}
        accessibilityState={{ selected: active() }}
        onPress={() => void openFileAt(props.path)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 2,
          paddingRight: 2,
          borderRadius: FILE_TAB_INNER_RADIUS,
          cursor: "pointer",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        activeStyle={tactileActiveStyle(0.97)}
        focusVisibleStyle={rowFocusRing()}
      >
        <Icon
          name={fileIconForPath(props.path, false, false)}
          size={12.5}
          color={fileIconColor(props.path, false, active())}
        />
        <Text
          style={{
            maxWidth: props.compact ? 116 : 168,
            color: active() ? palette().text : palette().textSecondary,
            fontSize: textSize(11.5),
            lineHeight: textLineHeight(11.5, 1.32),
            fontWeight: active() ? "600" : "500",
            numberOfLines: 1,
            textOverflow: "ellipsis-middle",
          }}
        >
          {basename(props.path) || props.path}
        </Text>
        <If when={active() && editingContent() !== null}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: radii.pill,
              flexShrink: 0,
              backgroundColor: hasUnsavedEdit() ? palette().warning : palette().accent,
            }}
          />
        </If>
      </View>
      <IconButton
        icon="close"
        size="xs"
        iconSize={10.5}
        tooltip={tr("files.closeTab")}
        accessibilityLabel={`close-file-tab-${basename(props.path)}`}
        style={{
          width: 18,
          height: 18,
          borderRadius: FILE_TAB_INNER_RADIUS,
          opacity: active() || hovered() ? 0.86 : 0.34,
        }}
        onPress={() => closeOpenFileTab(props.path)}
      />
    </View>
  );
}

function OpenFileTabStrip(props: { compact?: boolean }) {
  return (
    <If
      when={openFilePaths().length > 0}
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
          {tr("files.selectToPreview")}
        </Text>
      }
    >
      <Scroll
        horizontal
        style={{ flex: 1, minWidth: props.compact ? 100 : 120 }}
        scrollbar={false}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Each of={openFilePaths()} key={path => path}>
            {path => <OpenFileTabChip path={path()} compact={props.compact} />}
          </Each>
        </View>
      </Scroll>
    </If>
  );
}

function PreviewBody(props: { compact?: boolean }) {
  return (
    <If
      when={openFile()}
      else={
        <If when={!props.compact || !explorerOpen()}>
          <View
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              padding: props.compact ? 16 : 32,
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <QuietEmptyPrompt
              icon="file-code"
              title={tr("files.noFileOpen")}
              subtitle={tr("files.noFileOpenSubtitle")}
            />
          </View>
        </If>
      }
    >
      {file => (
        <View
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
            flexDirection: "column",
            backgroundColor: palette().canvas,
          }}
        >
          <If when={file().kind === "diff"}>
            <If
              when={Boolean(file().content.trim())}
              else={
                <View
                  style={{
                    flex: 1,
                    minHeight: 0,
                    minWidth: 0,
                    padding: props.compact ? 16 : 28,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <QuietEmptyPrompt
                    icon="git-branch"
                    title={tr("files.noDiffOutput")}
                    subtitle={
                      file().note ? localizeHostError(file().note!) : tr("files.noDiffAgainstHead")
                    }
                  />
                </View>
              }
            >
              <View style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
                <If when={file().note ?? ""}>
                  {note => (
                    <Text
                      style={{
                        color: palette().textMuted,
                        fontSize: textSize(11),
                        lineHeight: textLineHeight(11, 1.45),
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderBottomWidth: 1,
                        borderColor: palette().borderSubtle,
                      }}
                    >
                      {localizeHostError(note())}
                    </Text>
                  )}
                </If>
                <DiffView
                  patch={file().content}
                  language={inferCodeLanguage(file().path) ?? (file().language || undefined)}
                  layout={props.compact ? "unified" : fileDiffLayout()}
                  indicators="bars"
                  inline="wordAlt"
                  lineNumbers={true}
                  fontFamily={fontMono}
                  fontSize={textSize(12)}
                  lineHeight={textLineHeight(12, 1.55)}
                  styles={createDiffViewStyles()}
                  style={{ flex: 1, minHeight: 0, minWidth: 0 }}
                />
              </View>
            </If>
          </If>
          <If when={file().kind === "markdown" && editingContent() === null}>
            <Scroll style={{ flex: 1, minHeight: 0 }}>
              <View style={{ padding: props.compact ? 16 : 28, alignItems: "center" }}>
                <View style={{ width: "100%", maxWidth: 740 }}>
                  <TextView
                    markdown={file().content}
                    selectable={true}
                    styles={createMarkdownStyles({ compact: props.compact })}
                    codeBlockActions={createMarkdownCodeActions()}
                  />
                </View>
              </View>
            </Scroll>
          </If>
          <If when={file().kind === "text" && editingContent() === null}>
            <Scroll style={{ flex: 1, minHeight: 0 }}>
              <View style={{ padding: props.compact ? 14 : 20 }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.55),
                    fontFamily: fontMono,
                    userSelect: "text",
                  }}
                >
                  {file().content}
                </Text>
              </View>
            </Scroll>
          </If>
          <If
            when={
              file().kind === "code" ||
              (editingContent() !== null && (file().kind === "markdown" || file().kind === "text"))
            }
          >
            <View style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
              <Editor
                value={editingContent() ?? file().content}
                language={
                  file().kind === "code"
                    ? (inferCodeLanguage(file().path) ?? file().language)
                    : file().kind === "markdown"
                      ? "markdown"
                      : "text"
                }
                readOnly={editingContent() === null}
                lineNumbers={true}
                folding={true}
                indentGuides={true}
                activeLine={editingContent() !== null}
                fontFamily={fontMono}
                fontSize={textSize(12)}
                lineHeight={textLineHeight(12, 1.55)}
                softWrap={file().kind !== "code"}
                styles={createEditorStyles()}
                accessibilityLabel="file-editor"
                style={{ flex: 1, minHeight: 0, minWidth: 0 }}
                onChange={event => {
                  if (editingContent() !== null) setEditingContent(event.value);
                }}
              />
            </View>
          </If>
          <If when={file().kind === "image"}>
            <View
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                padding: props.compact ? 12 : 24,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Image
                src={file().content}
                accessibilityLabel={file().name}
                style={{ flex: 1, width: "100%", objectFit: "contain" }}
                onError={event =>
                  fileNotice.set(
                    tr("files.cannotShowImage", {
                      name: file().name,
                      error: localizeHostError(event.message),
                    }),
                  )
                }
              />
            </View>
          </If>
          <If when={file().kind === "video"}>
            <View style={{ flex: 1, minHeight: 0, minWidth: 0, padding: props.compact ? 12 : 24 }}>
              <Video src={file().content} controls={true} muted={true} style={{ flex: 1 }} />
            </View>
          </If>
          <If when={file().kind === "binary"}>
            <View
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                padding: props.compact ? 16 : 28,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <QuietEmptyPrompt
                icon="file"
                title={file().name}
                subtitle={file().note ? localizeHostError(file().note!) : tr("files.binaryNoPreview")}
              />
            </View>
          </If>
        </View>
      )}
    </If>
  );
}

function Preview(props: { compact?: boolean }) {
  return (
    <View
      style={{
        flex: props.compact && explorerOpen() && !openFile() ? 0 : 1,
        flexShrink: props.compact && explorerOpen() && !openFile() ? 0 : 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        flexDirection: "column",
        backgroundColor: palette().canvas,
      }}
    >
      {/* Hide redundant empty preview bar in compact AuxPane until a file is open or explorer collapses */}
      <If when={!props.compact || Boolean(openFile()) || !explorerOpen()}>
        <View
          style={{
            minHeight: props.compact ? 36 : 44,
            paddingHorizontal: props.compact ? 8 : 14,
            paddingVertical: props.compact ? 4 : 6,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: props.compact ? 6 : 8,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
          }}
        >
          <IconButton
            icon="panel-left"
            size={props.compact ? "xs" : "sm"}
            active={explorerOpen()}
            tooltip={tr("files.toggleExplorer")}
            accessibilityLabel="explorer-toggle"
            onPress={() => explorerOpen.set(!explorerOpen())}
          />
          <If when={!props.compact}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <WorkbenchSwitcher />
              <View
                style={{
                  width: 1,
                  height: 16,
                  backgroundColor: palette().borderSubtle,
                }}
              />
            </View>
          </If>
          <OpenFileTabStrip compact={props.compact} />
          <If when={openFile()}>
            {file => (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                <If when={editingContent() !== null}>
                  <Badge label={tr("files.editing")} tone="warning" />
                </If>
                <If when={!props.compact && file().kind === "diff"}>
                  <SegmentedTabs
                    size="sm"
                    value={fileDiffLayout()}
                    options={[
                      { value: "unified", label: tr("files.diffUnified") },
                      { value: "split", label: tr("files.diffSplit") },
                    ]}
                    onChange={next => fileDiffLayout.set(next)}
                  />
                </If>
                <If when={file().kind === "diff"}>
                  <Button
                    label={tr("files.openFile")}
                    accessibilityLabel="file-view-source"
                    variant="secondary"
                    size={props.compact ? "xs" : "sm"}
                    onPress={() => void openFileAt(file().path)}
                  />
                </If>
                <If when={isEditableKind(file().kind) && editingContent() === null}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 }}>
                    <If when={Boolean(gitChanges()[file().path])}>
                      <Button
                        label={tr("files.viewDiff")}
                        accessibilityLabel="file-view-diff"
                        variant="ghost"
                        size={props.compact ? "xs" : "sm"}
                        onPress={() => void openDiffReview(file().path)}
                      />
                    </If>
                    <Button
                      label={tr("files.editFile")}
                      accessibilityLabel="file-edit"
                      variant="secondary"
                      size={props.compact ? "xs" : "sm"}
                      leadingIcon="edit"
                      onPress={() => beginEditFile()}
                    />
                  </View>
                </If>
                <If when={isEditableKind(file().kind) && editingContent() !== null}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 }}>
                    <Button
                      label={fileSaving() ? tr("common.saving") : tr("files.saveFile")}
                      accessibilityLabel="file-save"
                      variant="primary"
                      size={props.compact ? "xs" : "sm"}
                      loading={fileSaving()}
                      onPress={() => void saveEditedFile()}
                    />
                    <Button
                      label={tr("files.discardEdit")}
                      accessibilityLabel="file-discard"
                      variant="ghost"
                      size={props.compact ? "xs" : "sm"}
                      disabled={fileSaving()}
                      onPress={() => cancelEditFile()}
                    />
                  </View>
                </If>
              </View>
            )}
          </If>
        </View>
      </If>

      {/* Slim breadcrumb + edit-state + language strip (shown only when a file is open) */}
      <If when={openFile()}>
        {file => (
          <View
            style={{
              minHeight: 26,
              paddingHorizontal: props.compact ? 8 : 14,
              paddingVertical: 3,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderBottomWidth: 1,
              borderColor:
                editingContent() !== null ? palette().warningBorder : palette().borderSubtle,
              backgroundColor:
                editingContent() !== null ? palette().warningSoft : palette().canvas,
              ...paintTransition(MOTION_DURATION.fast),
            }}
          >
            <Scroll horizontal style={{ flex: 1, minWidth: 0 }} scrollbar={false}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Each of={buildBreadcrumbs(file().path, activeWorkspaceRoot())} key={seg => seg.path}>
                  {(seg, index) => (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0 }}>
                      <If when={index() > 0}>
                        <Icon name="chevron-right" size={10} color={palette().textMuted} />
                      </If>
                      <View
                        role={seg().isLast ? undefined : "button"}
                        tooltip={
                          relativeDisplayPath(seg().path, activeWorkspaceRoot()) !== seg().label ? (
                            <TooltipBubble
                              text={relativeDisplayPath(seg().path, activeWorkspaceRoot())}
                            />
                          ) : undefined
                        }
                        onPress={
                          seg().isLast
                            ? undefined
                            : () => {
                                selectedPath.set(seg().path);
                                void setExpanded(seg().path, true);
                              }
                        }
                        style={{
                          paddingHorizontal: 4,
                          paddingVertical: 1,
                          borderRadius: 5,
                          borderCurve: "continuous",
                          backgroundColor: seg().isLast ? palette().surfaceSubtle : "transparent",
                          cursor: seg().isLast ? "default" : "pointer",
                          ...pressTransition(MOTION_DURATION.fast),
                        }}
                        hoverStyle={
                          seg().isLast ? undefined : { backgroundColor: palette().panelHover }
                        }
                        activeStyle={seg().isLast ? undefined : tactileActiveStyle(0.97)}
                        focusVisibleStyle={seg().isLast ? undefined : rowFocusRing()}
                      >
                        <Text
                          style={{
                            maxWidth: props.compact ? 110 : 180,
                            color: seg().isLast ? palette().text : palette().textMuted,
                            fontSize: textSize(11),
                            lineHeight: textLineHeight(11, 1.35),
                            fontWeight: seg().isLast ? "600" : "400",
                            numberOfLines: 1,
                            textOverflow: "ellipsis-middle",
                          }}
                        >
                          {seg().label}
                        </Text>
                      </View>
                    </View>
                  )}
                </Each>
              </View>
            </Scroll>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <If when={editingContent() !== null}>
                <Text
                  style={{
                    color: palette().warning,
                    fontSize: textSize(10.5),
                    fontWeight: "600",
                    lineHeight: textLineHeight(10.5, 1.32),
                    flexShrink: 0,
                  }}
                >
                  {hasUnsavedEdit() ? tr("files.unsavedChanges") : tr("files.liveEdit")}
                </Text>
              </If>
              <If when={file().kind === "diff" && Boolean(file().content.trim())}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 }}>
                  <Text
                    style={{
                      color: palette().diffAddRail,
                      fontFamily: fontMono,
                      fontSize: textSize(10.5),
                      fontWeight: "600",
                      lineHeight: textLineHeight(10.5, 1.32),
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {`+${formatCount(openFileDiffStats().added)}`}
                  </Text>
                  <Text
                    style={{
                      color: palette().diffDelRail,
                      fontFamily: fontMono,
                      fontSize: textSize(10.5),
                      fontWeight: "600",
                      lineHeight: textLineHeight(10.5, 1.32),
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {`-${formatCount(openFileDiffStats().deleted)}`}
                  </Text>
                </View>
              </If>
              <If when={gitChanges()[file().path]?.letter ?? ""}>
                {letter => (
                  <Text
                    style={{
                      color: decorationColor(letter()),
                      fontFamily: fontMono,
                      fontSize: textSize(10),
                      fontWeight: "700",
                      lineHeight: textLineHeight(10, 1.35),
                    }}
                  >
                    {letter()}
                  </Text>
                )}
              </If>
              <Badge
                label={
                  file().kind === "diff"
                    ? "diff"
                    : inferCodeLanguage(file().path) || file().language || file().kind
                }
                tone="neutral"
              />
            </View>
          </View>
        )}
      </If>

      <PreviewBody compact={props.compact} />
    </View>
  );
}

export function FilesScene(props: { compact?: boolean } = {}) {
  effect(() => {
    const root = activeWorkspaceRoot();
    if (!root || dirChildren()[root]) return;
    void loadRoot();
  });

  effect(() => {
    const edit = pendingEdit();
    editValue.set(edit?.value ?? "");
  });

  effect(() => {
    const file = openFile();
    if (file?.path && !openFilePaths().includes(file.path)) {
      openFilePaths.update(tabs => [...tabs, file.path]);
    }
  });

  effect(() => {
    const requested = auxSelectedFilePath();
    if (!requested) return;
    if (openFile()?.path !== requested) {
      void openFileAt(requested);
    }
    auxSelectedFilePath.set(null);
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
      <If when={explorerOpen()}>
        <FileTree compact={props.compact} width={explorerWidth()} />
      </If>
      <If when={explorerOpen() && !props.compact}>
        <SplitHandle
          accessibilityLabel="Resize explorer pane"
          onReset={() => explorerWidth.set(260)}
          onDelta={dx =>
            explorerWidth.update(w =>
              Math.max(EXPLORER_MIN_WIDTH, Math.min(EXPLORER_MAX_WIDTH, w + dx)),
            )
          }
        />
      </If>
      <Preview compact={props.compact} />
    </View>
  );
}
