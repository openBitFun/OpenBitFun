// Log files and the diagnostics bundle: what the desktop's Data > Diagnostics
// page adds beyond the log-level switches.
//
// The level and the sensitive-payload switch are plain config paths and live in
// the settings table; this store holds the answers that are not config — where
// this run writes its logs, whether the previous run ended badly, and the two
// actions over those files. Both actions reach the OS (a file manager, a zip in
// the log directory), so a refusal is reported as it came instead of being
// retried somewhere else.

import { signal } from "nsh";
import { invokeCommand } from "./bridge";
import { runStep } from "./state";

/** What `get_runtime_logging_info` reports about this run. */
export interface RuntimeLoggingInfo {
  effectiveLevel: string;
  sessionLogDir: string;
  appLogPath: string;
  flowChatLogPath: string;
  /** The previous run's ending, when the host detected an unexpected one. */
  previousCrash: { detected: boolean; category: string; sessionLogDir: string } | null;
}

export const runtimeLogging = signal<RuntimeLoggingInfo | null>(null);
export const loggingNotice = signal("");
export const loggingBusy = signal("");

let loaded = false;

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function readRuntimeLogging(value: unknown): RuntimeLoggingInfo {
  const record = (value ?? {}) as Record<string, unknown>;
  const exit = (record.previousUnexpectedExit ?? record.previous_unexpected_exit) as
    | Record<string, unknown>
    | undefined;
  const crash =
    exit && exit.detected === true
      ? {
          detected: true,
          // The host names the category in snake_case (`unclean_shutdown`).
          category: readString(exit, ["category"]).replace(/_/g, " "),
          sessionLogDir: readString(exit, ["sessionLogDir", "session_log_dir"]),
        }
      : null;
  return {
    effectiveLevel: readString(record, ["effectiveLevel", "effective_level"]),
    sessionLogDir: readString(record, ["sessionLogDir", "session_log_dir"]),
    appLogPath: readString(record, ["appLogPath", "app_log_path"]),
    flowChatLogPath: readString(record, ["flowChatLogPath", "flow_chat_log_path"]),
    previousCrash: crash,
  };
}

/** Reads the log location once; the section calls it on every render. */
export function ensureRuntimeLogging(): void {
  if (loaded) return;
  loaded = true;
  void loadRuntimeLogging();
}

export async function loadRuntimeLogging(): Promise<void> {
  await runStep(async () => {
    try {
      const info = await invokeCommand<unknown>("get_runtime_logging_info", {});
      runtimeLogging.set(readRuntimeLogging(info));
    } catch {
      // A host without the command simply has nothing to report here.
      runtimeLogging.set(null);
    }
  });
}

/** Shows the session log folder in this machine's file manager. */
export async function revealLogFolder(): Promise<void> {
  const folder = runtimeLogging()?.sessionLogDir;
  if (!folder) {
    loggingNotice.set("This host reported no log folder");
    return;
  }
  loggingBusy.set("reveal");
  loggingNotice.set("");
  try {
    await invokeCommand<unknown>("reveal_in_explorer", { path: folder });
  } catch (error) {
    loggingNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    loggingBusy.set("");
  }
}

/**
 * Writes a diagnostics bundle and shows where it landed. The bundle carries
 * whatever the sensitive-diagnostics switch allows, so the section says that
 * next to the button instead of asking twice.
 */
export async function exportDiagnosticsBundle(): Promise<void> {
  loggingBusy.set("export");
  loggingNotice.set("");
  try {
    const result = await invokeCommand<Record<string, unknown>>("export_diagnostics_bundle", {});
    const bundlePath = readString(result, ["bundlePath", "bundle_path"]);
    loggingNotice.set(bundlePath ? `Exported ${bundlePath}` : "Bundle exported");
    if (bundlePath) {
      await invokeCommand<unknown>("reveal_in_explorer", { path: bundlePath }).catch(() => null);
    }
  } catch (error) {
    loggingNotice.set(error instanceof Error ? error.message : String(error));
  } finally {
    loggingBusy.set("");
  }
}
