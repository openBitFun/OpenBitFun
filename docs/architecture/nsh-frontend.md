# NSH frontend

`src/nsh-ui` is the OpenBitFun desktop UI. It is a Native Shell (NSH) app built as a
12-scene **Personal Agent Studio** (`Home`, `Sessions`, `Assistants`, `Agents`,
`Skills`, `Routines`, `Files`, `Git`, `Terminal`, `Spaces`, `Devices`, and
`Settings`). The same TSX code renders the native desktop app
(`src/apps/desktop-nsh`: AppKit, Win32, GTK runners with the backend library loaded
in-process) and, as the NSH web target, browsers and phones that connect to a
backend over OBP. Architecture owner: [unified-client-architecture.md](unified-client-architecture.md).

The React desktop UI (`src/web-ui`) and the Tauri desktop shell were retired
(wave 4 sunset); this document's history sections below still mention the Tauri
window the NSH web target ran in during the migration.

## Current shape

- **Native desktop.** `src/apps/desktop-nsh/App.tsx` installs the in-process
  connection (`src/jsonWireConnection.ts` over the `openbitfun/native` module) and
  the native window shell (`src/nshDesktopShell.ts`), then mounts this app.
- **Browser / phone.** `servedBackend.ts` installs `webSocketConnection.ts` when the
  page was served by a backend's OBP listener (`#nsh-params`).
- **Peer Device Mode.** On new hosts the bridge routes to the peer's backend over
  the device mesh (`meshPeerConnection.ts`); registry `ControllerLocal` commands stay
  local (`src/generated/peerSurface.ts`).
- **Page host (`host.js`).** The legacy page-host wire (`tauri` transport when a
  host page exposes `window.__TAURI__`, `dev` fixtures otherwise) remains for
  `nsh run --target web` development and the headless tests; nothing ships it as
  the desktop transport.
- Capabilities without an NSH implementation degrade loudly: the desktop pet
  window and desktop cards (retired with the Tauri shell), in-product MiniApp tabs
  (MiniApps open as independent windows), browser screenshots, and in-place
  updates on Windows/Linux.

## Transport

The NSH engine runs in its own JavaScript realm inside the page, so it cannot see
`window.__TAURI__`. `host.js` is the page-side host module NSH loads
(`nsh.json` → `web.host`), and it is the only code that touches the desktop IPC:

| App side (`src/bridge.ts`) | Host function | Desktop |
|---|---|---|
| `invokeCommand(action, request)` | `openbitfun.invoke` → `core.invoke(action, { request })` | one Tauri command |
| `invokeCommand` while a peer is selected | `openbitfun.invoke` → `account_device_rpc` with `{cmd:"host_invoke", command, args:{request}}` | the same command on that device |
| `invokeRawCommand(action, params)` | `openbitfun.invoke` with `raw` → `core.invoke(action, params)` | commands with positional arguments (`account_*`, `remote_connect_*`) |
| `invokeRawCommand` while a peer is selected | `account_device_rpc` with `{cmd:"host_invoke", command, args}` — the positional arguments at `args`' top level, no `request` wrapper | the same command on that device |
| `listenEvent(event, cb)` | `openbitfun.listen` → `event.listen(event)` then `player.hostEvent("openbitfun.event")` | backend events |

`host.js` answers from fixtures when `window.__TAURI__` is absent, so the shell
runs in a plain browser during `nsh run --target web` and under `nsh test`
without the desktop binary. `transportKind()` reads `tauri`, `dev` or `native`;
it is no longer drawn in the chrome, so check it from a scene or the logs.

Request shapes follow the backend command signatures (the wire the retired React
UI also used), mixed casing included:
sessions use `workspace_id`, workspace and file commands use `workspaceId`, and
positional commands use Tauri v2's default camelCase wire names — e.g.
`account_device_rpc` takes `targetDeviceId`, `commandJson`, `timeoutMs`, and
`terminal_get_history` / `save_mcp_json_config` pass camelCase positional args
unwrapped via `invokeRawCommand` directly to `core.invoke`.

Peer Device Mode is the one exception to "commands go to the machine the window
runs on": while a device is selected, `invokeCommand` wraps the command in a
HostInvoke envelope and sends it over `account_device_rpc`, then unwraps
`{resp:"host_invoke_result", ok, value}`. `invokeRawCommand` takes the same route
with the positional arguments at `args`' top level instead of under `request`,
because a peer's handler reads the envelope the way a local caller's arguments
arrive; it had been sending those commands to this machine regardless of the
selected device, which is a silent local fallback — a question answered, or an
MCP server started, on the wrong host. The commands that stay here — account,
relay, window, updater — are read from `src/nsh-ui/src/generated/peerSurface.ts`,
a projection of the Product Operation Registry, so the UI and every host agree
on which command is controller-local.

## Backend connection and window shell

The table above is the legacy page host. `src/bridge.ts` no longer talks to
`host` itself; two things are injected before the app mounts:

- A **backend connection** (`src/backendConnection.ts`): `invoke(command, args)`
  where `args` is exactly the Tauri args object (`{ request }` or the positional
  arguments), `subscribe(onEvents)` for seq-numbered event batches, `ready()`,
  and a connection state (`connecting` / `connected` / `reconnecting` /
  `failed`, drawn as a banner when it is not answering). The default is the page
  host (`src/hostPageConnection.ts`, which keeps the `{ action, request }` /
  `{ action, raw }` envelopes above); the native desktop installs a JSON-string
  wire (`src/jsonWireConnection.ts`) over the in-process `openbitfun/native`
  module, and browsers/phones use the OBP WebSocket connection
  (`src/webSocketConnection.ts`) with the same interface: every client is the
  same UI over one protocol.
- A **window shell** (`src/windowShell.ts`): the window, title bar, application
  menu, tray, OS notifications and the local folder picker — the client's own
  machine, never the backend's. The default (`host.js` page host) is for
  development and tests; `src/nshDesktopShell.ts`
  drives a native NSH window with `nsh/desktop` (system traffic lights in a
  hidden title bar, `desktop={{ windowDrag }}` regions, `Menu` with the editing
  roles so text fields get Command-C / Command-V, `Tray`, `Notifications`,
  `Application.quit`).

Peer Device Mode's HostInvoke envelope and the peer event tag filter live in
`src/peerRouting.ts` and are applied by the bridge over any connection; they are
marked `backend-owned` because the target design connects the UI's connection
to the peer's backend instead. `agentic://text-chunk` is merged per frame by
`host.js` for the page host and by `src/textChunkCoalescer.ts` for every other
wire, with the same algorithm (a test holds the two to the same output).

The native desktop app is `src/apps/desktop-nsh` (`nsh.json`, `App.tsx` that
installs the native connection and shell and then imports this app); its Rust
side is the `native/` crate (`openbitfun/native`) and the `openbitfun-nsh`
runner that loads the backend library (`libopenbitfun_desktop_lib`) into the same
process.

## Rendering model notes

- NSH components run once. State lives in signals (`src/state.ts`), and JSX reads
  them; there is no re-render and no virtual DOM.
- `<If>` and `<Each>` are globals; `<List>` virtualizes and recycles rows.
- `nsh/base` supplies the heavy widgets this product needs: `Tree`, `TextView`
  (Markdown, streaming), `Editor`, `DiffView`, `Terminal`, `DataTable`, `Input`.
- The app owns its look: `src/theme.ts` holds the palette as a `computed` signal
  (dark and light), so a scheme change repaints every binding that reads it. NSH
  provides primitives and an unstyled base layer, not a styled product library.

## Personal Agent Studio design system and UX architecture

The NSH frontend carried over the retired React UI's **OpenBitFun 5-Plane Desktop
Shell**, motion system, Layer-4 overlays, and Remote SSH capabilities across
all 12 scenes:

1. **5-Plane Surface Hierarchy & 9 Built-In Appearances (`src/theme.ts`), Motion (`src/ui/motion.tsx`), Overlays (`src/ui/overlays.tsx`), Icons (`src/ui/icons.tsx`), and Primitives (`src/ui/primitives.tsx`)**:
   - **5-Plane Elevation & 9 Built-In `APPEARANCE_PRESETS`**: separates `NavPanel`
     chrome tokens (`chromeBg`, `chromeText`, `chromeTextMuted`, `chromeHover`,
     `chromeActive`, `chromeBorder`, `chromeInputBg`, `chromeAccent`) from inset
     `SceneSurface` tokens (`canvas`, `canvasSubtle`, `panelRaised`,
     `surfaceElevated`, `popoverBg`, `inputBg`, `shadowScene`, semantic badges)
     across all 9 built-in appearances (`Dark`, `Light`, `Monochrome`, `Slate`,
     `Midnight`, `Ink & Paper`, `Night Ink`, `Cyber`, `Tokyo Night`) via
     `selectAppearancePreset`. Separating `chrome*` tokens keeps split themes
     like `Monochrome` (dark `#1c1c1f` `NavPanel` paired with `#ffffff`
     `SceneSurface`) legible across active rows. Every `fontSize` scales via
     `textSize(base)`.
   - `src/ui/motion.tsx` provides `animateLayout`, `enterMotion`, `Spinner`, and
     `<SceneTransition>` (`<ShaderTransition>` with `fallback="fade"`).
   - `src/ui/overlays.tsx` provides centered `ModalDialog` (`ModalHeader`,
     bounded `ModalBody` `<Scroll>` `maxHeight: 540`, `ModalFooter` inside a
     full-bleed `<Overlay>`), anchored `DropdownMenu`, `ContextMenuOverlay`,
     searchable `SelectDropdown`, and `ToastHost` / `pushToast`.
   - `src/ui/icons.tsx` and `src/ui/primitives.tsx` supply native `<Canvas>` +
     `Path2D` icons, 5-variant `BotCharacter` faces, and Tauri controls
     (`Button`, `IconButton`, `ConfigSection`, `ConfigRow`, `Badge`, `KbdHint`,
     `SplitHandle`, `SegmentedTabs`, `ToggleSwitch`, `SectionCard`,
     `StatusDot`, `StatusPill`, `AgentAvatar`, `TapOptionRow`,
     `InlineConfirmBar`, `EmptyStateCard`), avoiding `nsh/base`'s `Switch`,
     `Select`, and `AlertDialog` and explicitly setting `color: palette().text`
     on `<Input>` and `itemStyle` on `<Tree>`.
2. **Collapsible + Resizable `NavPanel`, `SceneTopBar`, `SceneBar`, & Right `AuxPane` (`App.tsx`, `state.ts`)**:
   - Left `NavPanel` (`drawerOpen()` + draggable `SplitHandle`) houses history
     navigation (`Back`/`Forward`), `Search everything… ⌘K`, primary links
     (`Home`, `Sessions`, `Assistants`), collapsible `STUDIO & WORKBENCH`
     (`Agents`, `Skills`, `Routines`, `Spaces`, `Files`, `Git`, `Terminal`),
     unified `Workspaces` + grouped/flat `Sessions` + `SSH HOSTS` tree,
     `SettingsNavBlock`, and persistent footer (`Devices`, `Settings`, Appearance
     preset picker, Remote/SSH menu, and `{transportKind()}` indicator).
   - `SceneTopBar` + `SceneBar` manage open scene tabs, active workspace pill /
     port-forwarding badge, and `AuxPane` workbench toggles (`Files`, `Git`,
     `Terminal`) flanking the inset rounded `SceneSurface`. `AuxPane` supports
     side swapping, maximize/restore, and compact layouts (`compact?: boolean`)
     for `FilesScene`, `GitScene`, and `TerminalScene`. Global `keymap.bind`
     wires `mod+k`, `mod+b`, `mod+j`, `mod+,`, and `mod+n`.
3. **FlowChat Progressive Disclosure, Personal Hub, & Spaces (`SessionsScene.tsx`, `HomeScene.tsx`, `AssistantsScene.tsx`, `SpacesScene.tsx`)**:
   - `ConversationHeader` offers transcript search (`transcript-search-toggle`),
     copy, `AuxPane` toggle (`aux-pane-toggle`), and `thread-actions-trigger`
     `DropdownMenu` (`New session`, `Open tabs` switcher, `Rename`,
     `Duplicate`, `Fork`, `Archive`/`Restore`, `Delete`).
   - Empty threads show the Welcome Studio (`BotCharacter`, `"How can I help
     today?"`, 2×2 starter cards); active transcripts render progressive
     disclosure (`THINKING` collapse, `ToolCard` items with `AuxPane` file links,
     checklists, unified `DiffView`, `TextView` Markdown, `TapOptionRow` user
     questions), and the 3-band `ChatInput` dock (`Agent` / `Model` / `Reasoning`
     anchored `<Overlay>` popovers, `Attach`, `Reference` / `@`, `Actions`,
     `Send` / `Steer` / `Queue` / `Stop`).
   - `HomeScene` displays the 5-metric telemetry bar (`Total Tokens`,
     `Peak Daily Tokens`, `Requests (30d)`, `Longest Streak`, `Current Streak`),
     6-month `<Canvas>` usage heatmap, Agents/Assistants, Workspace & Saved SSH
     Hosts, Skills & Routines, Spaces & AI Insights (opening Markdown
     `<ModalDialog>`), and 24 h Attention feed.
4. **Remote SSH, Capabilities, Workbench & Settings (`SshWorkspaceModals.tsx`, `AgentsScene.tsx`, `SkillsScene.tsx`, `RoutinesScene.tsx`, `FilesScene.tsx`, `GitScene.tsx`, `TerminalScene.tsx`, `DevicesScene.tsx`, `SettingsScene.tsx`)**:
   - `SshWorkspaceModals` mounts `NewWorkspaceModal` (Assistant vs Local/SSH/Docker/WSL
     Project), `SshConnectionModal` (`~/.ssh/config` import, hop test stages,
     Docker/WSL, saved profiles), `SshAuthPromptModal`,
     `RemoteFileBrowserModal` (POSIX navigation, mkdir, rename, delete, rebind),
     and `PortForwardModal` (listening port scan + forward rules).
   - `AgentsScene` & `SkillsScene` use `ModalDialog` builders and `DropdownMenu`
     overflow actions; `RoutinesScene` pairs a 24 h feed with an interactive
     Mon–Sun calendar; `FilesScene` stacks vertically in compact `AuxPane` mode
     with open-file tabs; `GitScene` supports Working Copy Discard (`git_reset_files`
     + `delete_file`), Worktrees tab (`git_list_worktrees`, `git_add_worktree`,
     `git_remove_worktree`), and 2-row compact `AuxPane` tabs; `SettingsScene`
     binds its categories to `App.tsx`'s `NavPanel` (`nav-settings-cat-*`) and
     adds live URL projection, `/models` discovery (`list_ai_models_by_config`),
     `test_ai_config_connection`, AI subscriptions & quotas, and 9 appearances.

## Parity matrix

Status: **ported** means the scene calls the same host commands as the React
surface for that feature; **partial** means the scene exists with a subset of the
feature's states; **not started** means the React surface still owns it;
**blocked by the widget** means the NSH component cannot report the event the
feature is built on, and **blocked by the surface** means the product operation
is not scriptable or needs assets this surface does not have, so those rows say
what the surface does show instead of claiming a behavior it does not have.

### Home

| Feature point | React owner | NSH status |
|---|---|---|
| Hero Launchpad and quick prompt | `scenes/personal-overview`, `scenes/profile` | ported (`HomeScene` + `src/homeStore.ts`: `AgentAvatar`, personal greeting, `"Ask OpenBitFun anything…"` prompt calling `startQuickPromptInSession`) |
| Overview layout | `scenes/personal-overview` (`PersonalOverviewScene.scss`, config-page frame) | redesigned (`HomeScene` + `src/ui/studio.tsx`: greeting, prompt, "Needs attention", one quiet activity row with the heatmap, and one "Your studio" grouped list; follows the shared visual language rather than the React overview's numbers) |
| GitHub account identity and device-flow auth | `AccountIdentityAPI`, `RemoteConnectAPI` | ported (`account_status`, `account_github_info`, `account_github_start` + `openUrl`, `account_github_poll`, `account_logout`; controller-local with explicit Peer Mode notice when driving a remote device) |
| Live Attention & Activity Feed | `flow_chat`, `scenes/cron` | ported (aggregates `pendingPermissions()`, active `runningTurns()`, and routines due within 24 h from `list_cron_jobs` with one-click jumps to `Sessions` or `Routines`) |
| Ecosystem Grid, 6-month Heatmap & SSH Pulse | `NavPanel`, `UsageStatistics` | ported (5-metric telemetry bar, 27-week `<Canvas>` 6-month activity heatmap via `get_token_usage_statistics` `custom`, cards for `Assistants`, `Agents`, `Workspace & Remote SSH`, `Skills`, `Routines`, and `Spaces`; each pulse call fails independently so older hosts degrade gracefully) |
| AI Insights Studio | `scenes/insights`, `insightsApi` | ported (`get_latest_insights`, `load_insights_report` opening Markdown `<ModalDialog>` with `TextView`, `generate_insights`, `cancel_insights_generation`; controller-local with Peer Mode notice) |

### Sessions

| Feature point | React owner | NSH status |
|---|---|---|
| Personal Agent Welcome Studio | `flow_chat` empty state | ported (renders `"How can I help today?"` with `BotCharacter` and 4 `TapOptionRow` starter options on empty or zero-session views, populating `composerText` without auto-sending) |
| Workspace list and switching | `NavPanel/sections/workspaces` | ported (`NavPanel` Workspaces/Sessions/`SSH HOSTS` tree + `NewWorkspaceModal` / `SshConnectionModal`: `get_opened_workspaces`, `get_recent_workspaces`, `set_active_workspace`, `close_workspace`, and `open_workspace` / `open_remote_workspace`) |
| Session catalog with paging | `sections/sessions` | ported (`list_persisted_sessions_page` + cursor "Load older sessions") |
| Session row actions (rename, archive, delete, fork, copy) | `sections/sessions` | ported (`save_session_metadata`, `archive_session`, `delete_persisted_session`, `fork_session` from the last loaded turn, `copy_session` which selects the copy) |
| New session | `sections/sessions` | ported (`create_session` with `agentType: "Standard"`) |
| Transcript rendering (Muse 3-layer progressive disclosure, turns, tool cards, streaming) | `flow_chat` | ported (`SessionsScene.tsx` renders user bubbles separately from Muse 3-layer assistant turns: Layer 1 ambient status banner above the composer while running, Layer 2 vertical process timeline rail grouping `THINKING` / `THINKING SUMMARY` blocks and tool cards, Layer 3 checklists with progress bar, `DiffView` patches, monospace command/path callouts, and `TextView` Markdown with per-block `Copy` / `Copied` and streaming `agentic://text-chunk` / `agentic://dialog-turn-completed`) |
| Reasoning notes (thinking) | `flow_chat` (`ThinkingDetailPanel`, `FlowThinkingItem`) | ported (`src/agentEvents.ts` keeps the two streams apart — the host sends a reasoning model's notes on the *same* `agentic://text-chunk` event with `contentType: "thinking"`, so a chunk that says so goes to `thinkingText` and only the rest becomes the answer; before that they were concatenated into the reply and the model's working showed up as its answer. A persisted turn carries the same notes in `modelRounds[].thinkingItems`, which `turnParts` turns into a `thinking` part drawn before that round's text, since the round does not record the order the two streams interleaved in. The block is collapsed like the desktop's: its header names `THINKING` (or `THINKING SUMMARY` for a provider's summary) and the size or `streaming`, and a press shows the notes. A thinking part is not part of `turnToText`, so a session row or a search hit never shows the model's working as what the turn said) |
| Following the newest reply | `ScrollToBottomButton`, `ScrollToLatestBar` | done for the transcript (`src/scenes/SessionsScene.tsx`: `onScroll` decides whether the reader is within 32 px of the end, and while they are, a zero-height view at the bottom of the content is `reveal`ed after each change — a new turn, a streamed chunk, a thinking chunk, an opened session — so a growing reply stays in view with no measurement of the content's height. Scrolling up stops the following immediately, because a reply must not pull the text the reader is reading away, and a `Latest` chip then returns to the end and resumes it. `reveal` is applied after layout, which is why the follow lands on the content just added) |
| Composer, sending, queue, model selector | `flow_chat` | partial (`submit_user_message` sends every message — the host decides start / steer / queue from `app.flow_chat.send_during_turn`, mobile and IM bots go through the same host function — and `Stop` is the host's `stop_dialog_turn`, which interrupts and falls back to cancellation itself; a host older than those commands still starts idle turns through `start_dialog_turn` and stops through `interrupt_dialog_turn` / `cancel_dialog_turn`; `Model: <name>` opens the catalog's chat models — `get_ai_model_catalog` filtered to chat-capable entries — and `Model: <name>` opens the catalog's chat models — `get_ai_model_catalog` filtered to chat-capable entries — and binds one with `update_session_model`, together with the reasoning the model can be set to: `project_ai_model_reasoning_catalog` projects that model's presets from its own `ai.models` entry (endpoint, limits and reasoning block, forwarded unchanged), `get_session_model_target` reports the preset the session currently runs at — an older host omits the field, which is not the same as `null`, so nothing is written for it — and `Reasoning: <label>` offers the model's default plus those presets. The two are written as one pair because the host validates them together: pressing a preset sends the preset alone, and switching model carries the current preset only when the new model declares it, since a preset the new model does not know would fail the whole change. A model whose provider declares no presets draws no control at all rather than an empty list. Not drawn: the reasoning intensity slider and the per-turn reasoning preset the desktop keeps beside the composer's `Boost` submenu, which presets this surface cannot compile `modelName` its own record carries; `Attach` reads the clipboard's image through `Clipboard.readImage`, chips it above the input while it can still be removed, and sends it as `imageContexts` — by `image_path` for a `file:` URL the host opens itself, by `data_url` for bytes that only exist in the clipboard; a message sent while a turn is running reaches that turn as `steer_dialog_turn` and the composer reads `Steer` for it, which is the desktop surface's default immediate-steering policy; the other policy is `Queue`, which hands the message to the host's own queue: `manage_dialog_queue` with a turn id this surface chooses, `agentType`, no attachments yet, and `displayContent` for the row's text; what the panel lists is the host's `list` snapshot, `Send now` sends `promote` with the running turn as `expectedActiveTurnId`, `Delete` sends `cancel` with an operation id, and the host does the draining, so a queued message survives a reload of this surface and keeps its place beside what another surface queued — a host that does not answer that command gets an explicit "update the host" line instead of a local list (rows older builds stored under `openbitfun.nsh.pending-queue.v1` are submitted to the host queue once); a host row moves through `reorder` against the `revision` of a snapshot read first, and a row the host reports as `steering_pending` or `blocked` is labelled with the host's own status and reason instead of reading as idle, and the desktop's mid-turn policy setting is read from `app.flow_chat.send_during_turn`, so `Queue` there makes queueing the composer's primary action while `Steer now` (the host's default) keeps steering it; the other route stays one press away either way. `Return` sends, as the desktop's composer does: the field is `submitBehavior: "submit"`, which the widget documents as leaving `Shift+Return` (and `Option`/`Alt+Return`) as line breaks, so a multi-line message is still possible, and while the reference panel is offering a row `Return` takes the tag instead of sending) |
| Session agent (harness profile / agent) | `HarnessProfileSelector`, `ChatInputModePreferenceService` | ported (`src/agentModeStore.ts`; since logic batch 3 the order, eligibility, aliases, per-session `switchable` and the resolved default come from the host's `get_session_mode_catalog`, `update_session_mode` refuses to rebind a started session (`session_mode_locked`) and records `last_mode_id`, and the text below describes the rules the host now applies; `get_available_modes` is the catalogue the panel draws for the active workspace — the four harness profiles `Minimal` / `Standard` / `Ultimate` / `Creative` first, then the agents and external ACP agents the host resolves, minus the modes the desktop keeps out of a session's agent list: `claw`, `multitask`, `plan`. A session that has not started a turn takes the press and is rebound with `update_session_mode`; a session whose `messageCount` is above zero keeps the agent it started with, because the runtime would accept the rebind silently and change what a running session's next turn is — so the press offers a new session in that agent instead, created by `create_session` with the name and agent, which is what the desktop's own lock does. The agent a new session starts as follows the preference both surfaces share, `app.flow_chat`: `default_mode_strategy: "fixed"` reads `default_mode_id`, anything else reads `last_mode_id`, and every choice is remembered by writing the `last_mode_id` leaf, so the object's other keys survive and the React surface reads the same value back. The session header names the agent of the session it opens, and the header of a row without a recorded agent shows the one this surface would send. A host without the command — an older build, or a Peer that does not answer it — leaves the composer on the agent it already had and says so in the panel rather than drawing an empty list) |
| File and directory references in a message | `flow_chat` (`ChatContextPicker`, `RichTextInput`) | partial (`src/mentionStore.ts`; the composer's `Reference` opens a search over the active workspace through `search_files` — the same read the Files scene searches with — and a pressed row puts the tag the desktop composer writes into the message text: `#file:<name>` or `#dir:<name>`, added where the caret is when the widget is there to take it, appended when it is not. The tag is not a separate wire field: the runtime does not expand it, so it travels as text and the agent resolves the name with its own tools, which is what the desktop sends too. The picker draws at most eight names and says when the host matched more, and a host that refuses the command states that instead of showing an empty list. Not ported: the other context kinds the desktop tags — session references, code snippets, pull requests, URLs, Mermaid nodes — and the removal pills, which `RichTextInput` draws for contexts it holds separately. The inline `@` trigger **is** ported and the earlier note here was wrong about why it could not be: `Input` reports `selectedRange` / `onSelectionChange` / `onCaretMove` and takes `insertText`, so the composer reads the token the caret sits in (`mentionTriggerAt`: a `@` that starts the message or follows whitespace, running to the caret with no space or second `@`), opens the panel with that query and no field of its own, and a pressed row replaces the typed token with the tag. The token's range is kept from the edit that produced it rather than read from the caret at press time, because a widget's caret report can lag a press; and the composer became a controlled field (`value={composerText()}`) so the replacement is the text itself, not a select-and-insert whose result depends on that report) |
| Permission prompts | `flow_chat`, `ConfigAPI` | ported (`subscribe_permission_requests` + `list_pending_permission_requests` seed the prompt, `permission://event` keeps it current, `respond_permission` answers once / always / reject; drawn in the scene so a remote controller can answer) |
| User questions (`AskUserQuestion`) | `flow_chat`, `ConfigAPI` | ported (`src/userQuestionStore.ts`; `backend-event-toolawaitinguserinput` adds the prompt, and opening a session reads `get_session_interaction_mailbox`, so a question asked before this surface loaded — or while it looked at another session — is recovered instead of leaving the tool call waiting forever; `start_user_question_interaction` reports the question as on screen once per tool id, which is what starts the host's unattended-answer deadline. A single-select question takes one option, a multi-select takes several, and the `Other` row the desktop adds becomes a text field whose typed text replaces that label in the answer. `Send answer` answers every question at once and otherwise says `Answer every question first`; the answers leave as `submit_user_answers` with `{ toolId, answers, sessionId }` as separate arguments — question index as the key, the label or labels as the value. It is drawn in the scene rather than in a dialog for the same reason permission prompts are: a remote controller has to be able to answer it. A prompt that arrives while a mailbox read is in flight is kept, because the snapshot cannot contain it. Not ported: dismissing a question, since the desktop exposes no command for it) |
| Session tabs / scene bar | `app/components/SceneBar` | ported for the session canvas (an `openSessionIds` strip above the transcript: a pressed session joins it, a tab press reloads that session's turns, a tab close falls back to the last tab, and archiving or deleting a session removes its tab) |
| Global search | `app/global-search` | partial (`src/globalSearchStore.ts`; one field over active workspace sessions by name, message hits via `search_session_content`, workspace files via `search_files`, and leading `>` commands for all 12 scenes — `>home`, `>sessions`, `>assistants`, `>agents`, `>skills`, `>routines`, `>files`, `>git`, `>terminal`, `>spaces`, `>devices`, `>settings` — plus `New session`. Typing is debounced 220 ms with request tickets so stale answers never overwrite newer ones, and a failing source sets `searchNotice` while other groups still render. Not ported: federated catalog items inside search rows, and global `Cmd+K` / `Alt+F` chords since NSH delivers key events only to a focused input) |
| Archived and background sessions | `sections/devices`, `sections/sessions` | ported for archive and restore (`Active` / `Archived n` chips split the one catalog the host returns by `persistedStatus`, the archived row's header action restores it through `unarchive_session`, and archiving keeps its row instead of dropping it); a row also states what its session is doing, derived from this surface's own events rather than stored per session: `Running` (a turn event that names the session — including a session the user is not looking at), `Waiting for approval` (a permission prompt carrying that session), `Queued` (the host queue reported rows for it), `Last turn failed`, and `Not read yet` / `Last turn failed` from the host's unread receipt (`unread` / `failed` in the session page's activities; opening a session acknowledges it with `mark_session_seen`, and stamps older builds kept in `openbitfun.nsh.session-seen.v1` are handed to the host once). Sessions a device owns are reached by entering Peer Device Mode, not by listing them beside local ones, and a background session whose turn this surface never saw an event for shows no mark) |
| Task card subagent steps (wave 5) | `tool-cards/TaskToolDisplay` | ported (`src/ui/toolCards.tsx` lists the subagent's tool calls and replies from the transcript view's nested `subagentItems` under an opened Task card, the latest eight first and the rest behind `Show n earlier steps`; nothing is re-derived from records) |
| Joining a turn that is already running (wave 5) | `restore_session_view` `runtimeEventSnapshot` replay | ported (`get_session_transcript_view` now carries `runningTurn`: the runtime journal's projection of the running turn as the live `agentic://*` events plus the delivery cursor they reached; `src/agentEvents.ts` replays them through its own live handlers and drops live events at or below that cursor — a text chunk merged across it keeps only the newer text, using the `__openbitfunChunkSpans` the per-frame merge records — so a surface that connects, reopens the session or lost events mid-turn shows the turn exactly as an attached one does. A turn this surface followed from its start is not replayed again. An older host omits the field and the turn appears when it settles, as before) |
| GenUI answers (wave 5) | `GenerativeWidgetInline`, `tools/generative-ui`, `@openuidev/react-lang` | ported for the transient inline answer (`src/genui/`: an OpenUI Lang reader for the same language — statements, positional component calls whose argument order `scripts/generate-genui-contract.mjs` generates from the product library, `$state`, hoisting, `@Each` and the library's builtins, `@ToAssistant` / `@OpenUrl` / `@Set` / `@Reset` / `@CopyToClipboard` actions — and NSH drawings for all 55 components, rendered as the source streams in through `GenUIStream` deltas and from the call's result once settled; a failed candidate leaves no card, as on the desktop. Shown differently and said so: images, maps and YouTube are captions with an Open link because this window has no network grant, and HtmlView and free `html-document` answers render as static pages with scripts off. Not ported: the owner/CAS persistence the desktop also did not have, host `Query`/`Mutation` providers, the repair request after a render diagnostic) |
| Composer voice input and voice calls (wave 5) | `flow_chat/components/voice` | partial (`src/voiceInputStore.ts`, `src/ui/VoiceInput.tsx`: dictation runs on the system recognizer (`Speech`, macOS/iOS) in the language `app.ai_experience.voice_input.default_language` names, shows what it hears, and inserts or sends the transcript; the button follows `voice_input.enabled`. An NSH window cannot capture raw microphone audio, so the host speech service (`speech_*` input sessions with the local or cloud model) and full-duplex voice calls (`speech_*_realtime_*`) are not driven: the dictation tooltip names the system recognizer, a device without one says so, and an enabled voice call explains that this window cannot place it instead of starting anything) |
| Agent navigation requests (wave 5) | `global-search/openBitFunControlBridge` | ported (`src/controlPresenter.ts`: the window marks itself the presentation surface with `mark_openbitfun_control_surface_ready`, answers `agentic://openbitfun-control-request` by opening the screen behind the catalog `destination` the host now resolves into the request (settings page and section, scene, product action, surface event) and reports through `report_openbitfun_control_result`; a destination this UI has no screen for, or a host that sends none, is reported as a failure naming it. Persisted language and appearance effects are applied and acknowledged. Pages served to phones or browsers never declare themselves the presenter) |

### Assistants

| Feature point | React owner | NSH status |
|---|---|---|
| Assistant gallery & primary designation | `scenes/profile/views/NurseryGallery`, `AssistantCard` | ported (`AssistantsScene` opens on a card gallery, primary first and large, with open/close workspace, set-primary and delete per card and a create card below three assistants; `src/assistantStore.ts`: `get_assistant_workspaces`, `get_primary_assistant_workspace`, `create_assistant_workspace` (which opens the new assistant's page), `set_primary_assistant_workspace`, `reset_assistant_workspace`, `delete_assistant_workspace` behind `InlineConfirmBar` with primary-delete guard) |
| Assistant config page | `scenes/profile/views/AssistantConfigPage`, `AssistantAvatarPicker` | ported (back to gallery; avatar picker with the official artwork, the 16 emoji presets and a one-character custom symbol; in-place name edit saved on Return or blur; `saveIdentityFields` re-reads `IDENTITY.md` and rewrites only the edited frontmatter field, so unknown fields and the body survive; new-session composer; the assistant's sessions via `list_persisted_sessions_page`, opened in `Sessions`. Not ported: the scheduled-sessions block (`ScheduledJobsView`), which stays on the `Routines` scene) |
| Persona & Soul Studio (`IDENTITY.md`, `SOUL.md`, `USER.md`) | `scenes/profile/views/AssistantConfigPage` | ported (the page's three persona links open an editor dialog with `SegmentedTabs` across the POSIX-joined files via `read_file_content`, treating missing files as empty drafts, multiline `Input` with live `TextView` Markdown preview, `write_file_content` save, `reset_workspace_persona_files` behind `InlineConfirmBar`, and quick message launch via `startQuickPromptInSession(..., "Claw")`) |

### Agents

| Feature point | React owner | NSH status |
|---|---|---|
| Multi-Agent Team catalog (modes, profiles, subagents, external ACP) | `scenes/agents` | ported (`AgentsScene` + `src/agentsCatalogStore.ts`: `get_available_modes`, `list_subagents`, `list_agent_tool_names`, `get_agent_profile_configs`, `SegmentedTabs` for `All Bots` / `Primary Agents` / `Subagents`, scope & text filters, and one-click `Start Thread` launching `startQuickPromptInSession`) |
| Custom bot builder, profile tools & subagent config | `scenes/agents`, `SubagentAPI` | ported (`create_custom_agent`, `update_custom_agent`, `delete_custom_agent`, `get_custom_agent_detail`, `reload_custom_agents`, `create_subagent`, `update_subagent`, `delete_subagent`, `get_subagent_detail`, `reload_subagents`, `set_agent_profile_config` / `reset_agent_profile_config`, `update_subagent_config` with `parentAgentType`, interactive tool multi-select `PillChip`s; explicitly disabled on remote workspaces and gated by `peerSupports("tool_catalog")`) |

### Skills

| Feature point | React owner | NSH status |
|---|---|---|
| Installed skills, global toggles & `SKILL.md` inspection | `scenes/skills` | ported (`SkillsScene` + `src/skillsCatalogStore.ts`: `get_skill_configs` normalizing array and `{ skills, diagnostics }`, `get_global_skill_settings`, `set_global_skill_disabled`, `ToggleSwitch`, `SKILL.md` inspection via POSIX `${skill.path}/SKILL.md`, and `delete_skill` behind `InlineConfirmBar`) |
| Local folder install & Skill Marketplace | `scenes/skills`, `skill_api` | ported (`validate_skill_path` + `add_skill` for user/project scope, `list_skill_market` / `search_skill_market` / `download_skill_market` with `Installed` matching; local folder installs and project-level remote installs degrade loudly with explicit warnings on remote workspaces and Peer Device Mode) |

### Routines

| Feature point | React owner | NSH status |
|---|---|---|
| Scheduled Cron Jobs & 24 h feed | `scenes/cron`, `CronAPI` | ported (`RoutinesScene` + `src/routinesStore.ts`: `notify_cron_host_ready`, `cron://jobs-changed` subscription with `cleanup()`, `list_cron_jobs`, `create_cron_job`, `update_cron_job`, `delete_cron_job`, `ToggleSwitch` enable/pause, `All` / `Active` / `Paused` filter, Due in Next 24 Hours cards, preserving existing `"session"` targets, omitting `reportPolicy` with notice when Peer reports `background_result_delivery_v1: false`) |
| Interactive Month Calendar & Routine Editor | `scenes/cron` | ported (7-column Mon–Sun month calendar highlighting today and scheduled dates with day-click occurrence filter, alongside `Every` / `Cron` / `At` schedule editor with workspace and agent selection) |

### Devices & Connectors

| Feature point | React owner | NSH status |
|---|---|---|
| Account device inventory | `NavPanel/sections/devices` | ported (`account_list_devices`) |
| Online presence | `DeviceStatusControl` | ported (`account_online_devices`) |
| Device alias / visibility / ordering | `deviceVisibilityPreferences`, `deviceOrderPreferences` | ported (an alias writes `account_update_device_alias`; `Hide` / `Show` per row and `Up` / `Down` arrangement persist in this app's `Storage` under the React stores' own keys — `openbitfun.sidebar-device-visibility.v1`, `openbitfun.device-order.v1` — with the same `{ state, version }` envelope, so both surfaces read one set of preferences and a file either wrote still parses; the default order is this machine (`remote_connect_get_device_info`) first, then online, then alias or name, and `Hidden n` reveals the hidden rows. Arrangement is buttons rather than drag, which keeps it usable from a keyboard and from a remote controller) |
| Rendering another device's sessions and workspaces | `infrastructure/peer-device` | ported for the desktop-to-desktop path (a `Use` press on an online device handshakes with `peer_mode_ping`, opens the control link with `peer_control_attach`, and from then on `invokeCommand` sends product commands to that host as `account_device_rpc` `{cmd:"host_invoke", command, args:{request}}`; the reply envelope's `error` reaches the scene instead of falling back to this machine's data. The set that stays local is generated from the Product Operation Registry into `src/nsh-ui/src/generated/peerSurface.ts`, so account, relay, window and updater commands never travel. Switching drops every cached workspace, session, file and terminal fact first — terminal tabs are forgotten without closing their shells, because those shells belong to the device the user just left. `Return to this machine` detaches and reads this machine again. Rate: `peer_mode_ping`/`attach`/`detach`, priority classes, keepalive, reconnect backoff and per-capability gates of the React connection manager are not ported — the NSH surface sends one handshake and reports a refusal; a device whose host is older simply refuses the commands it lacks) |
| Peer reconnection and capability gating | `infrastructure/peer-device` | ported for the handshake's own facts (the ping's capability map is kept with the scope, and `peerSupports` answers `undefined` for a capability the host never stated, which is different from a stated `false`; a peer that says `dialog_queue_v1: false` keeps queued text here and the panel says which device refused, and one that does not answer `manage_dialog_queue` is probed once and then also falls back; `model_pool_selection_v1: false` keeps the pools section from asking at all. `Reconnect` in the banner re-runs `peer_mode_ping` and `peer_control_attach` for the device already being driven without leaving peer mode, and a failure there leaves the scope in place so the button can be pressed again. There is no periodic keepalive and no automatic retry: a dropped relay is noticed by the next command, not by a timer) |
| Detached dispatch entry points | `features/dispatch` | ported (`dispatch_list_targets` fills a target row — the first remote target is preselected so a job never defaults to this machine — and `New job` sends `dispatch_submit` with the ids this surface mints (`job-…`, `session-…`), the session's own `agentType`, the prompt, and an approval policy the user picks from the three the host accepts (`auto`, `reject-and-report`, `remote`), because the request is refused without one; the target's `workspacePath` is required for a remote target and is prefilled from this workspace. The list below it is `dispatch_list_jobs` with no target, i.e. the controller's own index, read as `lastState` / `promptPreview` / `target.displayName`, and `Cancel` sends `dispatch_cancel`. A host without these commands hides the panel instead of showing an error. Not drawn: the CLI install / probe / model-sync preflight and result navigation) |
| Detached dispatch observation | `features/dispatch/DispatchJobObserver`, `flow_chat` transcript | ported as a reduced projection (`Observe` on a job opens `src/dispatchObserver.ts`: `dispatch_status` is polled every 1.8 s while the job is alive, and the cursor sent is always the one the target handed back for a page this surface already rendered, so a page that failed to render is re-read instead of skipped; `cursorReset` means the target rewrote its log, which drops the transcript and replays from zero. The fold keeps what a reader needs — `jobState` rows, assistant text with consecutive chunks merged into one row, thinking kept distinct, tool rows for `Queued` / `Waiting` / `Started` / `ConfirmationNeeded` / `Confirmed` / `Rejected` / `Completed` / `Failed` / `Cancelled` and not for the assembly frames, turn failures and `permissionRejected` as errors — and drops what only a full dialog-turn store can carry: per-round metrics, subagent nesting, image analysis, deep-review queues, `ThinkingChunk` merge order. A permission the target waits on is answered in place with `dispatch_answer` (`once` / `always` / `reject`), and the composer means one of two commands depending on the state: `dispatch_append` while the turn runs, `dispatch_continue` with a freshly minted `turnId` once it has finished, so a repeated press cannot start the same turn twice. `Sync result` runs `dispatch_sync_result` for a finished job and `Cancel job` runs `dispatch_cancel`. The poll is released when the panel closes or the scene unmounts, and a terminal job releases it once the log is drained. Not ported: the controller-side transcript cache (`dispatch_load_transcript` / `dispatch_save_transcript`), so a reopened job replays the target's log again) |
| Messaging Bots & Mobile Relay Connectors | `scenes/remote-connect`, `RemoteConnectAPI` | ported (`DevicesScene` + `src/connectorsStore.ts`: `remote_connect_status`, `remote_connect_get_methods`, `remote_connect_get_form_state`, `remote_connect_set_form_state`, `remote_connect_start`, `remote_connect_stop`, `remote_connect_configure_bot`, `remote_connect_stop_bot`, `remote_connect_weixin_qr_start`, `remote_connect_weixin_qr_poll`, `remote_connect_get_bot_verbose_mode`, `remote_connect_set_bot_verbose_mode` for Telegram, Feishu, WeChat iLink QR, LAN relay, and OpenBitFun Server relay; marked `Controller local` when driving a Peer device and degrades cleanly when unsupported) |

### Settings

| Feature point | React owner | NSH status |
|---|---|---|
| Two-column category rail | `scenes/settings` | ported (`SettingsNavBlock` inside `App.tsx` `NavPanel` defaulting to `All sections` plus 7 domain filters: `Appearance & Layout`, `Agent & Memory`, `Models & Pools`, `Permissions & Safety`, `MCP & Web Search`, `Workspace & Shell`, `Usage & Diagnostics`) |
| Config sections read | `scenes/settings` | ported for the paths it draws (`get_config` per path, so one missing path cannot fail the batch: `app`, `app.ai_experience`, `app.logging.level`, `editor`, `terminal` and the two `app.notifications` flags; a path a host lacks is shown as `unavailable` instead of breaking the page. `AI execution` draws the `ai.*` scalars the desktop page reconciles — `enable_deferred_tool_loading`, `subagent_max_concurrency`, `swarm_max_concurrency`, `subagent_batch_execution_policy`, `tool_execution_timeout_secs`, `user_question_timeout_secs`, `tool_presentation_mode` — as ordinary fields, with `native` / `ptc` / `ptc_python` as the values `ToolPresentationMode` deserializes. `ai.task_models` has its own section rather than a field table, because `TaskModelSelection` is a serde enum (`"Inherit"` or `{"Fixed":{"model_id":…}}`), so the whole object is written back with each task set to a model id from `ai.models` shown by name. `Permissions` reads `tool_permissions`, resolves it to Ask / Auto / Full access the way the desktop does, and writes the mode back by rewriting `policy.preset`, `interaction.auto_approve_ask` and `approval.strategy` while keeping the rule list and any other field; full access takes a second press. The rule list is edited as its own draft: `Edit rules` opens it, `Add rule` seeds an empty row, each row is an effect chip — `Allow` / `Ask` / `Deny` — over an `action` and a `resource`, plus `Up` / `Down` / `Remove`, and `Save rules` writes the whole `tool_permissions` document once, so the drawn order becomes the evaluation order the host applies; `Discard changes` drops the draft and says nothing was written. A row whose action or resource is blank is refused instead of being stored as a rule that matches everything. Automatic approval is drawn from the same document: `Chat model` / `Decision model` pick the `model_kind` that answers, the chat route lists the `fast` / `primary` roles beside the `ai.models` entries and writes `approval.chat_model_id` with `model_kind: "chat"`, the decision route edits `ai.decision_model` (name and endpoint) and keeps its key in the vault through `save_decision_model_credential` / `clear_decision_model_credential`, so the secret never enters the config, `Approval timeout` clamps the seconds it accepts, and the `When it is unsure` / `When it fails` chips write `on_ask` and `on_error`. Those writes never move the permission mode: saving approval rewrites `approval` alone. Driven in the real window: `Auto` wrote `approval` as `strategy: "model"`, `model_kind: "chat"`, `chat_model_id: "fast"`, `on_ask: "user"`, `on_error: "ask"`, `timeout_ms: 30000` together with `interaction.auto_approve_ask: true`; a rule added as `*` / `workspace/*` / `Deny` reached `policy.rules` and the section then read `1 rule in force`; removing it and saving cleared the list to `0 rules in force`; and `Full access` behind its confirmation wrote `preset: "full_access"` and dropped the approval block again. `Tools` and `Agent hooks` draw the switches the desktop keeps for Computer Use, browser reattachment and native hooks (`ai.computer_use_enabled`, `ai.browser_control_auto_connect_on_startup`, `ai.browser_control_preferred_browser`, `app.hooks.enabled`, `app.hooks.project_hooks_enabled`), plus `app.prevent_sleep` under `Application` and `app.logging.include_sensitive_diagnostics` under `Diagnostics`; those are written as leaf paths, so `ai` (models and keys) and `app.hooks` are never replaced wholesale. `Session memory` draws the user-facing `memories.*` switches (extraction, prompt inclusion, background sessions, the `MemoryExternalContextPolicy` enum, how long an unused memory stays, and the consolidation batch), again as leaf paths. `AI experience` also draws `app.ai_experience.enable_git_commit_coauthor` — the desktop's commit-attribution switch — as its own leaf path rather than through the `app.ai_experience` object the quick-action list is merged into, so a press cannot rewrite a list it does not own. `application.input`, `development.*` and the memory scheduler's lease and retry timings are not drawn) |
| Scalar field editing (toggles, choices, numbers, text) | `scenes/settings` | ported (`set_config` one path at a time; numbers clamp to the field's range; an empty field leaves the value alone) |
| Section forms and validation | `scenes/settings` | partial (bounds, numeric parsing, and three checks the host also makes. A model's limit pair above the host's 40% ceiling is refused; a memory extraction window longer than the retention it runs inside is refused with the reason instead of being silently shrunk, read from the stored document at write time so raising the retention first is what makes a larger window legal; and a `model` field writes a configured model id, one of the product's two roles, or `null` — a stored id the host no longer configures keeps its own chip marked `(not configured)` rather than reading as "follow", because silently forgetting a reference is worse than showing it is gone. `Session memory` therefore draws the fields the desktop keeps inside that document rather than at a leaf path: the extraction and consolidation models, the idle window, the rollout window, sessions per startup, the scan limit and the extraction concurrency, with the desktop's own ranges. One deliberate difference: the desktop ties `generate_memories` and `use_memories` to a single switch, while this surface exposes both, so an install can keep learning without including what it learned. Other sections still have no per-field validation) |
| Secret, model discovery, testing & subscriptions | `ConfigAPI`, `modelDiscovery` | ported for custom/catalog/remote model config (`AI models` reads `ai.models`, previews live resolved endpoint URLs across `openai`, `response`, `anthropic`, `gemini` including trailing `#` verbatim suffix, detects models via `list_ai_models_by_config`, merges `get_local_models_dev_catalogs` in `ModelDiscoveryPicker` with 40% `max_tokens` batch save, tests endpoints via `test_ai_config_connection`, and displays `list_subscription_accounts` / `get_subscription_account_quota` usage windows) |
| Model pools | `ModelPoolsSection`, `ModelPoolAPI` | ported for the pool document (`get_model_pools` fills the list; `Add pool` opens a draft whose members are the `ai.models[].id` values the desktop editor stores, ordered with `Up` / `Down` because an ordered pool's priority is its order; `save_model_pool` creates with an empty id — the host allocates it — and updates with a real one; `delete_model_pool` removes one; `Check` asks `get_model_pool_status` and prints each member's status and reason. A host that does not answer `get_model_pools` hides the section rather than showing an error. A pool's per-member retry (`retry_model_pool_member`) and the strategy preview image are not drawn) |
| Input, workspace and the mid-turn send policy | `settings/pages/application`, `settings/pages/development` | ported for the stored values (`Input` draws the selection-toolbar switch and the local voice-input preferences — on/off, language, longest recording, microphone — from `app.flow_chat.auto_show_selection_toolbar` and `app.ai_experience.voice_input.*`; `Workspace` draws the worktree folder, branch prefix, copy-local-changes and the auto-delete policy from `app.worktrees.*`, in the camelCase keys the worktree service stores. `Message sending` is a two-chip switch over `app.flow_chat.send_during_turn` — `Steer now` or `Queue` — and the composer's primary action follows it: with `Queue` a message written during a turn goes to the queue instead of into that turn, with `Steer now` it steers, and the other route stays one press away either way. Every one of these is a leaf write, so `app.flow_chat`, `app.ai_experience` and `app.worktrees` are never replaced. Not ported: the local-model download/selection and the microphone test, which are host probes rather than stored values, and the suggestion fields the desktop groups with them) |
| Web search provider and key | `tools/WebSearchConfig`, `ai/web_search` | ported (`ai.web_search` is read as one document and written back whole, so a provider this surface does not draw and any unknown field of a drawn one survive the write; the six providers the desktop offers are `exa_mcp_free`, `exa_search_api`, `tavily`, `deepseek`, `keenable` and the self-hosted `openbitfun_search_http`, and choosing one writes `provider` plus that provider's `credential_id` / endpoint / auth fields. The key never enters the config: `get_web_search_credential_status` states whether one is stored, `save_web_search_credential` / `clear_web_search_credential` move it through the vault, and the note above the row is what the host answered last. A provider that needs no key, such as Exa's free MCP, says so instead of showing the credential rows) |
| Composer quick actions | `ChatInput/quickActions` | ported (`app.ai_experience.quick_actions` — `{ id, label, prompt, enabled }` — is drawn as an editable list: `Show` / `Hide` per row, `Up` / `Down` for order, `Edit` for label and prompt, `Delete`, and `Add`; the host's defaults (`commit`, `create_pr`) appear when it stores nothing. Every write re-reads `app.ai_experience` and merges, because `voice_input` and the other switches in that object are written by other sections of the same page. The composer's `Actions` menu lists the enabled rows and sends the row's prompt as a turn; a hidden row stays out of the menu but stays in the stored list) |
| Theme and appearance application | `infrastructure/appearance`, `infrastructure/font-preference` | ported for built-in presets and scaling (`src/theme.ts` defines the 5-plane elevation tokens + all 9 built-in `APPEARANCE_PRESETS`: `Dark`, `Light`, `Monochrome`, `Slate`, `Midnight`, `Ink & Paper`, `Night Ink`, `Cyber`, `Tokyo Night` selectable via `NavPanel` header menu or `Settings → Appearance` `<SelectDropdown>`, alongside `System` / `Light` / `Dark` override persisted in `openbitfun.nsh.appearance.v1` and `openbitfun.nsh.appearance-id.v1`; `font` `{ uiSize: { level, customPx? } }` scales every text size via `textSize(base)`, and `openbitfun:appearance:flowChatWidth` controls conversation column width. Custom user-imported appearance asset packs are not ported; the retired React UI owned them) |
| Language selection | `infrastructure/i18n` | blocked by the surface (the configured value `app.language` is shown under `Application`, and the row states that this surface renders English only. Switching is not a scripted operation even for the desktop: the catalog marks it `open`/`unstructuredInteraction`, and applying a locale loads that locale's namespaces and repaints every live window, which a surface with no resource catalogs of its own cannot honour — offering the control here would change the desktop and leave this page unchanged) |
| MCP servers | `tools/mcp`, `settings/pages/tools/McpConfig` | partial (`get_mcp_servers` fills the list — name, id, `transport · command` or `transport · url`, the host's status chip, and `Enable` / `Edit` / `Enable and start` / `Stop` / `Restart` / `Delete` — and `start_mcp_server` / `stop_mcp_server` / `restart_mcp_server` / `delete_mcp_server` drive one server at a time. Configuration is edited as the stored document, not as a rebuilt one: `load_mcp_json_config` returns the Cursor-format text and its fingerprint, `save_mcp_json_config` writes with that fingerprint, and a document another surface changed meanwhile is refused with the host's own `changed elsewhere` wording instead of overwriting it — the editor then reports `Not saved` rather than `Saved`, because a refused write that still reads as saved is worse than no status at all. The form writes only the fields it draws into a copy of the stored entry, so a field this surface does not show survives an edit, and a new entry is stored `enabled: false` whatever the form said, so a server never starts behind the user's back. Entries the form cannot express (a transport alias it does not know, a non-string environment, a shape it would have to guess) open the whole-document editor instead of being silently rewritten. The remote OAuth flow is its own panel: a row whose `url` the host reported carries an `Authorize` / `Reauthorize` chip (the label follows `authConfigured`), and the panel behind it runs `start_mcp_remote_oauth` and then polls `get_mcp_remote_oauth_session` once a second until the session answers `authorized` / `failed` / `cancelled` — an `authorized` answer refreshes the server list — while `Cancel authorization` sends `cancel_mcp_remote_oauth`. The address the host hands back is opened with the surface's own `openUrl`, and when that fails the panel shows the address with `Copy address` instead of dropping it. The token route is the same panel: `update_mcp_remote_auth` stores an authorization value and `clear_mcp_remote_auth` removes it, so a server without OAuth discovery still takes one. Importing another client's configuration is the pasted-document route: `Import` takes the text, `Preview` reads it through the same entry reader the edit form uses and lists one row per server with an editable target id, an entry whose id the document already holds starts unselected, and an entry the form cannot express stays listed as `Unsupported` with the reader's reason instead of being stored as a server nobody could edit — the write is one `save_mcp_json_config` of the document with the selected entries added `enabled: false`, because importing a configuration is not permission to launch what it names. What a running server publishes is browsed from the row's `Resources` entry: `list_mcp_resources` fills the list (the first read is the cached list, `Refresh` asks the server again with `refresh: true`), a filter narrows it by name, URI or description without another read, and `read_mcp_resource` renders the contents — one block prints its media type, several name themselves so they stay distinguishable, a `blob` is reported as binary instead of being decoded, and a read that fails says so under the row it belongs to. `list_mcp_prompts` / `get_mcp_prompt` are not drawn because the desktop's own surface does not call them either: there is no prompts UI to port) |
| Token usage | `data/UsageStatisticsSettingsPage`, `infrastructure/config/components/UsageActivityHeatmap` | ported (`get_token_usage_statistics` answers the whole dashboard, and the section reads it twice, as the desktop does. The range half: the five preset ranges are chips, the granularity is derived the way the desktop derives it — `last24Hours` and `today` bucket by hour, everything else by day — and the IANA zone goes along because the host aligns calendar ranges and buckets with it. Totals, the cache hit rate (computed from `totalCachedTokens` over `totalCacheReportedInputTokens`, and shown only when that denominator is non-zero), failed and unknown-usage counts, the distribution block, the last twelve trend buckets as a stacked input/output bar chart with its legend, and the same buckets again as rows. The distribution block is the desktop's `UsageDistribution` plus the detail rows under it: `Model` and `Group` tabs over the host's own `byModel` and `byGroup` (one answer, one view drawn, both sorted by tokens), five rows at a time behind `Show all N` / `Show less`, a `cache N%` beside each row that reported telemetry, and a text filter matched against the row's primary and secondary text. The filter is matched against the rows that view holds and the match count decides the empty state, so a filter that matches nothing says so instead of reading as a host with no usage. Switching tabs clears the filter and collapses the list, the way the desktop resets its own narrowing. `By endpoint` lists `byEndpoint` with the same columns and is not narrowed by that filter, because it is the detail block rather than the distribution. Row keys are positional: the legacy `/unknown` endpoint arrives once per request group, so identical labels are expected. The activity half: the same command asked for `timeRange: "custom"` over the desktop's fixed six-calendar-month window with day granularity, projected onto a Monday-first week grid — one cell per day, days outside the window left as empty padding, a bucket the host did not report kept at zero rather than interpolated, and the five-step shade taken from the busiest day in that window. The projection is date arithmetic on the host's own buckets plus a `YYYY-MM-DD` key in the statistics zone, so the grid groups days exactly where the host bucketed them. The window is independent of the range, so switching ranges redraws only the half below it. A Peer host that answers `token_usage_statistics_unsupported` gets its own sentence instead of an error, a failed range read never renders as zeroes, and a host that answers the range but refuses the window keeps the section and says why instead of drawing an empty grid. Not ported: nothing the desktop draws. The command also accepts `filterKind` / `filterQuery` and a `custom` range, but no desktop surface exposes either — `custom` appears only as this heatmap's fixed window, which is read here too — so there is no UI to port for them) |
| Log files and diagnostics bundle | `data/DiagnosticsSettingsPage`, `crash_diagnostics` | ported for the runtime half (`src/diagnosticsStore.ts`: `get_runtime_logging_info` answers the effective level, the folder this run writes to, the `app.log` path and, when the host detected one, the previous run's ending — the category is shown as words, and the folder that still holds that run's log is named beside it, so a crash is visible instead of being a file nobody opens. `Open log folder` and `Export diagnostics bundle` run `reveal_in_explorer` and `export_diagnostics_bundle`, and the exported path is revealed and stated. Field names are read in both camelCase and snake_case because this command's shape comes from a Rust struct rather than a hand-written payload. The level and the sensitive-payload switch stay config and live in the `Diagnostics` group above; a host without the command renders the section as "reports no log location" instead of an error) |
| External import | `scenes/ecosystem-compatibility` | partial (`src/externalImportStore.ts`: `get_external_source_discovery_snapshot` with the `get_external_source_control_snapshot` → `get_external_source_snapshot` fallback for older hosts, the automatic-discovery switch through `update_external_integration_policy_command` (`set_automatic_discovery` against the read `preferenceRevision`), the source list with scope and health and the command/tool/subagent/MCP counts, MCP import through `plan_external_mcp_import_command` / `apply_external_mcp_import_command` per item or all ready items with the `stale` outcome replacing the preview, and removed source sessions through `list_removed_external_sessions` / `restore_removed_external_session`. A remote workspace sends none of the workspace-scoped commands and says why; an older host is told apart from an empty one; in Peer Device Mode the catalog is read from the peer while MCP import and session restore stay with their owning host, as on the desktop. Not ported: per-application pages, account capture, pets, skill import, conflict choices, tool/subagent approvals, safe mode and source enable/disable) |

`get_configs` is all-or-nothing: one unknown path fails the whole call. The NSH
scene therefore reads each path on its own and treats the paths the React
preload marks optional as optional, so a backend that lacks one of them still
renders the rest of the page.

Two settings belong to the desktop's own front end rather than to a shared store,
so they are stated instead of drawn as controls. `Keyboard shortcuts` reads
`app.keybindings` and prints how many overrides are stored: the desktop applies
them through its shortcut registry, which this surface does not have, so an editor
here would change the desktop and none of this page's keys. Re-checked at build
76: the widget's `shortcut` and `keymap.label` are menu-item hints and a menu
popup, not an application-level key registry, so a chord still cannot be
registered from here. The background-session
close confirmation is a `localStorage` preference of the desktop's own panel, which
has no counterpart here at all.

### Terminal

| Feature point | React owner | NSH status |
|---|---|---|
| Shell session lifecycle | `tools/terminal` | ported (`terminal_create`, `terminal_write`, `terminal_resize`, `terminal_close`) |
| Output streaming | `tools/terminal` | ported (`terminal_event` with `Data` / `Exit`, plus a `terminal_get_history` replay on attach. `terminal-output` is a different, remote-stream notification that carries no bytes: subscribing to it left the widget blank) |
| Tabs and multiple terminals | `content-canvas` | ported (`terminalStore` keeps one tab per host session with its own scrollback, so a background shell's bytes are kept but not drawn; `New shell` opens another, a tab press redraws its own buffer, a tab close closes the host session and falls back to the last remaining shell). Driven in the real window: `New shell` moved the header to `2 shells`, the tab strip listed both, and `Close` removed one |
| Shell profiles and detection | `tools/terminal` | done (`terminal_get_shells` fills a `Shell: <name>` picker with the shells the host reports and skips the ones it marks unavailable; the choice is what `New shell` starts — `shellId` when the host names one, plus `shellType` for a plain enum name, because a `Custom("...")` debug name cannot deserialize back — and it persists in this app's `Storage` so the next launch starts the same shell. The `Profiles` panel keeps named profiles per workspace root: a shell plus an optional startup command, saved in this surface's own `openbitfun.nsh.terminal-profiles.v1`. Opening one starts that shell under the profile's name and types the command into it. The desktop's `manualTerminalProfileService` entries are **not** reused, because they bind a profile to a chat session and this surface's tabs are host terminal sessions; writing there would hand the desktop records it cannot resolve). Round-tripped in the real window: `Save profile` reported `Saved Terminal 1`, the profile was still listed after the app restarted, and `Open Terminal 1` started a third shell whose tab reads `Terminal 1` and whose startup command ran (`echo profile-ok` printed `profile-ok`), so the write path reaches the PTY with its newline. Pressing Return inside the widget itself is the part automation cannot drive; see the verification note below | |
| Shell title | `tools/terminal` | ported (the host's `terminal_event` `TitleChanged` and the widget's own `onTitleChange` both reach `applyTerminalTitle`: a tab started without a name follows the title the program sets — `vim notes.md`, an ssh host — and a tab a profile named keeps that name, so a saved profile is not renamed by whatever runs inside it) |
| Command links and decorations | `tools/terminal` | blocked by the widget (ANSI colors, bold and reverse video come from xterm's own parser behind `Terminal`, so the decorations a shell emits are drawn; a press on a link in the output is not reportable: `Terminal` exposes `onData` / `onResize` / `onTitleChange` and write/reset/focus methods, and `onLinkPress` belongs to `TextView`, not to the terminal. The desktop surface resolves output links itself — an `https:` URL opens externally, a workspace path opens in the editor, and `ssh://` / port-forward URIs consult saved connections — so its behavior cannot be reproduced without a link hook, and inventing a side list of scraped URLs would not be the same interaction. Re-checked at build 76: the widget gained `onTitleChange` in the meantime but still has no link hook, so this stays blocked until it offers one) |

### Files (management & live preview/editing)

| Feature point | React owner | NSH status |
|---|---|---|
| File tree & breadcrumb bar | `tools/file-explorer` | ported (`explorer_get_children` at the workspace root with interactive breadcrumb folder navigation) |
| Lazy directory loading | `tools/file-explorer` | ported (a directory is read the first time it expands; children are cached per path and dropped after a mutation there) |
| Create / rename / delete / paste | `WorkspaceAPI` commands | ported (`create_file`, `create_directory`, `rename_file`, `delete_file`, `delete_directory` with recursive delete behind `InlineConfirmBar`, and `paste_files` for the clipboard's files) |
| Search (files, contents) | `search_*` commands | ported (`search_files`; `Names` matches file names, `Contents` greps inside files and lists one row per matching line with its preview, and a hit opens in the preview) |
| Git decorations | `tools/git` | ported (`git_get_status` on the workspace root: a `Changes n` strip over the tree names the branch, lists each changed path with its porcelain letter and opens that file's diff; a workspace that is not a repository simply stays undecorated) |
| Paste from the clipboard | `pasteClipboardFilesToWorkspaceDirectory` | ported (`Clipboard.readFiles` gives the OS file list as `file:` URLs, `paste_files` copies them into the selected directory and the tree refreshes; the host refuses a remote workspace because the remote provider has no copy primitive, and that message reaches the notice instead of a silent no-op) |
| Markdown, plain text & code preview + live editing | `tools/editor`, `TextView`, `Editor` | ported (`TextView` Markdown preview, syntax-highlighted `Editor` preview, and `Edit file` / `Save file` / `Discard edit` toolbar for `"code" | "markdown" | "text"` files persisting through `write_file_content` via `src/fileStore.ts`) |
| Image preview | `Image` | ported (`read_file_content` with `encoding: "base64"`, shown from a `data:` URL with `objectFit: "contain"`; verified in the real window) |
| Video preview | `Video` | ported (same base64 data URL, native controls, muted start; verified in the real window) |
| PDF preview | `file-viewer` | not ported: no document viewer exists in NSH; the scene says so instead of showing an empty panel. Re-checked at build 76: the only `pdf` in the widget types is a file-extension string in `index.d.ts`, not a renderer |
| Oversized media & binary files | `file-viewer` | files over 32 MB are not read into base64; binary files state that the format has no preview |
| Diff review | `DiffView` | ported (`git_get_diff` for one path, rendered by `DiffView` from its unified patch) |

### Git

| Feature point | React owner | NSH status |
|---|---|---|
| Repository probe, trust recovery & agent init | `tools/git`, `git_api` | ported (`GitScene` + `src/gitWorkbenchStore.ts`: `effect`-gated `git_is_repository` and `git_get_repository_trust`; handles `trust_required` with `git_trust_repository` + manual command fallback, and `not_a_repository` with `Initialize with Agent`) |
| Working copy, AI commit message, Discard & unified diff | `tools/git`, `git_agent_api` | ported (`git_get_status` split into `Staged`, `Unstaged`, `Untracked`, `Conflicts`; `git_add_files`, flat `git_reset_files` (`staged: true` unstages; `staged: false` discards tracked/conflict edits, with `delete_file` for untracked), `git_commit` with `Amend` toggle, `git_pull`, `git_push`, `quick_commit_message` with `generate_commit_message` fallback, and `<DiffView>` per file) |
| Branches, commit history graph & Worktrees | `tools/git` | ported (`git_get_enhanced_branches` with `git_get_branches` fallback, `git_checkout_branch`, `git_create_branch`, `git_delete_branch`, `git_get_commits`, plus `git_get_graph` and `Worktrees` tab (`git_list_worktrees`, `git_add_worktree`, `git_remove_worktree`) on local workspaces — skipped with an explicit notice on remote workspaces; supports `{ compact?: boolean }` `AuxPane` layout) |

### Remote Workspaces & SSH

| Feature point | React owner | NSH status |
|---|---|---|
| New Workspace Wizard | `app/components/NewProjectDialog` | ported (`NewWorkspaceModal` in `src/ui/SshWorkspaceModals.tsx` + `src/sshRemoteStore.ts`: Personal Assistant creation via `create_assistant_workspace` and Local/SSH/Docker/WSL Project Workspace creation via `create_directory` + `open_workspace` or `remote_create_dir` + `open_remote_workspace`) |
| SSH Connection Manager, `~/.ssh/config`, Docker & WSL | `features/ssh-remote` | ported (`SshConnectionModal`: saved profiles, `ssh_list_saved_connections`, `ssh_save_connection`, `ssh_delete_connection`, `ssh_has_stored_password`, `ssh_connect`, `ssh_disconnect`, `ssh_is_connected`, `ssh_get_server_info`, `ssh_test_connection` stage reports, `~/.ssh/config` `ssh_list_config_hosts` / `ssh_get_config`, `ssh_list_docker_containers`, `ssh_list_wsl_distributions`, and `SshAuthPromptModal`) |
| Remote File Browser & Port Forwarding | `features/ssh-remote` | ported (`RemoteFileBrowserModal`: POSIX `remote_read_dir`, `remote_exists`, `remote_create_dir`, `remote_rename`, `remote_remove`, `open_remote_workspace` / `remote_open_workspace`, rebind conflict handling, `remote_close_workspace`, `remote_remove_workspace`; `PortForwardModal`: `ssh_list_port_forwards`, `ssh_list_remote_listening_ports`, `ssh_start_port_forward`, `ssh_stop_port_forward`) |

### Spaces

| Feature point | React owner | NSH status |
|---|---|---|
| Space catalog, worker lifecycle & source inspection | `scenes/miniapps`, `MiniAppAPI` | partial (`SpacesScene` + `src/spacesStore.ts`: natural-language `"Describe a Space to build…"` launchpad calling `startQuickPromptInSession(..., "Ultimate")`, `list_miniapps`, `miniapp_worker_list_running` / `miniapp_worker_stop`, `get_miniapp`, `get_miniapp_versions`, `delete_miniapp` behind `InlineConfirmBar`, and explicit Peer Mode notice; interactive multi-window MiniApp webviews stay on the desktop host shell) |

## Capabilities outside the NSH UI

All 12 primary scenes are implemented in `src/nsh-ui`. What the native desktop does
not offer, and how it says so:

| Capability | State in the native desktop |
|---|---|
| Interactive MiniApp windows & hosted `pages` | Independent windows through the `openbitfun-miniapp-shell` sidecar; in-product tabs are refused (`kind: tab`) |
| Desktop cards & companion pet window | Retired with the Tauri shell (registry `retired(...)` rows; Settings says so); the agent `DesktopCard` tool hides itself without a card host |
| `ecosystem-compatibility` account capture, pets and per-application pages | Discovery snapshot, MCP import and removed-session restore are in `Settings → External import`; account capture and pet handling use desktop-only adapters |
| In-place updates on Windows/Linux | The updater reports that in-place install is not available yet; macOS installs in place |

## Verification

Two headless layers plus the desktop-window smoke path are runnable from a
checkout:

```bash
export PATH="$HOME/.nsh/bin:$PATH"
cd src/nsh-ui && nsh check
cd src/nsh-ui && nsh test App.test.tsx
cd src/nsh-ui && nsh test .                 # runs App.test.tsx + all test/*.test.tsx suites
cd src/nsh-ui && nsh package . --target web
```

The headless suites play the embedding host (`test/support.ts` and local
`openbitfun.invoke` wrappers inside each scene suite), asserting real request
shapes (`{ request }` vs `raw: true`), theme reactivity, remote/Peer degradation,
and UI state without starting the desktop binary. The Personal Agent Studio
Tauri 1:1 migration (`sessions-ux`, `personal-hub`, `agents-skills`,
`routines-git-spaces`, `workbench-connectors`, `ssh-remote`) is verified across
`nsh check`, `App.test.tsx`, all six scene suites, `nsh package . --target web`,
`pnpm run capabilities:check`, and `pnpm run check:repo-hygiene`; real-window
interactive observation notes below reflect the prior MVP desktop-window runs.

Real-host smoke (the native app on a real backend):

```bash
pnpm run desktop:dev                     # build and run the native app
pnpm run e2e:smoke                       # package-free smoke over the loopback OBP owner connection
pnpm run desktop-nsh:package:mac -- --profile release-fast && pnpm run e2e:smoke:packaged
```

History (migration period): the steps below drove the NSH web target inside the
retired Tauri window (`transport: tauri`); they are kept as the record of those
observations and no longer apply.

The dev server is not the only way, and here it stopped being a reliable one: in
this environment the page `nsh run` serves did not load in the desktop webview (the
window kept whatever bundle it had, and a `nsh.json` build bump plus a reload did not
replace it). The channel that does work is the packaged site over plain HTTP. The
desktop build from `tauri.nsh.conf.json` loads `devUrl`, so pointing that port at
`frontendDist` serves the packaged output to the real host, which is closer to what
ships:

```bash
cd src/nsh-ui && nsh package . --target web
cd src/nsh-ui/.nsh/out/OpenBitFun && python3 -m http.server 8790
# then start the desktop build against it, with its own profile so the user's
# installed app and its data are untouched
OPENBITFUN_NONINTERACTIVE=1 \
OPENBITFUN_HOME="$PWD/.openbitfun/desktop-nsh/home" \
OPENBITFUN_USER_ROOT="$PWD/.openbitfun/desktop-nsh/user" \
  ./target/debug/openbitfun-desktop
```

The badge reads `transport: tauri` there too, so it is the real host, and a rebuild
is `nsh package` plus a window restart rather than a hot reload.

Scenes driven in that real window so far (macOS, desktop channel `development`):
sessions and their turns, the workspace chips, the file tree with Markdown and
plain-text preview, the Settings values (`editor`, `terminal`, agent execution,
tool permissions, logging level) with a `set_config` round trip verified on disk,
the lazy explorer over a real workspace directory, a real `.rs` file opened in the
code editor, a terminal session the host created whose prompt now renders
(`terminal_create` returned an id, the status line reads `running`, and the widget
shows `user@host workspace %`), an image preview (a workspace PNG
rendered through `read_file_content` with `encoding: "base64"`), and a video
preview (a workspace MP4 playing in `<Video>` with the platform's own controls, and
its duration read from the data URL), the Settings `AI models` section (the host
reported `ai.models = []`, so the section said so), and one `ai.models` write
round trip performed by temporarily driving the store from the app: the host
stored the appended entry, normalized it (`provider`, `model_name`, its resolved
`request_url` and its key all came back intact), and the removal left
`config/app.json` byte-identical to before. Driving a button inside the webview is
still unreliable: AX presses reached the sidebar but not the in-scene controls, so
the model form, clipboard paste and clipboard attachments were exercised headless.

The light scheme was driven in that window: `Settings → Appearance` renders the
`System` / `Light` / `Dark` chips and the scheme line under them
(`Showing the dark scheme` on this dark host), and because a press on an in-scene
view does not land in this capture session, the switch itself was applied by a
temporary startup call — every panel, the sidebar, the chips and the composer
repainted light. Removing that call and reloading kept the light scheme, which is
the persisted `openbitfun.nsh.appearance.v1` being read back at launch.

The font baseline was driven there the same way, and it is the one appearance
setting that reaches the host (build 56): pressing `Large 16` on the Appearance
section's size chips repainted the whole surface at the larger size in place — the
Settings page's own rows, the sidebar, and after switching scenes the session list
and composer — and `config/app.json` then held `"font": {"uiSize": {"level":
"large"}}`, the document and shape the desktop writes, with the neighbouring
`app.flow_chat` keys intact. A restart drew at 16 px from the first frame, because
the document is read before the first scene renders. The chips, the `−1` / `+1`
stepper and `Reset` write the same shapes the headless tests pin; a press at 12 or
20 px is refused by the surface rather than sent as a no-op write.

The content width row was checked in the real window in build 59: `Settings` drew
`Content width` with `900px · the transcript column, shared with the desktop
surface`, the `-` / `900 px` / `+` stepper, `Reset` and `Narrowest 600px`, and the
session scene's transcript and composer both sat in a 900 px column centred in the
wider right pane instead of stretching to its full width. The stepper, the floor and
the persistence are headless-verified — a fixture preloads `1100` and `120` under the
desktop's key, so one run opens at the stored width and steps it to `Reset`, and the
other proves a value below the floor reads as unset.

The packaged site in that window is the run where the in-scene presses do land, and
it settled the terminal end to end:

- The prompt was invisible at first: `Terminal` draws its cells in the view's
  foreground and paints **no** background of its own, and the scene had a fixed
  `#101214` panel behind it, so in the light scheme every glyph was dark on dark.
  The panel is now the theme's canvas, which is the rule for any widget that leaves
  its background to the host.
- Typed text reaches the shell (`onData` → `terminal_write` → PTY → `terminal_event`
  → `Terminal.write`) and the shell's echo comes back in the same widget.
- `New shell` moved the header to `2 shells` and added a tab; pressing a tab
  redrew that shell's own buffer; `Close` removed one.
- A profile survives a restart of the app, and `Open Terminal 1` starts a shell
  named after it and writes its startup command: the shell ran `echo profile-ok`
  and printed `profile-ok`, so the write path reaches the PTY with its newline.
- Only the widget's own key handling is unverified by automation: synthesized
  `Return`, `Backspace` and arrow keys — foreground `key_chord` and window-directed
  `app_key_chord` alike — never produced an `onData` event, so "press Return to run
  what I typed" could not be observed here. The bytes path behind it is proven by
  the profile command above, so what remains is whether `Terminal` translates those
  keys, which needs a human at the keyboard.
- The shell title (build 76) is headless-verified: a `TitleChanged` event renames a
  tab that nobody named, and a tab opened from a profile keeps the profile's name.
  Which of the two paths a real shell uses — the host's `TitleChanged` or the
  widget's `onTitleChange` — was not driven in the window, because no automation
  step can make `vim` set the title from outside the widget. Build 77 was booted in
  the packaged window and drew its scenes, so the change is compiled into what the
  host loads; only the event's arrival is unobserved there.

Clipboard reads have a platform limit worth knowing before debugging them. NSH's
web target implements `Clipboard.readFiles` / `Clipboard.readImage` on top of
`navigator.clipboard.read()` (`~/.nsh/runtime/web/nsh.js`), and the Tauri webview
does not answer that call even when the system pasteboard holds a converted PNG or
a `file:` URL (measured: a temporary probe inside the window reported
`files=0 image=none` while `osascript -e 'clipboard info'` listed `PNGf`, `TIFF`,
`BMP` and `JPEG` for the same clipboard). Both paths therefore say so in the
composer or file notice instead of failing silently, and their request shapes are
what the headless tests pin. They need a real browser tab, not the desktop shell,
to be observed end to end.

The session marks are headless-verified as a transition, not as a drawing: two rows
start `Not read yet` because the host reports messages for both and neither was
opened, `Waiting for approval` rides on the one session the seeded prompt names,
opening a session removes its own mark, a `dialog-turn-started` for the *other*
session marks that row `Running` while the open transcript keeps its own turns, and
a failed event replaces that mark with `Last turn failed`.

Model pools are headless-verified against a fixture that holds them: the section
starts at `No pool yet.`, `Add pool` + a member press + `Create pool` arrives as one
`save_model_pool` with an empty id, an ordered strategy and the configured model's
id, the row that appears is the host's document (its `Ordered · 1 members` line, not
the draft), `Edit` reopens the draft from that document, `Check` prints the status
and reason `get_model_pool_status` returned, and `Delete` sends the pool's id.

One NSH rule surfaced while building that section and applies to every scene: an
NSH component body runs once, so a signal read into a `const` there is a snapshot.
The pool row and its editor therefore read `poolStatuses()` / `poolDraft()` inside
the bindings (`when`, `of`, style values), which is what makes a member press or a
status reply show up without a reload.

The queued-message path is headless-verified. Every composer send is
`submit_user_message`; the host applies `app.flow_chat.send_during_turn` and answers
`started`, `steered` or `queued`, and the composer's secondary mid-turn button sends
an explicit `sendDuringTurn` for that one message. A queued message is a row of the
host queue, so nothing is written to local storage, the row the panel shows comes
back from the host's snapshot, and `Send now` is a `promote` addressed to that turn.
A host without the queue or the command gets an explicit "update the host" state;
there is no local list that drains only while this window is open. Moving a row is the host's too: `Up` /
`Down` re-reads a snapshot first — `supportsReorder` is answered per reply, so
capability is never inferred from a version or remembered from an older one — and
sends `reorder` naming that read's `revision` and the row it must precede (`null`
for last), which the fixture refuses when the revision is stale; a row this surface
holds is swapped in place and persisted. A row the host is holding back keeps the
host's `status` and `reason`, so `Steering` and `Blocked · Waiting: <reason>` are
drawn instead of a row that merely looks idle.

The agent picker is headless-verified on the request shapes, and one press of it was
driven in the packaged window. Headless: the composer's chip reads the agent the
shared preference names (`app.flow_chat` with
`{default_mode_strategy: "follow_last", last_mode_id: "Creative"}` renders
`Agent: Creative`), the catalogue read is `get_available_modes` with the active
workspace's id and path, the panel draws the host's order with the chosen entry
marked and leaves `Claw` out, `New` creates a session with that `agentType`, a
session with no messages takes a press as one `update_session_mode` plus a
`last_mode_id` write and sends its next turn as that agent, a started session draws
the new-session confirmation and writes nothing until it is answered, and a host
without `get_available_modes` shows the notice with `Reload` and still sends a turn.
Real window (build 53, `transport: tauri`): `get_available_modes` answered the four
profiles plus `Cowork` / `Deep Research` / `Claw` / `Paper Writing`, pressing the
chip and then `Ultimate` rebound the session (`update_session_mode`), the header and
chip both repainted to `Ultimate`, `app.flow_chat.last_mode_id = "Ultimate"` landed
in `config/app.json` with the sibling `auto_show_selection_toolbar` intact, and a
restart of the app read it back into the chip. The next packaged build (54) did not
accept any press at the chip in this capture session — the same webview press that
comes and goes elsewhere in this document — so the `Claw` filter in the real window
is unconfirmed and stands on its headless test.

The reference picker was driven end to end in build 55, and it settled a better way
to press a row than a pointer: after a physical press on `Reference` opened the panel,
typing `notes` into it made the host search the active workspace root and answer the
real path (`<workspace>/notes.md`), a second press on the
row did not land, and `Tab` + `Return` did — the focused row reported itself as
`[focused]` in the accessibility tree first, and the press then put
`#file:notes.md ` into the composer with the panel closed, which the composer's AX
value and its own change event both show. That is the route to take for an in-scene
view in this webview: `role="button"` views take keyboard focus where Tab stops, so a
press that a pointer cannot deliver is `Tab` to the row and `Return` on it.

The three settings blocks added with the port are headless-verified through the
`set_config` call each one makes, not only through the text they draw: `AI
execution` writes a boolean, a number and the enum value `ptc_python` that
`ToolPresentationMode` deserializes; `Task models` starts from a fixture holding
`{"Fixed":{"model_id":"model-1"}}` and writes the whole object back, so choosing a
model for the commit task produces both tasks in the host's shape and choosing
`Inherit` produces the unit variant; `Permissions` starts from a policy with one
allow rule, and `Auto` produces `strategy: "model"` with the `fast` approval model
while `Full access` withholds the write until the confirmation is pressed and keeps
the rule list. The rule editor and the approval block are covered by their own
tests: a draft written but not saved leaves `tool_permissions` untouched, saving it
writes the rows in the order they were drawn, a blank resource is refused, the
approval timeout is clamped, and a decision-model key goes to the vault while the
config keeps only the model name and endpoint. Terminal profiles are verified as a
round trip: a profile saved in one run is listed and opened in the next, with the
startup command arriving as `terminal_write`, and a malformed record in the stored
list is skipped.

Detached dispatch is headless-verified for its write path: this capture session has
one machine, so the submit request and the cancel call are checked against a
fixture that answers the three commands, not against a second host that actually
took the job. The read path was seen in the real window — `dispatch_list_targets`
returned this machine as `Local (local)` beside two real SSH hosts (`host-a`,
`host-b`), the first remote target came preselected, and with an empty controller index
the list said `No job in this controller's index yet.` instead of showing a fake
row.

Detached dispatch observation is headless-verified, for the same reason: no second
host can take a job here. What the fixture proves is the read/write contract of the
observer — a page of the target's log folds `jobState` and `TextChunk` events into a
state row and one assistant line, a `ToolEvent` becomes its own row, a pending
`PermissionRequest` is drawn with its action and resources and answered with the
reply kind the protocol expects, a message while the turn runs leaves as
`dispatch_append` and never as `dispatch_continue`, a finished job takes the next
turn with a minted `turnId`, and `Sync result` reaches `dispatch_sync_result`.

Two real command signatures were corrected against the Rust side during that pass,
and both had been hidden by a fixture that accepted either shape: the MCP lifecycle
commands (`start_mcp_server`, `stop_mcp_server`, `restart_mcp_server`) take the
server id as a positional argument rather than a `request` struct, so they now go
through the raw path, while `delete_mcp_server` takes `{ request: { serverId } }` and
`invokeCommand` already wraps its body in `request` — it had been wrapped twice. The
fixture now rejects the wrong shape for each command, so this class of mistake fails a
test instead of silently failing on a device.

The remote OAuth panel was driven in the real window (build 60). One remote server
(`streamable-http`, `oauthEnabled`, no stored authorization) was written into that
profile's `config/app.json` under `mcp_servers.mcpServers` — the value the host reads,
a Cursor-format document rather than a bare map, since a bare map is logged as
`Invalid MCP config format` and rendered as no server at all. With it the row drew
`verify-oauth · streamable-http · https://…` and an `Authorize` chip; the chip's panel
opened at `OAuth status: not started` with `Authorize in browser`, `Cancel
authorization`, the masked authorization field and `Save value` / `Clear stored
authorization`. `Authorize in browser` against a host that cannot answer put the
host's own sentence in the panel — `MCP error: OAuth error: No authorization support
detected` — while the section, the row and the other buttons stayed usable, which is
the degradation this panel exists for. Typing a value and pressing `Save value`
reached `mcpServers.verify-oauth.headers.Authorization` as `Bearer <value>` on disk
and the row's chip then read `Reauthorize`, so `update_mcp_remote_auth` goes through
the bridge with the shape the host expects. The profile was restored afterwards. What
this run did not observe: a successful browser round trip (it needs a host that
advertises OAuth metadata), and `clear_mcp_remote_auth` on the real host — the clear
button and both poll outcomes are headless-verified in the two tests that cover the
panel, including the `failed` outcome and the `Clipboard` fallback when `openUrl`
cannot open the address.

The pasted-configuration import (build 61) is headless-verified only, and the reason
is this session rather than the code: every packaged build after the OAuth run came
up with another application holding the system foreground, so `activate_app` was
refused and no pointer input could be delivered to this window. The test that covers
it pastes a document holding three entries — one this form draws, one whose `args`
are not strings, and one whose id the document already holds — and asserts that
preview reports `3 servers read; 1 cannot be imported by this form`, that only the
drawable and unused entry is written, that it lands `enabled: false`, that the
refused entry never reaches the document, and that the colliding id keeps the
document's own fields (`keepMe`) instead of being rewritten.

The search field (build 67) is headless-verified only, for the same reason. One test
opens it from the sidebar, asserts an empty field lists the commands, types
`terminal` and asserts the three kinds arrive together — the session-name hit, the
host's message hit through `search_session_content` (with the request's
`workspaceId` and `query` checked) — then runs a session hit and asserts the panel
closed and that session opened, and finally runs `>files` and asserts the scene
switched. A second test runs the same query against a host that answers
`Command not found` for the message search and asserts the session hits still
arrive, the refusal is stated, and no message group is drawn. What it does not
cover is the desktop's own federation: the providers for workspaces, assistants,
agents, skills and interactive capabilities are not ported, so a test asserting
those groups would be asserting a feature this surface does not have.

The panel also ran in the real window (build 71), which settled how it is opened.
Typing into the sidebar field is what opens it, so the field is an `Input` whose
focus and first character both open the panel with the caret already in the panel's
field — a button would leave the user to press a second time inside the overlay, and
a `readonly` input collapses to a `button` in the accessibility tree, which is both
unpressable there and unusable as a focus target. Driven that way against a real
host: `notes` typed into the sidebar field opened the panel with `notes` in its own
field, `Files` appeared as a group with the workspace's `notes.md` and its full
path (that file existed only because this run created it, so the row came from
`search_files` and not from anything cached), and the same query in an empty
workspace read `Nothing matches that text in this workspace.` instead of an empty
list. Running a row is the part no automation reaches here: presses into this
webview are dropped and the panel's rows are not keyboard-reachable without a
global shortcut, so that half is covered by the headless tests above.

The transcript copy (build 77) is headless-verified: the test spies the surface's
`Clipboard.writeText`, presses the first block's `Copy` and asserts the clipboard
received exactly the user's message text, then sees the label read `Copied`. The
Markdown body (build 78) is headless-verified the same way: a reply written with a
heading, inline code, a fenced block and a link draws its text and none of its
markers, so the source never reaches the transcript. The
shell title (build 76) is headless-verified in the same document.

The reasoning block (build 79) was a bug a window with a reasoning model would have
shown: notes and answer chunks arrive on the same event, and the surface appended
both to the reply. Two tests hold the fix — a streamed turn whose notes are marked
`contentType: "thinking"` ends with the answer as the only visible text plus a
`THINKING` block that says `streaming`, and a persisted turn's `thinkingItems` draw
a collapsed block with its size that shows its text only when opened.

Following the newest reply (build 80) is **not** verified by either route: the
headless harness has no layout and dispatches no scroll events, and no automation
step can scroll a webview, so `onScroll`, the 32 px end test and the `Latest` chip
have only been reasoned about, not observed. Build 80 was booted in the packaged
window: the transcript drew its column and empty state with no `Latest` chip, so the
effect and the end sentinel run without breaking the layout — which is all that
observation can say.

The inline `@` trigger (build 81) is headless-verified: typing `Explain @readme` in
the message opens the panel with no query field, searches the workspace for
`readme`, and a pressed row leaves the sent message as `Explain #file:README.md` —
the typed token gone rather than left in front of the tag. That test also corrected
an earlier claim in this document: the surface does have a caret, and the note that
said it did not has been removed. It was also typed into the packaged window: the
message read `@readme`, the panel opened under the composer with its inline hint,
the composer kept the focus, and the panel drew no field of its own. That home's
workspace matched no name, so the row press — the step automation cannot deliver to
a webview — is what the headless test stands in for.

`Return` sending (build 82) is headless-verified through the harness's own submit
step, which is what a Return on the field does: with a reference row on offer the
first Return leaves the composer holding `Explain #file:README.md ` and sends
nothing, and the second sends exactly that trimmed. It was also observed in the
packaged window: typed text plus a synthesized Return moved the message into the
transcript's turn error — that install has no model configured, so the host answered
`Failed to start dialog turn: AI client error: Dialog turn model could not resolve a
concrete primary model`, which is proof the turn was submitted rather than that a
line break was inserted. `Shift+Return` staying a line break still rests on the
widget's documented behaviour; the automation route has no chord to hold Shift with
the composer focused.

The reasoning control (build 73) is headless-verified only, for the same reason. One test asserts the
chip reads the session's own default, that pressing a preset sends `update_session_model` with the
pair the host validates (`gpt-4.1-mini` with `reasoningPreset: "high"`, plus the workspace), that the
chip then reads the preset the host accepted, and that pressing `Default` writes an explicit `null`
rather than dropping the field — the host reads those as two different things. A second test runs a
host that refuses `project_ai_model_reasoning_catalog` and asserts no reasoning control is drawn, so an
older host shows the composer it had instead of an empty picker.

The control itself was seen in the real window (build 74), which also settled how the chip
finds its model. That install had no `ai.models` entry at all and the session recorded the
role `primary`, so the panel had nothing to project until it resolved the role through
`ai.default_models` first — the same resolution the desktop's own `normalizeModelSelection`
does. With one model configured under that role (`gpt-5`, whose provider declares reasoning
efforts) the composer drew `Reasoning: Default` between the model and the agent, the host's
catalog command answered with presets, and `get_session_model_target` answered with no preset
for that session, which is why the chip reads `Default` rather than a level.

The key-binding row (build 66) is headless-verified only, for the same reason: the
test opens `Settings`, asserts the row reports the two overrides the fixture stores
and states that this front end has no shortcut registry, and asserts that nothing
was written to `app.keybindings`. It does not assert what the desktop does with
those overrides, which is the desktop's own behavior.

The memory model and window fields (build 65) are headless-verified only, for the
same reason. One test writes a configured model onto the stored `memories`
document and asserts the fields this page does not draw survive the write, then
presses `Follow the primary model` and asserts the stored value is `null` rather
than an empty string the host would read as a model id. It then refuses a
retention drop that would put the extraction window outside the retention and
asserts nothing was written, and finally types a window above the retention and
asserts it was clamped to it. What that leaves unobserved is the live host's own
memory pipeline: the fixture only stores the document, so whether an extraction
really runs with the chosen model is the host's behavior, not this page's.

The MCP resource browser (build 64) is headless-verified only, for the same reason.
One test opens `Resources` on the connected server, asserts the first list is read
with `refresh: false` and that `Refresh` asks again with `refresh: true`, then reads
three entries: a text resource (drawn with its media type), one that answers two
contents (both blocks kept, each naming its URI), and one that answers a `blob`
(reported as binary, not decoded). A filter then narrows the list by URI without a
third read. `list_mcp_prompts` is not covered because no test asserts it: this
surface does not call it, matching the desktop, whose prompts API has no page.

The per-row `enabled` and `Limits` controls (build 62) are headless-verified for
the same reason: one test disables a stored model and asserts the whole-list write
keeps the fields the page does not draw (`api_key`), then refuses a `90000` output
limit against a `200000` context window with the host's own 40% wording and asserts
nothing was written, and finally reopens the form and saves `32000`, so a refused
value cannot survive in the field it was typed in.

The model picker (build 63) is headless-verified only, for the same reason: the
window could not be activated in this session. One test opens `Add model`, asserts
`get_local_models_dev_catalogs` was read exactly once, narrows the list with the
filter, picks `Anthropic` and then `Claude Sonnet 4`, and checks the stored entry
carries the endpoint format, the model id, the base URL and both limits; a second
test runs the same form against a host that answers `Command not found` for that
command and asserts the picker is absent while a hand-typed model still saves with
`context_window` / `max_tokens` as `null`. What that leaves unobserved is the real
catalog's own projection: the fixture is a two-provider document, so a host whose
catalog nests its models or endpoints differently would fail in the picker rather
than in the form.

The usage section was checked in the real window: `Settings` drew `Usage` with the
range chips and the totals the host answered (`0 requests · 0 tokens` in this
scratch profile, which holds no sessions — the point of the check is that the
command was answered at all, since a wrong name or argument shape arrives as an
error line under the heading instead of a figure). The heatmap and the trend chart
are headless-verified: the fixture answers the six-month `custom` read with two
busy days inside any window and one bucket from 2020 outside it, so a projection
that ignored the window boundary would report the wrong total, and a second test
makes that read fail while the range read still answers, which must leave the
totals and the chart in place with one sentence about the window.

The distribution block was then driven in the real window against a scratch
`token_usage` record set (build 58, `transport: tauri`): the section drew
`Model` / `Group`, `Filter these rows`, five model rows with `cache N%` and
`Show all 6`, `By endpoint` listing six `/unknown` rows — the duplicate labels the
positional row keys exist for, all six rendered — and `By day`. `Show all` expanded
the sixth model and turned into `Show less`; typing `gem` collapsed the list to
`gemini-3-pro` and dropped the expand control; switching to `Group` cleared the
filter and restored the full list. The seed records were deleted afterwards, which
is the expected reason the block is absent in an empty profile: it is drawn only
when the host reports a model or a group row.

The Devices scene was reloaded
after the observer landed and still rendered with the real transport
(`transport: tauri`), its real SSH targets and an empty job index, so the panel's
poll and its `cleanup` did not disturb the scene.

Peer Device Mode is headless-verified only: this capture session has one machine,
so no second host can answer `peer_mode_ping`. What the test fixture does prove is
the wire contract — the handshake and `peer_control_attach` leave inside
`account_device_rpc` envelopes addressed to the chosen device, the workspace and
session reads that follow are inside envelopes too, no `account_*` command ever
is, the peer's own workspace and transcript are what the scenes render, and
`Return to this machine` sends `peer_control_detach` and reads local data again.
`Reconnect` adds a second ping and attach to that same envelope sequence, and a
peer fixture that implements no queue sees the `list` probe and never a `submit`:
the text stays on this surface and the panel names the device that does not keep
one. The positional path is covered there too: answering a question while a device
is being driven puts `submit_user_answers` — with `toolId`, `answers` and
`sessionId` at the envelope's top level and no `request` around them — inside the
Device RPC for that device, and this machine's own backend sees no answer at all.

User questions are headless-verified for the same reason: answering one needs a
model turn that calls `AskUserQuestion`, and this scratch profile has no session to
run. What the fixtures prove is the contract — a question restored from the mailbox
is answered once in the shape the Runtime expects (`{"0": "label"}`), a typed
`Other` answer replaces that label, a multi-select takes several labels, and an
incomplete answer is refused in the panel instead of being sent. One real-host fact
does reach this path: the desktop surface has no command for cancelling a question,
so the panel offers none rather than a press that would do nothing.

A terminal shell picker reads the host's own
`terminal_get_shells` (`Bash`, `Zsh`, `Sh` with their paths on this machine), and a
`terminal_create` carrying `shellType: "Zsh"` came back as a session the host
reports with that shell, so the enum round-trips. The session delete path was
driven in the window as well (`Delete` → in-scene `Delete NSH verify? This cannot
be undone.` → `Confirm delete`), which is how the stale count above turned up.

Reloading the page is enough to re-exercise a scene end to end (`nsh run`'s
server reloads the window when `nsh.json` changes), which is how a scene was
driven without pointer input. Model pools were added after that route stopped
working in this capture session — the window kept its old bundle through a
`nsh.json` build bump and a `Cmd+R` — so the pool commands are covered headless
only; they sit in the same command family as the `ai.models` edits that did
round-trip against a live desktop. A change to `host.js` is the exception: the dev
server compiles the host module when it starts and only rebuilds the app bundle
afterwards, so a renamed or added host function needs the dev server restarted
before the window can call it. Renaming the host namespace to `openbitfun.*`
(the repository rejects the retired short product name) first showed up as
`no host function openbitfun.invoke` for exactly that reason; after restarting
`nsh run` and the window, the badge reads `transport: tauri` and the scenes load
the host's own workspace again.

Bugs this smoke found, all fixed in the code they belong to:

- the transport badge was assigned once instead of read from a signal;
- `get_file_tree` was called with an empty `path`, which the backend rejects;
- `get_configs` failed the whole Settings page when one guessed path was absent;
- the file explorer and the terminal both ran their first load before the
  workspace list arrived, so the explorer showed an empty tree and the host
  rejected the terminal with `Terminal workspace ID is unavailable`. Both now
  wait for the active workspace in an effect instead of loading once at mount;
- the composer and the delete confirmation were built from values read once
  (a non-reactive `disabled`) and from a native `AlertDialog` that leaves the
  UI untestable and unreachable from a remote controller. The composer now reads
  signals inside its bindings, and delete confirms in-scene.
- `nsh/base`'s `Switch` and `Select` lay out at their intrinsic size on
  the web target, so a settings row showed an 8×5 hit area for a toggle and nothing
  at all for a choice list. `SettingsScene` now draws the toggle and the choice chips
  from plain views; `Input` is used for text and secret fields inside a visible box,
  and `Switch` / `Select` stay unused there until upstream sizing is fixed.
- deleting a session left the catalog count in the header unchanged: the row went
  away and the number stayed. The real window showed it after a delete, and the
  row action now lowers the count it already knows instead of waiting for a
  reload.
- `open_workspace` takes `{ path }`, not a root path under another name: the first
  probe sent `rootPath`, the host ignored it, and no workspace was opened.
- a model picker that asked for the catalog with `reportError` raised a failure
  banner on a host that has no catalog to give; the picker now stays on its
  default model silently, which is what an unconfigured workspace looks like.
- an image preview was first drawn with the default `objectFit` (cover), which
  cropped a square PNG top and bottom; the panel now asks for `contain`.
- the terminal subscribed to `terminal-output`, which is the remote-stream
  notification (session id and cursor, no bytes), so the widget stayed blank while
  the shell was running. The bytes travel in `terminal_event` as
  `{ type: "Data", payload: { session_id, data } }`; with that channel the prompt
  (`user@host workspace %`) renders, and `terminal_get_history` covers
  what was printed before the view attached. This one only appeared on the real
  host: a fixture cannot tell a wrong event name from a silent shell.
- the terminal scene had a fixed dark panel behind a widget that paints no
  background, so the light scheme drew dark glyphs on it and the prompt disappeared
  entirely. The panel now follows `palette().canvas`.
- a settings field whose path the host stores nothing for drew an empty control and
  could not be written, and a section whose object was absent read as a failure
  rather than as "the host keeps its defaults". `FieldSpec.defaultValue` now supplies
  the value the host would use, the row says
  `The host stores no value yet; these are its defaults.`, and the first edit
  creates the path.

The Settings round trip is proven against the host, not just the fixtures:
loading the scene wrote `terminal.scrollback` back through `set_config` and the
on-disk `config/app.json` moved 1000 → 1001, which the scene then read back.

The `Input` and `Workspace` groups and the mid-turn policy were read and one of
them written in the real window: the host reported
`app.flow_chat.auto_show_selection_toolbar = true`,
`app.ai_experience.voice_input.{enabled,default_language,max_recording_seconds}`
as `true` / `auto` / `60`, and every `app.worktrees.*` value the worktree service
stores (`rootPath`, `branchPrefix`, `copyLocalChanges`, `autoDeleteEnabled`,
`autoDeleteLimit`), while `Message sending` started on `Steer now` because the host
stores nothing for `app.flow_chat.send_during_turn`. Pressing `Queue` wrote that
leaf (`app.flow_chat.send_during_turn = "queue"` appeared in the file, with the rest
of `app` untouched) and the section redrew with the queue hint; pressing `Steer now`
put it back and the host dropped the key again, because `immediate` is the value its
own serializer omits. That round trip also shows the write goes through the host's
typed config service rather than a raw file edit.

Web search and quick actions were driven the same way. The host stored no
`ai.web_search`, so the section drew its default (`Exa (free MCP)`, "works without a
key"); pressing `Tavily` wrote `{"provider":"tavily"}` into `config/app.json` and the
credential rows appeared. Typing a key and pressing `Save key` created
`data/web-search/credentials.json` with one entry under the default id
`tavily-search-api` and a separate `credentials.key`; the config file still contained
no secret, and the row switched to `A key is stored for this provider`. `Remove`
deleted the entry and the file, and the row went back to `No key is stored`. The
composer's `Actions` menu listed the host's two stored quick actions (`Commit`,
`Create PR`) with their prompts.

Two MCP entries were written into the scratch profile's `config/app.json` under the
key the host actually reads (`mcp_servers`, holding a Cursor-format `{"mcpServers":
{…}}` document — a top-level `mcpServers` key is ignored, which the first attempt
proved by rendering an empty list) and the window was restarted. `MCP servers` then
listed both from the host: `probe-local · probe-local` with `stdio · /bin/echo` and
`probe-remote · probe-remote` with `streamable-http · https://example.invalid/mcp`,
each `Disabled` with `Enable` / `Edit` / `Enable and start` / `Restart` / `Delete`;
`Edit` opened the form prefilled from the stored entry (name and id, `Local command`
selected, `/bin/echo`, the `probe` argument, `Disabled` + `Started by hand`). Pressing
`Save` with unchanged values did not reach the host — `config/app.json` kept its
previous mtime — so the write path for this section is covered by the fixtures and by
the command shapes read from the host code, not by a real press; the physical click
that drives the rest of this surface was swallowed at that point, which is the same
limitation the terminal's Return key has.

That same session found a real layout defect: `Settings` did not scroll. Its
`<Scroll style={{ flex: 1 }}>` grew to its content's height (the AX tree reported a
3862-tall child inside a 977-tall pane) because a flex item keeps its content size
unless `minHeight` lets it shrink, so every section below `MCP servers` — the
`Application`, `Editor`, `Terminal`, `Workspace`, `AI execution`, `Diagnostics`,
`Session memory`, `Tools` and `Agent hooks` groups, and the second MCP row — was
unreachable in the real window while the fixture tests were happy. The five
full-height `Scroll`s (`Settings`, `Devices`, both `Files` panes, the session
transcript) now carry `minHeight: 0`, and the wheel scrolls the settings page in the
window.

`Log files` was then driven against the real host. `get_runtime_logging_info` answered
`Effective level debug` with the session folder
`…/.openbitfun/desktop-nsh/user/logs/20261118T070635` and its `app.log`, and the
previous run — killed with `SIGTERM` to restart the window on the new build — was
reported as `The previous run ended without shutting down (unclean shutdown)` with the
folder that still holds that run's log. `Export diagnostics bundle` wrote
`logs/diagnostics/openbitfun-diagnostics-20261118T070812.zip` (25 KB), the section
stated `Exported …` with that path, and `reveal_in_explorer` brought Finder forward on
it, which is the same command `Open log folder` uses. Both commands take a `request`
body, so they go through `invokeCommand` like the rest of the settings surface.

## Risks and open decisions

- NSH is at 0.6.x: APIs move, and `.nsh/types` is generated truth. Re-run
  `nsh check` after toolchain updates. Since 0.6 an app that declares
  `capabilities` must list `application` (main window, menus, tray, quit) and
  `homeDir` explicitly; `nsh.json` grants `application`.
- The web runtime is about 1 MB compressed; acceptable for a desktop window that
  loads from local files, and a cost to review before any web distribution.
- The native NSH host (`src/apps/desktop-nsh`) is the desktop client; the Tauri
  window that hosted the web target during the migration was retired. Capabilities
  it does not offer are listed above and refuse with an explicit state.
