// Shared workspace-kind detection and POSIX/Windows-safe path helpers.
//
// Remote workspaces (SSH, Docker, WSL) always use POSIX `/` semantics on every
// client OS so `\` inside a remote filename is never treated as a separator.

import type { WorkspaceRecord } from "../api";

/**
 * Single canonical check for whether a workspace lives on a remote transport
 * (SSH, Docker, WSL, or explicit remote connection) rather than locally on the
 * device that owns the workspace. Assistant workspaces stay local to their host.
 */
export function isRemoteWorkspace(ws: WorkspaceRecord | null | undefined): boolean {
  if (!ws) return false;
  const kind = (ws.workspaceKind ?? "").toLowerCase();
  if (kind.includes("assistant")) return false;
  return (
    Boolean(ws.connectionId) ||
    Boolean(ws.sshHost) ||
    kind === "remote" ||
    kind === "remote_ssh" ||
    kind.includes("ssh") ||
    kind.includes("docker") ||
    kind.includes("wsl")
  );
}

/** True when `path` uses a Windows drive prefix (`C:\` or `C:/`) or UNC prefix (`\\`). */
export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/** Picks `/` for remote/POSIX paths and `\` for Windows paths. */
export function pathSepFor(path: string, isRemote = false): "/" | "\\" {
  if (isRemote) return "/";
  if (path.startsWith("\\\\")) return "\\";
  if (/^[A-Za-z]:\\/.test(path)) return "\\";
  const slash = path.lastIndexOf("/");
  const backslash = path.lastIndexOf("\\");
  return backslash > slash ? "\\" : "/";
}

/**
 * Parent directory of `path`.
 * - `dirnameOfPath("/README.md") === "/"`
 * - `dirnameOfPath("/") === "/"`
 * - `dirnameOfPath("C:\\foo") === "C:\\"`
 * - `dirnameOfPath("C:\\") === "C:\\"`
 * - Remote POSIX paths never split on `\`.
 */
export function dirnameOfPath(path: string, isRemote = false): string {
  if (!path) return "";
  if (isRemote) {
    if (/^\/+$/.test(path)) return "/";
    const trimmed = path.replace(/\/+$/, "");
    const index = trimmed.lastIndexOf("/");
    if (index < 0) return "";
    if (index === 0) return "/";
    return trimmed.slice(0, index);
  }
  if (/^\/+$/.test(path)) return "/";
  if (/^[A-Za-z]:[\\/]+$/.test(path)) {
    const sep = path.includes("/") && !path.includes("\\") ? "/" : "\\";
    return `${path.slice(0, 2)}${sep}`;
  }
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) return path.startsWith("/") ? "/" : "";
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return "";
  if (index === 0) return trimmed[0] === "/" ? "/" : "";
  if (index === 2 && /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed.slice(0, 3);
  }
  return trimmed.slice(0, index);
}

/** Final path segment, respecting POSIX-only splitting on remote workspaces. */
export function basenameOfPath(path: string, isRemote = false): string {
  if (!path) return "";
  if (isRemote) {
    const trimmed = path.replace(/\/+$/, "");
    if (!trimmed) return path.startsWith("/") ? "/" : "";
    const index = trimmed.lastIndexOf("/");
    return index >= 0 ? trimmed.slice(index + 1) : trimmed;
  }
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) return path.startsWith("/") ? "/" : path;
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

/**
 * Joins `parent` and `child` without double or mixed separators.
 * On Windows local paths (`\`), forward slashes inside `child` are normalized to `\`.
 */
export function joinWorkspacePath(parent: string, child: string, isRemote = false): string {
  if (!parent) return child;
  if (!child) return parent;
  const sep = pathSepFor(parent, isRemote);
  if (isRemote) {
    const cleanParent = parent === "/" ? "/" : parent.replace(/\/+$/, "");
    const cleanChild = child.replace(/^\/+/, "");
    if (!cleanChild) return cleanParent;
    return cleanParent === "/" ? `/${cleanChild}` : `${cleanParent}/${cleanChild}`;
  }
  const cleanChild = child.replace(/^[\\/]+/, "");
  if (!cleanChild) return parent;
  const normalizedChild = sep === "\\" ? cleanChild.replace(/\//g, "\\") : cleanChild;
  if (parent.endsWith("/") || parent.endsWith("\\")) {
    return `${parent}${normalizedChild}`;
  }
  return `${parent}${sep}${normalizedChild}`;
}

/**
 * True when `candidate` equals `root` or sits strictly inside `root` on a
 * separator boundary (`/srv/app` matches `/srv/app/a`, never `/srv/app-v2`).
 */
export function isPathAtOrUnder(candidate: string, root: string, isRemote = false): boolean {
  if (!candidate || !root) return false;
  if (isRemote) {
    const cleanRoot = root === "/" ? "/" : root.replace(/\/+$/, "");
    if (cleanRoot === "/") return candidate.startsWith("/");
    return candidate === cleanRoot || candidate.startsWith(`${cleanRoot}/`);
  }
  if (/^\/+$/.test(root)) return candidate.startsWith("/");
  if (/^[A-Za-z]:[\\/]+$/.test(root)) {
    const drive = root.slice(0, 2);
    return (
      candidate.length >= 3 &&
      candidate.slice(0, 2).toLowerCase() === drive.toLowerCase() &&
      (candidate[2] === "\\" || candidate[2] === "/")
    );
  }
  const cleanRoot = root.replace(/[\\/]+$/, "");
  if (!cleanRoot) return false;
  if (candidate === cleanRoot) return true;
  if (!candidate.startsWith(cleanRoot)) return false;
  const boundary = candidate[cleanRoot.length];
  return boundary === "/" || boundary === "\\";
}

/**
 * Converts a `file://` URL into a filesystem path.
 * - `file:///a/b%20c` -> `/a/b c`
 * - `file:///C:/Users/me/file.txt` -> `C:/Users/me/file.txt`
 * - `file://localhost/tmp/x` -> `/tmp/x`
 */
export function fileUrlToPath(url: string): string {
  if (!url || !/^file:\/\//i.test(url)) return url;
  let rest = url.replace(/^file:\/\//i, "");
  if (/^localhost\//i.test(rest)) {
    rest = rest.slice("localhost".length);
  }
  let decoded = rest;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    decoded = rest;
  }
  if (/^\/[A-Za-z]:[\\/]/.test(decoded)) {
    return decoded.slice(1);
  }
  return decoded;
}

export type ResolvedMarkdownLink =
  | { kind: "ignore"; target: "" }
  | { kind: "external"; target: string }
  | { kind: "workspace"; target: string };

/**
 * Resolves a Markdown link target against `baseDir` (either the document's
 * parent directory or the workspace root).
 * - `http:`, `https:`, `mailto:` -> external (`openUrl`)
 * - `file://`, `computer://`, absolute or relative paths -> workspace file path
 *   with `#L...` / `#anchor` and `:line(:col)` suffixes stripped.
 */
export function resolveWorkspaceMarkdownLink(
  rawUrl: string,
  baseDir: string,
  isRemote = false,
): ResolvedMarkdownLink {
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed || trimmed.startsWith("#")) return { kind: "ignore", target: "" };
  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return { kind: "external", target: trimmed };
  }
  if (/^file:\/\//i.test(trimmed)) {
    const withoutFragment = trimmed.split(/[?#]/)[0] ?? trimmed;
    const strippedLine = stripLineSuffix(fileUrlToPath(withoutFragment));
    return strippedLine ? { kind: "workspace", target: strippedLine } : { kind: "ignore", target: "" };
  }
  let rawPath = trimmed;
  if (/^computer:\/\//i.test(rawPath)) {
    rawPath = rawPath.replace(/^computer:\/\//i, "");
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawPath) && !(!isRemote && /^[A-Za-z]:[\\/]/.test(rawPath))) {
    // Unknown non-file URI scheme (e.g. `javascript:`, `data:`) — ignore safely.
    return { kind: "ignore", target: "" };
  }

  const withoutQuery = (rawPath.split(/[?#]/)[0] ?? "").trim();
  if (!withoutQuery) return { kind: "ignore", target: "" };

  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    decoded = withoutQuery;
  }
  const cleaned = stripLineSuffix(decoded);
  if (!cleaned) return { kind: "ignore", target: "" };

  if (cleaned.startsWith("/") || (!isRemote && isWindowsPath(cleaned))) {
    return { kind: "workspace", target: normalizePathSegments(cleaned, isRemote) };
  }
  if (!baseDir) {
    return { kind: "workspace", target: cleaned };
  }
  return {
    kind: "workspace",
    target: normalizePathSegments(joinWorkspacePath(baseDir, cleaned, isRemote), isRemote),
  };
}

function stripLineSuffix(path: string): string {
  // Strip `:12` or `:12:5` while keeping Windows drive prefixes like `C:\a\b`.
  const match = path.match(/^(.*):(\d+)(?::(\d+))?$/);
  if (!match) return path;
  const prefix = match[1];
  if (!prefix) return path;
  return prefix;
}

function normalizePathSegments(path: string, isRemote: boolean): string {
  const sep = pathSepFor(path, isRemote);
  if (isRemote) {
    const leadingSlash = path.startsWith("/");
    const parts = path.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
        else if (!leadingSlash) stack.push("..");
      } else {
        stack.push(part);
      }
    }
    return `${leadingSlash ? "/" : ""}${stack.join("/")}` || (leadingSlash ? "/" : "");
  }

  let prefix = "";
  let rest = path;
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    prefix = `${path.slice(0, 2)}${sep}`;
    rest = path.slice(3);
  } else if (path.startsWith("\\\\")) {
    prefix = "\\\\";
    rest = path.slice(2);
  } else if (path.startsWith("/")) {
    prefix = "/";
    rest = path.slice(1);
  }
  const parts = rest.split(/[\\/]/);
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
      else if (!prefix) stack.push("..");
    } else {
      stack.push(part);
    }
  }
  return `${prefix}${stack.join(sep)}` || prefix;
}
