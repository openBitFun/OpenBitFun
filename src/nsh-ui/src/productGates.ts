// Product gates: UI entry points switched off by an owner decision. A gate
// hides UI only. The backend, the server, the stores and the scenes behind it
// stay in the tree unchanged, so turning a gate back on restores the surface
// as it was.

import { signal } from "nsh";

/**
 * Super Agent (the account's cloud agent, the `openbitfun` scene and every
 * `superagent_*` command) is OFF by owner decision (wave 23): it confused
 * users, and the app returns to the Tauri-era layout, a sidebar of the
 * account's devices → workspaces → sessions that opens on the session view.
 *
 * To turn it back on, set `SUPER_AGENT_UI_DEFAULT` to `true`. Nothing was
 * deleted; every entry reads `superAgentUi()`:
 * - shell (`App.tsx`): the sidebar row and conversation history, the phone
 *   tab and ☰ history drawer, ⌘N as "new conversation", the ⌘K command, and
 *   the `openbitfun` scene itself (`resolveSceneAlias` sends `openbitfun` and
 *   `home` to the session view while it is off);
 * - `superagentStore.ts`: the store never starts and refuses every call, so
 *   no `superagent_*` command leaves this UI;
 * - Settings: Account › Super Agent and the per-device `superagent.*`
 *   switches (they only make sense next to the entry);
 * - Inbox items that belong to a Super Agent conversation, the session
 *   header's "Started by Super Agent" line, the device page's Super Agent job
 *   rows and capability, and the sign-in copy that names it.
 *
 * Tests that cover the Super Agent surface switch it on with
 * `superAgentUi.set(true)` before opening the app.
 */
export const SUPER_AGENT_UI_DEFAULT = false;

/** Whether the Super Agent UI is shown (see `SUPER_AGENT_UI_DEFAULT`). */
export const superAgentUi = signal<boolean>(SUPER_AGENT_UI_DEFAULT);
