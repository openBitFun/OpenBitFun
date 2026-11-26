// Run the scene with the usual shell prompts on headless and native test hosts.
// Native hosts cannot receive the test runner's host.handlers.
import "../../src/agentEvents";
import { mount } from "nsh";
import { backendConnection, installBackendConnection } from "../../src/bridge";
import { TerminalScene } from "../../src/scenes/TerminalScene";
import { activeWorkspaceKey } from "../../src/state";
import { createBackend } from "../support";

const invoke = createBackend().handlers["openbitfun.invoke"];
installBackendConnection({
  ...backendConnection(),
  async invoke(command, args, options) {
    const envelope = options?.positional
      ? { action: command, raw: args }
      : { action: command, request: args?.request };
    const reply = invoke(envelope) as { ok: true; value: unknown } | { ok: false; error: string };
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  },
});
activeWorkspaceKey.set({ deviceId: "", workspaceId: "workspace-1" });
mount(() => <TerminalScene />);
