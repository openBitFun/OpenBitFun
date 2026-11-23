import { ToolPaneHeader } from "../ui/toolPane";
import {
  cleanup,
  Clipboard,
  computed,
  effect,
  Image,
  keymap,
  openUrl,
  untracked,
  Scroll,
  signal,
  Text,
  Video,
  View,
  WebView,
  type Point,
  type ViewRef,
} from "nsh";
import {
  DiffView,
  Editor,
  Tree,
  type EditorRef,
  type EditorSearchResult,
  type TextViewImage,
  type TreeEntry,
  type TreeItem,
} from "nsh/base";
import { basename, extensionOf, formatCount, formatPlural } from "../format";
import { localizeHostError, tr } from "../i18n";
import { isDesktopLocalShell, isRemotePeerContext } from "../shared/deviceScope";
import {
  basenameOfPath,
  dirnameOfPath,
  isPathAtOrUnder,
  isRemoteWorkspace as isRemoteWorkspaceRecord,
  joinWorkspacePath,
  resolveWorkspaceMarkdownLink,
} from "../shared/workspaceUtils";
import {
  beginEditFile,
  cancelCloseTab,
  cancelDelete,
  cancelEdit,
  cancelEditFile,
  cancelSaveConflict,
  changedOnDisk,
  changedPaths,
  closeOtherTabs,
  closeTab,
  commitEdit,
  confirmingCloseTab,
  confirmingDelete,
  dirChildren,
  dirnameOf,
  editingContent,
  expandedDirs,
  fileNotice,
  fileSaving,
  fileWatchState,
  gitChanges,
  gitListOpen,
  gitStatus,
  hasUnsavedEdit,
  holdFilesStatusWatch,
  ensureWorkspaceWatch,
  isDirtyPath,
  joinPath,
  keepDraftOverDisk,
  loadDirectory,
  loadRoot,
  openDiffReview,
  openFile,
  openFileAt,
  openFilePaths,
  pasteFromClipboard,
  pdfPreviewSupported,
  pathSep,
  pendingEdit,
  refreshDirectory,
  reloadFromDisk,
  removeSelected,
  requestCloseTab,
  requestDelete,
  retryFileWatch,
  revealPath,
  runFileSearch,
  saveAndCloseTab,
  scheduleFileSearch,
  searchCaseSensitive,
  searchRegex,
  searchRunning,
  searchTruncated,
  searchWholeWord,
  type SearchHit,
  saveConflict,
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
import { fleetDeviceById } from "../fleetStore";
import {
  activeWorkspace,
  activeWorkspaceId,
  activeWorkspaceRoot,
  auxSelectedFilePath,
  composerText,
  deviceContext,
  navigateScene,
} from "../state";
import { entryDeviceId, fleetActive, invokeCommand, windowShellId } from "../bridge";
import { mentionToken } from "../mentionStore";
import { readFileContent } from "../api";
import { openTerminal } from "../terminalStore";
import {
  compactLayout,
  elevationShadow,
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
import { deviceException, stateColor } from "../ui/fleet";
import { Icon, type IconName } from "../ui/icons";
import {
  createDiffViewStyles,
  createEditorStyles,
  inferCodeLanguage,
} from "../ui/markdown";
import {
  askAiInDocument,
  documentWebViewsAvailable,
  MarkdownDocumentEditor,
  MarkdownPreview,
  visualEditBlock,
  visualEditBlockMessage,
  VisualEditNotice,
} from "../ui/markdownEditor";
import {
  MOTION_DURATION,
  paintTransition,
  pressTransition,
  rotatingChevronStyle,
  Spinner,
  tactileActiveStyle,
} from "../ui/motion";
import { ImageViewerSurface, type ImageZoomState } from "../ui/ImageLightbox";
import { ContextMenuOverlay, DropdownMenu, pushToast, type DropdownMenuItem } from "../ui/overlays";
import {
  Button,
  EmptyStateCard,
  focusRingStyle,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  SegmentedTabs,
  SplitHandle,
  splitDragging,
  TooltipBubble,
} from "../ui/primitives";
import { RemoteWorkspaceStatusBanner } from "../ui/SshWorkspaceModals";
import {
  createSceneWidth,
  StackBackButton,
  WORKBENCH_TOUCH_MIN,
} from "../ui/workbenchLayout";

/** A directory that has not been read yet needs one row so that it can expand. */
const PLACEHOLDER_SUFFIX = "/\u0000loading";

const EXPLORER_MIN_WIDTH = 204;
const EXPLORER_MAX_WIDTH = 440;
const MAX_GUIDE_DEPTH = 6;
/** The desktop explorer's indent per level. */
const INDENT_STEP = 16;

const editValue = signal("");
const explorerOpen = signal(true);
const explorerWidth = signal(260);
const fileDiffLayout = signal<"unified" | "split">("unified");

// ── Documents (wave 22 P1): Markdown Preview | Edit, HTML and PDF previews ──

/** Markdown files the user chose to edit as source ("Edit as source"). */
const markdownSourcePaths = signal<Record<string, true>>({});
/** The rendered preview is showing over a Markdown draft that is kept. */
const markdownPreviewing = signal(false);
/** HTML files showing their rendered preview instead of the source. */
const htmlPreviewPaths = signal<Record<string, true>>({});

/** Why the open Markdown file edits as source on its own (the fidelity guard), decided per file text. */
const markdownBlock = computed(() => {
  const file = openFile();
  if (!file || file.kind !== "markdown" || file.large) return null;
  return visualEditBlock(untracked(() => editingContent()) ?? file.content);
});

type MarkdownMode = "preview" | "visual" | "source";

/** What the Markdown body shows: the preview, the visual editor or the source editor. */
const markdownMode = computed<MarkdownMode | null>(() => {
  const file = openFile();
  if (!file || file.kind !== "markdown") return null;
  if (editingContent() === null || markdownPreviewing()) return "preview";
  if (file.large || markdownSourcePaths()[file.path] || markdownBlock()) return "source";
  return "visual";
});

function enterMarkdownEdit(): void {
  markdownPreviewing.set(false);
  if (editingContent() === null) beginEditFile();
}

/** Preview keeps an unsaved draft (and shows it); a clean file just leaves edit mode. */
function showMarkdownPreview(): void {
  if (hasUnsavedEdit()) {
    markdownPreviewing.set(true);
    return;
  }
  markdownPreviewing.set(false);
  cancelEditFile();
}

function setMarkdownSource(path: string, source: boolean): void {
  markdownSourcePaths.update(current => {
    const next = { ...current };
    if (source) next[path] = true;
    else delete next[path];
    return next;
  });
}

function isHtmlFile(path: string): boolean {
  const ext = extensionOf(path);
  return ext === "html" || ext === "htm";
}

const htmlPreviewing = computed(() => {
  const file = openFile();
  return Boolean(file && file.kind === "code" && isHtmlFile(file.path) && htmlPreviewPaths()[file.path]);
});

function setHtmlPreview(path: string, preview: boolean): void {
  htmlPreviewPaths.update(current => {
    const next = { ...current };
    if (preview) next[path] = true;
    else delete next[path];
    return next;
  });
}

/**
 * "Open in browser" asks the OS of the device that owns the file: offered only
 * in the desktop app, for a local workspace of this same device.
 */
function canOpenInSystemBrowser(): boolean {
  if (windowShellId() !== "nsh-desktop" || isRemoteWorkspace()) return false;
  return !fleetActive() || !deviceContext() || deviceContext() === entryDeviceId();
}

async function openHtmlInSystemBrowser(path: string): Promise<void> {
  try {
    await invokeCommand<unknown>("open_html_file_in_browser", { path });
  } catch (error) {
    pushToast(localizeHostError(error instanceof Error ? error.message : String(error)), "error");
  }
}

function docMenuItems(): DropdownMenuItem[] {
  const file = openFile();
  if (!file) return [];
  const mode = markdownMode();
  const items: DropdownMenuItem[] = [];
  if (mode === "visual") {
    items.push({
      id: "doc-ask-ai",
      label: tr("doc.askAi"),
      icon: "sparkles",
      accessibilityLabel: "doc-ask-ai",
      onSelect: () => askAiInDocument(file.path),
    });
    items.push({
      id: "doc-edit-source",
      label: tr("doc.editAsSource"),
      icon: "code",
      accessibilityLabel: "doc-edit-source",
      onSelect: () => setMarkdownSource(file.path, true),
    });
  }
  if (mode === "source" && markdownSourcePaths()[file.path]) {
    items.push({
      id: "doc-edit-visual",
      label: tr("doc.editVisually"),
      icon: "file-text",
      accessibilityLabel: "doc-edit-visual",
      onSelect: () => {
        // A source draft the visual editor cannot keep stays in the source editor.
        const block = visualEditBlock(editingContent() ?? file.content);
        if (block) {
          pushToast(visualEditBlockMessage(block));
          return;
        }
        setMarkdownSource(file.path, false);
      },
    });
  }
  return items;
}

/** A PDF in the desktop's web view: its own viewer draws it, from the bytes the host read. */
function pdfDocumentHtml(base64: string, background: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:${background}}` +
    `embed{width:100%;height:100%;border:0}</style></head><body>` +
    `<embed src="data:application/pdf;base64,${base64}" type="application/pdf"></body></html>`
  );
}

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

function fileIconColor(_path: string, isDir: boolean, selected: boolean): string {
  if (selected) return palette().accent;
  return isDir ? palette().textSecondary : palette().textMuted;
}

const changedAncestors = computed(() => {
  const ancestors = new Set<string>();
  for (const path of changedPaths()) {
    let dir = dirnameOf(path);
    while (dir && !ancestors.has(dir)) {
      ancestors.add(dir);
      const parent = dirnameOf(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return ancestors;
});

function hasChangedDescendant(dirPath: string): boolean {
  const normalized = dirPath.replace(/[\\/]+$/, "");
  return changedAncestors().has(dirPath) || changedAncestors().has(normalized);
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
  const remote = isRemoteWorkspace();
  const normalizedRoot = remote
    ? rootPath === "/"
      ? "/"
      : rootPath.replace(/\/+$/, "")
    : /^[A-Za-z]:[\\/]+$/.test(rootPath)
      ? rootPath.slice(0, 3)
      : rootPath === "/"
        ? "/"
        : rootPath.replace(/[\\/]+$/, "");
  if (normalizedRoot && isPathAtOrUnder(filePath, normalizedRoot, remote)) {
    const restRaw =
      normalizedRoot === "/" || /^[A-Za-z]:[\\/]$/.test(normalizedRoot)
        ? filePath.slice(normalizedRoot.length)
        : filePath.slice(normalizedRoot.length);
    const rest = remote ? restRaw.replace(/^\/+/, "") : restRaw.replace(/^[\\/]+/, "");
    const parts = rest ? rest.split(remote ? /\/+/ : /[\\/]+/).filter(Boolean) : [];
    const segments: BreadcrumbSegment[] = [
      {
        label: basenameOfPath(normalizedRoot, remote) || normalizedRoot,
        path: normalizedRoot,
        isLast: parts.length === 0,
      },
    ];
    let current = normalizedRoot;
    parts.forEach((part, index) => {
      current = joinWorkspacePath(current, part, remote);
      segments.push({
        label: part,
        path: current,
        isLast: index === parts.length - 1,
      });
    });
    return segments;
  }
  const parts = filePath.split(remote ? /\/+/ : /[\\/]+/).filter(Boolean);
  if (parts.length === 0) return [{ label: filePath, path: filePath, isLast: true }];
  const prefix = filePath.startsWith("/") ? "/" : "";
  let current = "";
  return parts.map((part, index) => {
    current = current ? joinWorkspacePath(current, part, remote) : `${prefix}${part}`;
    return {
      label: part,
      path: current,
      isLast: index === parts.length - 1,
    };
  });
}

async function copyText(text: string): Promise<void> {
  try {
    await Clipboard.writeText(text);
    pushToast(tr("files.copied"), "success");
  } catch (error) {
    pushToast(localizeHostError(error), "error");
  }
}

function isEditableKind(kind: string): boolean {
  return kind === "code" || kind === "markdown" || kind === "text";
}

function isDirectoryPath(path: string): boolean {
  return path === activeWorkspaceRoot() || knownDirectoryPaths().has(path);
}

function isRemoteWorkspace(): boolean {
  return isRemoteWorkspaceRecord(activeWorkspace());
}

function revealInExplorerDisabled(): boolean {
  return isRemoteWorkspace() || isRemotePeerContext() || !isDesktopLocalShell();
}

async function revealInSystemExplorer(path: string): Promise<void> {
  if (revealInExplorerDisabled()) {
    pushToast(tr("files.revealLocalOnly"), "error");
    return;
  }
  const workspaceId = activeWorkspaceId();
  try {
    await invokeCommand<unknown>("reveal_in_explorer", { path, ...(workspaceId ? { workspaceId } : {}) });
  } catch (error) {
    pushToast(localizeHostError(error instanceof Error ? error.message : String(error)), "error");
  }
}

function addPathToChat(path: string, directory: boolean): void {
  const name = basename(path) || path;
  composerText.update(text => `${text}${text && !text.endsWith(" ") ? " " : ""}${mentionToken({ path, name, directory })}`);
  pushToast(tr("files.addedToChat", { name }), "success");
}

function openTerminalAt(path: string): void {
  const directory = isDirectoryPath(path) ? path : dirnameOf(path) || activeWorkspaceRoot();
  void openTerminal(activeWorkspaceId(), directory);
  navigateScene("terminal");
}

/**
 * The explorer's menu, for one path (the row under the cursor) or the root.
 * Items the workspace cannot honour (revealing a remote file in this machine's
 * file manager) stay visible and disabled, with the reason in their label.
 */
function fileMenuItems(target: string | null = selectedPath()): DropdownMenuItem[] {
  const hasSelection = Boolean(target);
  const selected = target ?? "";
  const directory = hasSelection ? isDirectoryPath(selected) : true;
  const createIn = (mode: "file" | "directory") => {
    if (target) selectedPath.set(target);
    else selectedPath.set(null);
    startCreate(mode);
  };
  const items: DropdownMenuItem[] = [];
  if (hasSelection && !directory) {
    items.push({
      id: "open",
      label: tr("files.open"),
      icon: "file-code",
      onSelect: () => void openFileAt(selected),
    });
  }
  items.push(
    {
      id: "new-file",
      label: tr("files.newFile"),
      icon: "plus",
      accessibilityLabel: "New file",
      onSelect: () => createIn("file"),
    },
    {
      id: "new-folder",
      label: tr("files.newFolder"),
      icon: "folder-plus",
      accessibilityLabel: "New folder",
      onSelect: () => createIn("directory"),
    },
    {
      id: "paste",
      label: tr("common.paste"),
      icon: "copy",
      accessibilityLabel: "Paste",
      onSelect: () => void pasteFromClipboard(target ?? undefined),
    },
    { id: "sep-1", label: "", separator: true },
  );
  if (hasSelection) {
    items.push(
      {
        id: "add-to-chat",
        label: tr("files.addToChat"),
        icon: "at",
        onSelect: () => addPathToChat(selected, directory),
      },
      {
        id: "copy-path",
        label: tr("files.copyPath"),
        icon: "copy",
        onSelect: () => void copyText(selected),
      },
      {
        id: "copy-relative-path",
        label: tr("files.copyRelativePath"),
        onSelect: () => void copyText(relativeDisplayPath(selected, activeWorkspaceRoot())),
      },
      {
        id: "reveal",
        label: revealInExplorerDisabled() ? tr("files.revealLocalOnly") : tr("files.revealInFinder"),
        icon: "external-link",
        disabled: revealInExplorerDisabled(),
        onSelect: () => void revealInSystemExplorer(selected),
      },
      {
        id: "terminal-here",
        label: tr("files.openTerminalHere"),
        icon: "terminal",
        onSelect: () => openTerminalAt(selected),
      },
      { id: "sep-2", label: "", separator: true },
    );
  }
  items.push(
    {
      id: "rename",
      label: tr("common.rename"),
      icon: "edit",
      disabled: !hasSelection,
      accessibilityLabel: "Rename",
      onSelect: () => {
        if (target) selectedPath.set(target);
        startRename();
      },
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
      confirmDelete: true,
      confirmAccessibilityLabel: "file-delete-confirm",
      disabled: !hasSelection,
      accessibilityLabel: "Delete",
      onSelect: () => {
        if (target) selectedPath.set(target);
        void removeSelected(target ?? selectedPath() ?? undefined);
      },
    },
  );
  return items;
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
  if (safe <= MAX_GUIDE_DEPTH) return 6 + safe * INDENT_STEP;
  return Math.min(160, 6 + MAX_GUIDE_DEPTH * INDENT_STEP + (safe - MAX_GUIDE_DEPTH) * 8);
}

function guideLevelsFor(depth: number): number[] {
  const count = Math.min(Math.max(0, depth), MAX_GUIDE_DEPTH);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(i);
  return out;
}

function decorationColor(letter: string | undefined): string {
  if (letter === "C") return stateColor("failed");
  if (letter === "U") return palette().textMuted;
  return palette().textSecondary;
}

/** Calm centered borderless empty prompt (never a lonely boxed wireframe card). */
function QuietEmptyPrompt(props: { icon: IconName; title: string; subtitle?: string }) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: space.sm,
        maxWidth: 340,
      }}
    >
      <View style={{ marginBottom: space.xs }}>
        <Icon name={props.icon} size={28} color={palette().textMuted} />
      </View>
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
              ...textStyle("caption", { color: palette().textSecondary }),
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
            gap: space.sm,
            paddingHorizontal: space.md,
            paddingVertical: space.md,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().panelRaised,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0 }}>
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
                ...textStyle("caption", { color: palette().text }),
                fontWeight: "600",
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
                ...textStyle("mono", { color: palette().textMuted }),
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
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
 * Search mode switcher (`Names` / `Contents`) on its own dedicated row below
 * the Explorer search input, so `file-search` keeps the full explorer width
 * and labels stay readable at whole-pixel `caption` (`12px`) contrast.
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
        minHeight: compactLayout() ? 32 : 24,
        padding: 2,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().segmentedTrackBg,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        flexShrink: 0,
      }}
    >
      <Each of={modes} key={item => item.value}>
        {item => (
          <View
            role="tab"
            accessibilityLabel={item().a11y}
            accessibilityState={{ selected: searchMode() === item().value }}
            hitSlop={touchSlop(24)}
            onPress={() => {
              searchMode.set(item().value);
              void runFileSearch();
            }}
            style={{
              minHeight: compactLayout() ? 28 : 20,
              paddingHorizontal: space.sm,
              borderRadius: radii.xs,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                searchMode() === item().value ? palette().panelRaised : "transparent",
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{
              backgroundColor:
                searchMode() === item().value
                  ? palette().panelRaised
                  : palette().surfaceSubtle,
            }}
            activeStyle={tactileActiveStyle(0.97)}
            focusVisibleStyle={focusRingStyle()}
          >
            <Text
              style={{
                ...textStyle("caption", {
                  color:
                    searchMode() === item().value ? palette().text : palette().textSecondary,
                }),
                fontWeight: searchMode() === item().value ? "600" : "500",
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
 * Calm collapsible changed-files banner above the tree: subtle branch label,
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
          gap: space.xs,
          minHeight: compactLayout() ? WORKBENCH_TOUCH_MIN : 28,
          paddingHorizontal: props.compact ? space.sm : space.md,
          paddingVertical: space.xs,
          minWidth: 0,
          cursor: "pointer",
          userSelect: "none",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().panelHover }}
        activeStyle={{ opacity: 0.88 }}
        focusVisibleStyle={focusRingStyle()}
      >
        <View style={rotatingChevronStyle(gitListOpen())}>
          <Icon name="chevron-right" size={12} color={palette().textMuted} />
        </View>
        <Text
          style={{
            ...textStyle("caption", { color: palette().textSecondary, tabular: true }),
            fontWeight: "600",
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
                  paddingHorizontal: space.xs,
                  overflow: "hidden",
                }}
              >
                <Text
                  style={{
                    minWidth: 0,
                    flexShrink: 1,
                    ...textStyle("mono", { color: palette().textMuted }),
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
            ...textStyle("caption", { color: palette().textMuted }),
            fontWeight: "500",
            flexShrink: 0,
          }}
        >
          {gitListOpen() ? tr("common.hide") : tr("common.show")}
        </Text>
      </View>
      <If when={gitListOpen()}>
        <Scroll style={{ maxHeight: props.compact ? 120 : 176, minHeight: 0 }}>
          <View style={{ paddingHorizontal: space.xs, paddingBottom: space.xs, gap: 2 }}>
            <Each of={changedPaths()} key={path => path}>
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
        minHeight: compactLayout() ? WORKBENCH_TOUCH_MIN : 28,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        backgroundColor: openFile()?.path === props.path ? palette().accentSoft : "transparent",
        cursor: "pointer",
        userSelect: "none",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor:
          openFile()?.path === props.path ? palette().accentSoft : palette().panelHover,
      }}
      activeStyle={{ opacity: 0.88 }}
      focusVisibleStyle={focusRingStyle()}
    >
      <Icon
        name={fileIconForPath(props.path, false, false)}
        size={14}
        color={fileIconColor(props.path, false, openFile()?.path === props.path)}
      />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Text
          style={{
            ...textStyle("caption", { color: palette().text }),
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
            ...textStyle("mono", { color: decorationColor(decoration()?.letter) }),
            fontWeight: "600",
          }}
        >
          {decoration()?.letter ?? "M"}
        </Text>
      </View>
    </View>
  );
}

interface SearchGroup {
  path: string;
  hits: SearchHit[];
}

/** Hits grouped by file, in the order the host ranked their first match. */
const searchGroups = computed<SearchGroup[]>(() => {
  const groups = new Map<string, SearchHit[]>();
  for (const hit of searchResults()) {
    const list = groups.get(hit.path);
    if (list) list.push(hit);
    else groups.set(hit.path, [hit]);
  }
  return [...groups.entries()].map(([path, hits]) => ({ path, hits }));
});

function openSearchHit(hit: SearchHit): void {
  pendingRevealLine.set(hit.line === undefined ? null : { path: hit.path, line: hit.line });
  void revealPath(hit.path);
}

/** One match line: the text before it, the match highlighted, the text after it. */
function SearchMatchRow(props: { hit: SearchHit }) {
  const style = () => ({
    ...textStyle("mono"),
  });
  return (
    <View
      role="button"
      accessibilityLabel={`search-hit-${props.hit.name}:${props.hit.line ?? 0}`}
      onPress={() => openSearchHit(props.hit)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        minHeight: compactLayout() ? WORKBENCH_TOUCH_MIN : 24,
        paddingLeft: space.xxl,
        paddingRight: space.sm,
        borderRadius: radii.xs,
        cursor: "pointer",
        userSelect: "none",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      focusVisibleStyle={focusRingStyle()}
    >
      <Text
        style={{
          minWidth: 28,
          ...textStyle("mono", { color: palette().textMuted, tabular: true }),
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {String(props.hit.line ?? "")}
      </Text>
      <Text style={{ flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis", ...style(), color: palette().textSecondary }}>
        {props.hit.previewBefore ?? ""}
        <Text
          style={{
            ...style(),
            color: palette().text,
            fontWeight: "600",
            backgroundColor: palette().accentSoft,
          }}
        >
          {props.hit.preview ?? ""}
        </Text>
        {props.hit.previewAfter ?? ""}
      </Text>
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
          gap: space.xs,
          paddingHorizontal: space.md,
          paddingTop: space.xs,
          paddingBottom: space.xs,
        }}
      >
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            ...textStyle("caption", { color: palette().textMuted, tabular: true }),
            fontWeight: "600",
            numberOfLines: 1,
          }}
        >
          {searchTruncated()
            ? tr("files.searchTruncated", { count: formatCount(searchResults().length) })
            : searchMode() === "content"
              ? tr("files.searchSummary", {
                  matches: formatPlural(searchResults().length, "format.matchOne", "format.matchOther"),
                  files: formatCount(searchGroups().length),
                })
              : formatPlural(searchResults().length, "format.matchOne", "format.matchOther")}
        </Text>
        <If when={searchRunning()}>
          <Spinner size={12} />
        </If>
        <IconButton
          icon="close"
          size="xs"
          iconSize={12}
          tooltip={tr("files.clearResults")}
          accessibilityLabel="clear-file-search-results"
          onPress={() => {
            searchResults.set([]);
            fileNotice.set("");
          }}
        />
      </View>
      <Scroll style={{ maxHeight: props.compact ? 160 : 280, minHeight: 0 }}>
        <View style={{ paddingHorizontal: space.xs, paddingBottom: space.xs, paddingTop: 2, gap: 2 }}>
          <Each of={searchGroups()} key={group => group.path}>
            {group => (
              <View style={{ gap: 2 }}>
                <View
                  role="button"
                  tooltip={<TooltipBubble text={relativeDisplayPath(group().path, activeWorkspaceRoot())} />}
                  onPress={() => openSearchHit(group().hits[0])}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.xs,
                    minHeight: compactLayout() ? WORKBENCH_TOUCH_MIN : 28,
                    paddingHorizontal: space.sm,
                    borderRadius: radii.xs,
                    cursor: "pointer",
                    userSelect: "none",
                    ...paintTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: palette().panelHover }}
                  focusVisibleStyle={focusRingStyle()}
                >
                  <Icon
                    name={fileIconForPath(group().path, false, false)}
                    size={14}
                    color={fileIconColor(group().path, false, false)}
                  />
                  <Text
                    style={{
                      ...textStyle("label", { color: palette().text }),
                      fontWeight: "500",
                      flexShrink: 0,
                      maxWidth: "60%",
                      numberOfLines: 1,
                      textOverflow: "ellipsis-middle",
                    }}
                  >
                    {basename(group().path)}
                  </Text>
                  <Text
                    style={{
                      flex: 1,
                      minWidth: 0,
                      ...textStyle("caption", { color: palette().textMuted }),
                      numberOfLines: 1,
                      textOverflow: "ellipsis-start",
                    }}
                  >
                    {parentHintOf(group().path, activeWorkspaceRoot())}
                  </Text>
                  <If when={group().hits.some(hit => hit.line !== undefined)}>
                    <Text
                      style={{
                        ...textStyle("caption", { color: palette().textMuted, tabular: true }),
                        flexShrink: 0,
                      }}
                    >
                      {formatCount(group().hits.length)}
                    </Text>
                  </If>
                </View>
                <Each
                  of={group()
                    .hits.filter(hit => hit.line !== undefined)
                    .map((hit, idx) => ({ hit, key: `${hit.path}:${hit.line}:${idx}` }))}
                  key={entry => entry.key}
                >
                  {entry => <SearchMatchRow hit={entry().hit} />}
                </Each>
              </View>
            )}
          </Each>
        </View>
      </Scroll>
    </View>
  );
}

function renderExplorerRow(
  entry: TreeEntry,
  touch: boolean,
  onContext: (path: string, pos: Point) => void,
) {
  if (entry.disabled && entry.id.endsWith(PLACEHOLDER_SUFFIX)) {
    return (
      <View
        style={{
          minHeight: 24,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          paddingLeft: explorerIndentLeft(entry.depth) + 18,
          paddingRight: space.sm,
          paddingVertical: 0,
        }}
      >
        <Spinner size={12} />
        <Text style={{ ...textStyle("caption", { color: palette().textMuted }) }}>
          {tr("common.loading")}
        </Text>
      </View>
    );
  }

  const guideLevels = guideLevelsFor(entry.depth);

  return (
    <View
      accessibilityLabel={`explorer-row-${entry.label}`}
      onContextMenu={event => onContext(entry.id, event.pagePosition)}
      style={{
        position: "relative",
        height: touch ? WORKBENCH_TOUCH_MIN : 26,
        minHeight: touch ? WORKBENCH_TOUCH_MIN : 26,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingLeft: explorerIndentLeft(entry.depth),
        paddingRight: space.sm,
        paddingVertical: 0,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        backgroundColor: selectedPath() === entry.id ? palette().accentSoft : "transparent",
        cursor: entry.disabled ? "default" : "pointer",
        userSelect: "none",
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
                left: 13 + level() * INDENT_STEP,
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
          <View style={rotatingChevronStyle(expandedDirs().includes(entry.id))}>
            <Icon
              name="chevron-right"
              size={12}
              color={selectedPath() === entry.id ? palette().accent : palette().textMuted}
            />
          </View>
        </If>
      </View>
      <Icon
        name={fileIconForPath(
          entry.id,
          entry.folder || knownDirectoryPaths().has(entry.id),
          expandedDirs().includes(entry.id),
        )}
        size={14}
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
          ...textStyle("label", {
            color:
              selectedPath() === entry.id
                ? palette().text
                : entry.disabled
                  ? palette().textMuted
                  : entry.folder || knownDirectoryPaths().has(entry.id)
                    ? palette().text
                    : palette().textSecondary,
          }),
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
              minWidth: space.lg,
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Text
              style={{
                ...textStyle("mono", { color: decorationColor(letter()) }),
                fontWeight: "600",
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
            width: 4,
            height: 4,
            borderRadius: radii.pill,
            backgroundColor: palette().textMuted,
            flexShrink: 0,
          }}
        />
      </If>
    </View>
  );
}

function FileTree(props: {
  compact?: boolean;
  width: number;
  stacked?: boolean;
  onOpenDetail: () => void;
}) {
  const fileActionsMenuOpen = signal(false);
  const fileActionsAnchor = signal<ViewRef | null>(null);
  const treeContextPos = signal<Point | null>(null);
  const treeContextOpen = signal(false);
  const treeContextTarget = signal<string | null>(null);
  let rowContextHandled = false;

  // Stacked: the list is the whole view (the detail is pushed over it instead).
  const split = () => Boolean(props.compact) && !props.stacked && Boolean(openFile());
  const rootLoaded = () => {
    const root = activeWorkspaceRoot();
    return Boolean(root && root in dirChildren());
  };

  return (
    <View
      style={{
        width: props.compact || props.stacked ? "100%" : props.width,
        height: split() ? "38%" : undefined,
        minWidth: 0,
        minHeight: split() ? 168 : 0,
        maxHeight: split() ? 304 : undefined,
        flex: props.stacked || (props.compact && !openFile()) ? 1 : undefined,
        flexShrink: props.stacked || (props.compact && !openFile()) ? 1 : 0,
        overflow: "hidden",
        flexDirection: "column",
        borderRightWidth: 0,
        borderBottomWidth: split() ? 1 : 0,
        borderColor: palette().borderSubtle,
        backgroundColor: props.stacked ? palette().canvas : palette().canvasSubtle,
      }}
    >
      {/* Explorer header: title + count + actions, full-width search field, dedicated mode row */}
      <View
        style={{
          paddingHorizontal: props.compact || props.stacked ? space.sm : space.md,
          paddingVertical: space.sm,
          gap: space.sm,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().canvasSubtle,
        }}
      >
        {/* Row 1: Explorer label + quiet tabular item count + New / Refresh / More */}
        <View
          style={{
            minHeight: compactLayout() ? WORKBENCH_TOUCH_MIN : 24,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            minWidth: 0,
          }}
        >
          <Text
            style={{
              ...textStyle("caption", {
                color: props.compact ? palette().textSecondary : palette().text,
              }),
              fontWeight: "600",
              flexShrink: 0,
            }}
          >
            {tr("files.explorer")}
          </Text>
          <Text
            style={{
              ...textStyle("caption", { color: palette().textMuted, tabular: true }),
              flexShrink: 0,
            }}
          >
            {formatCount(treeItems().length)}
          </Text>
          <View style={{ flex: 1, minWidth: 0 }} />
          <If when={fileWatchState().kind === "unsupported"}>
            <View
              accessibilityLabel="file-watch-unsupported"
              tooltip={<TooltipBubble text={tr("files.watchUnsupportedHint")} />}
              style={{ flexShrink: 1, minWidth: 0 }}
            >
              <Text
                style={{
                  ...textStyle("caption", { color: palette().warning }),
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {tr("files.watchUnsupported")}
              </Text>
            </View>
          </If>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <IconButton
              icon="plus"
              size={compactLayout() ? "md" : "xs"}
              iconSize={compactLayout() ? undefined : 12}
              tooltip={tr("files.newFile")}
              accessibilityLabel="file-quick-new"
              onPress={() => startCreate("file")}
            />
            <IconButton
              icon="refresh"
              size={compactLayout() ? "md" : "xs"}
              iconSize={compactLayout() ? undefined : 12}
              tooltip={tr("files.refreshExplorer")}
              accessibilityLabel="Refresh"
              onPress={() => void refreshDirectory(activeWorkspaceRoot())}
            />
            <View ref={el => fileActionsAnchor.set(el)} style={{ flexShrink: 0 }}>
              <IconButton
                icon="more"
                size={compactLayout() ? "md" : "xs"}
                iconSize={compactLayout() ? undefined : 12}
                active={fileActionsMenuOpen()}
                tooltip={tr("files.fileActions")}
                accessibilityLabel="file-actions-menu"
                onPress={() => fileActionsMenuOpen.set(!fileActionsMenuOpen())}
              />
            </View>
          </View>
        </View>

        {/* Row 2: Full-width Explorer search field (never crushed by mode toggle) */}
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
          onChange={val => {
            searchQuery.set(val);
            if (!val.trim()) {
              searchResults.set([]);
              fileNotice.set("");
            }
            scheduleFileSearch();
          }}
          onSubmit={() => void runFileSearch()}
        />

        {/* Row 3: Search mode switcher (Names / Contents) + optional content match toggles */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs }}>
          <InlineSearchModeToggle />
          <If when={searchMode() === "content" || searchQuery().trim()}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
              <FindToggle
                label="Aa"
                a11y="file-search-case"
                tooltip={tr("files.matchCase")}
                active={searchCaseSensitive()}
                onPress={() => {
                  searchCaseSensitive.set(!searchCaseSensitive());
                  scheduleFileSearch();
                }}
              />
              <FindToggle
                label="ab"
                a11y="file-search-word"
                tooltip={tr("files.matchWholeWord")}
                active={searchWholeWord()}
                onPress={() => {
                  searchWholeWord.set(!searchWholeWord());
                  scheduleFileSearch();
                }}
              />
              <FindToggle
                label=".*"
                a11y="file-search-regex"
                tooltip={tr("files.useRegex")}
                active={searchRegex()}
                onPress={() => {
                  searchRegex.set(!searchRegex());
                  scheduleFileSearch();
                }}
              />
            </View>
          </If>
        </View>

        <If when={fileWatchState().kind === "failed"}>
          <View
            role="alert"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: space.xs,
              paddingVertical: space.xs,
            }}
          >
            <Icon name="warning" size={14} color={palette().warning} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={{ ...textStyle("caption", { color: palette().text }) }}>
                {tr("files.watchFailed")}
              </Text>
              <If when={(() => { const state = fileWatchState(); return state.kind === "failed" ? state.hint ?? "" : ""; })()}>
                {hint => (
                  <Text
                    style={{
                      userSelect: "text",
                      ...textStyle("mono", { color: palette().textSecondary }),
                    }}
                  >
                    {hint()}
                  </Text>
                )}
              </If>
            </View>
            <Button
              label={tr("files.watchRetry")}
              accessibilityLabel="file-watch-retry"
              variant="ghost"
              size="xs"
              onPress={() => void retryFileWatch()}
            />
          </View>
        </If>

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
      <If when={Boolean(searchQuery().trim()) && !searchRunning() && searchResults().length === 0}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.sm,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
          }}
        >
          <Text style={{ flex: 1, minWidth: 0, ...textStyle("caption", { color: palette().textMuted }) }}>
            {tr("files.findNoResults")}
          </Text>
          <Button
            label={tr("common.clearSearch")}
            size="xs"
            variant="ghost"
            accessibilityLabel="clear-empty-file-search"
            onPress={() => {
              searchQuery.set("");
              searchResults.set([]);
              fileNotice.set("");
            }}
          />
        </View>
      </If>
      <View
        style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
        onContextMenu={event => {
          // A row already claimed this press; the empty space below the rows is the root.
          if (rowContextHandled) {
            rowContextHandled = false;
            return;
          }
          treeContextTarget.set(null);
          treeContextPos.set(event.pagePosition);
          treeContextOpen.set(true);
        }}
      >
        <If
          when={Boolean(activeWorkspace())}
          else={
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg }}>
              <EmptyStateCard
                icon="folder"
                title={tr("git.noWorkspaceTitle")}
                subtitle={tr("git.noWorkspaceSubtitle")}
              />
            </View>
          }
        >
          <If
            when={rootLoaded()}
            else={
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: space.sm,
                  padding: space.lg,
                }}
              >
                <Spinner size={14} />
                <Text style={{ ...textStyle("caption", { color: palette().textMuted }) }}>
                  {tr("common.loading")}
                </Text>
              </View>
            }
          >
            <Tree
              items={treeItems()}
              expanded={expandedDirs()}
              selected={selectedPath()}
              reveal={false}
              renderItem={entry =>
                renderExplorerRow(entry, compactLayout(), (path, pos) => {
                  rowContextHandled = true;
                  treeContextTarget.set(path);
                  treeContextPos.set(pos);
                  treeContextOpen.set(true);
                })
              }
              itemClass="group rounded-md focus-visible:outline-2 focus-visible:outline-ring"
              itemStyle={{
                color: palette().text,
                fontSize: textSize(13),
                paddingVertical: 0,
                paddingHorizontal: 0,
                minHeight: 0,
              }}
              listStyle={{ padding: space.xs, gap: 1 }}
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
                if (!knownDirectoryPaths().has(event.selected)) {
                  props.onOpenDetail();
                  void openFileAt(event.selected);
                }
              }}
              onAction={event => {
                if (!knownDirectoryPaths().has(event.id)) {
                  props.onOpenDetail();
                  void openFileAt(event.id);
                }
              }}
            />
          </If>
        </If>
      </View>
      <ContextMenuOverlay
        open={treeContextOpen()}
        position={treeContextPos()}
        items={fileMenuItems(treeContextTarget())}
        onClose={() => treeContextOpen.set(false)}
      />
    </View>
  );
}

function tabMenuItems(path: string): DropdownMenuItem[] {
  return [
    {
      id: "tab-close",
      label: tr("files.closeTab"),
      icon: "close",
      onSelect: () => requestCloseTab(path),
    },
    {
      id: "tab-close-others",
      label: tr("files.closeOtherTabs"),
      disabled: openFilePaths().length < 2,
      onSelect: () => closeOtherTabs(path),
    },
    { id: "tab-sep", label: "", separator: true },
    {
      id: "tab-copy-path",
      label: tr("files.copyPath"),
      icon: "copy",
      onSelect: () => void copyText(path),
    },
    {
      id: "tab-copy-relative",
      label: tr("files.copyRelativePath"),
      onSelect: () => void copyText(relativeDisplayPath(path, activeWorkspaceRoot())),
    },
    {
      id: "tab-reveal",
      label: tr("files.revealInExplorer"),
      icon: "folder-open",
      onSelect: () => void revealPath(path),
    },
  ];
}

/**
 * One flat editor tab: no box, a 2 px accent under the active one, the file's
 * icon, a persistent dirty indicator alongside an always-reachable close button
 * on touch/phone and active/hovered tabs, middle-click to close, and context menu.
 */
function OpenFileTabChip(props: {
  path: string;
  compact?: boolean;
  onContext: (path: string, pos: Point) => void;
}) {
  const hovered = signal(false);
  const active = () => openFile()?.path === props.path;
  const dirty = () => isDirtyPath(props.path);
  const showClose = () => compactLayout() || Boolean(props.compact) || hovered() || active();

  return (
    <View
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      onMouseUp={event => {
        if (event.button === "middle") requestCloseTab(props.path);
      }}
      onContextMenu={event => props.onContext(props.path, event.pagePosition)}
      style={{
        boxSizing: "border-box",
        position: "relative",
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        gap: space.xs,
        paddingLeft: space.md,
        paddingRight: space.xs,
        height: compactLayout() ? WORKBENCH_TOUCH_MIN : props.compact ? 32 : 36,
        borderRightWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: active() ? palette().canvas : "transparent",
        userSelect: "none",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: active() ? palette().canvas : palette().panelHover,
      }}
    >
      <View
        role="tab"
        tooltip={<TooltipBubble text={relativeDisplayPath(props.path, activeWorkspaceRoot())} />}
        accessibilityLabel={`file-tab-${basename(props.path)}`}
        accessibilityState={{ selected: active() }}
        onPress={() => {
          if (!active()) void openFileAt(props.path);
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          height: "100%",
          paddingRight: 2,
          cursor: "pointer",
          userSelect: "none",
        }}
        focusVisibleStyle={focusRingStyle()}
      >
        <Icon
          name={fileIconForPath(props.path, false, false)}
          size={14}
          color={fileIconColor(props.path, false, active())}
        />
        <Text
          style={{
            maxWidth: props.compact ? 120 : 180,
            ...textStyle("label", {
              color: active() ? palette().text : palette().textSecondary,
            }),
            fontWeight: active() ? "500" : "400",
            textDecorationLine: changedOnDisk()[props.path] === "deleted" ? "line-through" : "none",
            numberOfLines: 1,
            textOverflow: "ellipsis-middle",
          }}
        >
          {basename(props.path) || props.path}
        </Text>
        <If when={dirty()}>
          <View
            accessibilityLabel={`file-tab-dirty-${basename(props.path)}`}
            style={{
              width: 6,
              height: 6,
              borderRadius: radii.pill,
              backgroundColor: palette().textSecondary,
              flexShrink: 0,
            }}
          />
        </If>
      </View>
      <View
        style={{
          width: 24,
          height: 24,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          opacity: showClose() ? 1 : 0.45,
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <IconButton
          icon="close"
          size="xs"
          iconSize={12}
          tooltip={tr("files.closeTab")}
          accessibilityLabel={`close-file-tab-${basename(props.path)}`}
          onPress={() => requestCloseTab(props.path)}
        />
      </View>
      <If when={active()}>
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            backgroundColor: palette().accent,
            pointerEvents: "none",
          }}
        />
      </If>
    </View>
  );
}

function OpenFileTabStrip(props: { compact?: boolean }) {
  const tabContextPath = signal<string | null>(null);
  const tabContextPos = signal<Point | null>(null);
  return (
    <If
      when={openFilePaths().length > 0}
      else={
        <Text
          accessibilityLabel={tr("files.selectToPreview")}
          style={{
            flex: 1,
            minWidth: 0,
            paddingHorizontal: space.xs,
            ...textStyle("caption", { color: palette().textMuted }),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {tr("pane.files.choose")}
        </Text>
      }
    >
      <Scroll
        horizontal
        style={{ flex: 1, minWidth: 0, alignSelf: "stretch" }}
        scrollbar={false}
      >
        <View style={{ flexDirection: "row", alignItems: "stretch", height: "100%" }}>
          <Each of={openFilePaths()} key={path => path}>
            {path => (
              <OpenFileTabChip
                path={path()}
                compact={props.compact}
                onContext={(target, pos) => {
                  tabContextPath.set(target);
                  tabContextPos.set(pos);
                }}
              />
            )}
          </Each>
        </View>
      </Scroll>
      <ContextMenuOverlay
        open={tabContextPath() !== null}
        position={tabContextPos()}
        items={tabMenuItems(tabContextPath() ?? "")}
        onClose={() => tabContextPath.set(null)}
      />
    </If>
  );
}

const editorRef = signal<EditorRef | null>(null);
const editorCursor = signal<{ line: number; column: number; selectedLines: number } | null>(null);
const findOpen = signal(false);
const findQuery = signal("");
const findCase = signal(false);
const findWord = signal(false);
const findRegex = signal(false);
const findResult = signal<EditorSearchResult | null>(null);
/** A line the editor should reveal once the file it belongs to is on screen. */
const pendingRevealLine = signal<{ path: string; line: number } | null>(null);

function openFind(): void {
  const file = openFile();
  if (!file || (file.kind !== "code" && editingContent() === null)) return;
  findOpen.set(true);
}

function closeFind(): void {
  findOpen.set(false);
  findResult.set(null);
  editorRef()?.focus();
}

function FindToggle(props: { label: string; a11y: string; active: boolean; tooltip: string; onPress: () => void }) {
  return (
    <View
      role="checkbox"
      accessibilityLabel={props.a11y}
      accessibilityState={{ checked: props.active }}
      tooltip={<TooltipBubble text={props.tooltip} />}
      hitSlop={touchSlop(24)}
      onPress={props.onPress}
      style={{
        minWidth: 24,
        height: compactLayout() ? 32 : 24,
        paddingHorizontal: space.xs,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.active ? palette().accentBorder : "transparent",
        backgroundColor: props.active ? palette().accentSoft : "transparent",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: props.active ? palette().accentSoft : palette().panelHover }}
      activeStyle={tactileActiveStyle(0.96)}
      focusVisibleStyle={focusRingStyle()}
    >
      <Text
        style={{
          ...textStyle("mono", {
            color: props.active ? palette().accent : palette().textSecondary,
          }),
          fontWeight: "600",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/** The editor's find bar: the Editor's own `search`, with case / word / regex and match count. */
function EditorFindBar() {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().canvasSubtle,
      }}
    >
      <View style={{ flex: 1, minWidth: 140, maxWidth: 360 }}>
        <InputBox
          size="sm"
          leadingIcon="search"
          value={findQuery()}
          placeholder={tr("files.findPlaceholder")}
          accessibilityLabel="file-find-input"
          autoFocus={true}
          onChange={value => findQuery.set(value)}
          onSubmit={() => editorRef()?.run("findNext")}
          onKeyPress={event => {
            if (event.key === "Escape") closeFind();
          }}
        />
      </View>
      <FindToggle label="Aa" a11y="file-find-case" tooltip={tr("files.matchCase")} active={findCase()} onPress={() => findCase.set(!findCase())} />
      <FindToggle label="ab" a11y="file-find-word" tooltip={tr("files.matchWholeWord")} active={findWord()} onPress={() => findWord.set(!findWord())} />
      <FindToggle label=".*" a11y="file-find-regex" tooltip={tr("files.useRegex")} active={findRegex()} onPress={() => findRegex.set(!findRegex())} />
      <Text
        style={{
          minWidth: 64,
          ...textStyle("caption", {
            color: findResult()?.error ? palette().danger : palette().textMuted,
            tabular: true,
          }),
          numberOfLines: 1,
        }}
      >
        {findResult()?.error
          ? tr("files.findInvalidRegex")
          : !findQuery()
            ? ""
            : (findResult()?.count ?? 0) === 0
              ? tr("files.findNoResults")
              : tr("files.findCount", {
                  current: (findResult()?.current ?? -1) + 1 || "?",
                  total: formatCount(findResult()?.count ?? 0),
                })}
      </Text>
      <IconButton icon="chevron-up" size="xs" iconSize={12} tooltip={tr("files.findPrevious")} accessibilityLabel="file-find-previous" onPress={() => editorRef()?.run("findPrevious")} />
      <IconButton icon="chevron-down" size="xs" iconSize={12} tooltip={tr("files.findNext")} accessibilityLabel="file-find-next" onPress={() => editorRef()?.run("findNext")} />
      <IconButton icon="close" size="xs" iconSize={12} tooltip={tr("common.close")} accessibilityLabel="file-find-close" onPress={closeFind} />
    </View>
  );
}

function lineEndingOf(text: string): "LF" | "CRLF" {
  return text.includes("\r\n") ? "CRLF" : "LF";
}

/** Line and column, selection, language, line ending and encoding, as an editor's status bar shows them. */
function EditorStatusBar() {
  const item = (text: string) => (
    <Text
      style={{
        ...textStyle("caption", { color: palette().textMuted, tabular: true }),
        numberOfLines: 1,
        flexShrink: 0,
      }}
    >
      {text}
    </Text>
  );
  return (
    <View
      style={{
        height: 24,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        borderTopWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().canvasSubtle,
      }}
    >
      <If when={openFile()?.large}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 1, minWidth: 0 }}>
          <Icon name="warning" size={12} color={palette().warning} />
          <Text
            style={{
              ...textStyle("caption", { color: palette().warning }),
              numberOfLines: 1,
              flexShrink: 1,
            }}
          >
            {tr("files.largeFileMode")}
          </Text>
        </View>
      </If>
      <View style={{ flex: 1 }} />
      <If when={openFile() && isEditableKind(openFile()!.kind) ? editorCursor() : null}>
        {cursor =>
          item(
            cursor().selectedLines > 1
              ? tr("files.cursorWithLines", { line: cursor().line, column: cursor().column, lines: cursor().selectedLines })
              : tr("files.cursor", { line: cursor().line, column: cursor().column }),
          )
        }
      </If>
      <If when={openFile() && isEditableKind(openFile()!.kind)}>
        {item(lineEndingOf(openFile()?.content ?? ""))}
        {item("UTF-8")}
      </If>
      {item(
        openFile()?.kind === "diff"
          ? tr("files.diffTab")
          : inferCodeLanguage(openFile()?.path ?? "") || openFile()?.language || openFile()?.kind || "",
      )}
    </View>
  );
}

/** The image viewer's zoom: fitted to the pane, or a factor of the natural size. */
const imageZoom = signal<ImageZoomState>("fit");

/** Resolves a document-relative reference (`./img/a.png`, `../b.md`) against the document's folder. */
function resolveDocumentPath(documentPath: string, reference: string): string {
  const sep = pathSep(documentPath);
  const cleaned = reference.split(/[?#]/)[0];
  let decoded = cleaned;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    decoded = cleaned;
  }
  if (decoded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(decoded)) return decoded;
  const parts = dirnameOf(documentPath).split(/[\\/]/);
  for (const segment of decoded.split(/[\\/]/)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > 1) parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join(sep);
}

function isExternalUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[A-Za-z]:[\\/]/.test(url);
}

/** Workspace images referenced by a Markdown file, read once as data URLs. */
const markdownImageCache = signal<Record<string, string | null>>({});
const markdownImagePending = new Set<string>();

function loadMarkdownImage(path: string): void {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId || markdownImagePending.has(path) || path in markdownImageCache()) return;
  markdownImagePending.add(path);
  void readFileContent(workspaceId, path, "base64")
    .then(encoded => {
      const ext = extensionOf(path);
      const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext || "png"}`;
      markdownImageCache.update(current => ({ ...current, [path]: encoded ? `data:${mime};base64,${encoded}` : null }));
    })
    .catch(() => markdownImageCache.update(current => ({ ...current, [path]: null })))
    .finally(() => markdownImagePending.delete(path));
}

/**
 * An image in a Markdown preview. Web and data URLs load as they are; a path
 * inside the workspace is read through the host (`read_file_content`, base64),
 * which works for a remote workspace too. Reactive to prop/workspace changes.
 */
function MarkdownImage(props: { image: TextViewImage; documentPath: string }) {
  const external = () => isExternalUrl(props.image.src);
  const path = () => (external() ? "" : resolveDocumentPath(props.documentPath, props.image.src));
  effect(() => {
    const _workspace = activeWorkspaceId();
    const target = path();
    void _workspace;
    if (target) {
      untracked(() => loadMarkdownImage(target));
    }
  });
  const source = () => (external() ? props.image.src : markdownImageCache()[path()] ?? "");
  const width = () => (typeof props.image.width === "number" ? props.image.width : undefined);
  const height = () => (typeof props.image.height === "number" ? props.image.height : undefined);
  return (
    <If
      when={source()}
      else={
        <Text style={{ ...textStyle("caption", { color: palette().textMuted }) }}>
          {markdownImageCache()[path()] === null
            ? tr("files.imageUnavailable", { name: props.image.alt || basename(path()) })
            : props.image.alt || basename(path())}
        </Text>
      }
    >
      <Image
        src={source()}
        accessibilityLabel={props.image.alt || basename(path() || props.image.src)}
        style={{
          maxWidth: "100%",
          ...(width() ? { width: width() } : {}),
          ...(height() ? { height: height() } : {}),
          objectFit: "contain",
          borderRadius: radii.sm,
        }}
      />
    </If>
  );
}

/** A link in a Markdown preview: web/mailto links open outside, workspace/file:// links open here. */
function openMarkdownLink(url: string, documentPath: string): void {
  const remote = isRemoteWorkspace();
  const baseDir = dirnameOfPath(documentPath, remote) || activeWorkspaceRoot();
  const resolved = resolveWorkspaceMarkdownLink(url, baseDir, remote);
  if (resolved.kind === "external") {
    void openUrl(resolved.target).catch(() => undefined);
    return;
  }
  if (resolved.kind === "workspace") {
    void revealPath(resolved.target);
  }
}

/**
 * The bars above the editor that need an answer: a dirty tab waiting to close,
 * a save stopped by a newer disk copy, an open file that changed or went away
 * on disk. Each is in-scene, so a remote controller can answer it too.
 */
function FileAttentionBars(props: { compact?: boolean }) {
  return (
    <View style={{ flexDirection: "column" }}>
      <If when={confirmingCloseTab()}>
        {path => (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: props.compact ? space.sm : space.md,
              paddingVertical: space.xs,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().canvasSubtle,
            }}
          >
            <View style={{ flex: 1, minWidth: 220 }}>
              <InlineConfirmBar
                message={tr("files.closeDirtyConfirm", { name: basename(path()) })}
                confirmLabel={tr("files.discardAndClose")}
                cancelLabel={tr("common.cancel")}
                danger={true}
                onConfirm={() => closeTab(path())}
                onCancel={cancelCloseTab}
              />
            </View>
            <If when={openFile()?.path === path()}>
              <Button
                label={tr("files.saveAndClose")}
                accessibilityLabel="file-save-and-close"
                variant="primary"
                size="xs"
                loading={fileSaving()}
                onPress={() => void saveAndCloseTab(path())}
              />
            </If>
          </View>
        )}
      </If>
      <If when={saveConflict()}>
        {path => (
          <AttentionBar
            tone="danger"
            icon="warning"
            message={tr("files.saveConflict", { name: basename(path()) })}
            actions={[
              {
                label: tr("files.overwrite"),
                a11y: "file-conflict-overwrite",
                variant: "danger",
                onPress: () => void saveEditedFile({ force: true }),
              },
              {
                label: tr("files.reloadFromDisk"),
                a11y: "file-conflict-reload",
                variant: "secondary",
                onPress: () => void reloadFromDisk(path()),
              },
              { label: tr("common.cancel"), a11y: "file-conflict-cancel", variant: "ghost", onPress: cancelSaveConflict },
            ]}
          />
        )}
      </If>
      <If when={openFile() && !saveConflict() ? changedOnDisk()[openFile()!.path] : undefined}>
        {state => (
          <AttentionBar
            tone="warning"
            icon="warning"
            message={
              state() === "deleted"
                ? tr("files.deletedOnDisk", { name: openFile()?.name ?? "" })
                : tr("files.changedOnDisk", { name: openFile()?.name ?? "" })
            }
            actions={[
              {
                label: state() === "deleted" ? tr("files.closeTab") : tr("files.reloadFromDisk"),
                a11y: "file-disk-reload",
                variant: "secondary",
                onPress: () => {
                  const path = openFile()?.path;
                  if (!path) return;
                  if (state() === "deleted") closeTab(path);
                  else void reloadFromDisk(path);
                },
              },
              {
                label: tr("files.keepMine"),
                a11y: "file-disk-keep",
                variant: "ghost",
                onPress: () => {
                  const path = openFile()?.path;
                  if (path) void keepDraftOverDisk(path);
                },
              },
            ]}
          />
        )}
      </If>
    </View>
  );
}

interface AttentionAction {
  label: string;
  a11y: string;
  variant: "primary" | "secondary" | "ghost" | "danger";
  onPress: () => void;
}

function AttentionBar(props: {
  tone: "warning" | "danger";
  icon: IconName;
  message: string;
  actions: AttentionAction[];
}) {
  return (
    <View
      role="alert"
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderBottomWidth: 1,
        borderLeftWidth: 2,
        borderColor: palette().borderSubtle,
        borderLeftColor: props.tone === "danger" ? palette().danger : palette().warning,
        backgroundColor: palette().canvasSubtle,
      }}
    >
      <Icon
        name={props.icon}
        size={14}
        color={props.tone === "danger" ? palette().danger : palette().warning}
      />
      <Text
        style={{
          flex: 1,
          minWidth: 160,
          ...textStyle("caption", { color: palette().text }),
        }}
      >
        {props.message}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
        <Each of={props.actions} key={action => action.a11y}>
          {action => (
            <Button
              label={action().label}
              accessibilityLabel={action().a11y}
              variant={action().variant}
              size="xs"
              onPress={action().onPress}
            />
          )}
        </Each>
      </View>
    </View>
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
              title={tr("pane.files.choose")}
              subtitle={undefined}
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
                    padding: props.compact ? space.lg : space.xxl,
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
                        ...textStyle("caption", { color: palette().textMuted }),
                        paddingHorizontal: space.md,
                        paddingVertical: space.sm,
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
                  language="text"
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
          <If when={markdownMode() === "preview"}>
            <Scroll style={{ flex: 1, minHeight: 0 }}>
              <View style={{ padding: props.compact ? space.lg : space.x3l, alignItems: "center" }}>
                <View style={{ width: "100%", maxWidth: layout.conversationWidth }}>
                  <MarkdownPreview
                    accessibilityLabel="file-markdown-preview"
                    markdown={editingContent() ?? file().content}
                    compact={props.compact}
                    renderImage={image => <MarkdownImage image={image} documentPath={file().path} />}
                    onLinkPress={event => openMarkdownLink(event.url, file().path)}
                  />
                </View>
              </View>
            </Scroll>
          </If>
          <If when={markdownMode() === "visual"}>
            <MarkdownDocumentEditor
              documentKey={file().path}
              documentName={file().name}
              text={editingContent() ?? ""}
              onChange={setEditingContent}
              accessibilityLabel="file-editor"
              placeholder={tr("doc.placeholder")}
              compact={props.compact}
              maxWidth={layout.conversationWidth}
              ai={true}
            />
          </If>
          <If when={htmlPreviewing()}>
            <WebView
              accessibilityLabel="file-html-view"
              html={editingContent() ?? file().content}
              javaScriptEnabled={false}
              incognito={true}
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                backgroundColor: palette().canvas,
                pointerEvents: splitDragging() ? "none" : "auto",
              }}
              onError={() => setHtmlPreview(file().path, false)}
            />
          </If>
          <If when={file().kind === "pdf"}>
            <If
              when={file().content}
              else={
                <View
                  style={{
                    flex: 1,
                    minHeight: 0,
                    minWidth: 0,
                    padding: props.compact ? space.lg : space.x3l,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <QuietEmptyPrompt
                    icon="file-text"
                    title={file().name}
                    subtitle={pdfPreviewSupported() ? tr("doc.pdfUnavailable") : tr("doc.pdfElsewhere")}
                  />
                </View>
              }
            >
              {encoded => (
                <WebView
                  accessibilityLabel="file-pdf-view"
                  html={pdfDocumentHtml(encoded(), palette().canvas)}
                  javaScriptEnabled={false}
                  incognito={true}
                  style={{ flex: 1, minHeight: 0, minWidth: 0, pointerEvents: splitDragging() ? "none" : "auto" }}
                  onError={() =>
                    openFile.update(current =>
                      current && current.path === file().path ? { ...current, content: "" } : current,
                    )
                  }
                />
              )}
            </If>
          </If>
          <If when={file().kind === "text" && editingContent() === null}>
            <Scroll style={{ flex: 1, minHeight: 0 }}>
              <View style={{ padding: props.compact ? space.md : space.xl }}>
                <Text
                  style={{
                    ...textStyle("monoBlock", { color: palette().text }),
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
              (file().kind === "code" && !htmlPreviewing()) ||
              markdownMode() === "source" ||
              (editingContent() !== null && file().kind === "text")
            }
          >
            <View style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
              <If when={markdownMode() === "source" ? markdownBlock() : null}>
                {block => <VisualEditNotice block={block()} />}
              </If>
              <If when={findOpen() && !props.compact}>
                <EditorFindBar />
              </If>
              <Editor
                ref={ref => editorRef.set(ref)}
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
                highlighting={!file().large}
                fontFamily={fontMono}
                fontSize={textSize(13)}
                lineHeight={textLineHeight(13, 1.55)}
                softWrap={file().kind !== "code"}
                styles={createEditorStyles()}
                search={
                  findOpen() && findQuery()
                    ? {
                        query: findQuery(),
                        caseSensitive: findCase(),
                        wholeWord: findWord(),
                        regex: findRegex(),
                      }
                    : null
                }
                accessibilityLabel="file-editor"
                style={{ flex: 1, minHeight: 0, minWidth: 0 }}
                onChange={event => {
                  if (editingContent() !== null) setEditingContent(event.value);
                }}
                onSelectionChange={event => {
                  const primary = event.selections[event.selections.length - 1];
                  if (!primary) return;
                  const sameLine = primary.anchor.line === primary.head.line;
                  editorCursor.set({
                    line: primary.head.line + 1,
                    column: primary.head.column + 1,
                    selectedLines: sameLine ? 0 : Math.abs(primary.head.line - primary.anchor.line) + 1,
                  });
                }}
                onSearchChange={event => findResult.set(event.result)}
              />
            </View>
          </If>
          <If when={file().kind === "image"}>
            <View
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
              }}
            >
              <ImageViewerSurface
                src={() => file().content}
                imageAccessibilityLabel={() => file().name}
                zoom={imageZoom}
                onZoomChange={next => imageZoom.set(next)}
                padding={props.compact ? space.md : space.xl}
                onError={message =>
                  fileNotice.set(
                    tr("files.cannotShowImage", {
                      name: file().name,
                      error: localizeHostError(message),
                    }),
                  )
                }
              />
            </View>
          </If>
          <If when={file().kind === "video"}>
            <View style={{ flex: 1, minHeight: 0, minWidth: 0, padding: props.compact ? space.md : space.xxl }}>
              <Video src={file().content} controls={true} muted={true} style={{ flex: 1 }} />
            </View>
          </If>
          <If when={file().kind === "binary"}>
            <View
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                padding: props.compact ? space.lg : space.xxl,
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

/**
 * Preview | Edit for Markdown, Preview | Source for HTML. In the header on a
 * wide pane; in the path strip under it on a narrow one, so Save keeps its room.
 */
function DocumentModeTabs() {
  return (
    <If when={openFile()}>
      {file => (
        <>
          <If when={file().kind === "markdown"}>
            <SegmentedTabs
              size="sm"
              options={[
                { value: "preview", label: tr("files.preview"), accessibilityLabel: "file-preview" },
                {
                  value: "edit",
                  label: file().large ? tr("files.editAnyway") : tr("common.edit"),
                  accessibilityLabel: "file-edit",
                },
              ]}
              value={markdownMode() === "preview" ? "preview" : "edit"}
              onChange={value => (value === "edit" ? enterMarkdownEdit() : showMarkdownPreview())}
            />
          </If>
          <If when={file().kind === "code" && isHtmlFile(file().path) && documentWebViewsAvailable() === true}>
            <SegmentedTabs
              size="sm"
              options={[
                { value: "preview", label: tr("files.preview"), accessibilityLabel: "file-html-preview" },
                { value: "source", label: tr("doc.source"), accessibilityLabel: "file-html-source" },
              ]}
              value={htmlPreviewing() ? "preview" : "source"}
              onChange={value => setHtmlPreview(file().path, value === "preview")}
            />
          </If>
        </>
      )}
    </If>
  );
}

function Preview(props: { compact?: boolean; stacked?: boolean; onBack?: () => void }) {
  const docMenuOpen = signal(false);
  const docMenuAnchor = signal<ViewRef | null>(null);
  let lastDocMenuPath: string | null = null;
  effect(() => {
    const path = openFile()?.path ?? null;
    untracked(() => {
      if (path === lastDocMenuPath) return;
      lastDocMenuPath = path;
      docMenuOpen.set(false);
    });
  });

  // The aux pane splits explorer and preview vertically; stacked views show one at a time.
  const splitBelowTree = () =>
    Boolean(props.compact) && !props.stacked && explorerOpen() && !openFile();
  const narrow = () => Boolean(props.compact) || Boolean(props.stacked);
  return (
    <View
      style={{
        flex: splitBelowTree() ? 0 : 1,
        flexShrink: splitBelowTree() ? 0 : 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        flexDirection: "column",
        backgroundColor: palette().canvas,
      }}
    >
      {/* Hide redundant empty preview bar in compact AuxPane until a file is open or explorer collapses */}
      <If when={Boolean(props.stacked) || !props.compact || Boolean(openFile()) || !explorerOpen()}>
        <View
          style={{
            minHeight: props.stacked ? WORKBENCH_TOUCH_MIN : props.compact ? 34 : 38,
            paddingLeft: narrow() ? space.xs : space.md,
            paddingRight: narrow() ? space.sm : space.md,
            paddingVertical: narrow() ? 2 : 0,
            flexDirection: "row",
            flexWrap: narrow() ? "wrap" : "nowrap",
            alignItems: "center",
            gap: narrow() ? space.xs : space.sm,
            borderBottomWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
          }}
        >
          <If
            when={Boolean(props.stacked)}
            else={
              <IconButton
                icon="panel-left"
                size={props.compact ? "xs" : "sm"}
                active={explorerOpen()}
                tooltip={tr("files.toggleExplorer")}
                accessibilityLabel="explorer-toggle"
                onPress={() => explorerOpen.set(!explorerOpen())}
              />
            }
          >
            <StackBackButton
              label={tr("files.explorer")}
              accessibilityLabel="files-stack-back"
              onPress={() => props.onBack?.()}
            />
          </If>
          <OpenFileTabStrip compact={narrow()} />
          <If when={openFile()}>
            {file => (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
                <If when={!narrow() && (file().kind === "code" || editingContent() !== null)}>
                  <IconButton
                    icon="search"
                    size="sm"
                    active={findOpen()}
                    tooltip={tr("files.findPlaceholder")}
                    accessibilityLabel="file-find-open"
                    onPress={openFind}
                  />
                </If>
                <If when={!narrow() && file().kind === "diff"}>
                  <IconButton
                    icon={fileDiffLayout() === "split" ? "list" : "panel-right"}
                    size="sm"
                    active={fileDiffLayout() === "split"}
                    tooltip={
                      fileDiffLayout() === "split" ? tr("files.diffUnified") : tr("files.diffSplit")
                    }
                    accessibilityLabel="file-diff-layout"
                    onPress={() =>
                      fileDiffLayout.set(fileDiffLayout() === "split" ? "unified" : "split")
                    }
                  />
                </If>
                <If when={file().kind === "diff"}>
                  <Button
                    label={tr("files.openFile")}
                    accessibilityLabel="file-view-source"
                    variant="ghost"
                    size="xs"
                    onPress={() => void openFileAt(file().path)}
                  />
                </If>
                <If when={isEditableKind(file().kind) && !hasUnsavedEdit()}>
                  <If when={Boolean(gitChanges()[file().path])}>
                    <Button
                      label={tr("files.viewDiff")}
                      accessibilityLabel="file-view-diff"
                      variant="ghost"
                      size="xs"
                      onPress={() => void openDiffReview(file().path)}
                    />
                  </If>
                  <If when={editingContent() === null && file().kind !== "markdown"}>
                    <Button
                      label={file().large ? tr("files.editAnyway") : tr("files.editFile")}
                      accessibilityLabel="file-edit"
                      variant="ghost"
                      size="xs"
                      leadingIcon="edit"
                      onPress={() => beginEditFile()}
                    />
                  </If>
                </If>
                <If when={!narrow()}>
                  <DocumentModeTabs />
                </If>
                <If when={file().kind === "markdown"}>
                  <If when={docMenuItems().length > 0}>
                    <View ref={el => docMenuAnchor.set(el)} style={{ flexShrink: 0 }}>
                      <IconButton
                        icon="more"
                        size="sm"
                        active={docMenuOpen()}
                        tooltip={tr("doc.moreActions")}
                        accessibilityLabel="file-doc-menu"
                        onPress={() => docMenuOpen.set(!docMenuOpen())}
                      />
                    </View>
                    <DropdownMenu
                      open={docMenuOpen()}
                      anchor={docMenuAnchor()}
                      align="end"
                      minWidth={200}
                      items={docMenuItems()}
                      onClose={() => docMenuOpen.set(false)}
                    />
                  </If>
                </If>
                <If when={file().kind === "code" && isHtmlFile(file().path) && canOpenInSystemBrowser()}>
                  <Button
                    label={tr("doc.openInBrowser")}
                    accessibilityLabel="file-open-in-browser"
                    variant="ghost"
                    size="xs"
                    leadingIcon="external-link"
                    onPress={() => void openHtmlInSystemBrowser(file().path)}
                  />
                </If>
                <If when={isEditableKind(file().kind) && hasUnsavedEdit()}>
                  <If
                    when={narrow()}
                    else={
                      <Button
                        label={tr("files.discardEdit")}
                        accessibilityLabel="file-discard"
                        variant="ghost"
                        size="xs"
                        disabled={fileSaving()}
                        onPress={() => cancelEditFile()}
                      />
                    }
                  >
                    <IconButton
                      icon="undo"
                      size="sm"
                      tooltip={tr("files.discardEdit")}
                      accessibilityLabel="file-discard"
                      disabled={fileSaving()}
                      onPress={() => cancelEditFile()}
                    />
                  </If>
                  <Button
                    label={fileSaving() ? tr("common.saving") : tr("files.saveFile")}
                    accessibilityLabel="file-save"
                    variant="primary"
                    size="xs"
                    loading={fileSaving()}
                    tooltip={tr("files.saveShortcut")}
                    onPress={() => void saveEditedFile()}
                  />
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
              minHeight: 28,
              paddingHorizontal: narrow() ? space.md : space.lg,
              paddingVertical: space.xs,
              flexDirection: "row",
              flexWrap: narrow() ? "wrap" : "nowrap",
              alignItems: "center",
              gap: space.sm,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().canvas,
              ...paintTransition(MOTION_DURATION.fast),
            }}
          >
            <Scroll horizontal style={{ flex: 1, minWidth: 120 }} scrollbar={false}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                <Each of={buildBreadcrumbs(file().path, activeWorkspaceRoot())} key={seg => seg.path}>
                  {(seg, index) => (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
                      <If when={index() > 0}>
                        <Icon name="chevron-right" size={12} color={palette().textMuted} />
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
                        hitSlop={seg().isLast ? undefined : touchSlop(24)}
                        onPress={
                          seg().isLast
                            ? undefined
                            : () => {
                                selectedPath.set(seg().path);
                                void setExpanded(seg().path, true);
                              }
                        }
                        style={{
                          paddingHorizontal: space.xs,
                          paddingVertical: 2,
                          borderRadius: radii.xs,
                          borderCurve: "continuous",
                          backgroundColor: seg().isLast ? palette().surfaceSubtle : "transparent",
                          cursor: seg().isLast ? "default" : "pointer",
                          userSelect: "none",
                          ...pressTransition(MOTION_DURATION.fast),
                        }}
                        hoverStyle={
                          seg().isLast ? undefined : { backgroundColor: palette().panelHover }
                        }
                        activeStyle={seg().isLast ? undefined : tactileActiveStyle(0.97)}
                        focusVisibleStyle={seg().isLast ? undefined : focusRingStyle()}
                      >
                        <Text
                          style={{
                            maxWidth: props.compact ? 110 : 180,
                            ...textStyle("caption", {
                              color: seg().isLast ? palette().text : palette().textMuted,
                            }),
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 0 }}>
              <If when={hasUnsavedEdit()}>
                <Text
                  style={{
                    ...textStyle("caption", { color: palette().warning }),
                    fontWeight: "600",
                    flexShrink: 0,
                  }}
                >
                  {tr("files.unsavedChanges")}
                </Text>
              </If>
              <If when={file().kind === "diff" && Boolean(file().content.trim())}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
                  <Text style={{ ...textStyle("mono", { color: palette().textMuted, tabular: true }) }}>
                    {`+${formatCount(openFileDiffStats().added)}`}
                  </Text>
                  <Text style={{ ...textStyle("mono", { color: palette().textMuted, tabular: true }) }}>
                    {`-${formatCount(openFileDiffStats().deleted)}`}
                  </Text>
                </View>
              </If>
              <If when={gitChanges()[file().path]?.letter ?? ""}>
                {letter => (
                  <Text
                    style={{
                      ...textStyle("mono", { color: decorationColor(letter()) }),
                      fontWeight: "600",
                    }}
                  >
                    {letter()}
                  </Text>
                )}
              </If>
              <IconButton
                icon="copy"
                size="xs"
                iconSize={12}
                tooltip={tr("pane.files.copyPath")}
                accessibilityLabel="file-copy-path"
                onPress={() => void copyText(file().path)}
              />
              <If
                when={narrow() && (file().kind === "markdown" || (file().kind === "code" && isHtmlFile(file().path)))}
                else={
                  <Text
                    style={{
                      ...textStyle("caption", { color: palette().textMuted }),
                      flexShrink: 0,
                    }}
                  >
                    {file().kind === "diff"
                      ? tr("files.diffTab")
                      : inferCodeLanguage(file().path) || file().language || file().kind}
                  </Text>
                }
              >
                <DocumentModeTabs />
              </If>
            </View>
          </View>
        )}
      </If>

      <FileAttentionBars compact={narrow()} />
      <PreviewBody compact={narrow()} />
      <If when={openFile() && !narrow()}>
        <EditorStatusBar />
      </If>
    </View>
  );
}

export function FilesScene(props: { compact?: boolean } = {}) {
  const sceneWidth = createSceneWidth();
  /** Stacked (narrow) layout: the preview is pushed over the explorer. */
  const filesStackDetail = signal(false);
  let lastStackedPath: string | null = null;
  let lastDocumentPath: string | null = null;
  const scopeDevice = () => fleetDeviceById(deviceContext());
  const deviceOffline = () => deviceException(scopeDevice()?.state) === "offline";
  const deviceLabel = () => scopeDevice()?.name || tr("device.thisDevice");

  // Another file starts in its own mode: the kept-draft preview belongs to the file that was open.
  effect(() => {
    const path = openFile()?.path ?? null;
    untracked(() => {
      if (path === lastDocumentPath) return;
      lastDocumentPath = path;
      markdownPreviewing.set(false);
    });
  });
  // Opening another file (a tree row, a tab, a search hit, a changed file, the
  // aux pane request) pushes the preview in the stacked layout.
  effect(() => {
    const path = openFile()?.path ?? null;
    untracked(() => {
      if (path && path !== lastStackedPath) filesStackDetail.set(true);
      lastStackedPath = path;
    });
  });
  effect(() => {
    const root = activeWorkspaceRoot();
    if (!root || dirChildren()[root]) return;
    void loadRoot();
  });

  effect(() => {
    const edit = pendingEdit();
    editValue.set(edit?.value ?? "");
  });

  // Live updates: the host watcher for this root, and the Git decorations the
  // host pushes while this scene is on screen.
  effect(() => {
    if (!activeWorkspace()) return;
    untracked(() => ensureWorkspaceWatch());
  });
  cleanup(holdFilesStatusWatch());

  const unbindSave = keymap.bind("mod+s", () => {
    if (hasUnsavedEdit()) void saveEditedFile();
  });
  const unbindFind = !props.compact ? keymap.bind("mod+f", () => openFind()) : null;
  cleanup(() => {
    unbindSave();
    unbindFind?.();
  });

  // Each image opens fitted to the pane.
  effect(() => {
    void openFile()?.path;
    untracked(() => {
      imageZoom.set("fit");
    });
  });

  // A search hit carries its line: reveal it once that file's editor is up.
  effect(() => {
    const target = pendingRevealLine();
    const file = openFile();
    const ref = editorRef();
    if (!target || !ref || file?.path !== target.path) return;
    const line = Math.max(0, target.line - 1);
    pendingRevealLine.set(null);
    ref.setSelections([{ anchor: { line, column: 0 }, head: { line, column: 0 } }]);
    ref.scrollToLine(line);
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
      onLayout={sceneWidth.onLayout}
      style={{ flex: 1, minHeight: 0, minWidth: 0, flexDirection: "column", backgroundColor: palette().canvas }}
    >
      <If when={!props.compact}>
        <ToolPaneHeader />
      </If>
      <RemoteWorkspaceStatusBanner compact={props.compact} />
      <If when={deviceOffline()}>
        <View style={{ paddingHorizontal: props.compact ? space.sm : space.md, paddingTop: space.sm }}>
          <InlineBanner
            tone="warning"
            message={tr("pane.terminal.offline", { device: deviceLabel() })}
          />
        </View>
      </If>
      <If when={fileNotice()}>
        {notice => (
          <View
            accessibilityLabel="file-notice-banner"
            style={{
              paddingHorizontal: props.compact ? space.sm : space.md,
              paddingTop: space.sm,
            }}
          >
            <InlineBanner
              tone="info"
              message={localizeHostError(notice())}
              onDismiss={() => fileNotice.set("")}
            />
          </View>
        )}
      </If>
      {/* Narrow: the list first; opening a file pushes the preview full width with a back control. */}
      <If
        when={sceneWidth.stacked()}
        else={
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
              <FileTree
                compact={props.compact}
                width={explorerWidth()}
                onOpenDetail={() => filesStackDetail.set(true)}
              />
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
        }
      >
        <View style={{ flex: 1, minHeight: 0, minWidth: 0, backgroundColor: palette().canvas }}>
          <If
            when={filesStackDetail() && Boolean(openFile())}
            else={
              <FileTree
                compact={props.compact}
                width={explorerWidth()}
                stacked={true}
                onOpenDetail={() => filesStackDetail.set(true)}
              />
            }
          >
            <Preview
              compact={props.compact}
              stacked={true}
              onBack={() => filesStackDetail.set(false)}
            />
          </If>
        </View>
      </If>
    </View>
  );
}
