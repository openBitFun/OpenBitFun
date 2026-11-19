// File explorer and preview state.
//
// The tree is lazy: the root is read once, and a directory's children are read
// when the user first expands it. Children are cached by directory path and
// dropped after a mutation in that directory, because the host is the only
// authority on what a directory now contains.

import { Clipboard, computed, signal } from "nsh";
import { invokeCommand } from "./bridge";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceDirectory,
  deleteWorkspaceFile,
  getDirectoryChildren,
  getGitDiff,
  getGitStatus,
  pasteWorkspaceFiles,
  readFileContent,
  renameWorkspaceFile,
  searchWorkspaceFiles,
  type GitStatus,
  type WorkspaceEntry,
} from "./api";
import { activeWorkspaceId, activeWorkspaceRoot, onWorkspaceChanged, reportError, runStep } from "./state";
import { basename, extensionOf, formatBytes } from "./format";

export type PreviewKind = "markdown" | "code" | "text" | "image" | "video" | "diff" | "binary";

export interface OpenFile {
  path: string;
  name: string;
  kind: PreviewKind;
  language: string;
  content: string;
  note?: string;
}

export interface PendingEdit {
  mode: "file" | "directory" | "rename";
  /** The directory the new entry goes into, or the path being renamed. */
  base: string;
  value: string;
}

/** A search row: a name match, or one content match with its line and preview. */
export interface SearchHit {
  path: string;
  name: string;
  line?: number;
  preview?: string;
}

export const dirChildren = signal<Record<string, WorkspaceEntry[]>>({});
export const expandedDirs = signal<string[]>([]);
export const selectedPath = signal<string | null>(null);
export const openFile = signal<OpenFile | null>(null);
export const editingContent = signal<string | null>(null);
export const fileSaving = signal(false);
export const pendingEdit = signal<PendingEdit | null>(null);
export const fileNotice = signal<string>("");
export const searchQuery = signal<string>("");
/** `name` matches file names, `content` greps inside files through the same command. */
export const searchMode = signal<"name" | "content">("name");
export const searchResults = signal<SearchHit[]>([]);
/** The repository under the workspace root, or null when there is none. */
export const gitStatus = signal<GitStatus | null>(null);
/** Whether the changed-files list is expanded over the tree. */
export const gitListOpen = signal(false);

export interface GitDecoration {
  /** The porcelain letter git reports: M, A, D, R, U (untracked) or C (conflict). */
  letter: string;
  /** Where the change sits, so staged and working-tree edits read differently. */
  staged: boolean;
}

/** One entry per changed path, staged or not, the way a file tree decorates it. */
export const gitChanges = computed<Record<string, GitDecoration>>(() => {
  const status = gitStatus();
  const decorations: Record<string, GitDecoration> = {};
  if (!status) return decorations;
  for (const file of status.staged ?? []) {
    decorations[file.path] = { letter: statusLetter(file.status, file.index_status), staged: true };
  }
  for (const file of status.unstaged ?? []) {
    // A path changed in both places keeps its working-tree letter, unstaged.
    decorations[file.path] = { letter: statusLetter(file.status, file.workdir_status), staged: false };
  }
  for (const path of status.untracked ?? []) decorations[path] = { letter: "U", staged: false };
  for (const path of status.conflicts ?? []) decorations[path] = { letter: "C", staged: false };
  return decorations;
});

/** The changed paths, staged first then the working tree, each once. */
export const changedPaths = computed<string[]>(() => Object.keys(gitChanges()).sort());

function statusLetter(status: string | undefined, detail: string | null | undefined): string {
  const raw = (detail || status || "").trim();
  if (!raw) return "M";
  if (raw.includes("?")) return "U";
  if (raw.includes("U") && raw.includes("A")) return "C";
  if (raw.startsWith("R")) return "R";
  const first = raw[0];
  return "MADRUC".includes(first) ? first : "M";
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif", "heic"]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "avi", "mkv"]);

/** Above this, a media file is not read into a base64 string for a preview. */
const MEDIA_PREVIEW_LIMIT_BYTES = 32 * 1024 * 1024;

const MEDIA_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

const BINARY_EXTENSIONS = new Set([
  "pdf", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar",
  "mp3", "wav", "flac", "m4a", "aac", "ogg",
  "woff", "woff2", "ttf", "otf", "wasm", "so", "dylib", "dll", "exe", "bin",
  "class", "jar", "o", "a", "pyc", "lock",
]);

/** Editor language ids for the extensions an editor is expected to colour. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "powershell",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  lua: "lua",
  dart: "dart",
  vue: "vue",
  svelte: "svelte",
  graphql: "graphql",
  proto: "protobuf",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

export function pathSep(path: string): string {
  const slash = path.lastIndexOf("/");
  const backslash = path.lastIndexOf("\\");
  return backslash > slash ? "\\" : "/";
}

export function dirnameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index > 0 ? trimmed.slice(0, index) : trimmed.slice(0, 0);
}

export function joinPath(parent: string, name: string): string {
  if (!parent) return name;
  const sep = pathSep(parent);
  return parent.endsWith("/") || parent.endsWith("\\") ? `${parent}${name}` : `${parent}${sep}${name}`;
}

function previewKindOf(path: string): PreviewKind {
  const extension = extensionOf(path);
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (BINARY_EXTENSIONS.has(extension)) return "binary";
  if (LANGUAGE_BY_EXTENSION[extension]) return "code";
  return "text";
}

function mediaMimeOf(path: string): string {
  return MEDIA_MIME[extensionOf(path)] ?? "application/octet-stream";
}

/** The size a directory listing already reported, when it listed this path. */
function knownSizeOf(path: string): number | undefined {
  const parent = parentOf(path);
  const size = (dirChildren()[parent] ?? []).find(entry => entry.path === path)?.size;
  return typeof size === "number" ? size : undefined;
}

function languageOf(path: string): string {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  return LANGUAGE_BY_EXTENSION[extensionOf(path)] ?? "text";
}

function sortEntries(entries: ReadonlyArray<WorkspaceEntry>): WorkspaceEntry[] {
  return [...entries].filter(entry => entry && entry.path).sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
    return basename(left.path).localeCompare(basename(right.path));
  });
}

function parentOf(path: string): string {
  return dirnameOf(path) || activeWorkspaceRoot();
}

/** Reads one directory into the cache; a failure stays with that directory. */
export async function loadDirectory(path: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  try {
    const entries = await getDirectoryChildren(workspaceId, path);
    dirChildren.update(current => ({ ...current, [path]: sortEntries(Array.isArray(entries) ? entries : []) }));
  } catch (error) {
    dirChildren.update(current => ({ ...current, [path]: current[path] ?? [] }));
    reportError(error);
  }
}

/** Loads the root and keeps it expanded, which is what an explorer shows first. */
export async function loadRoot(): Promise<void> {
  const root = activeWorkspaceRoot();
  if (!root) return;
  if (!expandedDirs().includes(root)) expandedDirs.set([root, ...expandedDirs()]);
  await runStep(async () => {
    await loadDirectory(root);
    void loadGitStatus();
  });
}

/**
 * Reads the repository state under the workspace root. A workspace that is not a
 * repository, or a host without git, simply leaves the tree undecorated.
 */
export async function loadGitStatus(): Promise<void> {
  const workspaceId = activeWorkspaceId();
  const root = activeWorkspaceRoot();
  if (!workspaceId || !root) {
    gitStatus.set(null);
    return;
  }
  try {
    gitStatus.set(await getGitStatus(workspaceId, root));
  } catch {
    gitStatus.set(null);
  }
}

/** Opens the file's working-tree diff for review, in place of its text. */
export async function openDiffReview(path: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  const root = activeWorkspaceRoot();
  if (!workspaceId || !root) return;
  editingContent.set(null);
  selectedPath.set(path);
  await runStep(async () => {
    try {
      const patch = await getGitDiff(workspaceId, root, { files: [path] });
      openFile.set({
        path,
        name: basename(path),
        kind: "diff",
        language: languageOf(path),
        content: patch ?? "",
        ...(patch ? {} : { note: "No diff for this file: git reports no change against HEAD." }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      openFile.set({ path, name: basename(path), kind: "binary", language: "", content: "", note: message });
    }
  });
}

export async function setExpanded(path: string, expanded: boolean): Promise<void> {
  const current = expandedDirs();
  if (expanded) {
    if (!current.includes(path)) expandedDirs.set([...current, path]);
    if (!dirChildren()[path]) await loadDirectory(path);
  } else {
    expandedDirs.set(current.filter(item => item !== path && !item.startsWith(`${path}/`)));
  }
}

export async function openFileAt(path: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  editingContent.set(null);
  selectedPath.set(path);
  const kind = previewKindOf(path);
  const name = basename(path);
  if (kind === "image" || kind === "video") {
    // Media travels as base64 inside the command result, so a file far past a
    // preview's needs would be a slow round trip and a large string to hold.
    const size = knownSizeOf(path);
    if (size !== undefined && size > MEDIA_PREVIEW_LIMIT_BYTES) {
      openFile.set({
        path,
        name,
        kind: "binary",
        language: "",
        content: "",
        note: `${formatBytes(size)} is too large to preview here: open it in an external app.`,
      });
      return;
    }
    // Shown from a data URL: the same command the React surface reads bytes with,
    // so it works for a local and a remote workspace alike.
    await runStep(async () => {
      try {
        const encoded = await readFileContent(workspaceId, path, "base64");
        openFile.set({
          path,
          name,
          kind,
          language: "",
          content: `data:${mediaMimeOf(path)};base64,${encoded ?? ""}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        openFile.set({ path, name, kind: "binary", language: "", content: "", note: message });
      }
    });
    return;
  }
  if (kind === "binary") {
    openFile.set({
      path,
      name,
      kind,
      language: "",
      content: "",
      note:
        extensionOf(path) === "pdf"
          ? "PDF preview needs a document viewer this frontend does not have yet: open it in an external app."
          : "Binary file: no preview for this format.",
    });
    return;
  }
  await runStep(async () => {
    try {
      const content = await readFileContent(workspaceId, path);
      openFile.set({ path, name, kind, language: languageOf(path), content: content ?? "" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      openFile.set({ path, name, kind: "binary", language: "", content: "", note: message });
    }
  });
}

/**
 * True when `path` is known to be a directory — either already expanded in
 * `dirChildren()`, equal to the workspace root, or listed with
 * `isDirectory: true` inside its parent directory's cached children. Checking
 * only `dirChildren()[path]` misclassifies unexpanded directories as files.
 */
function isKnownDirectory(path: string | null): boolean {
  if (!path) return false;
  if (path === activeWorkspaceRoot()) return true;
  if (dirChildren()[path] !== undefined) return true;
  const parent = parentOf(path);
  const siblings = dirChildren()[parent];
  if (!Array.isArray(siblings)) return false;
  return siblings.some(entry => entry.path === path && entry.isDirectory === true);
}

export function startCreate(mode: "file" | "directory"): void {
  const target = selectedPath();
  const base =
    target && isKnownDirectory(target)
      ? target
      : target
        ? parentOf(target)
        : activeWorkspaceRoot();
  pendingEdit.set({ mode, base, value: "" });
}

export function startRename(): void {
  const target = selectedPath();
  if (!target) return;
  // The field starts empty and shows the current name as its placeholder, so a
  // typed name replaces it instead of being appended to it.
  pendingEdit.set({ mode: "rename", base: target, value: "" });
}

export function cancelEdit(): void {
  pendingEdit.set(null);
}

export async function commitEdit(value: string): Promise<void> {
  const edit = pendingEdit();
  const workspaceId = activeWorkspaceId();
  if (!edit || !workspaceId) return;
  const name = value.trim();
  if (!name) return;
  pendingEdit.set(null);
  await runStep(async () => {
    if (edit.mode === "rename") {
      const next = joinPath(parentOf(edit.base), name);
      await renameWorkspaceFile(workspaceId, edit.base, next);
      await refreshDirectory(parentOf(edit.base));
      void loadGitStatus();
      if (selectedPath() === edit.base) selectedPath.set(next);
      if (openFile()?.path === edit.base) await openFileAt(next);
      fileNotice.set(`Renamed to ${name}`);
      return;
    }
    const path = joinPath(edit.base, name);
    if (edit.mode === "file") {
      await createWorkspaceFile(workspaceId, path);
    } else {
      await createWorkspaceDirectory(workspaceId, path);
    }
    await setExpanded(edit.base, true);
    await refreshDirectory(edit.base);
    void loadGitStatus();
    selectedPath.set(path);
    fileNotice.set(`Created ${name}`);
  });
}

/**
 * Copies the files the OS clipboard holds into the workspace. The clipboard owns
 * the file list (`Clipboard.readFiles`), the host does the copying
 * (`paste_files`), and a host that cannot copy — a remote workspace has no copy
 * primitive — says so through the notice instead of failing silently.
 */
export async function pasteFromClipboard(target?: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  const root = activeWorkspaceRoot();
  if (!workspaceId || !root) return;
  const targetDirectory = directoryTargetOf(target ?? selectedPath(), root);
  await runStep(async () => {
    let paths: string[] = [];
    try {
      const urls = await Clipboard.readFiles();
      paths = urls.map(fileUrlToPath).filter(path => Boolean(path));
    } catch (error) {
      fileNotice.set(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!paths.length) {
      fileNotice.set("The clipboard holds no files to paste");
      return;
    }
    try {
      const result = await pasteWorkspaceFiles(workspaceId, paths, targetDirectory);
      const copied = result?.successCount ?? 0;
      const failed = result?.failedFiles ?? [];
      await refreshDirectory(targetDirectory);
      void loadGitStatus();
      fileNotice.set(
        failed.length
          ? `Pasted ${copied}, ${failed.length} failed: ${failed[0].path}: ${failed[0].error}`
          : `Pasted ${copied} item${copied === 1 ? "" : "s"}`,
      );
    } catch (error) {
      fileNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

/** A directory to paste into: the target itself, or the directory it sits in. */
function directoryTargetOf(target: string | null, root: string): string {
  if (!target) return root;
  if (isKnownDirectory(target)) return target;
  return parentOf(target) || root;
}

/** `file:///a/b%20c` → `/a/b c`; anything else is left as it came. */
function fileUrlToPath(url: string): string {
  if (!url.startsWith("file://")) return url;
  const withoutScheme = url.slice("file://".length);
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

/**
 * A delete waits for an in-scene confirmation rather than a native alert: the
 * dialog has to be answerable from whichever surface is driving the session, and
 * an in-scene bar is reachable by a remote controller too.
 */
export const confirmingDelete = signal<string | null>(null);

export function requestDelete(): void {
  const target = selectedPath();
  if (target) confirmingDelete.set(target);
}

export function cancelDelete(): void {
  confirmingDelete.set(null);
}

export async function removeSelected(): Promise<void> {
  const target = confirmingDelete();
  const workspaceId = activeWorkspaceId();
  if (!target || !workspaceId) return;
  const isDirectory = isKnownDirectory(target);
  confirmingDelete.set(null);
  await runStep(async () => {
    if (isDirectory) {
      await deleteWorkspaceDirectory(workspaceId, target, true);
    } else {
      await deleteWorkspaceFile(workspaceId, target);
    }
    if (openFile()?.path === target) {
      openFile.set(null);
      editingContent.set(null);
    }
    selectedPath.set(null);
    await refreshDirectory(parentOf(target));
    void loadGitStatus();
    fileNotice.set(`Deleted ${basename(target)}`);
  });
}

export async function refreshDirectory(path: string): Promise<void> {
  const cached = dirChildren()[path];
  if (!cached) return;
  await loadDirectory(path);
}

/** Workspace search: file names, or file contents with the matching line. */
export async function runFileSearch(): Promise<void> {
  const workspaceId = activeWorkspaceId();
  const query = searchQuery().trim();
  const mode = searchMode();
  if (!workspaceId) return;
  if (!query) {
    searchResults.set([]);
    return;
  }
  await runStep(async () => {
    const rows = await searchWorkspaceFiles(workspaceId, query, { searchContent: mode === "content" });
    const root = activeWorkspaceRoot();
    const hits: SearchHit[] = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const record = (row ?? {}) as Record<string, unknown>;
      const raw = record.path ?? record.filePath ?? record.file ?? record.name;
      if (typeof raw !== "string" || !raw) continue;
      const path = raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw) ? raw : joinPath(root, raw);
      const line = typeof record.line_number === "number" ? record.line_number : undefined;
      const previewSource = record.preview_inside ?? record.matched_content;
      const preview = typeof previewSource === "string" ? previewSource.trim() : undefined;
      // One row per match: a file can match on several lines.
      const id = line === undefined ? path : `${path}:${line}`;
      if (hits.some(hit => (hit.line === undefined ? hit.path : `${hit.path}:${hit.line}`) === id)) continue;
      hits.push({ path, name: basename(path), ...(line === undefined ? {} : { line }), ...(preview ? { preview } : {}) });
    }
    searchResults.set(hits);
    if (hits.length === 0) {
      fileNotice.set(
        mode === "content" ? `No file contents match “${query}”` : `No file names match “${query}”`,
      );
    }
  });
}

/** Expands every ancestor of a path so its row is visible, then selects it. */
export async function revealPath(path: string): Promise<void> {
  const root = activeWorkspaceRoot();
  if (!root) return;
  const expanded = new Set(expandedDirs());
  expanded.add(root);
  let current = path;
  while (current.length > root.length) {
    current = dirnameOf(current);
    if (!current) break;
    expanded.add(current);
  }
  expandedDirs.set([...expanded]);
  for (const directory of expanded) {
    if (!dirChildren()[directory]) await loadDirectory(directory);
  }
  await openFileAt(path);
}

/** Starts live editing for text, code, or markdown files currently open in preview. */
export function beginEditFile(): void {
  const file = openFile();
  if (!file) return;
  if (file.kind !== "code" && file.kind !== "markdown" && file.kind !== "text") return;
  editingContent.set(file.content);
  fileNotice.set("");
}

/** Discards unsaved editor changes and returns to preview/read-only mode. */
export function cancelEditFile(): void {
  editingContent.set(null);
}

/** Updates the live draft content while editing an open file. */
export function setEditingContent(text: string): void {
  editingContent.set(text);
}

/** Persists the edited content through `write_file_content` and clears the draft on success. */
export async function saveEditedFile(): Promise<void> {
  const file = openFile();
  const content = editingContent();
  const workspaceId = activeWorkspaceId();
  if (!file || content === null || !workspaceId || fileSaving()) return;
  fileSaving.set(true);
  try {
    await runStep(async () => {
      await invokeCommand<unknown>("write_file_content", {
        workspaceId,
        workspacePath: activeWorkspaceRoot(),
        filePath: file.path,
        content,
      });
      openFile.update(current =>
        current && current.path === file.path ? { ...current, content } : current,
      );
      editingContent.set(null);
      fileNotice.set(`Saved ${file.name}`);
      void loadGitStatus();
    });
  } finally {
    fileSaving.set(false);
  }
}

onWorkspaceChanged(() => {
  dirChildren.set({});
  expandedDirs.set([]);
  selectedPath.set(null);
  openFile.set(null);
  editingContent.set(null);
  fileSaving.set(false);
  pendingEdit.set(null);
  confirmingDelete.set(null);
  gitStatus.set(null);
  gitListOpen.set(false);
  fileNotice.set("");
  searchQuery.set("");
  searchResults.set([]);
  searchMode.set("name");
});
