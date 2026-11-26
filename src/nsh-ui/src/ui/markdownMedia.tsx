// Shared workspace-aware image, SVG, video, and audio rendering for every
// Markdown surface (`MarkdownPreview`, `MarkdownDocumentEditor`, Files,
// Skills, Assistants, and Session replies).
//
// Why this exists:
// - NSH's `<Image>` does not auto-size from intrinsic pixels unless width and
//   height (or aspectRatio inside a definite width) are given. Custom
//   `renderImage` renderers that omit height collapse images to 0px.
// - Paragraphs with whitespace or `<br />` between `<img>` tags (e.g. README
//   badge rows or two `width="49%"` screenshots side-by-side) render as inline
//   text attachments in NSH `TextView`, where percentage widths have no
//   definite parent width. Resolving percentages against the measured reading
//   column width yields concrete point boxes that work in both block and inline
//   flows.
// - NSH `access.allows_media` refuses `file://` and local filesystem paths, so
//   workspace files (local, SSH/Docker remote, and CLI peer hosts) are read
//   through `read_file_content(..., "base64")` into `data:` URLs.
// - NSH `TextView`'s HTML parser drops `<video>` and `<audio>` tags; a
//   fence-aware preprocessor turns them into `openbitfun-media` custom blocks
//   so embedded videos and audio render natively with `<Video>` and degrade
//   clearly when oversized or unreachable.

import { effect, Image, openUrl, signal, Text, untracked, Video, View } from "nsh";
import type { TextViewImage } from "nsh/base";
import { readFileContent } from "../api";
import { invokeCommand } from "../bridge";
import { extensionOf, formatBytes } from "../format";
import { tr } from "../i18n";
import {
  basenameOfPath,
  dirnameOfPath,
  fileUrlToPath,
  isPathAtOrUnder,
  isRemoteWorkspace,
  joinWorkspacePath,
  pathSepFor,
} from "../shared/workspaceUtils";
import { activeWorkspace, activeWorkspaceId, activeWorkspaceRoot, deviceContext, openInAuxPane } from "../state";
import { layout, palette, radii, space, textStyle } from "../theme";
import { Icon } from "./icons";
import { openImageLightbox } from "./ImageLightbox";
import { Button } from "./primitives";

export const MARKDOWN_MEDIA_EXTENSION = {
  name: "media",
  language: "openbitfun-media",
} as const;

/** Above this, embedded local media is not read into a base64 data URL. */
const EMBEDDED_MEDIA_LIMIT_BYTES = 32 * 1024 * 1024;

const MEDIA_MIME_BY_EXT: Readonly<Record<string, string>> = {
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
  tif: "image/tiff",
  tiff: "image/tiff",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
};

export interface MediaDimensions {
  width: number;
  height: number;
}

export type ResolvedMediaTarget =
  | { kind: "invalid" }
  | { kind: "direct"; src: string }
  | { kind: "external"; src: string }
  | { kind: "workspace"; paths: string[] };

function normalizeSegments(path: string, remote: boolean): string {
  const sep = pathSepFor(path, remote);
  if (remote) {
    const leadingSlash = path.startsWith("/");
    const stack: string[] = [];
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
        else if (!leadingSlash) stack.push("..");
        continue;
      }
      stack.push(part);
    }
    return (leadingSlash ? "/" : "") + stack.join("/");
  }
  const drive = path.match(/^([A-Za-z]:)[\\/]/)?.[1] ?? "";
  const rest = drive ? path.slice(drive.length) : path;
  const leadingSep = !drive && (rest.startsWith("/") || rest.startsWith("\\"));
  const stack: string[] = [];
  for (const part of rest.split(/[\\/]/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
      else if (!drive && !leadingSep) stack.push("..");
      continue;
    }
    stack.push(part);
  }
  if (drive) return `${drive}${sep}${stack.join(sep)}`;
  return (leadingSep ? sep : "") + stack.join(sep);
}

/**
 * Resolves a Markdown image/video/audio `src` into direct, external HTTP(S), or
 * ordered workspace file path candidates (local or POSIX remote).
 */
export function resolveMarkdownMediaTarget(
  rawSrc: string,
  options: { documentPath?: string; workspaceRoot?: string; isRemote?: boolean } = {},
): ResolvedMediaTarget {
  const trimmed = (rawSrc ?? "").trim();
  if (!trimmed) return { kind: "invalid" };
  if (/^(?:data:|asset:|blob:)/i.test(trimmed)) return { kind: "direct", src: trimmed };
  if (/^https?:\/\//i.test(trimmed)) return { kind: "external", src: trimmed };

  const remote = options.isRemote ?? isRemoteWorkspace(activeWorkspace());
  const root = options.workspaceRoot ?? activeWorkspaceRoot();

  if (/^file:\/\//i.test(trimmed)) {
    const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
    const localPath = fileUrlToPath(withoutQuery);
    return localPath ? { kind: "workspace", paths: [localPath] } : { kind: "invalid" };
  }

  let rawPath = trimmed;
  if (/^computer:\/\//i.test(rawPath)) {
    rawPath = rawPath.replace(/^computer:\/\//i, "");
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawPath) && !(!remote && /^[A-Za-z]:[\\/]/.test(rawPath))) {
    return { kind: "invalid" };
  }

  const withoutQuery = (rawPath.split(/[?#]/)[0] ?? "").trim();
  if (!withoutQuery) return { kind: "invalid" };

  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    decoded = withoutQuery;
  }
  if (!decoded) return { kind: "invalid" };

  const candidates: string[] = [];
  const pushUnique = (candidate: string) => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };

  if (decoded.startsWith("/")) {
    const normalizedAbs = normalizeSegments(decoded, remote);
    if (root && !isPathAtOrUnder(normalizedAbs, root, remote)) {
      // GitHub-style repo-root-relative path (e.g. `/png/logo.png`) — try under
      // workspace root first, then fall back to the literal absolute path.
      const underRoot = normalizeSegments(joinWorkspacePath(root, decoded.replace(/^\/+/, ""), remote), remote);
      pushUnique(underRoot);
    }
    pushUnique(normalizedAbs);
    return candidates.length > 0 ? { kind: "workspace", paths: candidates } : { kind: "invalid" };
  }

  if (!remote && /^[A-Za-z]:[\\/]/.test(decoded)) {
    pushUnique(normalizeSegments(decoded, false));
    return { kind: "workspace", paths: candidates };
  }

  const docDir = options.documentPath ? dirnameOfPath(options.documentPath, remote) : "";
  const baseDir = docDir || root;
  if (baseDir) {
    pushUnique(normalizeSegments(joinWorkspacePath(baseDir, decoded, remote), remote));
  }
  if (root && root !== baseDir) {
    pushUnique(normalizeSegments(joinWorkspacePath(root, decoded, remote), remote));
  }
  if (candidates.length === 0) pushUnique(decoded);
  return { kind: "workspace", paths: candidates };
}

// ── Intrinsic image header sniffing (sync frame-0 sizing for data URLs) ──────

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LUT = new Int16Array(128).fill(-1);
for (let i = 0; i < BASE64_CHARS.length; i += 1) {
  BASE64_LUT[BASE64_CHARS.charCodeAt(i)] = i;
}

function decodeBase64Prefix(encoded: string, maxBytes: number): Uint8Array {
  const out = new Uint8Array(maxBytes);
  let outLen = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < encoded.length && outLen < maxBytes; i += 1) {
    const code = encoded.charCodeAt(i);
    if (code === 61 /* '=' */) break;
    if (code >= 128) continue;
    const val = BASE64_LUT[code];
    if (val < 0) continue;
    buf = (buf << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outLen++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, outLen);
}

function readU16BE(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}

function readU16LE(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}

function readU32BE(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}

function parseSvgDimensions(text: string): MediaDimensions | null {
  const tag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;
  const readLen = (attr: string): number | null => {
    const m = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, "i"));
    if (!m) return null;
    const raw = m[1]!.trim();
    if (raw.endsWith("%")) return null;
    const num = Number.parseFloat(raw);
    return Number.isFinite(num) && num > 0 ? num : null;
  };
  const w = readLen("width");
  const h = readLen("height");
  if (w && h) return { width: w, height: h };
  const vb = tag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1];
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number.parseFloat);
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3]) && parts[2]! > 0 && parts[3]! > 0) {
      if (w) return { width: w, height: (w * parts[3]!) / parts[2]! };
      if (h) return { width: (h * parts[2]!) / parts[3]!, height: h };
      return { width: parts[2]!, height: parts[3]! };
    }
  }
  return null;
}

/**
 * Extracts natural image pixel dimensions directly from base64-encoded PNG,
 * GIF, JPEG, WebP, or SVG bytes so workspace images size accurately on frame 0
 * (and deterministically in headless tests where native decoders are absent).
 */
export function sniffBase64ImageDimensions(encoded: string, mime?: string): MediaDimensions | null {
  if (!encoded) return null;
  if (mime === "image/svg+xml") {
    const bytes = decodeBase64Prefix(encoded, 4096);
    let text = "";
    for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]!);
    return parseSvgDimensions(text);
  }
  // 4 KB covers PNG/GIF/WebP headers and virtually all JPEG SOF markers (even with EXIF/ICC).
  const bytes = decodeBase64Prefix(encoded, 16384);
  if (bytes.length < 10) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width@16, height@20
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width = readU32BE(bytes, 16);
    const height = readU32BE(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // GIF: "GIF87a" / "GIF89a", width@6 LE, height@8 LE
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const width = readU16LE(bytes, 6);
    const height = readU16LE(bytes, 8);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // WebP: "RIFF"...."WEBP"
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === "VP8 " && bytes.length >= 30) {
      const width = readU16LE(bytes, 26) & 0x3fff;
      const height = readU16LE(bytes, 28) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === "VP8L" && bytes.length >= 25) {
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }

  // JPEG: FF D8 ... SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset]!;
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const segLen = readU16BE(bytes, offset);
      if (segLen < 2) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && offset + 7 < bytes.length) {
        const height = readU16BE(bytes, offset + 3);
        const width = readU16BE(bytes, offset + 5);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += segLen;
    }
  }

  // Fallback SVG detection when extension was omitted or unknown
  let head = "";
  for (let i = 0; i < Math.min(bytes.length, 256); i += 1) head += String.fromCharCode(bytes[i]!);
  if (head.includes("<svg")) {
    let full = "";
    for (let i = 0; i < Math.min(bytes.length, 4096); i += 1) full += String.fromCharCode(bytes[i]!);
    return parseSvgDimensions(full);
  }
  return null;
}

// ── Sizing math ──────────────────────────────────────────────────────────────

export type ImageLengthSpec =
  | { kind: "points"; value: number }
  | { kind: "percent"; value: number };

export function parseImageLength(raw: number | string | undefined | null): ImageLengthSpec | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? { kind: "points", value: raw } : null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith("%")) {
    const pct = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(pct) && pct > 0 ? { kind: "percent", value: Math.min(100, pct) } : null;
  }
  const num = Number.parseFloat(trimmed.replace(/px$/i, ""));
  return Number.isFinite(num) && num > 0 ? { kind: "points", value: num } : null;
}

/**
 * Computes concrete point `{ width, height }` for an image inside a Markdown
 * reading column. Concrete point boxes never collapse to 0px and work identically
 * for standalone block images and inline `<p><img> <img></p>` rows.
 */
export function computeMarkdownImageBox(params: {
  width?: number | string;
  height?: number | string;
  natural?: MediaDimensions | null;
  containerWidth: number;
}): MediaDimensions {
  const maxW = Math.max(120, Math.floor(params.containerWidth || layout.conversationWidth));
  const wSpec = parseImageLength(params.width);
  const hSpec = parseImageLength(params.height);
  const nat =
    params.natural && params.natural.width > 0 && params.natural.height > 0
      ? params.natural
      : null;

  const resolveWidth = (spec: ImageLengthSpec | null): number | null => {
    if (!spec) return null;
    if (spec.kind === "percent") {
      // Reserve a small horizontal gap for multi-up inline rows (e.g. two `49%` screenshots).
      const basis = spec.value <= 50 ? Math.max(120, maxW - 12) : maxW;
      return Math.max(16, Math.floor((basis * spec.value) / 100));
    }
    return Math.max(1, Math.min(maxW, Math.round(spec.value)));
  };

  const resolveHeight = (spec: ImageLengthSpec | null): number | null => {
    if (!spec) return null;
    if (spec.kind === "percent") {
      return Math.max(16, Math.floor((maxW * 0.6 * spec.value) / 100));
    }
    return Math.max(1, Math.round(spec.value));
  };

  const reqW = resolveWidth(wSpec);
  const reqH = resolveHeight(hSpec);

  if (reqW !== null && reqH !== null) {
    return { width: reqW, height: reqH };
  }

  if (nat) {
    const aspect = nat.width / nat.height;
    if (reqW !== null) {
      return { width: reqW, height: Math.max(1, Math.round(reqW / aspect)) };
    }
    if (reqH !== null) {
      const scaledW = Math.max(1, Math.round(reqH * aspect));
      if (scaledW > maxW) {
        return { width: maxW, height: Math.max(1, Math.round(maxW / aspect)) };
      }
      return { width: scaledW, height: reqH };
    }
    const naturalW = Math.max(1, Math.min(maxW, Math.round(nat.width)));
    return { width: naturalW, height: Math.max(1, Math.round(naturalW / aspect)) };
  }

  // Non-zero provisional box while an external image or native decoder reports
  // its intrinsic dimensions (ensures native loaders start fetching immediately).
  if (reqW !== null) {
    return { width: reqW, height: Math.max(24, Math.min(360, Math.round(reqW * 0.5625))) };
  }
  if (reqH !== null) {
    return { width: Math.min(maxW, Math.max(24, Math.round(reqH * 1.5))), height: reqH };
  }
  const fallbackW = Math.min(maxW, 240);
  return { width: fallbackW, height: Math.round(fallbackW * 0.5625) };
}

// ── Scoped workspace media cache ─────────────────────────────────────────────

type WorkspaceMediaEntry =
  | { status: "ready"; dataUrl: string; resolvedPath: string; natural?: MediaDimensions | null }
  | { status: "too_large"; sizeBytes: number; resolvedPath: string }
  | { status: "error"; resolvedPath: string };

const mediaCache = signal<Record<string, WorkspaceMediaEntry>>({});
const mediaPending = new Set<string>();
const remoteImageSizeCache = new Map<string, MediaDimensions>();

function mediaCacheKey(workspaceId: string, candidatePaths: readonly string[]): string {
  return `${deviceContext()}|${workspaceId}|${candidatePaths.join("\0")}`;
}

/** Clears cached workspace media (e.g. after a file reloads or changes on disk). */
export function invalidateMarkdownMediaCache(path?: string): void {
  if (!path) {
    mediaCache.set({});
    return;
  }
  mediaCache.update(current => {
    let changed = false;
    const next: Record<string, WorkspaceMediaEntry> = {};
    for (const [key, entry] of Object.entries(current)) {
      if (entry.resolvedPath === path || key.includes(path)) {
        changed = true;
        continue;
      }
      next[key] = entry;
    }
    return changed ? next : current;
  });
}

function mimeForPath(path: string, fallback: string): string {
  const ext = extensionOf(path);
  return MEDIA_MIME_BY_EXT[ext] ?? fallback;
}

async function readWorkspaceMediaCandidate(
  workspaceId: string,
  path: string,
  kind: "image" | "video" | "audio",
): Promise<WorkspaceMediaEntry | null> {
  if (kind !== "image") {
    try {
      const meta = await invokeCommand<Record<string, unknown> | null>("get_file_metadata", { workspaceId, path });
      const size = Number(meta?.size ?? Number.NaN);
      if (Number.isFinite(size) && size > EMBEDDED_MEDIA_LIMIT_BYTES) {
        return { status: "too_large", sizeBytes: size, resolvedPath: path };
      }
    } catch {
      // Metadata check is best-effort; proceed to read_file_content.
    }
  }
  try {
    const encoded = await readFileContent(workspaceId, path, "base64");
    if (!encoded) return null;
    const defaultMime = kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png";
    const mime = mimeForPath(path, defaultMime);
    const natural = kind === "image" ? sniffBase64ImageDimensions(encoded, mime) : null;
    return {
      status: "ready",
      dataUrl: `data:${mime};base64,${encoded}`,
      resolvedPath: path,
      natural,
    };
  } catch {
    return null;
  }
}

function ensureWorkspaceMediaLoaded(
  workspaceId: string,
  paths: readonly string[],
  kind: "image" | "video" | "audio",
): string {
  const key = mediaCacheKey(workspaceId, paths);
  if (!workspaceId || paths.length === 0) return key;
  if (mediaPending.has(key) || key in untracked(() => mediaCache())) return key;
  mediaPending.add(key);
  void (async () => {
    try {
      for (const candidate of paths) {
        const result = await readWorkspaceMediaCandidate(workspaceId, candidate, kind);
        if (result) {
          mediaCache.update(current => ({ ...current, [key]: result }));
          return;
        }
      }
      mediaCache.update(current => ({
        ...current,
        [key]: { status: "error", resolvedPath: paths[0] ?? "" },
      }));
    } finally {
      mediaPending.delete(key);
    }
  })();
  return key;
}

/** Reads and caches a workspace image as a `data:` URL (for lightbox opening from Markdown). */
export async function loadWorkspaceImageDataUrl(
  rawSrc: string,
  options: { documentPath?: string; workspaceRoot?: string; isRemote?: boolean } = {},
): Promise<string | null> {
  const target = resolveMarkdownMediaTarget(rawSrc, options);
  if (target.kind === "direct" || target.kind === "external") return target.src;
  if (target.kind !== "workspace") return null;
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return null;
  const key = mediaCacheKey(workspaceId, target.paths);
  const cached = mediaCache()[key];
  if (cached?.status === "ready") return cached.dataUrl;
  for (const candidate of target.paths) {
    const result = await readWorkspaceMediaCandidate(workspaceId, candidate, "image");
    if (result?.status === "ready") {
      mediaCache.update(current => ({ ...current, [key]: result }));
      return result.dataUrl;
    }
  }
  return null;
}

// ── Workspace-aware Markdown image component ─────────────────────────────────

export interface MarkdownImageViewProps {
  image: TextViewImage;
  documentPath?: string;
  workspaceRoot?: string;
  isRemote?: boolean;
  /** Reactive reading column width in points; defaults to `layout.conversationWidth`. */
  containerWidth?: () => number;
}

function ImageFallbackChip(props: { label: string; failed: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().surfaceTertiary,
        alignSelf: "flex-start",
      }}
    >
      <Icon name="image" size={13} color={palette().textMuted} />
      <Text style={{ ...textStyle("caption", { color: palette().textMuted }), numberOfLines: 1 }}>
        {props.failed ? tr("files.imageUnavailable", { name: props.label }) : props.label}
      </Text>
    </View>
  );
}

/**
 * Renders any Markdown image (workspace-relative, repo-root-relative, `file://`,
 * remote workspace, `data:`, or `https://`) with intrinsic aspect-ratio sizing
 * so it never collapses to 0px and degrades cleanly on load errors.
 */
export function MarkdownImageView(props: MarkdownImageViewProps) {
  const remote = () => props.isRemote ?? isRemoteWorkspace(activeWorkspace());
  const root = () => props.workspaceRoot ?? activeWorkspaceRoot();
  const target = () =>
    resolveMarkdownMediaTarget(props.image.src, {
      documentPath: props.documentPath,
      workspaceRoot: root(),
      isRemote: remote(),
    });

  const natural = signal<MediaDimensions | null>(null);
  const loadFailed = signal(false);

  const cacheKey = () => {
    const t = target();
    const wsId = activeWorkspaceId();
    if (t.kind !== "workspace" || !wsId) return "";
    return mediaCacheKey(wsId, t.paths);
  };

  effect(() => {
    const t = target();
    const wsId = activeWorkspaceId();
    void deviceContext();
    if (t.kind === "workspace" && wsId) {
      untracked(() => ensureWorkspaceMediaLoaded(wsId, t.paths, "image"));
    }
  });

  const cacheEntry = () => {
    const key = cacheKey();
    return key ? mediaCache()[key] : undefined;
  };

  const source = () => {
    const t = target();
    if (t.kind === "direct" || t.kind === "external") return t.src;
    if (t.kind === "workspace") {
      const entry = cacheEntry();
      return entry?.status === "ready" ? entry.dataUrl : "";
    }
    return "";
  };

  // Probe intrinsic image dimensions whenever `source()` changes.
  effect(() => {
    const src = source();
    const entry = cacheEntry();
    loadFailed.set(false);
    if (!src) {
      natural.set(null);
      return;
    }
    if (entry?.status === "ready" && entry.natural) {
      natural.set(entry.natural);
      return;
    }
    if (src.startsWith("data:")) {
      const comma = src.indexOf(",");
      if (comma > 0 && src.slice(0, comma).includes(";base64")) {
        const mime = src.slice(5, src.indexOf(";"));
        const sniffed = sniffBase64ImageDimensions(src.slice(comma + 1), mime);
        if (sniffed) {
          natural.set(sniffed);
          return;
        }
      }
    }
    const cachedRemote = remoteImageSizeCache.get(src);
    if (cachedRemote) {
      natural.set(cachedRemote);
      return;
    }
    natural.set(null);
    let cancelled = false;
    void Image.getSize(src)
      .then(size => {
        if (cancelled) return;
        if (size.width > 0 && size.height > 0) {
          const dims = { width: size.width, height: size.height };
          if (!src.startsWith("data:")) remoteImageSizeCache.set(src, dims);
          natural.set(dims);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  });

  const displayName = () => {
    const alt = props.image.alt?.trim();
    if (alt) return alt;
    const t = target();
    if (t.kind === "workspace" && t.paths[0]) return basenameOfPath(t.paths[0], remote());
    return basenameOfPath(props.image.src.split(/[?#]/)[0] ?? props.image.src, true) || props.image.src;
  };

  const box = () =>
    computeMarkdownImageBox({
      width: props.image.width,
      height: props.image.height,
      natural: natural(),
      containerWidth: props.containerWidth?.() ?? layout.conversationWidth,
    });

  const isFailed = () => {
    if (loadFailed()) return true;
    const t = target();
    if (t.kind === "invalid") return true;
    if (t.kind === "workspace") {
      const entry = cacheEntry();
      return entry?.status === "error" || entry?.status === "too_large";
    }
    return false;
  };

  return (
    <If
      when={!isFailed() ? source() || null : null}
      else={<ImageFallbackChip label={displayName()} failed={isFailed()} />}
    >
      {src => (
        <Image
          src={src()}
          accessibilityLabel={displayName()}
          onLoad={event => {
            const w = event.size?.width ?? 0;
            const h = event.size?.height ?? 0;
            if (w > 0 && h > 0) {
              const dims = { width: w, height: h };
              if (!src().startsWith("data:")) remoteImageSizeCache.set(src(), dims);
              natural.set(dims);
            }
          }}
          onError={() => loadFailed.set(true)}
          style={{
            width: box().width,
            height: box().height,
            maxWidth: "100%",
            objectFit: "contain",
            borderRadius: radii.sm,
          }}
        />
      )}
    </If>
  );
}

// ── Embedded <video> / <audio> preprocessing & rendering ─────────────────────

export interface EmbeddedMediaPayload {
  kind: "video" | "audio";
  src: string;
  poster?: string;
  width?: number | string;
  height?: number | string;
  controls?: boolean;
  muted?: boolean;
  loop?: boolean;
  title?: string;
}

function readHtmlAttr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`, "i");
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : undefined;
}

function hasHtmlBooleanAttr(tag: string, name: string): boolean {
  return new RegExp(`\\b${name}(?:\\s*=|\\s|>|/>|$)`, "i").test(tag);
}

function parseMediaElementBlock(html: string): EmbeddedMediaPayload | null {
  const openMatch = /<(video|audio)\b([^>]*)>/i.exec(html);
  if (!openMatch) return null;
  const kind = openMatch[1]!.toLowerCase() as "video" | "audio";
  const attrs = openMatch[2] ?? "";
  let src = readHtmlAttr(attrs, "src") ?? "";
  if (!src) {
    const sourceMatch = /<source\b([^>]*)\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(html);
    src = (sourceMatch?.[2] ?? sourceMatch?.[3] ?? sourceMatch?.[4] ?? "").trim();
  }
  if (!src) return null;
  const rawW = readHtmlAttr(attrs, "width");
  const rawH = readHtmlAttr(attrs, "height");
  const widthSpec = parseImageLength(rawW);
  const heightSpec = parseImageLength(rawH);
  const poster = readHtmlAttr(attrs, "poster");
  const title = readHtmlAttr(attrs, "title") || readHtmlAttr(attrs, "aria-label");
  return {
    kind,
    src,
    ...(poster ? { poster } : {}),
    ...(widthSpec ? { width: widthSpec.kind === "percent" ? `${widthSpec.value}%` : widthSpec.value } : {}),
    ...(heightSpec ? { height: heightSpec.kind === "percent" ? `${heightSpec.value}%` : heightSpec.value } : {}),
    controls: hasHtmlBooleanAttr(attrs, "controls") || true,
    muted: hasHtmlBooleanAttr(attrs, "muted"),
    loop: hasHtmlBooleanAttr(attrs, "loop"),
    ...(title ? { title } : {}),
  };
}

/**
 * Rewrites standalone HTML `<video>` / `<audio>` tags (outside fenced code
 * blocks) into `openbitfun-media` custom blocks so NSH `TextView` does not drop
 * them. Leaves fenced code blocks and standard Markdown untouched.
 */
export function transformEmbeddedMediaMarkdown(markdown: string): string {
  if (!/<(?:video|audio)\b/i.test(markdown)) return markdown;
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let fenceChar = "";
  let fenceLen = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!fenceChar) {
        fenceChar = marker[0]!;
        fenceLen = marker.length;
      } else if (marker[0] === fenceChar && marker.length >= fenceLen && trimmed.slice(marker.length).trim() === "") {
        fenceChar = "";
        fenceLen = 0;
      }
      out.push(line);
      i += 1;
      continue;
    }
    if (fenceChar) {
      out.push(line);
      i += 1;
      continue;
    }

    // Match an HTML media block (optionally wrapped in `<div ...>` / `<p ...>` on its own lines)
    // while avoiding inline code backticks.
    const mediaStart = !line.includes("`") ? /<(video|audio)\b[^>]*>/i.exec(line) : null;
    if (!mediaStart) {
      out.push(line);
      i += 1;
      continue;
    }

    const tagName = mediaStart[1]!.toLowerCase();
    const closeRe = new RegExp(`</${tagName}\\s*>`, "i");
    let block = line;
    let endIndex = i;
    const isSelfClosing = new RegExp(`<${tagName}\\b[^>]*/>`, "i").test(line);
    if (!isSelfClosing && !closeRe.test(line)) {
      while (endIndex + 1 < lines.length) {
        endIndex += 1;
        block += `\n${lines[endIndex]!}`;
        if (closeRe.test(lines[endIndex]!)) break;
      }
    }

    const payload = parseMediaElementBlock(block);
    if (!payload) {
      for (let k = i; k <= endIndex; k += 1) out.push(lines[k]!);
      i = endIndex + 1;
      continue;
    }

    // Keep any non-tag text before/after the media element on the same lines.
    const mediaTagRe = new RegExp(`<${tagName}\\b[\\s\\S]*?(?:/>|</${tagName}\\s*>)`, "i");
    const match = mediaTagRe.exec(block);
    const before = match ? block.slice(0, match.index).trim() : "";
    const after = match ? block.slice(match.index + match[0].length).trim() : "";
    if (before) out.push(before);
    out.push("");
    out.push("```openbitfun-media");
    out.push(JSON.stringify(payload));
    out.push("```");
    out.push("");
    if (after) out.push(after);
    i = endIndex + 1;
  }

  return out.join("\n");
}

export interface MarkdownMediaEmbedProps {
  rawJson: string;
  documentPath?: string;
  workspaceRoot?: string;
  isRemote?: boolean;
  containerWidth?: () => number;
  onOpenWorkspacePath?: (path: string) => void;
}

/** Renders an embedded `<video>` or `<audio>` block from Markdown. */
export function MarkdownMediaEmbed(props: MarkdownMediaEmbedProps) {
  const payload = (): EmbeddedMediaPayload | null => {
    try {
      const parsed = JSON.parse(props.rawJson) as Partial<EmbeddedMediaPayload>;
      if ((parsed.kind !== "video" && parsed.kind !== "audio") || typeof parsed.src !== "string" || !parsed.src.trim()) {
        return null;
      }
      return parsed as EmbeddedMediaPayload;
    } catch {
      return null;
    }
  };

  const remote = () => props.isRemote ?? isRemoteWorkspace(activeWorkspace());
  const root = () => props.workspaceRoot ?? activeWorkspaceRoot();
  const target = () => {
    const p = payload();
    if (!p) return { kind: "invalid" } as ResolvedMediaTarget;
    return resolveMarkdownMediaTarget(p.src, {
      documentPath: props.documentPath,
      workspaceRoot: root(),
      isRemote: remote(),
    });
  };

  const videoSize = signal<MediaDimensions | null>(null);
  const loadFailed = signal(false);

  const cacheKey = () => {
    const t = target();
    const wsId = activeWorkspaceId();
    if (t.kind !== "workspace" || !wsId) return "";
    return mediaCacheKey(wsId, t.paths);
  };

  effect(() => {
    const p = payload();
    const t = target();
    const wsId = activeWorkspaceId();
    void deviceContext();
    loadFailed.set(false);
    videoSize.set(null);
    if (p && t.kind === "workspace" && wsId) {
      untracked(() => ensureWorkspaceMediaLoaded(wsId, t.paths, p.kind));
    }
  });

  const cacheEntry = () => {
    const key = cacheKey();
    return key ? mediaCache()[key] : undefined;
  };

  const source = () => {
    const t = target();
    if (t.kind === "direct" || t.kind === "external") return t.src;
    if (t.kind === "workspace") {
      const entry = cacheEntry();
      return entry?.status === "ready" ? entry.dataUrl : "";
    }
    return "";
  };

  const label = () => {
    const p = payload();
    if (!p) return "";
    if (p.title) return p.title;
    const t = target();
    if (t.kind === "workspace" && t.paths[0]) return basenameOfPath(t.paths[0], remote());
    return basenameOfPath(p.src.split(/[?#]/)[0] ?? p.src, true) || p.src;
  };

  const openMediaTarget = () => {
    const t = target();
    if (t.kind === "external") {
      void openUrl(t.src).catch(() => undefined);
    } else if (t.kind === "workspace" && t.paths[0]) {
      const entry = cacheEntry();
      const targetPath = entry?.resolvedPath || t.paths[0];
      if (props.onOpenWorkspacePath) props.onOpenWorkspacePath(targetPath);
      else openInAuxPane("files", targetPath);
    }
  };

  const box = () => {
    const p = payload();
    const maxW = Math.max(200, Math.floor(props.containerWidth?.() ?? layout.conversationWidth));
    if (p?.kind === "audio") {
      return { width: Math.min(maxW, 480), height: 48 };
    }
    return computeMarkdownImageBox({
      width: p?.width ?? maxW,
      height: p?.height,
      natural: videoSize() ?? { width: 16, height: 9 },
      containerWidth: maxW,
    });
  };

  const fallbackReason = () => {
    const p = payload();
    if (!p) return "";
    const entry = cacheEntry();
    if (entry?.status === "too_large") {
      return tr("doc.mediaTooLarge", { name: label(), size: formatBytes(entry.sizeBytes) });
    }
    return p.kind === "audio"
      ? tr("doc.audioUnavailable", { name: label() })
      : tr("doc.videoUnavailable", { name: label() });
  };

  const isFailed = () => {
    if (loadFailed()) return true;
    const t = target();
    if (t.kind === "invalid") return true;
    if (t.kind === "workspace") {
      const entry = cacheEntry();
      return entry?.status === "error" || entry?.status === "too_large";
    }
    return false;
  };

  return (
    <If when={payload()}>
      {p => (
        <If
          when={!isFailed() ? source() || null : null}
          else={
            <View
              accessibilityLabel={`doc-${p().kind}-fallback`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radii.md,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceTertiary,
                alignSelf: "stretch",
              }}
            >
              <Icon name="file" size={14} color={palette().textMuted} />
              <Text style={{ ...textStyle("caption", { color: palette().textSecondary }), flex: 1, minWidth: 0, numberOfLines: 1 }}>
                {isFailed() ? fallbackReason() : label()}
              </Text>
              <If when={target().kind === "external" || target().kind === "workspace"}>
                <Button
                  label={tr("doc.openLink")}
                  variant="ghost"
                  size="xs"
                  accessibilityLabel={`doc-${p().kind}-open`}
                  onPress={openMediaTarget}
                />
              </If>
            </View>
          }
        >
          {src => (
            <View
              accessibilityLabel={`doc-${p().kind}-view`}
              style={{
                width: box().width,
                maxWidth: "100%",
                borderRadius: radii.md,
                borderCurve: "continuous",
                overflow: "hidden",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceTertiary,
              }}
            >
              <Video
                src={src()}
                paused={true}
                controls={p().controls !== false}
                muted={Boolean(p().muted)}
                repeat={Boolean(p().loop)}
                onLoad={event => {
                  const w = event.size?.width ?? 0;
                  const h = event.size?.height ?? 0;
                  if (w > 0 && h > 0) videoSize.set({ width: w, height: h });
                }}
                onError={() => loadFailed.set(true)}
                style={{ width: box().width, height: box().height }}
              />
            </View>
          )}
        </If>
      )}
    </If>
  );
}

/** Opens a Markdown image in the lightbox using a platform-allowed URL (external or base64 data URL). */
export async function openMarkdownImageInLightbox(
  image: Pick<TextViewImage, "src" | "alt" | "title">,
  options: { documentPath?: string; workspaceRoot?: string; isRemote?: boolean } = {},
): Promise<void> {
  const title = image.alt || image.title || undefined;
  const resolved = await loadWorkspaceImageDataUrl(image.src, options);
  if (resolved) {
    openImageLightbox({ src: resolved, title });
    return;
  }
  const target = resolveMarkdownMediaTarget(image.src, options);
  if (target.kind === "workspace" && target.paths[0]) {
    openInAuxPane("files", target.paths[0]);
  }
}
