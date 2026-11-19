# AGENTS.md

## Scope

This file applies to `src/nsh-ui`, the Native Shell (NSH) frontend of the
OpenBitFun desktop client. Use the top-level `AGENTS.md` for repository-wide
rules and [`docs/architecture/nsh-frontend.md`](../../docs/architecture/nsh-frontend.md)
for the architecture, the migration status and the feature-parity matrix.

## What this surface is

`src/nsh-ui` is a second frontend for the same desktop backend. It is an NSH app
(`nsh.json`, TSX entry `App.tsx`) packaged for NSH's web target and loaded in the
desktop window, so it reuses the existing Tauri command layer without changing a
single command. The React surface in `src/web-ui` stays the shipping one while
this one reaches parity.

Two rules follow:

- **The host contract is `src/web-ui`'s.** Action names and request shapes are
  the wire format the desktop already serves (`{ request: ... }`, sessions use
  `workspace_id`, workspace and file commands use `workspaceId`). Do not invent
  parallel command names; a shape change here means the two surfaces disagree.
  A command that takes positional arguments instead of a `request` struct is called
  through `invokeRawCommand`; both shapes exist in the same backend area, so read the
  command's own signature.
- **A scene is ported, not approximated.** When a feature is claimed as migrated,
  its scene calls the same commands the React surface calls, for the same state.
  A placeholder scene never counts as parity.

## Layout

- `host.js`: the page-side host module, the only code that talks to
  `window.__TAURI__`. It forwards `openbitfun.invoke` / `openbitfun.listen` /
  `openbitfun.unlisten` and pushes `openbitfun.event`. Without a native host it answers
  from development fixtures so the shell runs in a plain browser.
- `src/bridge.ts`: the app-side transport (`invokeCommand`, `invokeRawCommand`,
  `listenEvent`) and the window functions. Scenes never call `host` directly, and
  the bridge does not either: it runs over an injected backend connection
  (`src/backendConnection.ts`; default `src/hostPageConnection.ts` over `host.js`,
  the native desktop installs `src/jsonWireConnection.ts`) and an injected window
  shell (`src/windowShell.ts`; default the Tauri webview's, the native desktop
  installs `src/nshDesktopShell.ts`). Both are installed before `App.tsx` mounts
  (`installBackendConnection`, `installWindowShell`); see
  `src/apps/desktop-nsh/src/nativeTransport.ts`. A page served by a backend (its
  `index.html` carries `#nsh-params` `{obp}`) gets `src/webSocketConnection.ts`
  and `src/browserShell.ts` from `src/servedBackend.ts`, called first in `App.tsx`;
  it must never fall back to `host.js` fixtures. `src/backendResync.ts`
  re-hydrates on `backend://events-dropped` for every connection. A connection is generic: Tauri
  args in, seq-numbered event batches out, `ready()` and a connection state —
  nothing in it may assume NSH-native, Tauri or where the backend runs. Window,
  menu, tray, notification and picker work belongs to the shell. Peer envelope
  routing and the peer event tag filter live in `src/peerRouting.ts`
  (`backend-owned`: to be replaced by connecting to the peer's backend), and
  `src/textChunkCoalescer.ts` is `host.js`'s per-frame text-chunk merge for every
  other wire (`test/native-host.test.tsx` holds the two to the same output).
- `src/api.ts`: typed command wrappers. Keep the wire names and their casing.
- `src/format.ts`: text, date and count helpers shared by the scenes
  (`formatTokens`, `formatCount`, `formatPercent`, `formatBucket`, `formatBytes`,
  the turn and tool-call readers). Counts and tokens are grouped and scaled by hand
  rather than through `Intl`, so one surface renders the same text whatever the host
  locale is.
- `src/usageStore.ts`: the usage dashboard, one command read twice, as the desktop
  reads it. The range read decides the bucketing (`last24Hours` / `today` bucket by
  hour, the rest by day) and the resolved IANA zone travels with both reads, because
  the host aligns calendar ranges and buckets with it. Every number comes from the
  host: a failed read clears the totals to `null` instead of rendering zeroes, and the
  `token_usage_statistics_unsupported` marker an older Peer sends becomes its own
  sentence. The activity read asks the same command for `timeRange: "custom"` over a
  fixed six-calendar-month window at day granularity, then projects the host's buckets
  onto a Monday-first week grid: days outside the window stay empty padding, a day the
  host did not report stays at zero, and the five shades come from the busiest day in
  the window. Do not "smooth" that grid — every cell is one host bucket. It runs only
  after a successful range read (a host without the command loses both) and its own
  failure sets `usageActivityNotice` and leaves `usageActivity` `null`, so the section
  keeps its totals and states why the chart is missing. The distribution block reads
  the same answer's `byModel` / `byGroup` / `byEndpoint`: `usageDistribution` selects
  which list is drawn, `usageEntryFilter` narrows it by the row's primary and secondary
  text, `usageExpanded` lifts the five-row cap, and `usageDistributionRows()` /
  `usageVisibleRows()` are the only readers so both tabs cannot drift. `total` in
  `usageVisibleRows()` is the match count, not the list length, so a filter that
  matches nothing is told apart from a host that reports nothing. `chooseUsageDistribution`
  clears the filter and collapses, the way the desktop resets on a tab press, and
  `By endpoint` is a detail block that the filter does not narrow. Two habits this file
  must keep: never derive a number the host already sent, and key list rows
  positionally — the legacy `/unknown` endpoint legitimately repeats, so an
  identity key would drop rows the host did report.
- `src/contentWidthStore.ts`: the conversation column's width, the one appearance
  preference the desktop keeps in the page's local storage rather than the config
  (`openbitfun:appearance:flowChatWidth`, 900 px default, 600 px floor, 10 px step).
  The transcript and the composer both read `contentWidth()`, so the column stops
  there and centres itself; a stored value below the floor reads as unset, the way
  the desktop falls back instead of honouring a number its own stepper cannot reach.
  It is read once at launch, not when the settings page opens.
- `src/state.ts`: signals and loaders. NSH components run once, so state lives in
  signals, not in component state. It owns the 12-scene `SceneId` union
  (`home`, `sessions`, `assistants`, `agents`, `skills`, `routines`, `files`,
  `git`, `terminal`, `spaces`, `devices`, `settings`), workspace opening via
  `openPathWorkspace`, collapsible/resizable `NavPanel` & right `AuxPane`
  state (`drawerOpen`, `toggleDrawer`, `auxPaneOpen`, `auxPaneTab`,
  `auxPaneSide`, `auxPaneWidth`, `auxPaneMaximized`, `openInAuxPane`,
  `toggleAuxPane`), scene history/tabs (`navigateScene`, `canGoBack`,
  `canGoForward`, `goBack`, `goForward`, `openSceneTabs`), and cross-scene
  launch via `startQuickPromptInSession`. It
  also owns what a session runs as: `agentTypeOf(sessionId)` prefers the agent
  this surface bound (`sessionAgentTypes`), then the agent the host recorded
  for that session, then `chosenAgentType` — the agent a new session starts as.
  `sessionStarted` reads the host's `messageCount`, because that is the only
  proof a persisted session is not empty, and a row without a count counts as
  started.
- `App.tsx`: OpenBitFun Tauri 1:1 desktop shell featuring the collapsible and
  resizable `NavPanel` (back/forward navigation, `Search everything… ⌘K`,
  primary studio links `Home`/`Sessions`/`Assistants`, collapsible
  `STUDIO & WORKBENCH` group, unified `Workspaces` + grouped/flat `Sessions` +
  `SSH HOSTS` tree, `New workspace`, footer `Devices`/`Settings`, Appearance
  preset switcher, Remote/SSH menu), `SceneTopBar` + `SceneBar` open-scene tabs + right
  `AuxPane` toggles, inset rounded `SceneSurface` wrapping `<SceneTransition>`,
  resizable/swappable/maximizable right `AuxPane` (`Files`/`Git`/`Terminal`
  compact split), `BackendConnectionBanner`, `PeerBanner`, `SearchPanel`
  (`keymap.bind` `mod+k`, `mod+b`, `mod+j`, `mod+,`, `mod+n`), and mounted
  `<SshWorkspaceModals />`. The title bars take their drag behaviour from the
  shell (`titlebarDragRegionProps`: `desktop={{ windowDrag }}` in a native NSH
  window, a press-started drag in the Tauri webview); the menu and tray come
  from `startShellIntegration`, and shortcuts the native application menu
  carries (`shellMenuShortcutIds`) are not bound again with `keymap`.
- `src/ui/icons.tsx`: native `<Canvas>` + `Path2D` crisp 1.6 px vector icon library
  (`Icon`) and 5-variant expressive companion faces (`BotCharacter`: `"grok"`,
  `"muse"`, `"amber"`, `"mint"`, `"violet"`), reading `palette()` dynamically inside
  Canvas `draw` callbacks instead of CSS boxes or 2-letter monograms.
- `src/ui/motion.tsx`: layout and transition helpers (`animateLayout`,
  `enterMotion`, `SceneTransition` via NSH `<ShaderTransition>` `fallback="fade"`,
  and animated `Spinner`).
- `src/ui/overlays.tsx`: Layer-4 overlay system (`ModalDialog` centered inside a
  full-bleed `<Overlay>` wrapping `ModalHeader`, bounded scrollable `ModalBody`
  `<Scroll style={{ flexShrink: 1, minHeight: 0, maxHeight: 540 }}>`, and
  `ModalFooter`; anchored `DropdownMenu`, `ContextMenuOverlay`, searchable
  `SelectDropdown`, and `ToastHost` / `pushToast`).
- `src/ui/primitives.tsx`: reusable OpenBitFun Tauri UI primitives (`Button`,
  `IconButton`, `ActionButton`, `PillChip`, `SegmentedTabs`, `ToggleSwitch`,
  `SectionCard`, `ConfigSection`, `ConfigRow`, `Badge`, `KbdHint`, `StatusDot`,
  `StatusPill`, `AgentAvatar`, `TapOptionRow`, `FloatingPill`,
  `IconCircleButton`, `WorkbenchSwitcher`, `SplitHandle`, `EmptyStateCard`,
  `InlineConfirmBar`), built directly from NSH `View`, `Text`, and
  `Icon`/`BotCharacter` with `palette()` (`surface?: "canvas" | "chrome"`) and
  `textSize()` read inside JSX bindings so controls size and repaint cleanly
  across all 9 appearances without using `nsh/base`'s `Switch`, `Select`, or
  `AlertDialog`. Keep explicit `color: palette().text` and `placeholderColor` in
  `<Input>` `style` props and `itemStyle={{ color: palette().text, fontSize: textSize(12) }}`
  on `<Tree>` so populated text remains legible on Dark surfaces in Chromium.
- `src/sshRemoteStore.ts` + `src/ui/SshWorkspaceModals.tsx`: full OpenBitFun
  Remote Workspace stack (`NewWorkspaceModal`, `SshConnectionModal`,
  `SshAuthPromptModal`, `RemoteFileBrowserModal`, `PortForwardModal`).
  Positional `ssh_*` / `remote_*` commands call `invokeRawCommand`; structured
  `{ request }` commands (`ssh_start_port_forward`, `open_remote_workspace`,
  `close_workspace`, `open_workspace`) call `invokeCommand`. Remote SSH/Docker/WSL
  workspaces never fall back to local `open_workspace`.
- `src/modelDiscoveryStore.ts`: the request URL preview the host computes
  (`resolve_ai_model_request_url`, cached per input), remote `/models`
  discovery (`list_ai_models_by_config`; transient configs carry no
  `request_url`, the host derives it) with stale-reply coordination, batch
  import as one `ai_model_upsert` intent (the host mints ids and clamps each
  output limit), endpoint testing (`test_ai_config_connection`), and
  subscription account/quota loading (`list_subscription_accounts`,
  `get_subscription_account_quota`).
- Settings writes are typed intents (`src/settingsMutations.ts`): models
  (`ai_model_upsert` / `ai_model_delete`), task models (`set_task_model`),
  permissions (`set_permission_mode`, `upsert_permission_rule` /
  `delete_permission_rule` naming the rule they expect at that index,
  `set_approval_settings`), web search (`set_web_search_provider`) and ACP
  (`set_acp_client_permission_mode`); each answers with the updated view. Field
  bounds and defaults come from `get_settings_schema`, the language goes through
  `i18n_set_language`, single values are leaf `set_config` writes, and a file
  save sends `expectedHash` (the host's `FILE_CONFLICT` becomes Overwrite /
  Reload). No store writes back a document it read earlier; a host without one
  of these commands gets the "update the host" sentence, never a fallback.
- `src/agentModeStore.ts`: the agent picker behind the composer. The rules are the
  host's: `get_session_mode_catalog` answers the entries in draw order (the four
  harness profiles, then the agents and external ACP agents the host resolves, with
  `claw` / `multitask` / `plan` left out and retired aliases resolved), which entries
  the open session may switch to (`switchable`: a session that already ran a turn
  keeps its agent) and the `defaultModeId` a new session starts as, resolved from
  `app.flow_chat`. A switchable press is written with `update_session_mode`, which
  refuses a started session (`session_mode_locked`) and records the pick as
  `last_mode_id`; a non-switchable press offers a new session in that agent. A pick
  made with no session open is recorded when the session created with it opens. A
  host without the catalog command gets its `get_available_modes` rows as listed,
  with a notice that ordering and defaults need an update — the store never
  re-derives the rules.
  `manualTerminalProfileService` records bind a profile to a chat session, which is
  not what a tab is here, so they are read by neither surface.
- `src/sessionStatusStore.ts`: the mark a session row shows — running, waiting for
  approval, queued, last turn failed, not read yet. Running, approval and queued come
  from live events and the host queue; unread and failed are the host's (`unread` /
  `failed` in the session page's activities, derived from its unread receipt), and
  opening a session acknowledges that receipt with `mark_session_seen`. Nothing is
  kept in local storage; the stamps older builds stored under
  `openbitfun.nsh.session-seen.v1` are handed to the host once per session (with
  `seenThroughMs`) and then removed.
- `src/permissionStore.ts`: the approval prompt. `subscribe_permission_requests`
  plus `list_pending_permission_requests` seed it, `permission://event` keeps it
  current, and `respond_permission` answers. It stays silent when a host has no
  permission plumbing instead of reporting an error on every launch.
- `src/userQuestionStore.ts`: the `AskUserQuestion` prompt, which blocks the tool
  call the same way an approval does. `backend-event-toolawaitinguserinput` adds
  one and `get_session_interaction_mailbox` recovers the one whose event was
  missed, per session, on open; `start_user_question_interaction` reports it as on
  screen once per tool id, which is what starts the host's own answer deadline.
  Answers leave as `submit_user_answers` through `invokeRawCommand` —
  `{ toolId, answers, sessionId }` are separate arguments, and `answers` maps the
  question index to a label or a list of labels. A mailbox read only drops prompts
  older than the read (`seenAt`), because a question that arrives while it is in
  flight cannot be in the snapshot.
- `src/sendPolicyStore.ts`: the mid-turn send policy setting,
  `app.flow_chat.send_during_turn` (`immediate` steering or `queue`), read for the
  composer's labels and written by Settings. The composer does not apply it: every
  send is `submit_user_message`, where the host applies the policy and answers
  `started` / `steered` / `queued`; the secondary mid-turn button sends an explicit
  `sendDuringTurn` for that one message. A host without the command still starts a
  turn on an idle session and answers a mid-turn send with an "update the host"
  notice instead of guessing.
- `src/webSearchStore.ts`: the web-search provider and its key. `ai.web_search` is
  read as one document and written back whole, so a provider this surface does not
  draw and unknown fields of a drawn one survive; the key is not part of it —
  `get_web_search_credential_status` / `save_web_search_credential` /
  `clear_web_search_credential` move it through the device vault, and the scene
  states only what the host answered last.
- `src/quickActionStore.ts`: `app.ai_experience.quick_actions`, the list the
  composer's `Actions` menu runs. Every write re-reads `app.ai_experience` and merges,
  because other sections write `voice_input` and the neighbouring switches into the
  same object; a disabled action stays in the list and out of the menu.
- `src/queueStore.ts`: messages the host holds until the running turn finishes.
  The host owns the queue (`manage_dialog_queue`: `list`, `cancel`, `promote`,
  `reorder`; messages enter it through `submit_user_message`), so the panel draws the
  host's snapshot and the host drains it. `moveQueued` re-reads a snapshot before it
  reorders, because `supportsReorder` is answered per reply and never inferred from a
  version, and it names that read's `revision` so a queue another surface changed in
  between is refused instead of overwritten. Rows the host holds back keep the host's
  `status` and `reason`. There is no local fallback: a host or peer without the
  queue gets an explicit "update the host" line while a turn runs. Rows older builds
  kept under `openbitfun.nsh.pending-queue.v1` are submitted to the host queue once
  and the key is removed only when every row was taken.
- `src/mcpStore.ts`: MCP servers. `get_mcp_servers` lists them and
  `start` / `stop` / `restart` / `delete_mcp_server` act on one at a time; the
  configuration is the stored Cursor-format document, read with
  `load_mcp_json_config` and written with `save_mcp_json_config` against that
  document's fingerprint, so a change another surface made meanwhile is refused
  (`changed elsewhere`) instead of overwritten. The form merges into a copy of the
  stored entry — a field it does not draw survives — and a new entry is forced
  `enabled: false`; an entry the form cannot express opens the whole-document
  editor instead of being rewritten. `mcpJsonState` reports `Saved` /
  `Unsaved changes` / `Not saved`, because a refused save must not read as saved.
  Note that the host stores this under `mcp_servers` (a document wrapping
  `mcpServers`), not under a top-level `mcpServers` key.
- `src/mcpStore.ts` also owns the remote OAuth panel: `openMcpAuth` /
  `closeMcpAuth` per server id, `startMcpRemoteOAuth` (`start_mcp_remote_oauth`)
  followed by a one-second `get_mcp_remote_oauth_session` poll that stops on
  `authorized` / `failed` / `cancelled` and refreshes the list after `authorized`,
  `cancelMcpRemoteOAuth`, and the authorization-value route
  (`update_mcp_remote_auth` / `clear_mcp_remote_auth`) for a server without OAuth
  discovery. The address is opened with the surface's `openUrl`; when that fails,
  `mcpOAuthUrlUnopened` makes the panel show the address with `Copy address` rather
  than losing it. Rule that bit here: `<If when={…}>` passes the condition value to
  its child, so a boolean condition renders `true` — test presence with
  `when={value ?? ""}` and a non-empty string.
- `src/mcpStore.ts` also owns the pasted-configuration import: `openMcpImport` /
  `setMcpImportText` / `previewMcpImport` / `updateMcpImportCandidate` /
  `importMcpServers`. Preview reads the pasted text through `draftFromEntry`, the
  same reader the edit form uses, so an entry this surface could not draw is marked
  `Unsupported` with its reason and stays out of the write; an id the document
  already holds starts unselected. The import is one `save_mcp_json_config` of the
  document with each added entry forced `enabled: false`, and the result is reported
  in `mcpNotice` because the panel closes on success.
- `src/mcpResourcesStore.ts`: what one connected server publishes.
  `openMcpResources(serverId)` sets the panel and reads `list_mcp_resources` once;
  `loadMcpResources` is the same read with `refresh: true`, because the reason to
  press `Refresh` is that the server changed. `mcpResourceVisibleRows` filters by
  name, URI or description in memory, so typing never costs a round trip. Rows carry
  their list position as `slot` (the scene keys the chips by it rather than by a URI
  that may hold `:`), and `openMcpResource` renders `read_mcp_resource`: one content
  prints its media type, several name themselves, a `blob` is reported as binary
  instead of decoded, and a failed read is a message under the selected row. Of the
  two commands the desktop's API exposes here, the prompts commands are not called at
  all — the desktop's own surface does not draw them either.
- `src/poolStore.ts`: model pools (`get_model_pools`, `save_model_pool` with an
  empty id to create, `delete_model_pool`, `get_model_pool_status`). `ensurePools`
  reads them once; the scene renders the host's document, never the draft. Its
  bindings read `poolStatuses()` / `poolDraft()` inline, because a signal read into
  a `const` in a component body is a snapshot: an NSH component runs once.
- `src/globalSearchStore.ts`: the one search field. It answers from three host
  sources — session names, the host's message hits (`search_session_content`)
  and workspace files (`search_files`) — plus this surface's own commands behind
  a leading `>` (`>home`, `>sessions`, `>assistants`, `>agents`, `>skills`,
  `>routines`, `>files`, `>git`, `>terminal`, `>spaces`, `>devices`, `>settings`,
  and `New session`). Two rules matter here: typing is debounced by 220 ms
  because the message and file reads are host round trips, and every run takes a
  ticket so a late answer from an older query cannot overwrite a newer one. A
  failing source is collected into `searchNotice` and the other groups still
  render, because a search that returns nothing because one provider refused is
  worse than a partial answer. `mod+k` opens the panel. Groups cover actions,
  settings, sessions, messages, files, workspaces and assistants across the
  opened workspaces; file search on a remote workspace answers as unsupported
  rather than searching locally, and a message hit publishes `searchRevealTurn`
  so the Sessions scene scrolls to that turn once it is loaded.
- `src/modelStore.ts`: the composer's model and reasoning choices. Two rules are
  worth keeping: a model change carries the session's current reasoning preset only
  when the new model is known to declare it (the host validates the pair, so an
  unknown preset fails the whole change), and `null` is written explicitly — it
  means "the model's own default", which is not the same as leaving the field out,
  as a host too old to report the setting does.
- `src/settingsStore.ts`: the settings table (`SETTINGS_SECTIONS`), the values read
  per path, and the writes. Every field writes its own dotted leaf path
  (`app.auto_update`, `editor.font_size`, `app.ai_experience.enable_workspace_search`);
  never patch a parent object (`app`, `app.ai_experience`) from a load-time snapshot,
  because a leaf written since then (by another row or another store such as quick
  actions) would be silently reverted. A field the host
  may not have stored yet carries `FieldSpec.defaultValue` — the value the host
  would use — so the row is readable and writable instead of empty, the section says
  `The host stores no value yet; these are its defaults.`, and the first edit creates
  the path. Do not read such an object once at mount and treat its absence as a
  failure. Three things the table needs beyond a plain scalar live here too:
  `kind: "model"` draws a dropdown whose values are an enabled chat model id, the
  product's two roles or `null` (an id the host no longer configures is marked
  instead of reading as "follow"); `maxPath` lets a stored sibling lower a
  field's own maximum, which is how the memory extraction window is capped by the
  retention; and `memoryWindowRefusal` refuses that pair when it would invert. A row
  whose save button text is long must not be given a fixed-width container: the
  button takes the whole row and the `Input` beside it ends up zero-width, which a
  headless test reports as `no input matches` rather than as a layout problem. The
  keyboard-shortcut row is read-only by design: this front end has no shortcut
  registry, so it prints the count of stored `app.keybindings` overrides and says
  why it offers no editor rather than writing keys nothing here consumes.
- `src/scenes/*`: one scene per product area. `src/terminalStore.ts` owns the
  single terminal session for the app run and replays `terminal_get_history`
  before live output, dropping live events at or below the replayed cursor. A tab
  opened without a name follows the title the shell sets (`terminal_event`
  `TitleChanged` or the widget's `onTitleChange`); one a profile named keeps it.
- A message body is Markdown, drawn by `TextView` from `nsh/base` rather than by a
  `Text`: it is the reader the desktop's transcript uses too, so headings, code
  blocks and tables arrive as blocks, and a streamed reply is reparsed in place
  instead of restarting. The streaming caret stays off because it is a placeholder
  character inside the text, which a copied selection would carry.
- `src/theme.ts`: the app's own palette as a `computed` signal (`palette().text`
  in a binding, never destructured once). Mirrors OpenBitFun Tauri's 5-plane
  surface hierarchy (`chromeBg`, `chromeText`, `chromeTextMuted`, `chromeHover`,
  `chromeActive`, `chromeBorder`, `chromeInputBg`, `chromeAccent` for `NavPanel`,
  plus `canvas`, `canvasSubtle`, `panelRaised`, `surfaceElevated`, `popoverBg`,
  `inputBg`, `shadowScene`, and semantic tokens for the inset `SceneSurface`) and
  all 9 built-in `APPEARANCE_PRESETS` (`Dark`, `Light`, `Monochrome`, `Slate`,
  `Midnight`, `Ink & Paper`, `Night Ink`, `Cyber`, `Tokyo Night`) switched via
  `selectAppearancePreset` (`openbitfun.nsh.appearance-id.v1`). `src/themeStore.ts`
  holds the light/dark/system scheme, applies it through `setColorScheme` — which
  the host also uses for native widgets — and remembers it in
  `openbitfun.nsh.appearance.v1`.
- `src/fontPreferenceStore.ts`: the host's font baseline, the one appearance
  setting the frontends share. It is the `font` config (`{ uiSize: { level,
  customPx? } }`): five presets at 12–16 px and `custom` in 12–20, read once at
  launch and written whole by the desktop's own rules (`custom` keeps `customPx`,
  a preset drops it, a step off a preset becomes `custom`). The scale reaches the
  scenes through `textSize(base)` in `src/theme.ts`, which reads the baseline
  inside the style binding. **Every text size in this surface goes through
  `textSize`, never a raw px** — a literal opts that text out of the setting, and
  the surface would then grow unevenly.
- `src/peerState.ts` + `src/peerStore.ts`: Peer Device Mode. The signals live
  apart so `bridge.ts` reads the selected device without importing the store
  that calls it. `invokeCommand` routes product commands to that device over
  `account_device_rpc` (positional camelCase args `targetDeviceId`, `commandJson`,
  `timeoutMs` matching Tauri v2's default command parameter mapping), wrapping them
  in a HostInvoke envelope with `args.request`;
  `invokeRawCommand` takes the same route with its positional arguments at `args`'
  top level and no `request` — a positional command must never fall back to this
  machine while a peer is selected. The scope keeps the
  capability map the ping advertised, and `peerSupports` is the only reader of it:
  `undefined` means the host never stated that capability, which is not a `false`,
  so a store probes once instead of assuming either way. `reconnectPeer` re-runs
  the handshake for the device already being driven and never leaves peer mode.
- `src/generated/peerSurface.ts`: generated by `pnpm run capabilities:generate`
  from the Product Operation Registry. It lists the commands that stay on this
  machine while a peer is driven — never edit it by hand, and regenerate after
  changing `remote_surface/table.rs`.
- `test/support.ts`: the simulated backend the headless tests play as host; file
  mutations act on a mutable directory map, so a create, rename or delete changes
  what the next `explorer_get_children` returns, and `account_device_rpc` answers
  as a second host whose workspace and session names differ from the local ones.
  A command a surface reads more than once can be answered per request shape:
  `get_token_usage_statistics` returns `usage` for a range and `usageActivity` for
  the `custom` six-month window, where `usage: null` means this host offers the
  command not at all and `usageActivity: null` means it takes the range and refuses
  the window — the difference the usage section must survive. Sessions carry their
  `agentType`, `update_session_mode` rewrites it the way the host does (and is
  recorded in `sessionModeWrites`), `create_session` puts the new session into the
  catalogue the surface reloads with no turn yet, and `agentModes: null` means this
  host has no `get_available_modes` at all. `search_files` answers from the virtual
  file map, and `fileSearch: false` makes the host refuse it. `fontPreference` is
  the `font` document the host stores, with `null` for one that stores none; absent
  keeps the default.

- `test/sessions-ux.test.tsx`: Personal Agent Welcome Studio starter cards,
  Muse 3-layer transcript timeline/thinking/progress/ambient states, elevated
  permission trust card interactions, floating composer controls, close-tab
  `"×"` invariant, and dark/light scheme repainting.
- `test/personal-hub.test.tsx`: `HomeScene` ecosystem pulse counts, live
  attention feed, 30-day usage, quick prompt launch, GitHub device-flow auth,
  AI Insights loading/generation, partial pulse failure degradation,
  `AssistantsScene` CRUD + Persona Studio (`IDENTITY.md`/`SOUL.md`/`USER.md`)
  editing/preview/reset, and Peer Device Mode boundaries.
- `test/agents-skills.test.tsx`: `AgentsScene` & `SkillsScene` command-shape
  assertions (`raw: true` vs `raw: false`), custom mode/subagent CRUD, built-in
  profile tool configuration/reset, `Start Thread` handoff, global skill
  toggles, `SKILL.md` inspection, local folder validation/install/delete,
  marketplace search/download, and remote/Peer local-install gating.
- `test/routines-git-spaces.test.tsx`: `RoutinesScene` cron CRUD +
  `cron://jobs-changed` event refresh + Peer `reportPolicy` omission,
  `GitScene` trust/init recovery, working copy staging/unstaging/AI commit,
  branches CRUD, history graph local vs remote `git_get_graph` skip, and
  `SpacesScene` list/inspect/stop-worker/delete/create + Peer notice.
- `test/workbench-connectors.test.tsx`: `FilesScene` live edit + `write_file_content`
  persistence, open file tabs & `file-actions-menu`, `AuxPane` compact mode,
  `DevicesScene` Telegram/Feishu/WeChat QR/LAN & Server Relay modals + Peer
  `Controller local` badge, `SettingsScene` `NavPanel` category filtering, live URL
  resolution, `list_ai_models_by_config` discovery + 40% `max_tokens` batch save,
  `test_ai_config_connection`, subscriptions, 9 `APPEARANCE_PRESETS`, and
  `TerminalScene` light-scheme canvas background + shell/profile modals.
- `test/ssh-remote.test.tsx`: `NewWorkspaceModal` (assistant vs local/remote project
  creation), `SshConnectionModal` (`~/.ssh/config`, Docker, WSL, test stages, saved
  profiles, auth repair), `RemoteFileBrowserModal` (POSIX navigation, mkdir, rename,
  delete, rebind conflict, CLI fallback), and `PortForwardModal` (`raw: true` vs
  `raw: false` payload checks).
- `test/external-import.test.tsx`: `Settings → External import` request shapes
  (discovery snapshot, switch mutation and revision, MCP plan/apply with the
  `stale` outcome, removed-session list and restore), the older-host fallback,
  a failed read, the remote-workspace refusal and Peer Device Mode.
- `test/assistants-studio.test.tsx`: the assistants gallery and config page
  (avatar picker, in-place name edit preserving the other frontmatter fields,
  failed identity write, the assistant's sessions) and primary-first ordering.
  All `test/*.test.tsx` suites wrap `createBackend().handlers["openbitfun.invoke"]`
  or `createDeviceBackend()` locally without modifying `test/support.ts`.

## Commands

```bash
export PATH="$HOME/.nsh/bin:$PATH"        # nsh is installed outside PATH here

cd src/nsh-ui
nsh check                                 # type check (generated .nsh/types)
nsh test App.test.tsx                     # core headless regression suite (104 tests)
nsh test .                                # all headless suites (App.test.tsx + test/*.test.tsx)
nsh test test/sessions-ux.test.tsx        # or a single scene suite under test/
nsh run . --target web                    # dev server on http://127.0.0.1:8790
nsh package . --target web                # static site in .nsh/out/OpenBitFun
```

Desktop window with this frontend instead of the React one:

```bash
nsh run src/nsh-ui --target web           # from the repository root, first terminal
cd src/apps/desktop && cargo tauri dev --config ../../nsh-ui/tauri.nsh.conf.json
```

`tauri.nsh.conf.json` loads `devUrl` (`http://127.0.0.1:8790`) in the dev window. The
page `nsh run` serves did not load in the webview here, so the reliable channel is
the packaged site on that same port, with the desktop build started against it:

```bash
cd src/nsh-ui && nsh package . --target web
cd src/nsh-ui/.nsh/out/OpenBitFun && python3 -m http.server 8790
# from the repository root, with a scratch profile so the installed app is untouched
OPENBITFUN_NONINTERACTIVE=1 \
OPENBITFUN_HOME="$PWD/.openbitfun/desktop-nsh/home" \
OPENBITFUN_USER_ROOT="$PWD/.openbitfun/desktop-nsh/user" \
  ./target/debug/openbitfun-desktop
```

A rebuild there is `nsh package` plus a window restart; the workspace list must
be the machine's own (`transportKind()` reads `tauri`), or the window is talking
to fixtures and proves nothing.

The native desktop (`src/apps/desktop-nsh`) mounts this same `App.tsx` over the
in-process backend; `test/native-host.test.tsx` runs it headless through
`test/fixtures/nativeApp.tsx`, which installs the same JSON wire connection and
NSH desktop shell with the wire carried over `openbitfun.wire*` host calls.

## Verification

- UI, transport and request-shape changes: run `nsh check`, `nsh test .` (runs
  `App.test.tsx` plus every scene suite under `test/`, among them
  `test/sessions-ux.test.tsx`, `test/personal-hub.test.tsx`,
  `test/agents-skills.test.tsx`, `test/routines-git-spaces.test.tsx`,
  `test/workbench-connectors.test.tsx`, `test/ssh-remote.test.tsx`,
  `test/external-import.test.tsx` and `test/assistants-studio.test.tsx`; each test plays the embedding host through
  `openbitfun.invoke`, so request shapes are asserted).
  The harness drives more than presses and typing: `submit`, `clear`, `value`,
  `keyboard`, `scroll`, `clipboard`, `screenshot` and `waitUntil` exist on `app`
  too, so "no test can reach this" is worth checking against that list before it is
  written down. `app.submit(field)` is what a Return on a field does, and it is how
  the composer's send-on-Return is covered.
- Bridge changes (`host.js`, `src/bridge.ts`, the connections and shells): run
  `test/native-host.test.tsx` and `test/real-tauri-contracts.test.tsx`, and run
  the desktop window once to confirm it reaches the real host, not fixtures.
- `nsh run` compiles the host module at startup and only rebuilds the app bundle
  after that: restart the dev server after editing `host.js`, or the window keeps
  calling into the old module (`no host function …`).
- `nsh test --target web` runs the same tests in a real browser.
- NSH has no pre-1.0 API stability: pin nothing, but re-run `nsh check` after a
  `nsh update`, and treat `.nsh/types` as generated truth.

Driving the real window (macOS, `ComputerUse`): the accessibility tree carries exact
frames, so click the centre of the frame you read (`(x, y, w, h)` → `x + w/2`,
`y + h/2`) rather than guessing from where the text sits; a captured window image is
offset from the screen origin, so a press from the image alone lands short. Background
delivered clicks (`app_click`) are regularly dropped on the first try in this webview:
move the real pointer to the target, take a screenshot (a capture is also what
re-arms the next press — otherwise the tool answers `STALE_CAPTURE`), then press. A
press that lands on an in-scene view is what makes a scene test able to reach the
host, so verify each migrated area once this way.

When the pointer press does not land at all, the keyboard does: a view with
`role="button"` takes the focus where Tab stops at it, so `Tab` until the
accessibility tree reports the row `[focused]` and then `Return` on it. The reference
picker was verified that way — the physical press opened the panel, the press on a
result row was dropped, and `Tab` + `Return` put the tag in the composer. Re-run the
press twice before concluding the view is unreachable.

The one channel that works without any press is text: `app_type_text` with
`focus: { kind: "node_idx", idx }` on a node the tree reports as `text field` or
`text entry area` focuses it and injects what it is given, and this is what drove
build 71's global search (the sidebar field opened the panel, `notes` reached the
panel's own field, `search_files` answered with the workspace's `notes.md`). Three
things make that channel mislead. A view that is not an input is reported as
`button` and cannot take text — a `readonly` `Input` collapses to `button` in this
tree even though it is focusable in the page, so give a field that only opens
something no `readonly`. `app_type_text` appends, it does not replace, so a second
call continues the query (`terminal` then `new` reads `terminalnew`) and checking a
different query means restarting the app. And `app_key_chord` does reach the
webview after all: a `tab` chord is enough to make the tree expose its controls
(96 nodes here, and a later `tab` collapses it again), and a `return` chord sent to
a focused composer submitted the turn — the transcript showed the host's own
`Failed to start dialog turn: AI client model…` answer. So a key that is a plain
text or submit key works here; what does not is a window-level shortcut such as
`command+R`, and that is a platform limit (no app-level key registration), not a
reason to say the keyboard never arrives.

## Rules specific to this surface

- Logs are English, no emojis, as everywhere in this repository.
- Never call `window.__TAURI__` outside `host.js`; the app realm does not have it
  and the NSH test runtime does not either.
- Read state through signals in JSX. Reading a signal in a component body runs
  once and does not follow changes. The palette is one of them: bind
  `palette().accent`, and a scheme change repaints.
- A scene that needs the active workspace must wait for it in an `effect`, not
  call its loader once at mount: the workspace list arrives after the first
  render, and a one-shot load then reads an empty workspace.
- Native dialogs (`nsh/base`'s `AlertDialog`) are avoided for destructive
  confirmations: they cannot be driven by the headless tests, and a remote
  controller cannot answer them. Confirm in the scene instead. The same reasoning
  keeps permission prompts in the session scene rather than in an OS dialog.
- `nsh/base`'s `Switch` and `Select` lay out at their intrinsic size on
  the web target (an 8×5 toggle, an invisible choice list). Draw toggles and choice
  chips from views until upstream sizing is fixed. `Input` is usable for text and
  secret fields when it is given a visible box; `value` plus `masked` renders a
  password entry (the web target reports it as a secure text field), which is how the
  model key and the web-search key are entered. Verify any base widget in the real
  window before relying on it.
- `<If>` and `<Each>` are NSH globals; importing them is an error.
- `Each`'s `key` callback receives the raw item (`option.label`), while the children
  callback receives a thunk (`option().label`) — mixing the two is a type error that
  reads like a wrong prop name. `Input`'s `onChange` receives an event object, so the
  value is `event.value`, not the string.
- A widget that leaves its background to the host needs a themed surface behind it.
  `Terminal` draws cells in the view's foreground and paints nothing, so a fixed dark
  panel around it made the prompt invisible in the light scheme; the scene uses
  `palette().canvas`. Check any new widget in both schemes.
- Synthesized `Return`, `Backspace` and arrow keys do not reach `Terminal.onData` in
  this webview, so "press Return to run what I typed" cannot be verified by
  automation. The bytes path is verifiable another way — a terminal profile's startup
  command arrives as `terminal_write` with its newline and runs in the shell — so
  claim the write path from that, and leave the widget's key handling to a human.
- Keep `host.js` free of imports: NSH copies the host module as it is, so it
  cannot resolve a relative import.
- A full-height `Scroll` needs `{ flex: 1, minHeight: 0 }` on the web target: a flex
  item keeps its content height otherwise, so the scroll view grows with its content,
  never scrolls, and pushes everything below the fold out of reach while the fixture
  tests still pass. `Settings` shipped like that for a while; check any new scrolling
  pane by scrolling it in the real window, not only in a test.
- Check every command's argument shape against its Rust signature, not against the
  neighbouring call. Some commands take one `request` struct (`invokeCommand` wraps
  the body in `request` for them) and some take positional arguments, which need
  `invokeRawCommand`. Getting this wrong is silent in a fixture that accepts either
  shape and fails only on a device, which is how the MCP lifecycle commands and
  `delete_mcp_server` were both wrong at once; the fixture now rejects the shape that
  does not match.
- `cleanup()` (from `nsh`) is how a scene releases what it started — a poll, a
  subscription, a timer. A component body runs once, so nothing else will run at
  unmount.
- A settings field whose `path` names an object and whose `field` names a key inside
  it is written by read-modify-write: the whole stored object goes back after the one
  key is patched. That is right only when the object holds values this surface does
  not own and must merge (the `app.ai_experience` quick-action list, `tool_permissions`
  rules). A plain switch or scalar gets its own dotted leaf path
  (`app.ai_experience.enable_git_commit_coauthor`) so a press cannot rewrite a sibling
  it never drew.
