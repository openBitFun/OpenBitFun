/**
 * Per-tool transcript cards, the NSH counterpart of the desktop's
 * `flow_chat/tool-cards` registry. A tool call resolves to one `ToolKind` by its
 * name (MCP tools by their `mcp__server__tool` prefix, then the shape of their
 * arguments), and the kind decides three things: the localized verb title
 * ("Read", "Ran", "Edited"), the one-line target beside it, and what the expanded
 * card shows. Every expanded card ends with the tool's result (or its error), so
 * nothing the host sent back is hidden.
 *
 * Every call is one quiet 28 row (visual spec §3 Tool): icon 14, verb 13/500,
 * target mono 12, duration on the right; it expands into a mono well.
 */

import { McpAppLauncher } from "./sessionExtras"; // wave22-p5
import { Clipboard, computed, Image, openUrl, Scroll, signal, Text, View } from "nsh";
import type { JSX, Signal, ViewStyle } from "nsh";
import { DiffView } from "nsh/base";
import {
  basename,
  commandOf,
  toolCallOf,
  diffOf,
  exploreCounts,
  formatDuration,
  formatPlural,
  pathOf,
  todosOf,
  type ToolCallView,
} from "../format";
import { tr, type MessageKey } from "../i18n";
import { addReviewNote, editingReviewNote, removeReviewNote, reviewNotesFor, updateReviewNote, type ReviewNote } from "../reviewStore";
import { activeSessionKey, openInAuxPane, selectSession } from "../state";
import { fontMono, palette, radii, space, textLineHeight, textSize } from "../theme";
import { Icon, type IconName } from "./icons";
import { createDiffViewStyles, inferCodeLanguage } from "./markdown";
import {
  animateLayout,
  BrandSpinner,
  MOTION_DURATION,
  paintTransition,
  pressTransition,
  tactileActiveStyle,
} from "./motion";
import { IconButton, InputBox, StatusDot } from "./primitives";

export type ToolRunState = "completed" | "running" | "failed" | "cancelled" | "confirmation";

export type ToolKind =
  | "exec"
  | "read"
  | "write"
  | "edit"
  | "delete"
  | "grep"
  | "glob"
  | "ls"
  | "websearch"
  | "webfetch"
  | "todo"
  | "task"
  | "question"
  | "image"
  | "mcp"
  | "generic";

const KIND_BY_NAME: Record<string, ToolKind> = {
  bash: "exec",
  execcommand: "exec",
  runcode: "exec",
  runcommand: "exec",
  shell: "exec",
  exec: "exec",
  terminal: "exec",
  writestdin: "exec",
  read: "read",
  readfile: "read",
  write: "write",
  writefile: "write",
  createfile: "write",
  edit: "edit",
  editfile: "edit",
  multiedit: "edit",
  strreplace: "edit",
  strreplaceeditor: "edit",
  searchreplace: "edit",
  applypatch: "edit",
  delete: "delete",
  deletefile: "delete",
  grep: "grep",
  searchfiles: "grep",
  codebasesearch: "grep",
  glob: "glob",
  findfiles: "glob",
  ls: "ls",
  listdir: "ls",
  listdirectory: "ls",
  websearch: "websearch",
  webfetch: "webfetch",
  todowrite: "todo",
  todo: "todo",
  createplan: "todo",
  task: "task",
  agentspawn: "task",
  agentfork: "task",
  askuserquestion: "question",
  viewimage: "image",
  generateimage: "image",
  analyzeimage: "image",
};

/** `mcp__server__tool` → `{ server, tool }`, the desktop's own split. */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const index = rest.indexOf("__");
  if (index <= 0 || index >= rest.length - 2) return null;
  return { server: rest.slice(0, index), tool: rest.slice(index + 2) };
}

export function toolKindOf(call: ToolCallView): ToolKind {
  if (call.name.startsWith("mcp__")) return "mcp";
  const normalized = call.name.toLowerCase().replace(/[^a-z]/g, "");
  const known = KIND_BY_NAME[normalized];
  if (known) return known;
  if (todosOf(call.input).length > 0) return "todo";
  if (diffOf(call.input) !== null) return "edit";
  if (commandOf(call.input)) return "exec";
  return "generic";
}

const VERB_KEYS: Record<Exclude<ToolKind, "mcp" | "generic">, { done: MessageKey; running: MessageKey }> = {
  exec: { done: "chat.tool.exec.done", running: "chat.tool.exec.running" },
  read: { done: "chat.tool.read.done", running: "chat.tool.read.running" },
  write: { done: "chat.tool.write.done", running: "chat.tool.write.running" },
  edit: { done: "chat.tool.edit.done", running: "chat.tool.edit.running" },
  delete: { done: "chat.tool.delete.done", running: "chat.tool.delete.running" },
  grep: { done: "chat.tool.grep.done", running: "chat.tool.grep.running" },
  glob: { done: "chat.tool.glob.done", running: "chat.tool.glob.running" },
  ls: { done: "chat.tool.ls.done", running: "chat.tool.ls.running" },
  websearch: { done: "chat.tool.websearch.done", running: "chat.tool.websearch.running" },
  webfetch: { done: "chat.tool.webfetch.done", running: "chat.tool.webfetch.running" },
  todo: { done: "chat.tool.todo.done", running: "chat.tool.todo.running" },
  task: { done: "chat.tool.task.done", running: "chat.tool.task.running" },
  question: { done: "chat.tool.question.done", running: "chat.tool.question.running" },
  image: { done: "chat.tool.image.done", running: "chat.tool.image.running" },
};

const ICON_BY_KIND: Record<ToolKind, IconName> = {
  exec: "terminal",
  read: "file-text",
  write: "file-code",
  edit: "edit",
  delete: "trash",
  grep: "search",
  glob: "search",
  ls: "folder-open",
  websearch: "globe",
  webfetch: "link",
  todo: "check-circle",
  task: "bot",
  question: "help-circle",
  image: "image",
  mcp: "plug",
  generic: "wrench",
};

function inputRecord(call: ToolCallView): Record<string, unknown> {
  const input = call.input;
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // A partial argument string is not an object yet.
    }
  }
  return {};
}

function firstStringOf(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function firstNumberOf(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function resultRecord(result: unknown): Record<string, unknown> | null {
  if (result && typeof result === "object" && !Array.isArray(result)) return result as Record<string, unknown>;
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const MAX_RESULT_CHARS = 24_000;

/** The result as a reader wants it: the text it carries, or its JSON. */
export function resultTextOf(call: ToolCallView): string {
  const result = call.result;
  let text = "";
  if (typeof result === "string") {
    text = result;
  } else if (result !== undefined && result !== null) {
    const record = resultRecord(result);
    const direct = record
      ? firstStringOf(record, ["output", "content", "text", "stdout", "result", "summary", "message"])
      : "";
    if (direct) {
      const stderr = record ? firstStringOf(record, ["stderr"]) : "";
      text = stderr && direct !== stderr ? `${direct}\n${stderr}` : direct;
    } else {
      try {
        text = JSON.stringify(result, null, 2) ?? "";
      } catch {
        text = String(result);
      }
    }
  }
  if (!text && call.resultForAssistant) text = call.resultForAssistant;
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n…` : text;
}

function execCommandOf(call: ToolCallView): string {
  const input = inputRecord(call);
  const cmd = firstStringOf(input, ["cmd", "command", "script", "shell"]);
  if (cmd) return cmd;
  const code = firstStringOf(input, ["code"]);
  if (code) return code.split("\n")[0] ?? code;
  return firstStringOf(input, ["description", "chars"]);
}

function exitCodeOf(call: ToolCallView): number | undefined {
  const record = resultRecord(call.result);
  if (!record) return undefined;
  return firstNumberOf(record, ["exit_code", "exitCode", "code"]);
}

function readRangeOf(call: ToolCallView): string {
  const input = inputRecord(call);
  const start = firstNumberOf(input, ["start_line", "startLine", "offset"]);
  const limit = firstNumberOf(input, ["limit"]);
  const end = firstNumberOf(input, ["end_line", "endLine"]);
  if (start === undefined && end === undefined && limit === undefined) return "";
  const from = start ?? 1;
  const to = end ?? (limit !== undefined ? from + limit - 1 : undefined);
  return to !== undefined ? `L${from}–${to}` : `L${from}+`;
}

function diffStatsOf(call: ToolCallView): { added: number; removed: number } | null {
  const diff = diffOf(call.input);
  if (diff) {
    if ("patch" in diff) {
      let added = 0;
      let removed = 0;
      for (const line of diff.patch.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+")) added += 1;
        else if (line.startsWith("-")) removed += 1;
      }
      return { added, removed };
    }
    const oldLines = diff.oldText ? diff.oldText.split("\n") : [];
    const newLines = diff.newText ? diff.newText.split("\n") : [];
    const oldSet = new Map<string, number>();
    for (const line of oldLines) oldSet.set(line, (oldSet.get(line) ?? 0) + 1);
    let common = 0;
    for (const line of newLines) {
      const count = oldSet.get(line) ?? 0;
      if (count > 0) {
        common += 1;
        oldSet.set(line, count - 1);
      }
    }
    return { added: newLines.length - common, removed: oldLines.length - common };
  }
  const content = writeContentOf(call);
  if (content) return { added: content.split("\n").length, removed: 0 };
  return null;
}

function writeContentOf(call: ToolCallView): string {
  return firstStringOf(inputRecord(call), ["content", "contents", "file_text", "text"]);
}

/** The one-line target beside the verb: a file, a command, a pattern, a query. */
export function toolTargetOf(call: ToolCallView, kind: ToolKind = toolKindOf(call)): string {
  const input = inputRecord(call);
  switch (kind) {
    case "exec":
      return execCommandOf(call);
    case "read":
    case "write":
    case "edit":
    case "delete": {
      const path = pathOf(input);
      return path ? basename(path) : call.detail;
    }
    case "grep":
      return firstStringOf(input, ["pattern", "query", "search_pattern", "text", "regex"]) || call.detail;
    case "glob":
      return firstStringOf(input, ["pattern", "glob_pattern", "file_pattern"]) || call.detail;
    case "ls": {
      const path = firstStringOf(input, ["path", "target_directory", "directory"]);
      return path || ".";
    }
    case "websearch":
      return firstStringOf(input, ["query", "search_term"]) || call.detail;
    case "webfetch":
      return firstStringOf(input, ["url"]) || call.detail;
    case "todo": {
      const todos = todosOf(call.input);
      const done = todos.filter(item => item.state === "done").length;
      return todos.length ? tr("sessions.toolChecklist", { done, total: todos.length }) : "";
    }
    case "task":
      return firstStringOf(input, ["description", "subagent_type", "subagentType", "prompt"]) || call.detail;
    case "question": {
      const questions = input.questions;
      const first = Array.isArray(questions) ? (questions[0] as Record<string, unknown> | undefined) : undefined;
      return (first && firstStringOf(first, ["question", "header"])) || call.detail;
    }
    case "image": {
      const path = firstStringOf(input, ["path", "image_path", "file_path"]);
      return path ? basename(path) : firstStringOf(input, ["prompt", "description"]) || call.detail;
    }
    default:
      return call.detail;
  }
}

/** The localized title: a verb for a known tool, `server · tool` for MCP, the name otherwise. */
export function toolTitleOf(call: ToolCallView, state: ToolRunState, kind: ToolKind = toolKindOf(call)): string {
  if (kind === "mcp") {
    const parsed = parseMcpToolName(call.name);
    return parsed ? `${parsed.server} · ${parsed.tool}` : call.name;
  }
  if (kind === "generic") return call.name;
  const keys = VERB_KEYS[kind];
  return tr(state === "running" || state === "confirmation" ? keys.running : keys.done);
}

function statusTone(state: ToolRunState): "danger" | "accent" | "success" | "warning" | "muted" {
  switch (state) {
    case "failed":
      return "danger";
    case "running":
      return "accent";
    case "confirmation":
      return "warning";
    case "cancelled":
      return "muted";
    default:
      return "success";
  }
}

/**
 * Which tool cards the user expanded, one signal per card id (the card's stable
 * key in the transcript). A toggle wakes only that card, not every card of a
 * long transcript, and a closed card never lays out its body.
 */
const expandedCardSignals = new Map<string, Signal<boolean>>();

function expandedSignal(cardId: string): Signal<boolean> {
  let entry = expandedCardSignals.get(cardId);
  if (!entry) {
    entry = signal(false);
    expandedCardSignals.set(cardId, entry);
  }
  return entry;
}

/** Whether a card is open (reactive for that card only). */
export function isCardExpanded(cardId: string): boolean {
  return expandedSignal(cardId)();
}

/** Forgets every card's open state; called when the transcript is disposed. */
export function resetExpandedCards(): void {
  for (const entry of expandedCardSignals.values()) {
    if (entry()) entry.set(false);
  }
  expandedCardSignals.clear();
}

function toggleCard(cardId: string): void {
  animateLayout();
  const entry = expandedSignal(cardId);
  entry.set(!entry());
}

const copiedToolBlock = signal("");

function SmallCopyButton(props: { copyKey: string; text: string }) {
  const copied = computed(() => copiedToolBlock() === props.copyKey);
  return (
    <View
      role="button"
      accessibilityLabel={`copy-${props.copyKey}`}
      onPress={() => {
        void Clipboard.writeText(props.text).then(() => {
          copiedToolBlock.set(props.copyKey);
          setTimeout(() => {
            if (copiedToolBlock() === props.copyKey) copiedToolBlock.set("");
          }, 1500);
        });
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        cursor: "pointer",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
      activeStyle={tactileActiveStyle(0.96)}
    >
      <Icon name={copied() ? "check" : "copy"} size={12} color={copied() ? palette().success : palette().textMuted} />
      <Text
        style={{
          color: copied() ? palette().success : palette().textMuted,
          fontSize: textSize(11),
          lineHeight: textLineHeight(11, 1.3),
          fontWeight: "500",
        }}
      >
        {copied() ? tr("common.copied") : tr("common.copy")}
      </Text>
    </View>
  );
}

function SectionLabel(props: { label: string; danger?: boolean; children?: JSX.Element }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Text
        style={{
          color: props.danger ? palette().danger : palette().textMuted,
          fontSize: textSize(11),
          lineHeight: textLineHeight(11, 1.3),
          fontWeight: "600",
        }}
      >
        {props.label}
      </Text>
      {props.children}
    </View>
  );
}

/** A bounded monospace block with its own copy button. */
function MonoBlock(props: { copyKey: string; label: string; text: string; danger?: boolean; maxHeight?: number }) {
  return (
    <View style={{ gap: 4 }}>
      <SectionLabel label={props.label} danger={props.danger}>
        <SmallCopyButton copyKey={props.copyKey} text={props.text} />
      </SectionLabel>
      <View
        style={{
          borderRadius: radii.md,
          borderCurve: "continuous",
          borderLeftWidth: props.danger ? 2 : 0,
          borderColor: palette().danger,
          backgroundColor: palette().surfaceTertiary,
          overflow: "hidden",
        }}
      >
        <Scroll
          style={{ maxHeight: Math.min(props.maxHeight ?? 240, 240), minHeight: 0 }}
          scrollbar={true}
          contentStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm }}
        >
          <Text
            style={{
              color: props.danger ? palette().danger : palette().textSecondary,
              fontFamily: fontMono,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 18 / 12),
              userSelect: "text",
            }}
          >
            {props.text}
          </Text>
        </Scroll>
      </View>
    </View>
  );
}

function ResultSection(props: { call: ToolCallView; cardId: string; label?: string }) {
  return (
    <>
      <If when={props.call.error ?? ""}>
        {error => (
          <MonoBlock copyKey={`${props.cardId}-error`} label={tr("chat.tool.error")} text={error()} danger={true} />
        )}
      </If>
      <If when={resultTextOf(props.call)}>
        {text => (
          <MonoBlock copyKey={`${props.cardId}-result`} label={props.label ?? tr("chat.tool.result")} text={text()} />
        )}
      </If>
    </>
  );
}

function ChecklistBody(props: { call: ToolCallView }) {
  const todos = computed(() => todosOf(props.call.input));
  const done = computed(() => todos().filter(item => item.state === "done").length);
  return (
    <View style={{ gap: 7 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            flex: 1,
            height: 4,
            borderRadius: radii.pill,
            backgroundColor: palette().surfaceSubtle,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: 4,
              borderRadius: radii.pill,
              backgroundColor: done() === todos().length ? palette().success : palette().accent,
              width: `${Math.round((done() / Math.max(1, todos().length)) * 100)}%`,
            }}
          />
        </View>
        <Text
          style={{
            flexShrink: 0,
            color: palette().textMuted,
            fontSize: textSize(11),
            lineHeight: textLineHeight(11, 1.25),
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {`${done()}/${todos().length}`}
        </Text>
      </View>
      <Each of={todos()} key="index">
        {item => (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <View style={{ marginTop: 6, flexShrink: 0 }}>
              <StatusDot
                kind={item().state === "done" ? "success" : item().state === "active" ? "accent" : "muted"}
                pulse={item().state === "active"}
                size={6}
              />
            </View>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.45),
                color: item().state === "done" ? palette().textMuted : palette().text,
                textDecorationLine: item().state === "done" ? "line-through" : "none",
              }}
            >
              {item().text}
            </Text>
          </View>
        )}
      </Each>
    </View>
  );
}

/** One review note under a diff line: a field while written, then its text (spec §4.5). */
function ReviewNoteView(props: { note: ReviewNote }) {
  return (
    <View
      testID={`review-note-${props.note.id}`}
      style={{
        marginVertical: space.xs,
        marginHorizontal: space.sm,
        padding: space.sm,
        gap: space.xs,
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().canvas,
      }}
    >
      <If
        when={editingReviewNote() === props.note.id}
        else={
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
            <Text
              role="button"
              accessibilityLabel={`edit-review-note-${props.note.id}`}
              onPress={() => editingReviewNote.set(props.note.id)}
              style={{ flex: 1, minWidth: 0, color: palette().text, fontSize: textSize(13), lineHeight: textLineHeight(13, 18 / 13), cursor: "text" }}
            >
              {props.note.text || tr("reviewNotes.add")}
            </Text>
            <IconButton icon="close" size="xs" accessibilityLabel={`remove-review-note-${props.note.id}`} onPress={() => removeReviewNote(props.note.id)} />
          </View>
        }
      >
        <InputBox
          value={props.note.text}
          placeholder={tr("reviewNotes.add")}
          size="sm"
          autoFocus={true}
          accessibilityLabel={`review-note-input-${props.note.id}`}
          onChange={value => updateReviewNote(props.note.id, value)}
          onSubmit={() => {
            if (!props.note.text.trim()) removeReviewNote(props.note.id);
            else editingReviewNote.set(null);
          }}
        />
      </If>
    </View>
  );
}

function DiffBody(props: { call: ToolCallView; kind: ToolKind }) {
  const filePath = computed(() => pathOf(props.call.input));
  const change = computed(() => {
    if (props.kind === "write") {
      const content = writeContentOf(props.call);
      return content ? { oldText: "", newText: content } : null;
    }
    return diffOf(props.call.input);
  });
  const notes = computed(() =>
    reviewNotesFor(activeSessionKey()).filter(note => note.path === (filePath() ?? "")),
  );
  return (
    <If when={change()}>
      {value => (
        <View
          style={{
            borderRadius: radii.md,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: palette().surfaceTertiary,
          }}
        >
          <View style={{ height: 240 }}>
            <DiffView
              oldValue={"oldText" in value() ? (value() as { oldText: string }).oldText : null}
              newValue={"newText" in value() ? (value() as { newText: string }).newText : null}
              patch={"patch" in value() ? (value() as { patch: string }).patch : null}
              language={inferCodeLanguage(filePath() ?? undefined)}
              layout="unified"
              indicators="bars"
              inline="wordAlt"
              lineNumbers={true}
              fontFamily={fontMono}
              fontSize={textSize(12)}
              lineHeight={textLineHeight(12, 18 / 12)}
              styles={createDiffViewStyles()}
              annotations={notes().map(note => ({ id: note.id, side: note.side, line: note.end }))}
              renderAnnotation={annotation => {
                const note = notes().find(item => item.id === annotation.id);
                return note ? <ReviewNoteView note={note} /> : <View />;
              }}
              renderAddAnnotation={range => (
                <View
                  role="button"
                  accessibilityLabel={tr("reviewNotes.add")}
                  tooltip={tr("reviewNotes.add")}
                  onPress={() => {
                    const key = activeSessionKey();
                    if (!key) return;
                    addReviewNote({
                      sessionKey: key,
                      path: filePath() ?? "",
                      side: range.side === "old" ? "old" : "new",
                      start: range.start,
                      end: range.end,
                    });
                  }}
                  style={{
                    width: 16,
                    height: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radii.xs,
                    backgroundColor: palette().accentSoft,
                    cursor: "pointer",
                  }}
                >
                  <Icon name="message-circle" size={12} color={palette().accent} />
                </View>
              )}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      )}
    </If>
  );
}

/** Rows a search or a listing returned, as the host sent them. */
function listRowsOf(call: ToolCallView): string[] {
  const result = call.result;
  const fromArray = (list: unknown[]): string[] =>
    list
      .map(entry => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          const path = firstStringOf(record, ["path", "file", "file_path", "name"]);
          const line = firstNumberOf(record, ["line", "line_number", "lineNumber"]);
          const preview = firstStringOf(record, ["preview", "content", "text", "match"]);
          return [path, line !== undefined ? String(line) : "", preview].filter(Boolean).join(":");
        }
        return "";
      })
      .filter(Boolean);
  if (Array.isArray(result)) return fromArray(result);
  const record = resultRecord(result);
  if (record) {
    for (const key of ["files", "matches", "entries", "results", "items"]) {
      const list = record[key];
      if (Array.isArray(list)) return fromArray(list);
    }
  }
  const text = resultTextOf(call);
  return text ? text.split("\n").filter(line => line.trim()) : [];
}

function pathOfListRow(row: string): string {
  const trimmed = row.trim().replace(/^[-*]\s+/, "");
  const colon = trimmed.search(/:\d+/);
  return colon > 0 ? trimmed.slice(0, colon) : trimmed;
}

function ListBody(props: { call: ToolCallView; cardId: string; openFiles: boolean }) {
  const rows = computed(() => listRowsOf(props.call));
  const visible = computed(() => rows().slice(0, 60));
  return (
    <View style={{ gap: 4 }}>
      <SectionLabel label={tr("chat.tool.matches", { count: rows().length })}>
        <SmallCopyButton copyKey={`${props.cardId}-list`} text={rows().join("\n")} />
      </SectionLabel>
      <Scroll style={{ maxHeight: 240, minHeight: 0 }} scrollbar={true}>
        <View style={{ gap: 1 }}>
          <Each of={visible()} key="index">
            {row => (
              <View
                role={props.openFiles ? "button" : undefined}
                onPress={() => {
                  if (props.openFiles) openInAuxPane("files", pathOfListRow(row()));
                }}
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: radii.xs,
                  cursor: props.openFiles ? "pointer" : "default",
                }}
                hoverStyle={props.openFiles ? { backgroundColor: palette().surfaceSubtle } : undefined}
              >
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontFamily: fontMono,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.5),
                    numberOfLines: 1,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {row()}
                </Text>
              </View>
            )}
          </Each>
        </View>
      </Scroll>
      <If when={rows().length > visible().length}>
        <Text style={{ color: palette().textMuted, fontSize: textSize(11), lineHeight: textLineHeight(11, 1.3) }}>
          {tr("chat.tool.moreRows", { count: rows().length - visible().length })}
        </Text>
      </If>
    </View>
  );
}

interface WebResultRow {
  title: string;
  url: string;
  snippet: string;
}

function webResultsOf(call: ToolCallView): WebResultRow[] {
  const record = resultRecord(call.result);
  const list = Array.isArray(call.result) ? call.result : Array.isArray(record?.results) ? (record?.results as unknown[]) : [];
  return list
    .map(entry => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const url = firstStringOf(row, ["url", "link", "href"]);
      if (!url) return null;
      return {
        url,
        title: firstStringOf(row, ["title", "name"]) || url,
        snippet: firstStringOf(row, ["snippet", "summary", "content", "description"]),
      };
    })
    .filter((row): row is WebResultRow => row !== null)
    .slice(0, 12);
}

function WebLinkRow(props: { row: WebResultRow }) {
  return (
    <View
      role="button"
      accessibilityLabel={`web-result-${props.row.url}`}
      onPress={() => void openUrl(props.row.url).catch(() => undefined)}
      style={{ gap: 2, paddingHorizontal: 6, paddingVertical: 4, borderRadius: radii.xs, cursor: "pointer" }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
    >
      <Text
        style={{
          color: palette().accent,
          fontSize: textSize(13),
          lineHeight: textLineHeight(13, 1.35),
          fontWeight: "500",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.row.title}
      </Text>
      <Text
        style={{
          color: palette().textMuted,
          fontSize: textSize(11),
          lineHeight: textLineHeight(11, 1.3),
          numberOfLines: 1,
          textOverflow: "ellipsis-middle",
        }}
      >
        {props.row.url}
      </Text>
      <If when={props.row.snippet}>
        <Text
          style={{
            color: palette().textSecondary,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.45),
            numberOfLines: 2,
            textOverflow: "ellipsis",
          }}
        >
          {props.row.snippet}
        </Text>
      </If>
    </View>
  );
}

function subagentSessionOf(call: ToolCallView): string {
  const input = inputRecord(call);
  const fromInput = firstStringOf(input, ["session_id", "sessionId"]);
  if (fromInput) return fromInput;
  const record = resultRecord(call.result);
  return record ? firstStringOf(record, ["session_id", "sessionId", "subagent_session_id", "subagentSessionId"]) : "";
}

/** How many subagent steps a Task card lists before "Show all". */
const SUBAGENT_STEP_PREVIEW = 8;
const subagentStepsOpen = signal<Record<string, boolean>>({});

/** One row per thing the subagent did, in the host's order: its tool calls and its answer text. */
interface SubagentStepRow {
  key: string;
  icon: IconName;
  title: string;
  target: string;
  state: ToolRunState;
}

function subagentStepRows(call: ToolCallView): SubagentStepRow[] {
  const items = call.subagentItems ?? [];
  const rows: SubagentStepRow[] = [];
  items.forEach((item, index) => {
    if (item.kind === "tool") {
      const step = toolCallOf(item.tool);
      const kind = toolKindOf(step);
      const state = persistedToolState(step);
      rows.push({
        key: `tool:${item.tool.id || index}`,
        icon: ICON_BY_KIND[kind],
        title: toolTitleOf(step, state, kind),
        target: toolTargetOf(step, kind),
        state,
      });
    } else if (item.kind === "text" && item.text.trim()) {
      rows.push({
        key: `text:${item.id || index}`,
        icon: "chat",
        title: tr("chat.tool.task.stepReply"),
        target: item.text.replace(/\s+/g, " ").trim(),
        state: "completed",
      });
    }
  });
  return rows;
}

/** The subagent's steps under a Task card, read from the transcript view's nested items. */
function SubagentSteps(props: { call: ToolCallView; cardId: string }) {
  const rows = computed(() => subagentStepRows(props.call));
  const showAll = computed(() => subagentStepsOpen()[props.cardId] === true);
  const visible = computed(() => (showAll() ? rows() : rows().slice(-SUBAGENT_STEP_PREVIEW)));
  const hidden = computed(() => Math.max(0, rows().length - visible().length));
  return (
    <View style={{ gap: 2 }} accessibilityLabel={`subagent-steps-${props.cardId}`}>
      <SectionLabel label={formatPlural(rows().length, "chat.tool.task.stepsOne", "chat.tool.task.stepsOther")} />
      <If when={hidden() > 0}>
        <View
          role="button"
          accessibilityLabel={`subagent-steps-all-${props.cardId}`}
          onPress={() => {
            animateLayout();
            subagentStepsOpen.update(current => ({ ...current, [props.cardId]: true }));
          }}
          style={{ paddingVertical: 3, paddingHorizontal: 6, borderRadius: radii.xs, cursor: "pointer", alignSelf: "flex-start" }}
          hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
        >
          <Text style={{ color: palette().accent, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3) }}>
            {tr("chat.tool.task.showEarlier", { count: hidden() })}
          </Text>
        </View>
      </If>
      <Each of={visible()} key={row => row.key}>
        {row => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24, paddingHorizontal: 6 }}>
            <Icon
              name={row().icon}
              size={14}
              color={
                row().state === "failed"
                  ? palette().danger
                  : row().state === "running"
                    ? palette().accent
                    : palette().textMuted
              }
            />
            <Text
              style={{
                flexShrink: 0,
                maxWidth: "45%",
                color: row().state === "failed" ? palette().danger : palette().textSecondary,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.35),
                fontWeight: "500",
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {row().title}
            </Text>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.35),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {row().target}
            </Text>
          </View>
        )}
      </Each>
    </View>
  );
}

function imageSourceOf(call: ToolCallView): string {
  const scan = (value: unknown, depth: number): string => {
    if (depth > 3) return "";
    if (typeof value === "string") {
      return value.startsWith("data:image/") || /^https?:\/\//.test(value) ? value : "";
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = scan(entry, depth + 1);
        if (found) return found;
      }
      return "";
    }
    if (value && typeof value === "object") {
      for (const key of ["data_url", "dataUrl", "url", "image_url", "imageUrl", "images", "image"]) {
        const found = scan((value as Record<string, unknown>)[key], depth + 1);
        if (found) return found;
      }
    }
    return "";
  };
  return scan(call.result, 0);
}

function argumentsTextOf(call: ToolCallView): string {
  if (call.input === undefined || call.input === null) return call.detail;
  if (typeof call.input === "string") return call.input;
  try {
    return JSON.stringify(call.input, null, 2) ?? "";
  } catch {
    return call.detail;
  }
}

function SmallButton(props: { label: string; icon: IconName; accessibilityLabel: string; onPress: () => void }) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: palette().border,
        cursor: "pointer",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle, borderColor: palette().borderStrong }}
      activeStyle={tactileActiveStyle(0.96)}
    >
      <Icon name={props.icon} size={12} color={palette().accent} />
      <Text style={{ color: palette().accent, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3), fontWeight: "500" }}>
        {props.label}
      </Text>
    </View>
  );
}

function ToolBody(props: { call: ToolCallView; cardId: string; kind: ToolKind }) {
  const kind = props.kind;
  return (
    <View style={{ gap: 10 }}>
      <If when={kind === "todo"}>
        <ChecklistBody call={props.call} />
      </If>
      <If when={kind === "edit" || kind === "write"}>
        <DiffBody call={props.call} kind={kind} />
      </If>
      <If when={kind === "exec" ? execCommandOf(props.call) : ""}>
        {command => (
          <MonoBlock copyKey={`${props.cardId}-command`} label={tr("chat.tool.command")} text={`$ ${command()}`} maxHeight={140} />
        )}
      </If>
      <If when={kind === "grep" || kind === "glob" || kind === "ls"}>
        <ListBody call={props.call} cardId={props.cardId} openFiles={kind !== "ls"} />
      </If>
      <If when={kind === "websearch" && webResultsOf(props.call).length > 0}>
        <View style={{ gap: 2 }}>
          <Each of={webResultsOf(props.call)} key={row => row.url}>
            {row => <WebLinkRow row={row()} />}
          </Each>
        </View>
      </If>
      <If when={kind === "webfetch" ? firstStringOf(inputRecord(props.call), ["url"]) : ""}>
        {url => <WebLinkRow row={{ url: url(), title: url(), snippet: "" }} />}
      </If>
      <If when={kind === "task" ? firstStringOf(inputRecord(props.call), ["prompt"]) : ""}>
        {prompt => (
          <Text
            style={{
              color: palette().textSecondary,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.5),
              numberOfLines: 6,
              textOverflow: "ellipsis",
              userSelect: "text",
            }}
          >
            {prompt()}
          </Text>
        )}
      </If>
      <If when={kind === "task" && (props.call.subagentItems?.length ?? 0) > 0}>
        <SubagentSteps call={props.call} cardId={props.cardId} />
      </If>
      <If when={kind === "task" ? subagentSessionOf(props.call) : ""}>
        {sessionId => (
          <SmallButton
            label={tr("chat.tool.openSession")}
            icon="external-link"
            accessibilityLabel={`open-subagent-${sessionId()}`}
            onPress={() => selectSession(sessionId())}
          />
        )}
      </If>
      <If when={kind === "image" ? imageSourceOf(props.call) : ""}>
        {src => (
          <Image
            src={src()}
            style={{ maxWidth: 360, maxHeight: 280, borderRadius: radii.sm, alignSelf: "flex-start" }}
          />
        )}
      </If>
      <If when={kind === "mcp" || kind === "generic" || kind === "question" ? argumentsTextOf(props.call) : ""}>
        {args => (
          <MonoBlock copyKey={`${props.cardId}-args`} label={tr("chat.tool.arguments")} text={args()} maxHeight={160} />
        )}
      </If>
      {/* wave22-p5: an MCP tool with an interactive UI opens it in a panel. */}
      <If when={kind === "mcp"}>
        <McpAppLauncher call={props.call} cardId={props.cardId} />
      </If>
      <If when={kind !== "grep" && kind !== "glob" && kind !== "ls" && !(kind === "websearch" && webResultsOf(props.call).length > 0)}>
        <ResultSection
          call={props.call}
          cardId={props.cardId}
          label={kind === "exec" ? tr("chat.tool.output") : undefined}
        />
      </If>
      <If when={(kind === "grep" || kind === "glob" || kind === "ls") && Boolean(props.call.error)}>
        <MonoBlock copyKey={`${props.cardId}-error`} label={tr("chat.tool.error")} text={props.call.error ?? ""} danger={true} />
      </If>
    </View>
  );
}

function hasBody(call: ToolCallView, kind: ToolKind): boolean {
  if (call.error || resultTextOf(call)) return true;
  if (kind === "todo") return todosOf(call.input).length > 0;
  if (kind === "edit") return diffOf(call.input) !== null;
  if (kind === "write") return Boolean(writeContentOf(call));
  if (kind === "exec") return Boolean(execCommandOf(call));
  if (kind === "task") {
    return Boolean(firstStringOf(inputRecord(call), ["prompt"]) || subagentSessionOf(call) || call.subagentItems?.length);
  }
  if (kind === "mcp" || kind === "generic" || kind === "question") return Boolean(argumentsTextOf(call));
  return false;
}

function stateLabel(state: ToolRunState, call: ToolCallView): string {
  switch (state) {
    case "failed":
      return tr("chat.tool.failed");
    case "cancelled":
      return call.status === "rejected" ? tr("chat.tool.rejected") : tr("chat.tool.cancelled");
    case "confirmation":
      return tr("chat.tool.awaitingApproval");
    default:
      return "";
  }
}

/**
 * One tool call. The summary row is always drawn; the body only once opened, so
 * a long transcript does not build hundreds of diff views it never shows.
 */
export function ToolCard(props: { call: ToolCallView; cardId: string; status?: ToolRunState }) {
  const kind = computed(() => toolKindOf(props.call));
  const state = computed<ToolRunState>(() => props.status ?? "completed");
  const expandable = computed(() => hasBody(props.call, kind()));
  const expanded = computed(() => isCardExpanded(props.cardId));
  const filePath = computed(() =>
    kind() === "read" || kind() === "write" || kind() === "edit" || kind() === "delete" || kind() === "image"
      ? pathOf(inputRecord(props.call))
      : null,
  );
  const stats = computed(() => (kind() === "edit" || kind() === "write" ? diffStatsOf(props.call) : null));
  const exitCode = computed(() => (kind() === "exec" ? exitCodeOf(props.call) : undefined));
  const muted = computed(() => state() === "cancelled");
  /** The row's one status mark: its state, else a failed exit code. */
  const statusText = computed(() => {
    const label = stateLabel(state(), props.call);
    if (label) return label;
    const code = exitCode();
    return code !== undefined && code !== 0 && state() !== "running" ? tr("chat.tool.exitCode", { code }) : "";
  });
  const statusColor = computed(() =>
    state() === "failed" || (exitCode() ?? 0) !== 0
      ? palette().danger
      : state() === "confirmation"
        ? palette().warning
        : palette().textMuted,
  );
  /** Duration and exit code stay one hover away instead of on every row. */
  const hoverHint = computed(() => {
    const parts: string[] = [];
    const duration = state() === "completed" ? formatDuration(props.call.durationMs) : "";
    if (duration) parts.push(duration);
    const code = exitCode();
    if (code !== undefined && state() !== "running") parts.push(tr("chat.tool.exitCode", { code }));
    return parts.join(" · ");
  });
  const titleColor = computed(() =>
    state() === "failed" ? palette().danger : muted() ? palette().textMuted : palette().text,
  );

  // Visual spec §3 Tool: every call is one quiet 28 row; nothing is boxed.
  const rowStyle = (): ViewStyle => ({
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 28,
    paddingHorizontal: space.chip,
    paddingVertical: 0,
    borderRadius: radii.md,
    borderCurve: "continuous",
    cursor: expandable() ? "pointer" : "default",
    ...paintTransition(MOTION_DURATION.fast),
  });

  return (
    <View style={{ borderRadius: radii.md, borderCurve: "continuous" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View
          role={expandable() ? "button" : undefined}
          accessibilityLabel={`tool-card-${props.call.name}`}
          tooltip={hoverHint() || undefined}
          onPress={() => {
            if (expandable()) toggleCard(props.cardId);
          }}
          style={{ flex: 1, minWidth: 0, ...rowStyle() }}
          hoverStyle={expandable() ? { backgroundColor: palette().surfaceSubtle } : undefined}
        >
          <If
            when={state() === "running"}
            else={
              <Icon name={ICON_BY_KIND[kind()]} size={14} color={palette().textMuted} />
            }
          >
            <BrandSpinner size={12} color={palette().accent} variant="matrix" />
          </If>
          <Text
            style={{
              flexShrink: 0,
              maxWidth: "50%",
              color: titleColor(),
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 18 / 13),
              fontWeight: "500",
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {toolTitleOf(props.call, state(), kind())}
          </Text>
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 16 / 12),
              fontFamily: fontMono,
              textDecorationLine: muted() ? "line-through" : "none",
              numberOfLines: 1,
              textOverflow: filePath() ? "ellipsis-middle" : "ellipsis",
            }}
          >
            {toolTargetOf(props.call, kind())}
          </Text>
          <If when={kind() === "read" ? readRangeOf(props.call) : ""}>
            {range => (
              <Text
                style={{
                  flexShrink: 0,
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 16 / 12),
                  fontVariant: ["tabular-nums"],
                }}
              >
                {range()}
              </Text>
            )}
          </If>
          <If when={stats()}>
            {value => (
              <Text
                style={{
                  flexShrink: 0,
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 16 / 12),
                  fontFamily: fontMono,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {`+${value().added} −${value().removed}`}
              </Text>
            )}
          </If>
          <If when={statusText()}>
            {text => (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
                <If when={statusColor() === palette().danger}>
                  <Icon name="close" size={12} color={palette().danger} />
                </If>
                <Text
                  style={{
                    color: statusColor(),
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 16 / 12),
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {text()}
                </Text>
              </View>
            )}
          </If>
          <If when={!statusText() && state() === "completed" ? formatDuration(props.call.durationMs) : ""}>
            {duration => (
              <Text
                style={{
                  flexShrink: 0,
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 16 / 12),
                  fontVariant: ["tabular-nums"],
                }}
              >
                {duration()}
              </Text>
            )}
          </If>
          <If when={expandable()}>
            <Icon name={expanded() ? "chevron-down" : "chevron-right"} size={12} color={palette().textMuted} />
          </If>
        </View>
        <If when={filePath() ?? ""}>
          {pathValue => (
            <View
              role="button"
              accessibilityLabel={`open-tool-file-${props.call.name}`}
              tooltip={tr("sessions.openInFiles")}
              onPress={() => openInAuxPane("files", pathValue())}
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexShrink: 0,
                gap: 4,
                marginRight: 0,
                paddingHorizontal: 6,
                paddingVertical: 3,
                borderRadius: radii.xs,
                borderCurve: "continuous",
                cursor: "pointer",
                ...pressTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
              activeStyle={tactileActiveStyle(0.96)}
            >
              <Icon name="external-link" size={14} color={palette().textMuted} />
            </View>
          )}
        </If>
      </View>
      <If when={expanded()}>
        <View style={{ paddingLeft: space.xxl, paddingRight: space.chip, paddingTop: space.xs, paddingBottom: space.sm }}>
          <ToolBody call={props.call} cardId={props.cardId} kind={kind()} />
        </View>
      </If>
    </View>
  );
}

/**
 * Consecutive reads, searches and listings folded into one row ("Explored 3
 * files, 2 searches"); opening it shows each call as its own row.
 */
export function ExploreGroupCard(props: {
  calls: ToolCallView[];
  cardId: string;
  stateOf: (call: ToolCallView) => ToolRunState;
}) {
  const expanded = computed(() => isCardExpanded(props.cardId));
  const running = computed(() => props.calls.some(call => props.stateOf(call) === "running"));
  const summary = computed(() => {
    const counts = exploreCounts(props.calls);
    const parts: string[] = [];
    if (counts.reads) parts.push(formatPlural(counts.reads, "chat.tool.fileOne", "chat.tool.fileOther"));
    if (counts.searches) parts.push(formatPlural(counts.searches, "chat.tool.searchOne", "chat.tool.searchOther"));
    return parts.join(", ");
  });
  return (
    <View style={{ gap: 2 }}>
      <View
        role="button"
        accessibilityLabel={`explore-group-${props.cardId}`}
        onPress={() => toggleCard(props.cardId)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 28,
          paddingHorizontal: 6,
          paddingVertical: 3,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
      >
        <If when={running()} else={<Icon name="compass" size={16} color={palette().textSecondary} />}>
          <BrandSpinner size={14} color={palette().accent} variant="bars" />
        </If>
        <Text
          style={{
            flexShrink: 0,
            color: palette().text,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.35),
            fontWeight: "500",
          }}
        >
          {running() ? tr("chat.tool.exploring") : tr("chat.tool.explored")}
        </Text>
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            color: palette().textMuted,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.35),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {summary()}
        </Text>
        <Icon name={expanded() ? "chevron-down" : "chevron-right"} size={14} color={palette().textMuted} />
      </View>
      <If when={expanded()}>
        <View style={{ paddingLeft: 14, gap: 2 }}>
          <Each of={props.calls} key={(call: ToolCallView) => call.id ?? `${call.name}-${call.detail}`}>
            {call => (
              <ToolCard
                call={call()}
                status={props.stateOf(call())}
                cardId={`${props.cardId}|${call().id ?? `${call().name}-${call().detail}`}`}
              />
            )}
          </Each>
        </View>
      </If>
    </View>
  );
}

/** Run state of a persisted call, from its own status and result. */
export function persistedToolState(call: ToolCallView): ToolRunState {
  const status = (call.status ?? "").toLowerCase();
  if (status === "cancelled" || status === "rejected" || status === "interrupted") return "cancelled";
  if (call.success === false || Boolean(call.error) || status === "failed" || status === "error") return "failed";
  if (status === "confirmation" || status === "awaiting_confirmation") return "confirmation";
  if (
    status === "running" ||
    status === "in_progress" ||
    status === "inprogress" ||
    status === "pending" ||
    status === "streaming" ||
    status === "queued" ||
    status === "waiting"
  ) {
    return "running";
  }
  return "completed";
}

export { statusTone };
