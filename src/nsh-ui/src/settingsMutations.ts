// Typed settings mutations. Each command carries one intent; the host applies
// the rule (ids, clamping, request URLs, defaults, validation) to the value it
// stores right now and answers with the updated view, so this surface never
// writes back a document it read earlier.
//
// A host older than these commands is told apart from a refused write: the page
// says the host needs an update instead of falling back to the whole-document
// write the command replaced.

import { invokeCommand } from "./bridge";
import { tr } from "./i18n";

/** Whether `error` says the host has no `command` at all (an older build or peer). */
export function isMissingCommand(error: unknown, command: string): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message.includes(command)) return false;
  return /not found|unsupported|no handler|no answer|unknown command|not available/i.test(message);
}

/** Runs one typed settings command; a missing command becomes the "update the host" sentence. */
export async function invokeSettingsMutation<T>(command: string, request: Record<string, unknown>): Promise<T> {
  try {
    return await invokeCommand<T>(command, request);
  } catch (error) {
    if (isMissingCommand(error, command)) {
      throw new Error(tr("settings.notice.hostUpdateRequired"));
    }
    throw error;
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
