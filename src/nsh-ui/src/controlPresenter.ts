// The OpenBitFunControl presentation adapter: when the Agent asks to open a
// product surface ("open the MCP settings", "show the Git panel"), the host
// emits `agentic://openbitfun-control-request` and waits for the surface that
// declared itself ready to answer with `report_openbitfun_control_result`.
//
// The host owns discovery, validation, state reads and mutations (the native
// ProductControl executor shared with the Agent) and resolves where a request
// leads: the request carries the catalog `destination` (settings page and
// view, scene, product action or event). This module only maps a destination
// onto this UI's own screens. A destination this UI has no screen for is
// answered with a failure that names it, never with a silent success, so the
// Agent can tell the user what did not open.
//
// Only a surface running next to its backend presents (the native desktop
// window or the local page host): a page served to a phone or browser over OBP
// never declares itself ready, so the desktop window stays the one that opens
// what the Agent asked for. Persisted effects (`openbitfun-control-effect`,
// language and appearance changes made through the executor) are applied to
// the live UI and acknowledged; non-transactional changes
// (`openbitfun-control-applied`) re-read the settings values.

import { invokeCommand, listenEvent } from "./bridge";
import { syncLocaleFromHost } from "./i18n";
import { servedBackendParams } from "./servedBackend";
import { loadSettingsValues } from "./settingsStore";
import { navigateScene, type SceneId } from "./state";
import { APPEARANCE_PRESETS, selectAppearancePreset, type AppearanceId } from "./theme";
import { applyLocalAppearance } from "./themeStore";
import { controllerPort } from "./controller/controllerPort";

const REQUEST_EVENT = "agentic://openbitfun-control-request";
const APPLIED_EVENT = "agentic://openbitfun-control-applied";
const EFFECT_EVENT = "agentic://openbitfun-control-effect";

/** A catalog destination, as `ProductCapabilityDestination` serializes it. */
export type ControlDestination =
  | { kind: "settings"; pageId: string; viewId?: string; sectionId?: string }
  | { kind: "action"; actionId: string }
  | { kind: "scene"; sceneId: string }
  | { kind: "event"; eventName: string; detail?: Record<string, unknown> };

export interface ControlRequest {
  requestId: string;
  action: "list" | "search" | "get" | "open" | "execute" | "configure";
  capabilityId?: string;
  itemId?: string;
  operationId?: string;
  destination?: ControlDestination;
}

interface ControlEffect {
  requestId: string;
  phase?: "commit" | "rollback";
  capabilityId?: string;
  changedPaths?: string[];
  value?: unknown;
}

/** What the shell does for the destinations that are actions rather than screens. */
export interface ControlPresenterActions {
  openSettingsPage(pageId: string, anchor?: string): void;
  openFolder(): void;
  newWorkspace(): void;
  newSession(): void;
}

/**
 * Catalog settings pages (the desktop's page ids, frozen in
 * `src/shared/interactive-capabilities/destinations.json`) onto this UI's pages
 * and, where the catalog names a view or section, the section to reveal.
 */
const SETTINGS_PAGES: Record<string, { page: string; anchor?: string }> = {
  "application.general": { page: "general" },
  "application.appearance": { page: "appearance" },
  "application.input": { page: "input", anchor: "input" },
  "application.voice": { page: "input", anchor: "input" },
  "application.shortcuts": { page: "input", anchor: "shortcuts" },
  "application.editor": { page: "editor" },
  "development.editor": { page: "editor" },
  "application.terminal": { page: "terminal" },
  "development.terminal": { page: "terminal" },
  "development.workspace": { page: "workspace" },
  "workspace.worktrees": { page: "workspace" },
  "ai.models": { page: "models" },
  "ai.permissions": { page: "permissions" },
  "ai.memory": { page: "session-memory", anchor: "memory" },
  "ai.session-memory": { page: "session-memory" },
  "workspace.session": { page: "session-memory", anchor: "session" },
  "ai.execution": { page: "execution" },
  "tools.execution": { page: "execution" },
  "tools.desktop-control": { page: "desktop-control" },
  "tools.automation": { page: "automation" },
  "tools.webSearch": { page: "web-search" },
  "tools.web-search": { page: "web-search" },
  "tools.mcp": { page: "mcp" },
  "tools.acp": { page: "external-agents" },
  "tools.external-agents": { page: "external-agents" },
  "tools.external-import": { page: "external-import" },
  "data.storage": { page: "storage" },
  "data.usage": { page: "usage" },
  "data.diagnostics": { page: "diagnostics" },
};

/** Catalog views and sections this UI draws as a section of the page. */
const SETTINGS_ANCHORS: Record<string, string> = {
  "quick-actions": "quick-actions",
  hooks: "agent-hooks",
  "message-sending": "send-policy",
  shortcuts: "shortcuts",
  memory: "memory",
  session: "session",
  "workspace-search": "workspace-search",
  git: "git",
};

const SCENES: Record<string, SceneId> = {
  "personal-overview": "home",
  session: "sessions",
  assistant: "assistants",
  git: "git",
  terminal: "terminal",
};

const ACTION_SCENES: Record<string, SceneId> = {
  "surface.agents.open": "agents",
  "surface.files.open": "files",
  "surface.terminal.open": "terminal",
  "surface.browser.open": "browser",
  "surface.skills.open": "skills",
  "surface.miniapps.open": "spaces",
  "surface.todos.open": "routines",
};

const EVENT_SCENES: Record<string, SceneId> = {
  "openbitfun:open-remote-connect": "devices",
};

function describe(destination: ControlDestination): string {
  switch (destination.kind) {
    case "settings":
      return `settings page ${destination.pageId}`;
    case "action":
      return `product action ${destination.actionId}`;
    case "scene":
      return `scene ${destination.sceneId}`;
    case "event":
      return `surface event ${destination.eventName}`;
  }
}

/**
 * Presents one destination; returns what was opened, or throws an error that
 * names a destination this UI cannot show.
 */
export function presentDestination(destination: ControlDestination, actions: ControlPresenterActions): string {
  switch (destination.kind) {
    case "settings": {
      const target = SETTINGS_PAGES[destination.pageId];
      if (!target) break;
      const section = destination.sectionId ?? destination.viewId;
      const anchor = (section && SETTINGS_ANCHORS[section]) || target.anchor;
      navigateScene("settings");
      actions.openSettingsPage(target.page, anchor);
      return anchor ? `settings:${target.page}#${anchor}` : `settings:${target.page}`;
    }
    case "scene": {
      const scene = SCENES[destination.sceneId];
      if (!scene) break;
      navigateScene(scene);
      return `scene:${scene}`;
    }
    case "action": {
      const scene = ACTION_SCENES[destination.actionId];
      if (scene) {
        navigateScene(scene);
        return `scene:${scene}`;
      }
      switch (destination.actionId) {
        case "project.open":
          actions.openFolder();
          return "action:project.open";
        case "project.new":
          actions.newWorkspace();
          return "action:project.new";
        case "session.new":
          actions.newSession();
          return "action:session.new";
        case "settings.open":
          navigateScene("settings");
          return "scene:settings";
        case "settings.shortcuts.open":
          navigateScene("settings");
          actions.openSettingsPage("input", "shortcuts");
          return "settings:input#shortcuts";
      }
      break;
    }
    case "event": {
      const scene = EVENT_SCENES[destination.eventName];
      if (!scene) break;
      navigateScene(scene);
      return `scene:${scene}`;
    }
  }
  throw new Error(`The OpenBitFun desktop UI has no screen for the ${describe(destination)} yet.`);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "OpenBitFunControl presentation request failed";
}

async function report(requestId: string, outcome: { success: boolean; result?: unknown; error?: string }): Promise<void> {
  try {
    await invokeCommand("report_openbitfun_control_result", { requestId, ...outcome });
  } catch (error) {
    // Another surface answered first, or the host stopped waiting.
    console.warn(`Failed to report an OpenBitFunControl result: ${errorText(error)}`);
  }
}

/** Handles one presentation request and reports its outcome to the waiting host. */
export async function handleControlRequest(request: ControlRequest, actions: ControlPresenterActions): Promise<void> {
  if (!request?.requestId) return;
  try {
    if (request.action !== "open" && request.action !== "execute") {
      throw new Error(`The desktop UI only presents open and execute requests, not ${request.action}`);
    }
    if (!request.destination) {
      throw new Error(
        `The host did not say where ${request.capabilityId ?? "this request"} leads; update the OpenBitFun host.`,
      );
    }
    const opened = presentDestination(request.destination, actions);
    await report(request.requestId, {
      success: true,
      result:
        request.action === "open"
          ? { capabilityId: request.capabilityId, itemId: request.itemId, opened: true, surface: "desktop", target: opened }
          : { capabilityId: request.capabilityId, operationId: request.operationId, executed: true, target: opened },
    });
  } catch (error) {
    await report(request.requestId, { success: false, error: errorText(error) });
  }
}

/** Applies a persisted language or appearance change to the live UI. */
export async function applyControlEffect(effect: ControlEffect): Promise<void> {
  if (!effect?.requestId) return;
  try {
    const paths = effect.changedPaths ?? [];
    let status: "applied" | "alreadyApplied" = "alreadyApplied";
    if (paths.includes("app.language")) {
      if (typeof effect.value !== "string") throw new Error("Persisted language effect did not carry a locale ID");
      syncLocaleFromHost(effect.value);
      status = "applied";
    }
    if (paths.includes("appearance.selection")) {
      const id = typeof effect.value === "string" ? effect.value : "";
      if (id === "system") {
        applyLocalAppearance("system");
        status = "applied";
      } else if (APPEARANCE_PRESETS.some(preset => preset.id === id)) {
        selectAppearancePreset(id as AppearanceId);
        status = "applied";
      } else {
        throw new Error(`The desktop UI has no appearance named ${id || "(empty)"}`);
      }
    }
    if (status === "alreadyApplied" && paths.length > 0) {
      await loadSettingsValues();
      status = "applied";
    }
    await report(effect.requestId, { success: true, result: { status } });
  } catch (error) {
    await report(effect.requestId, { success: false, error: errorText(error) });
  }
}

let installed: (() => void) | null = null;

/**
 * Declares this surface the presenter and follows the three control events.
 * Returns the stopper; a served page (phone, browser) installs nothing.
 */
export function installControlPresenter(actions: ControlPresenterActions): () => void {
  if (installed) return installed;
  // Only the host's own window presents control requests: a browser served by
  // the host, or a phone or browser driving a device as a controller, is not it.
  if (servedBackendParams() !== null || controllerPort() !== null) return () => {};
  const stops = [
    listenEvent<ControlRequest>(REQUEST_EVENT, request => void handleControlRequest(request, actions)),
    listenEvent<ControlEffect>(EFFECT_EVENT, effect => void applyControlEffect(effect)),
    listenEvent<unknown>(APPLIED_EVENT, () => {
      void loadSettingsValues().catch(() => undefined);
    }),
  ];
  // No `creationApiVersion`: this UI does not run the creation bridge, and the
  // host reads its absence as "no creation support" instead of waiting on it.
  void invokeCommand("mark_openbitfun_control_surface_ready", {}).catch(error => {
    console.warn(`The host did not accept this window as the presentation surface: ${errorText(error)}`);
  });
  installed = () => {
    for (const stop of stops) stop();
    void invokeCommand("mark_openbitfun_control_surface_unready").catch(() => undefined);
    installed = null;
  };
  return installed;
}
