import { Buffer } from "buffer";
import { entryDeviceId, fleetActive } from "./bridge";
import { controllerPort } from "./controller/controllerPort";
import { fleetDeviceById } from "./fleetStore";
import { tr } from "./i18n";
import { activeSessionDevice, activeWorkspace, deviceContext } from "./state";
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
  const ws = activeWorkspace() as
    | ({ workspaceKind?: string; sshHost?: string; remoteConnectionId?: string } | null | undefined);
  if (ws) {
    const kind = (ws.workspaceKind ?? "").toLowerCase();
    if (
      kind === "remote" ||
      kind === "remote_ssh" ||
      kind === "docker" ||
      kind === "wsl" ||
      Boolean(ws.sshHost) ||
      Boolean(ws.remoteConnectionId)
    ) {
      return false;
    }
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

export const imageAttachments = signal<ImageAttachment[]>([]);
export const attachmentNotice = signal<string>("");

let nextId = 0;

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
export async function attachImagesFromPicker(): Promise<number> {
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
  let added = 0;
  for (const image of picked) {
    try {
      const bytes = new Uint8Array(await image.file.arrayBuffer());
      const mimeType = image.file.type || "image/png";
      addAttachment({
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
  attachmentNotice.set("");
}

/** The request field `start_dialog_turn` takes, empty when nothing is attached. */
export function attachmentContexts() {
  const allowLocalPath = isLocalAttachmentPathAllowed();
  return imageAttachments()
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

export function pathOfFileUrl(url: string): string {
  let withoutScheme = url.startsWith("file://") ? url.slice("file://".length) : url;
  if (/^localhost\//i.test(withoutScheme)) {
    withoutScheme = withoutScheme.slice("localhost".length);
  }
  if (/^\/+[A-Za-z]:[\\/]/.test(withoutScheme)) {
    withoutScheme = withoutScheme.replace(/^\/+/, "");
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
