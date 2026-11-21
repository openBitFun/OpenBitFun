// Settings export and import (wave 22 P5). The device in the settings scope
// owns its configuration: `export_config` answers the whole document as a
// versioned export, and `import_config` validates and applies one (it refuses a
// file it cannot read and keeps the current settings). The client only moves
// the document between the device and the user: a copy on the clipboard out, a
// picked or pasted file in.

import { Clipboard, Picker, signal } from "nsh";
import { invokeCommand } from "./bridge";

export interface ConfigImportOutcome {
  success: boolean;
  errors: string[];
  warnings: string[];
}

export const configImportOpen = signal(false);
export const configImportText = signal("");
export const configImportName = signal("");
export const configTransferBusy = signal<"export" | "import" | null>(null);
export const configImportError = signal("");

/** Reads the device's export and puts it on the clipboard; resolves with its version line. */
export async function copyConfigExport(): Promise<{ version: string; exportedAt: string }> {
  configTransferBusy.set("export");
  try {
    const exported = await invokeCommand<Record<string, unknown>>("export_config");
    await Clipboard.writeText(JSON.stringify(exported, null, 2));
    return {
      version: typeof exported?.version === "string" ? exported.version : "",
      exportedAt: typeof exported?.export_timestamp === "string" ? exported.export_timestamp : "",
    };
  } finally {
    configTransferBusy.set(null);
  }
}

export function openConfigImport(): void {
  configImportText.set("");
  configImportName.set("");
  configImportError.set("");
  configImportOpen.set(true);
}

export function closeConfigImport(): void {
  configImportOpen.set(false);
}

/** Lets the user pick an exported `.json` file and reads its text into the dialog. */
export async function pickConfigFile(): Promise<void> {
  const files = await Picker.pickFiles({
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
    maxSize: 8 * 1024 * 1024,
  });
  const picked = files[0];
  if (!picked) return;
  if (!picked.file || picked.status !== "read") {
    configImportError.set("tooLarge");
    return;
  }
  configImportName.set(picked.name);
  configImportText.set(await picked.file.text());
  configImportError.set("");
}

/** Sends the document to the device; a parse error stays in the dialog. */
export async function importConfigText(): Promise<ConfigImportOutcome | null> {
  let data: unknown;
  try {
    data = JSON.parse(configImportText());
  } catch {
    configImportError.set("invalidJson");
    return null;
  }
  configTransferBusy.set("import");
  try {
    const answer = await invokeCommand<Record<string, unknown>>("import_config", { configData: data });
    const outcome: ConfigImportOutcome = {
      success: answer?.success === true,
      errors: Array.isArray(answer?.errors) ? answer.errors.map(String) : [],
      warnings: Array.isArray(answer?.warnings) ? answer.warnings.map(String) : [],
    };
    if (outcome.success) configImportOpen.set(false);
    else configImportError.set(outcome.errors.join("\n") || "failed");
    return outcome;
  } catch (error) {
    configImportError.set(error instanceof Error ? error.message : String(error ?? ""));
    return null;
  } finally {
    configTransferBusy.set(null);
  }
}
