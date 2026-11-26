// Standalone native NSH windows for Spaces (MiniApps).
//
// Replaces the retired Tauri `openbitfun-miniapp-shell` sidecar: each
// standalone Space window is a real OS window opened via `nsh/desktop`'s
// `Window.open(...)`, installed once by the native desktop shell
// (`nshDesktopShell.ts`) so windows outlive main-window scene switches and
// never exist on a phone or in a browser.
//
// Each window drives a `SpaceFrameSession` in `"window"` mode over
// `miniapp_inline`, providing full local desktop adapters (native OS file
// open/save dialogs with host path grants, in-window message dialogs,
// clipboard read/write, external URLs, reveal in folder, OS notifications,
// permission approvals, custom titlebar actions, transfer back to main window,
// and an optional collapsible chat drawer).

import {
  cleanup,
  Clipboard,
  effect,
  openUrl,
  platform,
  Scroll,
  signal,
  Text,
  View,
  WebView,
  type JSX,
  type WebViewRef,
} from "nsh";
import { isAvailable, Window, type WindowOptions, type WindowRef } from "nsh/desktop";
import { invokeCommand } from "./bridge";
import { localizeHostError, tr } from "./i18n";
import { resolvedScheme, palette, radii, space, textStyle } from "./theme";
import {
  SPACE_FRAME_SHIM,
  SpaceFrameSession,
  spaceDeliverScript,
  type SpaceChromeAction,
  type SpacePermissionRequest,
} from "./spaceFrame";
import { openSpacePage } from "./spaceViewStore";
import { openLibrary } from "./state";
import { spacesView } from "./miniAppMarketStore";
import { Icon, type IconName } from "./ui/icons";
import { Spinner } from "./ui/motion";
import { ModalDialog } from "./ui/overlays";
import { Button, IconButton, TextField } from "./ui/primitives";
import type { FileDialogOptions } from "./windowShell";

// ── Window driver (injectable for headless tests) ───────────────────────────

export interface MiniAppWindowHandle {
  focus(): void;
  show(): void;
  close(): void;
  minimize(): void;
  toggleMaximize(): void;
  toggleFullscreen(): void;
  setTitle(title: string): void;
  titleBarLeft(): number;
  titleBarRight(): number;
  isMaximized(): boolean;
}

export interface MiniAppWindowEvents {
  onClosePress?: () => void;
  onClose?: () => void;
}

export interface MiniAppWindowDriver {
  open(render: () => JSX.Element, options: WindowOptions, events: MiniAppWindowEvents): MiniAppWindowHandle;
}

const nshMiniAppWindowDriver: MiniAppWindowDriver = {
  open(render, options, events) {
    const ref: WindowRef = Window.open(render, options);
    if (events.onClosePress) ref.on("closePress", () => events.onClosePress?.());
    if (events.onClose) ref.on("close", () => events.onClose?.());
    return {
      focus: () => {
        ref.show();
        ref.focus();
      },
      show: () => ref.show(),
      close: () => ref.close(),
      minimize: () => ref.minimize(),
      toggleMaximize: () => {
        const mode = ref.state()?.mode;
        ref.setMode(mode === "maximized" || mode === "fullScreen" ? "normal" : "maximized");
      },
      toggleFullscreen: () => {
        const mode = ref.state()?.mode;
        ref.setMode(mode === "fullScreen" ? "normal" : "fullScreen");
      },
      setTitle: title => ref.set({ title }),
      titleBarLeft: () => ref.titleBar().left,
      titleBarRight: () => ref.titleBar().right,
      isMaximized: () => {
        const mode = ref.state()?.mode;
        return mode === "maximized" || mode === "fullScreen";
      },
    };
  },
};

let windowDriver: MiniAppWindowDriver = nshMiniAppWindowDriver;

/** Replaces the window driver (headless tests). Returns the previous driver. */
export function installMiniAppWindowDriver(next: MiniAppWindowDriver | null): MiniAppWindowDriver {
  const previous = windowDriver;
  windowDriver = next ?? nshMiniAppWindowDriver;
  return previous;
}

// ── Types & State ───────────────────────────────────────────────────────────

export const MINIAPP_WINDOW_PREFIX = "miniapp-window-";

export interface MiniAppWindowsHostDeps {
  showMain(): void;
  pickFileDialog?: (options: FileDialogOptions) => Promise<string | string[] | null>;
  showNotification?: (title: string, body: string) => Promise<void>;
}

interface OpenWindowRequest {
  appId: string;
  workspacePath: string | null;
  name: string;
  launchId?: string;
}

interface ChatTurnView {
  id: string;
  user: string;
  reply: string;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
}

interface ChatDrawerState {
  claimed: boolean;
  open: boolean;
  title: string;
  placeholder: string;
  welcomeTitle: string;
  welcomeSubtitle: string;
  suggestions: string[];
  sessionId: string | null;
  activeTurnId: string | null;
  activeRequestId: string | null;
  draft: string;
  turns: ChatTurnView[];
}

interface MessageDialogState {
  title: string;
  message: string;
  resolve: (answer: boolean) => void;
}

interface OpenMiniAppWindow {
  key: string;
  windowId: string;
  appId: string;
  workspacePath: string | null;
  handle: MiniAppWindowHandle;
  closeRequested: () => void;
}

let hostDeps: MiniAppWindowsHostDeps | null = null;
let windowsRunning = false;
let stopController: (() => void) | null = null;
const openWindows = new Map<string, OpenMiniAppWindow>();

function windowKey(appId: string, workspacePath: string | null): string {
  return `${appId}::${workspacePath ?? ""}`;
}

function windowIdFor(appId: string, launchId?: string): string {
  const raw = (launchId || appId).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
  return `${MINIAPP_WINDOW_PREFIX}${raw}`;
}

function initialChatState(): ChatDrawerState {
  return {
    claimed: false,
    open: false,
    title: "",
    placeholder: "",
    welcomeTitle: "",
    welcomeSubtitle: "",
    suggestions: [],
    sessionId: null,
    activeTurnId: null,
    activeRequestId: null,
    draft: "",
    turns: [],
  };
}

function parseSnapshotTurns(raw: unknown): ChatTurnView[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { turns?: unknown }).turns;
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map(item => {
      const rounds = Array.isArray(item.rounds) ? item.rounds : [];
      const reply = rounds
        .map(round => (round && typeof round === "object" ? String((round as { text?: unknown }).text ?? "") : ""))
        .filter(Boolean)
        .join("\n\n");
      const rawStatus = String(item.status ?? "completed");
      const status: ChatTurnView["status"] =
        rawStatus === "running" || rawStatus === "failed" || rawStatus === "cancelled" ? rawStatus : "completed";
      return {
        id: String(item.id ?? ""),
        user: String(item.user ?? ""),
        reply,
        status,
        error: typeof item.error === "string" && item.error ? item.error : undefined,
      };
    });
}

function mapActionIcon(name?: string): IconName {
  if (!name) return "sparkles";
  const normalized = name.trim().toLowerCase();
  const known: Record<string, IconName> = {
    refresh: "refresh",
    "refresh-cw": "refresh",
    "rotate-cw": "refresh",
    plus: "plus",
    settings: "settings",
    download: "download",
    upload: "upload",
    copy: "copy",
    search: "search",
    edit: "edit",
    play: "play",
    stop: "stop",
    folder: "folder",
    file: "file",
    info: "info",
    sparkles: "sparkles",
    chat: "chat",
    "message-circle": "message-circle",
    "external-link": "external-link",
  };
  return known[normalized] ?? "sparkles";
}

// ── Window Component ────────────────────────────────────────────────────────

function MiniAppWindowView(props: {
  request: OpenWindowRequest;
  windowId: string;
  deps: MiniAppWindowsHostDeps;
  getHandle: () => MiniAppWindowHandle | null;
  onFinished: () => void;
  registerClose: (fn: () => void) => void;
}) {
  const os = platform.os;
  let webViewRef: WebViewRef | null = null;
  const pendingScripts: string[] = [];
  const permissions = signal<SpacePermissionRequest[]>([]);
  const messageDialog = signal<MessageDialogState | null>(null);
  const chatState = signal<ChatDrawerState>(initialChatState());
  const transferring = signal(false);
  let closed = false;
  let nextChatReq = 0;

  function deliver(message: unknown): void {
    const script = spaceDeliverScript(message);
    if (webViewRef) webViewRef.injectJavaScript(script);
    else if (pendingScripts.length < 64) pendingScripts.push(script);
  }

  function applyAgentEvent(payload: Record<string, unknown>): void {
    const state = chatState();
    const eventSessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
    if (!state.sessionId || (eventSessionId && eventSessionId !== state.sessionId)) return;
    const sourceEvent = typeof payload.sourceEvent === "string" ? payload.sourceEvent : "";
    const turnId = typeof payload.turnId === "string" ? payload.turnId : state.activeTurnId ?? "";
    if (sourceEvent === "dialog-turn-started") {
      const user = String(payload.originalUserInput ?? payload.userInput ?? "");
      const exists = state.turns.some(turn => turn.id === turnId);
      const turns = exists
        ? state.turns
        : [...state.turns, { id: turnId || `turn-${Date.now()}`, user, reply: "", status: "running" as const }];
      chatState.set({ ...state, activeTurnId: turnId || state.activeTurnId, turns });
      return;
    }
    if (sourceEvent === "text-chunk") {
      const chunk = typeof payload.text === "string" ? payload.text : "";
      if (!chunk) return;
      const targetId = turnId || state.turns[state.turns.length - 1]?.id;
      if (!targetId) return;
      const turns = state.turns.map(turn =>
        turn.id === targetId ? { ...turn, reply: `${turn.reply}${chunk}`, status: "running" as const } : turn,
      );
      chatState.set({ ...state, turns });
      return;
    }
    if (sourceEvent === "dialog-turn-completed" || sourceEvent === "dialog-turn-failed" || sourceEvent === "dialog-turn-cancelled") {
      const nextStatus: ChatTurnView["status"] =
        sourceEvent === "dialog-turn-completed"
          ? "completed"
          : sourceEvent === "dialog-turn-cancelled"
            ? "cancelled"
            : "failed";
      const err = typeof payload.error === "string" ? payload.error : undefined;
      const turns = state.turns.map(turn =>
        turn.id === turnId || (!turnId && turn.status === "running")
          ? { ...turn, status: nextStatus, error: err ?? turn.error }
          : turn,
      );
      chatState.set({ ...state, activeTurnId: null, activeRequestId: null, turns });
    }
  }

  const session = new SpaceFrameSession(props.request.appId, props.request.workspacePath, {
    kind: "window",
    invoke: (method, params) => invokeCommand<unknown>("miniapp_inline", { method, params }),
    deliver,
    openUrl: url => void openUrl(url).catch(() => undefined),
    writeClipboard: text => void Clipboard.writeText(text).catch(() => undefined),
    readClipboard: () => Clipboard.readText(),
    showNotification: props.deps.showNotification,
    pickFileDialog: props.deps.pickFileDialog,
    showMessageDialog: options =>
      new Promise<boolean>(resolve => {
        const previous = messageDialog();
        previous?.resolve(false);
        messageDialog.set({ ...options, resolve });
      }),
    chat: {
      claim(params) {
        const composer = params.composer && typeof params.composer === "object" ? (params.composer as Record<string, unknown>) : {};
        const welcome = params.welcome && typeof params.welcome === "object" ? (params.welcome as Record<string, unknown>) : {};
        const suggestions = Array.isArray(welcome.suggestions)
          ? welcome.suggestions.filter((s): s is string => typeof s === "string" && Boolean(s.trim())).slice(0, 6)
          : [];
        chatState.update(prev => ({
          ...prev,
          claimed: true,
          title: typeof params.title === "string" && params.title.trim() ? params.title.trim() : prev.title,
          placeholder: typeof composer.placeholder === "string" ? composer.placeholder : prev.placeholder,
          welcomeTitle: typeof welcome.title === "string" ? welcome.title : prev.welcomeTitle,
          welcomeSubtitle: typeof welcome.description === "string" ? welcome.description : prev.welcomeSubtitle,
          suggestions,
        }));
      },
      async focusSession(sessionId) {
        chatState.update(prev => ({ ...prev, sessionId, open: true }));
        if (!sessionId) return;
        const snapshot = await session.loadChatSnapshot(sessionId).catch(() => null);
        if (snapshot) {
          chatState.update(prev => (prev.sessionId === sessionId ? { ...prev, turns: parseSnapshotTurns(snapshot) } : prev));
        }
      },
      release() {
        chatState.set(initialChatState());
      },
      clearSession() {
        chatState.update(prev => ({ ...prev, sessionId: null, activeTurnId: null, activeRequestId: null, turns: [] }));
      },
      setDraft(text) {
        chatState.update(prev => ({ ...prev, draft: text }));
      },
      complete(params) {
        const ok = params.ok !== false;
        const err = typeof params.error === "string" ? params.error : undefined;
        chatState.update(prev => ({
          ...prev,
          activeRequestId: null,
          activeTurnId: ok ? prev.activeTurnId : null,
          turns: prev.turns.map((turn, idx) =>
            idx === prev.turns.length - 1 && turn.status === "running"
              ? { ...turn, status: ok ? "completed" : "failed", error: err ?? turn.error }
              : turn,
          ),
        }));
        return null;
      },
      acceptedRun(result, requestId) {
        const rec = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
        const turnId = typeof rec.turnId === "string" ? rec.turnId : typeof rec.turn_id === "string" ? rec.turn_id : null;
        const sessionId = typeof rec.sessionId === "string" ? rec.sessionId : typeof rec.session_id === "string" ? rec.session_id : null;
        chatState.update(prev => ({
          ...prev,
          sessionId: sessionId ?? prev.sessionId,
          activeTurnId: turnId ?? prev.activeTurnId,
          activeRequestId: requestId ?? prev.activeRequestId,
        }));
      },
      getRequestId() {
        return chatState().activeRequestId;
      },
    },
    onFocus: () => props.getHandle()?.focus(),
    onAgentEvent: applyAgentEvent,
    onPermissions: requests => permissions.set(requests),
  });

  function closeNow(): void {
    if (closed) return;
    closed = true;
    const pendingDialog = messageDialog();
    if (pendingDialog) {
      messageDialog.set(null);
      pendingDialog.resolve(false);
    }
    void session.close().finally(() => {
      props.onFinished();
      props.getHandle()?.close();
    });
  }

  props.registerClose(closeNow);

  async function moveToMainWindow(): Promise<void> {
    if (transferring()) return;
    transferring.set(true);
    try {
      await session.transferToTab().catch(() => undefined);
      const name = session.bootstrap()?.name || props.request.name;
      props.deps.showMain();
      openLibrary("spaces");
      spacesView.set("library");
      openSpacePage({ appId: props.request.appId, name });
      closeNow();
    } catch {
      transferring.set(false);
    }
  }

  function submitChat(): void {
    const state = chatState();
    const text = state.draft.trim();
    if (!text) return;
    const requestId = `chat-${++nextChatReq}-${Date.now()}`;
    chatState.set({
      ...state,
      draft: "",
      activeRequestId: requestId,
      turns: [...state.turns, { id: requestId, user: text, reply: "", status: "running" }],
    });
    session.sendEvent("chat:userMessage", { text, requestId });
  }

  function stopChat(): void {
    const state = chatState();
    if (!state.sessionId) return;
    void session.cancelAgentRun({
      sessionId: state.sessionId,
      ...(state.activeTurnId ? { turnId: state.activeTurnId } : {}),
    });
  }

  effect(() => {
    const boot = session.bootstrap();
    if (!boot) return;
    const title = boot.chrome?.titlebar?.title || boot.name || props.request.name;
    props.getHandle()?.setTitle(title);
  });

  effect(() => {
    const status = session.status();
    if ((status === "released" || status === "replaced") && !closed) {
      closed = true;
      props.onFinished();
      props.getHandle()?.close();
    }
  });

  void session.open(resolvedScheme());

  cleanup(() => {
    if (!closed) {
      closed = true;
      void session.close();
      props.onFinished();
    }
  });

  const displayTitle = () => session.bootstrap()?.chrome?.titlebar?.title || session.bootstrap()?.name || props.request.name;
  const chromeActions = (): SpaceChromeAction[] => session.bootstrap()?.chrome?.titlebar?.actions ?? [];
  const showCustomWindowButtons = () => os !== "macos" && (props.getHandle()?.titleBarRight() ?? 0) === 0;
  const leftInset = () => (os === "macos" ? Math.max(76, props.getHandle()?.titleBarLeft() ?? 76) : space.md);

  return (
    <View
      accessibilityLabel={`miniapp-window-root-${props.request.appId}`}
      style={{
        flex: 1,
        backgroundColor: palette().canvas,
        minHeight: 0,
      }}
    >
      {/* Native titlebar */}
      <View
        accessibilityLabel="miniapp-window-titlebar"
        desktop={{ windowDrag: true }}
        style={{
          height: 40,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingLeft: leftInset(),
          paddingRight: space.sm,
          backgroundColor: palette().canvasSubtle,
          borderBottomWidth: 1,
          borderBottomColor: palette().borderSubtle,
        }}
      >
        <Icon name="layout-grid" size={14} color={palette().textSecondary} />
        <Text
          accessibilityLabel="miniapp-window-title"
          style={{
            ...textStyle("label", { color: palette().text }),
            fontWeight: "600",
            flexShrink: 1,
            minWidth: 0,
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {displayTitle()}
        </Text>
        <View style={{ flex: 1 }} />
        <Each of={chromeActions()} key={action => action.id}>
          {action => (
            <IconButton
              icon={mapActionIcon(action().icon)}
              size="sm"
              tooltip={action().tooltip || action().label}
              accessibilityLabel={`miniapp-chrome-action-${action().id}`}
              onPress={() => session.sendEvent("chrome:action", { actionId: action().id })}
            />
          )}
        </Each>
        <If when={chatState().claimed}>
          <IconButton
            icon="message-circle"
            size="sm"
            tooltip={tr("spaces.window.toggleChat")}
            accessibilityLabel="miniapp-window-toggle-chat"
            onPress={() => chatState.update(prev => ({ ...prev, open: !prev.open }))}
          />
        </If>
        <IconButton
          icon="arrow-up-right"
          size="sm"
          tooltip={tr("spaces.window.openInMain")}
          accessibilityLabel="miniapp-window-open-in-main"
          disabled={transferring()}
          onPress={() => void moveToMainWindow()}
        />
        <If when={showCustomWindowButtons()}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.hair }}>
            <IconButton
              icon="minus"
              size="sm"
              tooltip={tr("shell.window.minimize")}
              accessibilityLabel="miniapp-window-minimize"
              onPress={() => props.getHandle()?.minimize()}
            />
            <IconButton
              icon="maximize"
              size="sm"
              tooltip={tr("shell.menu.zoom")}
              accessibilityLabel="miniapp-window-maximize"
              onPress={() => props.getHandle()?.toggleMaximize()}
            />
            <IconButton
              icon="close"
              size="sm"
              tooltip={tr("spaces.p4.close")}
              accessibilityLabel="miniapp-window-close"
              onPress={closeNow}
            />
          </View>
        </If>
      </View>

      {/* Main body: WebView + optional collapsible Chat drawer */}
      <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
        <View style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <If when={session.bootstrap()}>
            {boot => (
              <WebView
                ref={node => {
                  webViewRef = node;
                  if (node) {
                    for (const script of pendingScripts.splice(0)) node.injectJavaScript(script);
                  }
                }}
                accessibilityLabel={`miniapp-window-webview-${props.request.appId}`}
                html={boot().html}
                incognito
                injectedJavaScriptBeforeContentLoaded={SPACE_FRAME_SHIM}
                onMessage={event => void session.receive(event.data)}
                onLoad={() => void session.pageLoaded()}
                onError={event => {
                  session.status.set("failed");
                  session.error.set(event.message || "error");
                }}
                style={{ flex: 1, minHeight: 0, alignSelf: "stretch" }}
              />
            )}
          </If>

          <If when={session.status() === "opening" || session.status() === "failed"}>
            <View
              accessibilityLabel={`miniapp-window-state-${session.status()}`}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
                gap: space.md,
                padding: space.xxl,
                backgroundColor: palette().canvas,
              }}
            >
              <If when={session.status() === "opening"}>
                <Spinner size={16} />
              </If>
              <Text style={{ ...textStyle("body", { color: palette().textSecondary }), textAlign: "center", maxWidth: 380 }}>
                {session.status() === "opening"
                  ? tr("spaces.p4.opening", { space: displayTitle() })
                  : tr("spaces.p4.failed", { error: localizeHostError(session.error()) })}
              </Text>
              <If when={session.status() === "failed"}>
                <Button
                  label={tr("spaces.p4.tryAgain")}
                  variant="secondary"
                  size="md"
                  accessibilityLabel="miniapp-window-retry"
                  onPress={() => void session.open(resolvedScheme())}
                />
              </If>
            </View>
          </If>
        </View>

        {/* Collapsible native chat drawer (shown when MiniApp claims composer) */}
        <If when={chatState().claimed && chatState().open}>
          <View
            accessibilityLabel="miniapp-window-chat-drawer"
            style={{
              width: 320,
              minHeight: 0,
              borderLeftWidth: 1,
              borderLeftColor: palette().borderSubtle,
              backgroundColor: palette().canvasSubtle,
              padding: space.md,
              gap: space.sm,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text style={{ ...textStyle("label", { color: palette().text }), fontWeight: "600", flex: 1 }}>
                {chatState().title || displayTitle()}
              </Text>
              <IconButton
                icon="close"
                size="sm"
                tooltip={tr("spaces.p4.close")}
                accessibilityLabel="miniapp-window-chat-close"
                onPress={() => chatState.update(prev => ({ ...prev, open: false }))}
              />
            </View>
            <Scroll style={{ flex: 1, minHeight: 0 }}>
              <View style={{ gap: space.sm }}>
                <If when={chatState().turns.length === 0}>
                  <View style={{ gap: space.xs, paddingVertical: space.md }}>
                    <Text style={{ ...textStyle("body", { color: palette().text }), fontWeight: "500" }}>
                      {chatState().welcomeTitle || displayTitle()}
                    </Text>
                    <If when={chatState().welcomeSubtitle}>
                      <Text style={textStyle("caption", { color: palette().textSecondary })}>
                        {chatState().welcomeSubtitle}
                      </Text>
                    </If>
                  </View>
                </If>
                <Each of={chatState().turns} key={turn => turn.id}>
                  {turn => (
                    <View
                      style={{
                        gap: space.xs,
                        padding: space.sm,
                        borderRadius: radii.md,
                        backgroundColor: palette().surfaceTertiary,
                      }}
                    >
                      <Text style={{ ...textStyle("caption", { color: palette().text }), fontWeight: "600" }}>
                        {turn().user}
                      </Text>
                      <If when={turn().reply}>
                        <Text style={textStyle("body", { color: palette().textSecondary })}>{turn().reply}</Text>
                      </If>
                      <If when={turn().error}>
                        <Text style={textStyle("caption", { color: palette().danger })}>{turn().error}</Text>
                      </If>
                    </View>
                  )}
                </Each>
              </View>
            </Scroll>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
              <TextField
                accessibilityLabel="miniapp-window-chat-input"
                value={chatState().draft}
                placeholder={chatState().placeholder || tr("spaces.window.chatPlaceholder")}
                size="sm"
                onChange={value => chatState.update(prev => ({ ...prev, draft: value }))}
                onSubmit={() => submitChat()}
                style={{ flex: 1, minWidth: 0 }}
              />
              <If
                when={chatState().activeTurnId || chatState().activeRequestId}
                else={
                  <IconButton
                    icon="arrow-up"
                    size="sm"
                    tooltip={tr("spaces.window.send")}
                    accessibilityLabel="miniapp-window-chat-send"
                    onPress={submitChat}
                  />
                }
              >
                <IconButton
                  icon="stop"
                  size="sm"
                  tooltip={tr("spaces.window.stop")}
                  accessibilityLabel="miniapp-window-chat-stop"
                  onPress={stopChat}
                />
              </If>
            </View>
          </View>
        </If>
      </View>

      {/* Permission approval bar */}
      <If when={permissions().length > 0}>
        <View
          accessibilityLabel="miniapp-window-permissions"
          style={{
            padding: space.md,
            gap: space.sm,
            borderTopWidth: 1,
            borderTopColor: palette().borderSubtle,
            backgroundColor: palette().canvasSubtle,
          }}
        >
          <Each of={permissions()} key={req => req.requestId}>
            {req => (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                  <Text style={{ ...textStyle("label", { color: palette().text }), fontWeight: "600" }}>
                    {tr("spaces.window.permissionTitle")}
                  </Text>
                  <Text style={textStyle("caption", { color: palette().textSecondary })}>
                    {[req().action, req().projectPath, ...(req().resources ?? [])].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <Button
                  label={tr("spaces.window.allowOnce")}
                  variant="primary"
                  size="sm"
                  accessibilityLabel={`miniapp-perm-allow-${req().requestId}`}
                  onPress={() => void session.respondPermission(req().requestId, "once")}
                />
                <Button
                  label={tr("spaces.window.reject")}
                  variant="ghost"
                  size="sm"
                  accessibilityLabel={`miniapp-perm-reject-${req().requestId}`}
                  onPress={() => void session.respondPermission(req().requestId, "reject")}
                />
              </View>
            )}
          </Each>
        </View>
      </If>

      {/* In-window message dialog (`dialog.message`) */}
      <If when={messageDialog()}>
        {dialog => (
          <ModalDialog
            open
            title={dialog().title}
            accessibilityLabel="miniapp-window-message-dialog"
            onClose={() => {
              const current = messageDialog();
              messageDialog.set(null);
              current?.resolve(false);
            }}
            footer={
              <Button
                label={tr("spaces.window.ok")}
                variant="primary"
                size="md"
                accessibilityLabel="miniapp-window-message-ok"
                onPress={() => {
                  const current = messageDialog();
                  messageDialog.set(null);
                  current?.resolve(true);
                }}
              />
            }
          >
            <Text style={textStyle("body", { color: palette().text })}>{dialog().message}</Text>
          </ModalDialog>
        )}
      </If>
    </View>
  );
}

// ── Controller & Shell Operations ───────────────────────────────────────────

function openOrFocusMiniAppWindow(request: OpenWindowRequest): { windowId: string; reused: boolean } {
  if (!windowsRunning || !hostDeps) {
    throw new Error("unsupported_in_native_host: standalone MiniApp windows are not installed in this shell");
  }
  const key = windowKey(request.appId, request.workspacePath);
  const existing = openWindows.get(key);
  if (existing) {
    existing.handle.focus();
    return { windowId: existing.windowId, reused: true };
  }
  const windowId = windowIdFor(request.appId, request.launchId);
  let handle: MiniAppWindowHandle | null = null;
  let closeRequested: () => void = () => handle?.close();
  const deps = hostDeps;

  handle = windowDriver.open(
    () => (
      <MiniAppWindowView
        request={request}
        windowId={windowId}
        deps={deps}
        getHandle={() => handle}
        onFinished={() => {
          openWindows.delete(key);
        }}
        registerClose={fn => {
          closeRequested = fn;
        }}
      />
    ),
    {
      id: windowId,
      title: request.name || "MiniApp",
      kind: "normal",
      titleBar: { style: "hidden", height: 40 },
      resizable: true,
      minimizable: true,
      maximizable: true,
      closeOnPress: false,
      defaultSize: { width: 1050, height: 760 },
      minSize: { width: 480, height: 360 },
      defaultPosition: "center",
    },
    {
      onClosePress: () => closeRequested(),
      onClose: () => {
        openWindows.delete(key);
      },
    },
  );
  openWindows.set(key, {
    key,
    windowId,
    appId: request.appId,
    workspacePath: request.workspacePath,
    handle,
    closeRequested: () => closeRequested(),
  });
  return { windowId, reused: false };
}

/** Shell operations announced to the backend via `host_shell_attach`. */
export const MINIAPP_WINDOW_SHELL_OPERATIONS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  "miniapp.window.open": async args => {
    const appId = typeof args.appId === "string" ? args.appId.trim() : "";
    if (!appId) throw new Error("miniapp.window.open requires an appId");
    const workspacePath = typeof args.workspacePath === "string" && args.workspacePath ? args.workspacePath : null;
    const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : appId;
    const launchId = typeof args.launchId === "string" && args.launchId.trim() ? args.launchId.trim() : undefined;
    return openOrFocusMiniAppWindow({ appId, workspacePath, name, launchId });
  },
  "miniapp.window.focus": async args => {
    const appId = typeof args.appId === "string" ? args.appId.trim() : "";
    const workspacePath = typeof args.workspacePath === "string" && args.workspacePath ? args.workspacePath : null;
    const entry = openWindows.get(windowKey(appId, workspacePath));
    if (!entry) return { focused: false };
    entry.handle.focus();
    return { focused: true };
  },
  "miniapp.window.close": async args => {
    const appId = typeof args.appId === "string" ? args.appId.trim() : "";
    const workspacePath = typeof args.workspacePath === "string" && args.workspacePath ? args.workspacePath : null;
    const entry = openWindows.get(windowKey(appId, workspacePath));
    if (!entry) return { closed: false };
    entry.closeRequested();
    return { closed: true };
  },
};

/** Installs the standalone MiniApp windows controller on the native desktop shell. */
export function startMiniAppWindows(deps: MiniAppWindowsHostDeps, options: { force?: boolean } = {}): () => void {
  if (stopController) return stopController;
  if (!isAvailable && !options.force) return () => undefined;
  windowsRunning = true;
  hostDeps = deps;
  stopController = () => {
    for (const entry of [...openWindows.values()]) entry.closeRequested();
    openWindows.clear();
    windowsRunning = false;
    hostDeps = null;
    stopController = null;
  };
  return stopController;
}

/** Open MiniApp window ids (tests). */
export function openMiniAppWindowIds(): string[] {
  return [...openWindows.values()].map(entry => entry.windowId);
}

/** Resets state between headless tests. */
export function resetMiniAppWindowsForTests(): void {
  stopController?.();
  openWindows.clear();
}
