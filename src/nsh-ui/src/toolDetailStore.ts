// Whole tool results, read when a card is opened.
//
// A transcript read asks for `tool_detail: "summary"`: a long session's tool
// outputs are megabytes nobody opened, and shipping, parsing and holding them is
// what made opening and scrolling such a session stutter. The host shortens them
// and marks the call `detailOmitted`; opening that call reads its one turn whole.
// A host that does not know the field answers whole results and never marks one.

import { signal, untracked } from "nsh";
import type { SessionTranscriptView, TranscriptItemView, TranscriptToolView, TranscriptTurnView } from "./api";
import { fleetActive, invokeCommand } from "./bridge";
import { toolCallOf, type ToolCallView } from "./format";

export interface TranscriptSource {
  sessionId: string;
  workspaceId: string;
  deviceId: string;
}

/** Opened calls kept whole; the oldest is dropped (and read again if reopened). */
const MAX_HELD_DETAILS = 48;

const sources = new WeakMap<object, TranscriptSource>();
const held = signal<Record<string, ToolCallView>>({});
const failures = signal<Record<string, true>>({});
const inFlight = new Map<string, Promise<TranscriptTurnView>>();

/** Remembers where these turns were read from, so an opened call can be read whole. */
export function noteTranscriptSource(turns: ReadonlyArray<TranscriptTurnView> | undefined, source: TranscriptSource): void {
  for (const turn of turns ?? []) sources.set(turn, source);
}

function turnKeyOf(turn: TranscriptTurnView, source: TranscriptSource): string {
  return `${source.deviceId}/${source.sessionId}/${turn.turnIndex}/${turn.turnId}`;
}

function keyOf(call: ToolCallView): string | null {
  const turn = call.detailTurn;
  const source = turn ? sources.get(turn) : undefined;
  return turn && source && call.id ? `${turnKeyOf(turn, source)}/${call.id}` : null;
}

function findTool(items: ReadonlyArray<TranscriptItemView>, id: string): TranscriptToolView | null {
  for (const item of items) {
    if (item.kind !== "tool") continue;
    if (item.tool.id === id) return item.tool;
    const nested = findTool(item.tool.subagentItems ?? [], id);
    if (nested) return nested;
  }
  return null;
}

async function readTurn(turn: TranscriptTurnView, source: TranscriptSource): Promise<TranscriptTurnView> {
  const view = await invokeCommand<SessionTranscriptView>(
    "get_session_transcript_view",
    {
      session_id: source.sessionId,
      workspace_id: source.workspaceId,
      limit: 1,
      before_turn_index: turn.turnIndex + 1,
    },
    fleetActive() && source.deviceId ? { target: source.deviceId } : undefined,
  );
  const found = view.turns?.find(item => item.turnId === turn.turnId && item.turnIndex === turn.turnIndex);
  if (!found) throw new Error(`Turn ${turn.turnIndex} is no longer in the transcript`);
  return found;
}

/** Reads the opened call whole, once. Several cards of one turn share the read. */
export async function loadToolDetail(call: ToolCallView): Promise<void> {
  const key = keyOf(call);
  const turn = call.detailTurn;
  if (!call.detailOmitted || !key || !turn || !call.id || untracked(held)[key]) return;
  const source = sources.get(turn)!;
  const turnKey = turnKeyOf(turn, source);
  if (untracked(failures)[key]) {
    failures.update(({ [key]: _, ...rest }) => rest);
  }
  let read = inFlight.get(turnKey);
  if (!read) {
    read = readTurn(turn, source).finally(() => inFlight.delete(turnKey));
    inFlight.set(turnKey, read);
  }
  try {
    const tool = findTool((await read).items, call.id);
    if (!tool) throw new Error(`Tool call ${call.id} is no longer in the transcript`);
    held.update(current => {
      const entries = Object.entries(current);
      const kept = entries.length >= MAX_HELD_DETAILS ? Object.fromEntries(entries.slice(entries.length - MAX_HELD_DETAILS + 1)) : current;
      return { ...kept, [key]: toolCallOf(tool) };
    });
  } catch (error) {
    console.warn(`Tool result could not be read: ${error instanceof Error ? error.message : String(error)}`);
    failures.update(current => ({ ...current, [key]: true }));
  }
}

/** The call as it was read whole, or the call itself until then. */
export function detailedToolCall(call: ToolCallView): ToolCallView {
  if (!call.detailOmitted) return call;
  const key = keyOf(call);
  return (key && held()[key]) || call;
}

export type ToolDetailState = "whole" | "loading" | "failed";

export function toolDetailState(call: ToolCallView): ToolDetailState {
  if (!call.detailOmitted) return "whole";
  const key = keyOf(call);
  if (!key || failures()[key]) return "failed";
  return held()[key] ? "whole" : "loading";
}
