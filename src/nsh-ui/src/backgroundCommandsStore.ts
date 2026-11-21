// Background commands of a session (wave 22 P5). A command the agent left
// running keeps its output in the runtime of the device that runs the session:
// `list_background_command_activities` lists them for the session,
// `read_background_command_output` pages their output by cursor, and
// `send_background_command_input` / `control_background_command` reach the
// process. The store mirrors those answers and decides nothing about status.

import { signal } from "nsh";
import { fleetActive, invokeCommand, type InvokeCommandOptions } from "./bridge";
import { isMissingCommand } from "./settingsMutations";

export type BackgroundCommandStatus = "running" | "exited" | "interrupted" | "killed" | "pruned" | "failed";

export interface BackgroundCommand {
  execSessionId: number;
  command: string;
  workdir?: string;
  remote: boolean;
  tty: boolean;
  status: BackgroundCommandStatus | string;
  exitCode?: number | null;
  startedAt?: number;
  endedAt?: number | null;
  truncatedFromStart?: boolean;
}

export interface BackgroundCommandsTarget {
  sessionId: string;
  deviceId: string;
}

/** The commands of the open session, as the host lists them. */
export const backgroundCommands = signal<BackgroundCommand[]>([]);
export const backgroundCommandsSession = signal<string>("");
export const backgroundCommandsUnsupported = signal(false);

/** The command whose output sheet is open. */
export const backgroundOutputOpen = signal<BackgroundCommand | null>(null);
export const backgroundOutputText = signal("");
export const backgroundOutputNotice = signal("");
export const backgroundInputDraft = signal("");

let outputCursor: number | null = null;
let outputDevice = "";
let pollTimer: ReturnType<typeof setTimeout> | null = null;

/** Output kept on screen; older text scrolls off as the host's own buffer does. */
const OUTPUT_LIMIT = 200_000;
const POLL_MS = 1000;

function route(deviceId: string): InvokeCommandOptions | undefined {
  return fleetActive() && deviceId ? { target: deviceId } : undefined;
}

function readCommand(raw: unknown): BackgroundCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.execSessionId !== "number") return null;
  return {
    execSessionId: value.execSessionId,
    command: typeof value.command === "string" ? value.command : "",
    ...(typeof value.workdir === "string" ? { workdir: value.workdir } : {}),
    remote: value.remote === true,
    tty: value.tty === true,
    status: typeof value.status === "string" ? value.status : "running",
    ...(typeof value.exitCode === "number" ? { exitCode: value.exitCode } : {}),
    ...(typeof value.startedAt === "number" ? { startedAt: value.startedAt } : {}),
    ...(typeof value.endedAt === "number" ? { endedAt: value.endedAt } : {}),
    ...(value.truncatedFromStart === true ? { truncatedFromStart: true } : {}),
  };
}

/** The commands still running, in the host's order. */
export function runningBackgroundCommands(): BackgroundCommand[] {
  return backgroundCommands().filter(command => command.status === "running");
}

/** Lists the session's background commands on its device. */
export async function loadBackgroundCommands(target: BackgroundCommandsTarget): Promise<void> {
  const key = `${target.deviceId}/${target.sessionId}`;
  if (backgroundCommandsSession() !== key) {
    backgroundCommands.set([]);
    backgroundCommandsSession.set(key);
  }
  try {
    const answer = await invokeCommand<{ activities?: unknown[] }>(
      "list_background_command_activities",
      { agentSessionId: target.sessionId },
      route(target.deviceId),
    );
    if (backgroundCommandsSession() !== key) return;
    backgroundCommandsUnsupported.set(false);
    backgroundCommands.set(
      (Array.isArray(answer?.activities) ? answer.activities : [])
        .map(readCommand)
        .filter((row): row is BackgroundCommand => row !== null),
    );
  } catch (error) {
    if (backgroundCommandsSession() !== key) return;
    backgroundCommands.set([]);
    backgroundCommandsUnsupported.set(isMissingCommand(error, "list_background_command_activities"));
  }
}

function appendOutput(text: string, reset: boolean): void {
  const next = (reset ? "" : backgroundOutputText()) + text;
  backgroundOutputText.set(next.length > OUTPUT_LIMIT ? next.slice(next.length - OUTPUT_LIMIT) : next);
}

async function readOutput(): Promise<void> {
  const command = backgroundOutputOpen();
  if (!command) return;
  try {
    const answer = await invokeCommand<{
      metadata?: unknown;
      cursor?: number;
      reset?: boolean;
      snapshot?: string | null;
      chunks?: string[];
    }>(
      "read_background_command_output",
      {
        execSessionId: command.execSessionId,
        remote: command.remote,
        cursor: outputCursor,
      },
      route(outputDevice),
    );
    if (backgroundOutputOpen()?.execSessionId !== command.execSessionId) return;
    const reset = answer?.reset === true || outputCursor === null;
    const text = `${answer?.snapshot ?? ""}${(answer?.chunks ?? []).join("")}`;
    if (reset || text) appendOutput(text, reset);
    if (typeof answer?.cursor === "number") outputCursor = answer.cursor;
    const metadata = readCommand(answer?.metadata);
    if (metadata) {
      backgroundOutputOpen.set(metadata);
      backgroundCommands.set(
        backgroundCommands().map(row => (row.execSessionId === metadata.execSessionId ? metadata : row)),
      );
    }
    backgroundOutputNotice.set("");
  } catch (error) {
    backgroundOutputNotice.set(error instanceof Error ? error.message : String(error ?? ""));
  }
}

function schedulePoll(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    pollTimer = null;
    const command = backgroundOutputOpen();
    if (!command) return;
    void readOutput().then(() => {
      // Output stops growing once the process ended; one last read settles it.
      if (backgroundOutputOpen()?.status === "running") schedulePoll();
    });
  }, POLL_MS);
}

/** Opens the output of one command and follows it while it runs. */
export async function openBackgroundOutput(command: BackgroundCommand, deviceId: string): Promise<void> {
  backgroundOutputOpen.set(command);
  backgroundOutputText.set("");
  backgroundOutputNotice.set("");
  backgroundInputDraft.set("");
  outputCursor = null;
  outputDevice = deviceId;
  await readOutput();
  if (backgroundOutputOpen()?.status === "running") schedulePoll();
}

export function closeBackgroundOutput(): void {
  backgroundOutputOpen.set(null);
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

/** Types a line into the process (Return appended). */
export async function sendBackgroundInput(text: string, appendEnter = true): Promise<void> {
  const command = backgroundOutputOpen();
  if (!command || (!text && !appendEnter)) return;
  await invokeCommand<unknown>(
    "send_background_command_input",
    { execSessionId: command.execSessionId, remote: command.remote, chars: text, appendEnter },
    route(outputDevice),
  );
  backgroundInputDraft.set("");
  await readOutput();
}

/** Interrupts (Ctrl+C) or kills the process. */
export async function controlBackgroundCommand(action: "interrupt" | "kill"): Promise<void> {
  const command = backgroundOutputOpen();
  if (!command) return;
  await invokeCommand<unknown>(
    "control_background_command",
    { execSessionId: command.execSessionId, action, remote: command.remote },
    route(outputDevice),
  );
  await readOutput();
}
