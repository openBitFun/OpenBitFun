import { Buffer } from "buffer";
import { createWorkspaceDirectory } from "./api";
import { entryDeviceId, fleetActive, invokeCommand } from "./bridge";
import { controllerPort } from "./controller/controllerPort";
import { fleetDeviceById } from "./fleetStore";
import { tr } from "./i18n";
import { activeSessionDevice, activeWorkspace, activeWorkspaceId, activeWorkspaceRoot, deviceContext } from "./state";
import { Clipboard, Picker, signal } from "nsh";

/**
 * Whether the active session runs on this machine with a local workspace, so
 * controller-side `imagePath` files can be read directly by the backend.
 * Remote peers, remote SSH/Docker/WSL workspaces, and browser/phone controllers
 * MUST send image bytes (`dataUrl`) and never controller-local paths.
 */
export function isLocalAttachmentPathAllowed(): boolean {
  if (controllerPort()) return false;
  if (fleetActive()) {
    const targetDevice = activeSessionDevice() || deviceContext();
    if (
      targetDevice &&
      targetDevice !== entryDeviceId() &&
      fleetDeviceById(targetDevice)?.isClientDevice !== true
    ) {
      return false;
    }
  }
  const ws = activeWorkspace();
  if (isRemoteWorkspace(ws)) {
    return false;
  }
  return true;
}

/**
 * An image the composer carries into the next turn. The React surface sends the
 * same shape (`ImageContextData`) to `start_dialog_turn`, so an attachment that
 * arrives here reaches the model exactly as it does there: by `image_path` when
 * the bytes already sit on this machine, by `data_url` when they only exist in
 * the clipboard.
 */
export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  imagePath?: string;
  dataUrl?: string;
}

export interface FileAttachment {
  id: string;
  name: string;
  /** Full path on the workspace host (or relative path when root is unknown). */
  path: string;
  /** Workspace-relative POSIX path when inside the active workspace root. */
  relativePath?: string;
  isDirectory?: boolean;
  source: "file" | "folder" | "pasted-text";
  lineCount?: number;
  charCount?: number;
}

export const LONG_PASTE_MAX_LINES = 50;
export const LONG_PASTE_MAX_CHARS = 1000;

export const imageAttachments = signal<ImageAttachment[]>([]);
export const fileAttachments = signal<FileAttachment[]>([]);
export const attachmentNotice = signal<string>("");

let nextId = 0;

export function countTextLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

export function isLongTextPaste(text: string): boolean {
  if (!text) return false;
  return text.length > LONG_PASTE_MAX_CHARS || countTextLines(text) > LONG_PASTE_MAX_LINES;
}

export function toRelativeWorkspacePath(filePath: string, root: string): string | undefined {
  if (!filePath || !root) return undefined;
  const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normPath = filePath.replace(/\\/g, "/");
  if (!normRoot) return undefined;
  if (normPath === normRoot) return ".";
  if (normPath.startsWith(`${normRoot}/`)) {
    return normPath.slice(normRoot.length + 1);
  }
  return undefined;
}

export function addFileAttachment(input: Omit<FileAttachment, "id">): FileAttachment {
  const existing = fileAttachments().find(item => item.path === input.path && item.isDirectory === input.isDirectory);
  if (existing) return existing;
  const entry: FileAttachment = {
    id: `file-attachment-${++nextId}`,
    ...input,
  };
  fileAttachments.update(list => [...list, entry]);
  attachmentNotice.set("");
  return entry;
}

export function removeFileAttachment(id: string): void {
  fileAttachments.update(list => list.filter(entry => entry.id !== id));
}

export function clearFileAttachments(): void {
  fileAttachments.set([]);
}

export function formatFileAttachmentTag(entry: Pick<FileAttachment, "path" | "relativePath" | "name" | "isDirectory">): string {
  const ref = (entry.relativePath || entry.path || entry.name).trim();
  return entry.isDirectory ? `#dir:${ref}` : `#file:${ref}`;
}

export function composeMessageWithFileAttachments(
  text: string,
  files: ReadonlyArray<Pick<FileAttachment, "path" | "relativePath" | "name" | "isDirectory">>,
): string {
  const trimmed = text.trim();
  if (files.length === 0) return trimmed;
  const tags: string[] = [];
  for (const file of files) {
    const tag = formatFileAttachmentTag(file);
    if (!trimmed.includes(tag)) tags.push(tag);
  }
  if (tags.length === 0) return trimmed;
  return trimmed ? `${trimmed} ${tags.join(" ")}` : tags.join(" ");
}

import { isRemoteWorkspace } from "./shared/workspaceUtils";

function isRemoteWorkspaceObj(ws: unknown): boolean {
  if (!ws || typeof ws !== "object") return false;
  return isRemoteWorkspace(ws as Parameters<typeof isRemoteWorkspace>[0]);
}

function formatPastedFileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return `pasted-${stamp}-${suffix}.txt`;
}

/**
 * Saves long pasted text (>50 lines or >1000 chars) into `<workspace>/.openbitfun/pasted/`
 * through `create_directory` + `write_file_content` (Routed / Proxied / HANDLED on local,
 * remote SSH/Docker, and CLI peer workspaces) and attaches it as a styled `FileAttachment`.
 */
export async function saveLongTextPasteToWorkspace(
  text: string,
  options?: {
    workspaceId?: string;
    workspaceRoot?: string;
    isRemote?: boolean;
    fileName?: string;
    skipPrimaryStore?: boolean;
  },
): Promise<FileAttachment | null> {
  const workspaceId = options?.workspaceId || activeWorkspaceId();
  const root = (options?.workspaceRoot || activeWorkspaceRoot() || "").trim();
  if (!workspaceId || !root) return null;
  const isRemote = options?.isRemote ?? isRemoteWorkspaceObj(activeWorkspace());
  // Remote workspaces always use POSIX paths; Windows local roots keep backslash.
  const sep = !isRemote && /^[A-Za-z]:\\/.test(root) ? "\\" : "/";
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const pastedDir = `${trimmedRoot}${sep}.openbitfun${sep}pasted`;
  const fileName = options?.fileName || formatPastedFileName();
  const filePath = `${pastedDir}${sep}${fileName}`;
  const relativePath = `.openbitfun/pasted/${fileName}`;

  try {
    try {
      await createWorkspaceDirectory(workspaceId, pastedDir);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!/exist/i.test(msg)) {
        // Proceed to write attempt; write_file_content will surface any real permission/path failure.
      }
    }
    await invokeCommand<unknown>("write_file_content", {
      workspaceId,
      workspacePath: root,
      filePath,
      content: text,
    });
    const entry = {
      name: fileName,
      path: filePath,
      relativePath,
      isDirectory: false,
      source: "pasted-text" as const,
      lineCount: countTextLines(text),
      charCount: text.length,
    };
    if (options?.skipPrimaryStore) {
      return { id: `file-attachment-${++nextId}`, ...entry };
    }
    return addFileAttachment(entry);
  } catch {
    return null;
  }
}

/**
 * Reads the clipboard's image. A `file:` URL is a path the host can open itself,
 * so the bytes stay out of the app; anything else is fetched and carried as a
 * data URL. A clipboard without an image says so instead of failing the send.
 */
export async function attachImageFromClipboard(): Promise<void> {
  attachmentNotice.set("");
  let image: { url: string; size: { width: number; height: number } } | null = null;
  try {
    image = await Clipboard.readImage();
  } catch (error) {
    attachmentNotice.set(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!image) {
    attachmentNotice.set(tr("chat.attach.noClipboardImage"));
    return;
  }

  const { width, height } = image.size;
  if (image.url.startsWith("file://") && isLocalAttachmentPathAllowed()) {
    addAttachment({
      id: `attachment-${++nextId}`,
      name: nameOfPath(image.url),
      mimeType: mimeOfPath(image.url),
      fileSize: 0,
      width,
      height,
      imagePath: pathOfFileUrl(image.url),
    });
    return;
  }

  try {
    const response = await fetch(image.url);
    if (!response.ok) {
      throw new Error(tr("error.unsupported"));
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType =
      response.headers.get("content-type") ??
      (image.url.startsWith("file://") ? mimeOfPath(image.url) : "image/png");
    addAttachment({
      id: `attachment-${++nextId}`,
      name: image.url.startsWith("file://") ? nameOfPath(image.url) : `clipboard-${nextId}.${extensionOf(contentType)}`,
      mimeType: contentType,
      fileSize: bytes.byteLength,
      width,
      height,
      dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
    });
  } catch (error) {
    attachmentNotice.set(
      image.url.startsWith("file://")
        ? tr("error.unsupported")
        : error instanceof Error
          ? error.message
          : String(error),
    );
  }
}

/**
 * Lets the user pick image files with the system picker. The bytes travel as a
 * data URL, the same field a clipboard image uses, so the host needs no access
 * to this machine's file system (a remote or Peer host could not open a local
 * path anyway). A runtime without the `picker` capability says so.
 */
export async function attachImagesFromPicker(
  onAdd?: (attachment: ImageAttachment) => void,
): Promise<number> {
  attachmentNotice.set("");
  let picked: Array<{ file: File; size: { width: number; height: number } }> = [];
  try {
    picked = await Picker.pickImages({ multiple: true, limit: 8, maxDimension: 2048 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    attachmentNotice.set(
      message.includes("ERR_ACCESS_DENIED") ? tr("chat.attach.pickerUnavailable") : message,
    );
    return 0;
  }
  const addTarget = onAdd ?? addAttachment;
  let added = 0;
  for (const image of picked) {
    try {
      const bytes = new Uint8Array(await image.file.arrayBuffer());
      const mimeType = image.file.type || "image/png";
      addTarget({
        id: `attachment-${++nextId}`,
        name: image.file.name || `image-${nextId}.${extensionOf(mimeType)}`,
        mimeType,
        fileSize: bytes.byteLength,
        width: image.size.width,
        height: image.size.height,
        dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
      });
      added += 1;
    } catch (error) {
      attachmentNotice.set(error instanceof Error ? error.message : String(error));
    }
  }
  return added;
}

function addAttachment(attachment: ImageAttachment): void {
  imageAttachments.update(list => [...list, attachment]);
}

/** Drops an attachment from the next turn; the array is replaced so `<Each>` re-renders. */
export function removeAttachment(id: string): void {
  imageAttachments.update(list => list.filter(entry => entry.id !== id));
}

export function clearAttachments(): void {
  imageAttachments.set([]);
  fileAttachments.set([]);
  attachmentNotice.set("");
}

/** Serializes a list of image attachments into the wire shape `submit_user_message` / `start_dialog_turn` expects. */
export function buildAttachmentContexts(list: ReadonlyArray<ImageAttachment>) {
  const allowLocalPath = isLocalAttachmentPathAllowed();
  return list
    .filter(entry => Boolean(entry.dataUrl) || (allowLocalPath && Boolean(entry.imagePath)))
    .map(entry => ({
      id: entry.id,
      mime_type: entry.mimeType,
      image_name: entry.name,
      file_size: entry.fileSize,
      source: "clipboard" as const,
      ...(allowLocalPath && entry.imagePath ? { image_path: entry.imagePath } : {}),
      ...(entry.dataUrl ? { data_url: entry.dataUrl } : {}),
      ...(entry.width ? { width: entry.width } : {}),
      ...(entry.height ? { height: entry.height } : {}),
    }));
}

/** The request field `start_dialog_turn` takes, empty when nothing is attached. */
export function attachmentContexts() {
  return buildAttachmentContexts(imageAttachments());
}

/**
 * Resolves a displayable preview `src` for an image attachment or persisted
 * `UserImage` across composer chips, rerun chips, and transcript bubbles.
 * Never returns a local `file://` URI for remote peers or remote workspaces.
 */
export function attachmentPreviewSrc(entry: { dataUrl?: string; imagePath?: string }): string {
  if (entry.dataUrl) return entry.dataUrl;
  if (entry.imagePath && isLocalAttachmentPathAllowed()) {
    return fileUrlOfPath(entry.imagePath);
  }
  return "";
}

/**
 * A local path as a `file:` URL on every OS. `file://` + a Windows path reads
 * its drive as a host (`file://C:/x`), so a drive path gets the empty host
 * (`file:///C:/x`) and a UNC path its server (`\\srv\share` -> `file://srv/share`).
 * POSIX paths are left as they are (a backslash is a character there).
 */
export function fileUrlOfPath(path: string): string {
  if (path.startsWith("file://")) return path;
  if (/^[A-Za-z]:[\\/]/.test(path)) return `file:///${path.replace(/\\/g, "/")}`;
  if (path.startsWith("\\\\")) return `file:${path.replace(/\\/g, "/")}`;
  return `file://${path.startsWith("/") ? "" : "/"}${path}`;
}

export function pathOfFileUrl(url: string): string {
  let withoutScheme = url.startsWith("file://") ? url.slice("file://".length) : url;
  if (/^localhost\//i.test(withoutScheme)) {
    withoutScheme = withoutScheme.slice("localhost".length);
  }
  if (/^\/+[A-Za-z]:[\\/]/.test(withoutScheme)) {
    withoutScheme = withoutScheme.replace(/^\/+/, "");
  } else if (url.startsWith("file://") && withoutScheme && !withoutScheme.startsWith("/")) {
    // `file://srv/share/x` names a UNC path: keep its server.
    withoutScheme = `//${withoutScheme}`;
  }
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

function nameOfPath(url: string): string {
  const path = pathOfFileUrl(url);
  const name = path.split(/[\\/]/).filter(Boolean).pop();
  return name ?? "image.png";
}

function mimeOfPath(url: string): string {
  const extension = nameOfPath(url).split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function extensionOf(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
}
