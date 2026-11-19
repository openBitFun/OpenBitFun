// Telling an older host apart from a refused request.
//
// A host (or a Peer) older than a command answers with the command's name and a
// "not found" / "unknown command" / "does not implement" style message, depending
// on the transport (Tauri, the native dispatcher, a Peer envelope, the dev host).
// Callers turn that into an explicit "update the host" state instead of falling
// back to a client-side copy of the rule the command now owns.

/** Whether `error` says the host has no `command` at all. */
export function isCommandUnavailable(error: unknown, command: string): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message.includes(command)) return false;
  return /not found|unsupported|not supported|no handler|no answer|unknown command|not available|not implement|no fixture/i.test(
    message,
  );
}
