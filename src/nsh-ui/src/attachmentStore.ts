import { Buffer } from "buffer";
import { Clipboard, signal } from "nsh";

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
    attachmentNotice.set("The clipboard holds no image");
    return;
  }

  const { width, height } = image.size;
  if (image.url.startsWith("file://")) {
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
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "image/png";
    addAttachment({
      id: `attachment-${++nextId}`,
      name: `clipboard-${nextId}.${extensionOf(contentType)}`,
      mimeType: contentType,
      fileSize: bytes.byteLength,
      width,
      height,
      dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
    });
  } catch (error) {
    attachmentNotice.set(error instanceof Error ? error.message : String(error));
  }
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
  return imageAttachments().map(entry => ({
    id: entry.id,
    mime_type: entry.mimeType,
    image_name: entry.name,
    file_size: entry.fileSize,
    source: "clipboard" as const,
    ...(entry.imagePath ? { image_path: entry.imagePath } : {}),
    ...(entry.dataUrl ? { data_url: entry.dataUrl } : {}),
    ...(entry.width ? { width: entry.width } : {}),
    ...(entry.height ? { height: entry.height } : {}),
  }));
}

function pathOfFileUrl(url: string): string {
  const withoutScheme = url.slice("file://".length);
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

function nameOfPath(url: string): string {
  const path = pathOfFileUrl(url);
  const name = path.split("/").filter(Boolean).pop();
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
