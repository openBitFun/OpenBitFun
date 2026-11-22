// Desktop presence (tauri-gap §4.4, wave 22 P3): the desktop app's floating
// windows for desktop cards and the companion pet, and what phones and
// browsers show instead. The test plays the backend of the entry device
// (`desktop_cards` and the pet commands in the desktop crate) over a fleet
// entry; the windows open as real headless NSH windows
// (`fixtures/installTestPresence.ts` records them).

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, type Backend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const PHONE = { width: 375, height: 812, platform: "macos" as const };
const PRESENCE = "./fixtures/presenceApp.tsx";

/** A 1×1 transparent PNG: the pet's stand-in spritesheet. */
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const BITBLOB = {
  id: "bitblob",
  displayName: "BitBlob",
  description: "Rounded lavender companion.",
  source: "builtin",
  packagePath: "builtin:bitblob",
  spritesheetPath: "builtin:bitblob/spritesheet.webp",
  spritesheetMimeType: "image/webp",
  spriteVersionNumber: 2,
};

const CAPY = {
  ...BITBLOB,
  id: "capy",
  displayName: "Capy",
  packagePath: "builtin:capy",
  spritesheetPath: "builtin:capy/spritesheet.webp",
  spriteVersionNumber: 1,
};

interface PresenceState {
  cards: Array<Record<string, unknown>>;
  petEnabled: boolean;
  attention: { revision: number; groups: Array<{ id: string; items: unknown[] }>; badge: number };
  configWrites: Array<{ path: string; value: unknown }>;
  stillReads: string[];
}

function cards(): Array<Record<string, unknown>> {
  return [
    {
      id: "card-a",
      title: "Ship 2.0",
      template: { kind: "checklist", items: [{ id: "i1", text: "Tag the release", done: false }] },
      position: { x: 900, y: 40 },
      size: { width: 300, height: 220 },
      visible: true,
      alwaysOnTop: true,
      origin: { sessionId: "s-1" },
    },
    {
      id: "card-b",
      title: "Build minutes",
      template: { kind: "metrics", items: [{ label: "Today", value: 42, format: "number" }] },
      visible: true,
      alwaysOnTop: false,
      desktopPinned: true,
    },
    { id: "card-c", title: "Hidden note", template: { kind: "note", text: "x" }, visible: false },
  ];
}

function withPresence(backend: Backend, state: PresenceState): Backend {
  const original = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const { action, request } = data as { action?: string; request?: Record<string, unknown> };
    const card = (id: unknown) => state.cards.find(item => item.id === id);
    switch (action) {
      case "desktop_card_list":
        return { ok: true, value: { enabled: true, desktopPinningSupported: true, cards: state.cards } };
      case "desktop_card_set_bounds":
        return { ok: true, value: null };
      case "desktop_card_set_visible": {
        const found = card(request?.cardId);
        if (!found) return { ok: false, error: "Desktop card not found" };
        found.visible = request?.visible === true;
        return { ok: true, value: found };
      }
      case "desktop_card_set_checklist_item":
        return { ok: true, value: card(request?.cardId) ?? null };
      case "fleet_attention":
        return { ok: true, value: state.attention };
      case "fleet_attention_mark_read":
        return { ok: true, value: null };
      case "list_agent_companion_pets":
        return { ok: true, value: { pets: [BITBLOB, CAPY], importOperationsVersion: 1, builtinImportVersion: 1 } };
      case "load_agent_companion_pet_spritesheet":
        return { ok: true, value: { mimeType: "image/png", base64: PIXEL } };
      case "load_agent_companion_pet_still":
        state.stillReads.push(String(request?.packagePath ?? ""));
        return { ok: true, value: { mimeType: "image/png", base64: PIXEL } };
      case "get_config": {
        const path = String(request?.path ?? "");
        if (path === "app.ai_experience.enable_agent_companion") return { ok: true, value: state.petEnabled };
        if (path === "app.ai_experience.agent_companion_pet") return { ok: true, value: BITBLOB };
        if (path === "app.ai_experience.enable_desktop_cards") return { ok: true, value: true };
        return original(data);
      }
      case "set_config": {
        state.configWrites.push({ path: String(request?.path ?? ""), value: request?.value });
        if (request?.path === "app.ai_experience.enable_agent_companion") state.petEnabled = request?.value === true;
        return { ok: true, value: null };
      }
      default:
        return original(data);
    }
  };
  return backend;
}

function presenceHost(state: PresenceState) {
  const backend = withPresence(createBackend(), state);
  const posts: Array<Record<string, unknown>> = [];
  const host = fleetObpHost(backend, {
    fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: {
      revision: 1,
      full: true,
      devices: [fleetDeviceRow("dev-a", "MacBook", [], { hostKind: "desktop" })],
      removedDeviceIds: [],
      totals: { running: 0, waiting: 0, unread: 0 },
    },
  });
  host.handlers["openbitfun.presence"] = (data: unknown) => {
    posts.push(data as Record<string, unknown>);
    return null;
  };
  return { host, posts };
}

function freshState(petEnabled = false): PresenceState {
  return {
    cards: cards(),
    petEnabled,
    attention: { revision: 1, groups: [], badge: 0 },
    configWrites: [],
    stillReads: [],
  };
}

let eventSeq = 0;
/** One backend event of the entry device, as its fleet stream carries it. */
function eventFrame(event: string, payload: unknown): string {
  eventSeq += 1;
  return JSON.stringify({ jsonrpc: "2.0", method: "event", params: { seq: eventSeq, event, payload, origin: "dev-a" } });
}

test("a visible card opens its window where the store placed it and a move goes back to desktop_card_set_bounds", async () => {
  const state = freshState();
  const { host, posts } = presenceHost(state);
  const app = await open(PRESENCE, { ...DESKTOP, host: { handlers: host.handlers } });

  // Every card is read from this device, addressed to it.
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "desktop_card_list"));
  expect(host.fleetCalls.find(call => call.command === "desktop_card_list")?.target).toBe("dev-a");

  // Card a: its stored place and size, floating (keep on top).
  await app.waitUntil(() => posts.some(post => post.action === "open" && post.id === "desktop-card-card-a"));
  const openA = posts.find(post => post.action === "open" && post.id === "desktop-card-card-a")!;
  expect(openA.position).toEqual({ x: 900, y: 40 });
  expect(openA.size).toEqual({ width: 300, height: 220 });
  expect(openA.level).toBe("floating");
  expect(app.window("desktop-card-card-a").state()?.bounds.origin).toEqual({ x: 900, y: 40 });
  await app.waitFor("text:Ship 2.0");
  await app.waitFor("text:Tag the release");

  // Card b is pinned to the desktop layer; it had no place, so the one it got is stored.
  await app.waitUntil(() => posts.some(post => post.action === "open" && post.id === "desktop-card-card-b"));
  expect(posts.find(post => post.id === "desktop-card-card-b")?.level).toBe("desktopIcon");
  await app.waitUntil(() =>
    host.fleetCalls.some(call => call.command === "desktop_card_set_bounds" && (call.args.request as { cardId?: string }).cardId === "card-b"),
  );
  // A hidden card has no window.
  expect(posts.some(post => post.id === "desktop-card-card-c")).toBe(false);

  // The user moves card a: the settled bounds go to its device.
  await app.host.send("openbitfun.presenceMove", { id: "desktop-card-card-a", x: 1010, y: 64, width: 320, height: 240 });
  await app.waitUntil(() =>
    host.fleetCalls.some(call => call.command === "desktop_card_set_bounds" && (call.args.request as { cardId?: string }).cardId === "card-a"),
  );
  const move = host.fleetCalls.find(
    call => call.command === "desktop_card_set_bounds" && (call.args.request as { cardId?: string }).cardId === "card-a",
  );
  expect(move?.target).toBe("dev-a");
  expect(move?.args).toEqual({ request: { cardId: "card-a", x: 1010, y: 64, width: 320, height: 240 } });

  // The close button hides the card on its device; the change event closes the window.
  await app.press("label:card-close-card-a");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "desktop_card_set_visible"));
  expect(host.fleetCalls.find(call => call.command === "desktop_card_set_visible")?.args).toEqual({
    request: { cardId: "card-a", visible: false },
  });
  await app.waitUntil(() => posts.some(post => post.action === "close" && post.id === "desktop-card-card-a"));

  // Another client showed it again (an event from the device): the window comes back.
  state.cards[0].visible = true;
  await app.host.send("openbitfun.obpFrames", [
    eventFrame("desktop-card://changed", { cardId: "card-a", card: state.cards[0], deleted: false }),
  ]);
  await app.waitUntil(() => posts.filter(post => post.action === "open" && post.id === "desktop-card-card-a").length === 2);

  // Deleted elsewhere: the window goes.
  await app.host.send("openbitfun.obpFrames", [eventFrame("desktop-card://changed", { cardId: "card-b", card: null, deleted: true })]);
  await app.waitUntil(() => posts.some(post => post.action === "close" && post.id === "desktop-card-card-b"));
});

test("the pet window follows the fleet's attention and a press opens the Inbox", async () => {
  const state = freshState(true);
  const { host, posts } = presenceHost(state);
  const app = await open(PRESENCE, { ...DESKTOP, host: { handlers: host.handlers } });

  await app.waitUntil(() => posts.some(post => post.action === "open" && post.id === "openbitfun-pet"));
  expect(posts.find(post => post.id === "openbitfun-pet")?.level).toBe("floating");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "load_agent_companion_pet_spritesheet") ||
    host.calls.some(call => call.command === "load_agent_companion_pet_spritesheet"));
  // Nothing waits and nothing runs: the pet rests.
  await app.waitFor("id:pet-bitblob-idle");

  // A job on another device needs you: the Inbox's first group wakes the pet.
  state.attention = {
    revision: 2,
    groups: [{ id: "needs_you", items: [{ itemId: "p1", kind: "permission", source: { deviceId: "dev-b" }, title: "run_command" }] }],
    badge: 1,
  };
  await app.host.send("openbitfun.obpFrames", [eventFrame("fleet://attention-changed", { revision: 2 })]);
  await app.waitFor("id:pet-bitblob-needs_you");

  // It failed instead.
  state.attention = {
    revision: 3,
    groups: [{ id: "failed", items: [{ itemId: "f1", kind: "failure", source: { deviceId: "dev-b" }, title: "Tests", unread: true }] }],
    badge: 0,
  };
  await app.host.send("openbitfun.obpFrames", [eventFrame("fleet://attention-changed", { revision: 3 })]);
  await app.waitFor("id:pet-bitblob-failed");

  await app.press("label:pet-open-inbox");
  await app.waitUntil(() => posts.some(post => post.action === "openInbox"));
});

test("turning the pet off elsewhere closes its window", async () => {
  const state = freshState(true);
  const { host, posts } = presenceHost(state);
  const app = await open(PRESENCE, { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitUntil(() => posts.some(post => post.action === "open" && post.id === "openbitfun-pet"));

  // Turned off (the agent, another window): the window closes once the setting reads off.
  state.petEnabled = false;
  await app.host.send("openbitfun.obpFrames", [eventFrame("agentic://openbitfun-control-applied", {})]);
  await app.waitUntil(() => posts.some(post => post.action === "close" && post.id === "openbitfun-pet"));
  expect(app.window("openbitfun-pet").state()).toBe(null);
});

test("a phone or a browser opens no window: cards show inline in Library and the pet page says Desktop only", async () => {
  const state = freshState(true);
  const { host } = presenceHost(state);
  const app = await open("./fixtures/obpApp.tsx", { ...PHONE, host: { handlers: host.handlers } });
  await app.waitFor("Library");
  await app.press("Library");
  await app.press("label:library-tab-spaces");
  // Library › Spaces › Cards (wave22-p4).
  await app.press("label:spaces-view-cards");
  await app.waitFor("label:cards-section");
  await app.waitFor("text:Ship 2.0");
  expect(app.shows("text:Build minutes")).toBe(true);
  expect(app.window("desktop-card-card-a").state()).toBe(null);
  expect(app.window("openbitfun-pet").state()).toBe(null);

  // Ticking a checklist item on the phone runs on the card's device.
  await app.press("label:card-check-card-a-i1");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "desktop_card_set_checklist_item"));
  const tick = host.fleetCalls.find(call => call.command === "desktop_card_set_checklist_item");
  expect(tick?.target).toBe("dev-a");
  expect(tick?.args).toEqual({ request: { cardId: "card-a", itemId: "i1", done: true } });
});

test("Settings › Pet on a browser is one Desktop only row", async () => {
  const state = freshState(true);
  const { host } = presenceHost(state);
  const app = await open("./fixtures/settingsApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("Interface language");
  await app.press("nav-settings-page-pet");
  await app.waitFor("label:desktop-companion-desktop-only");
  expect(app.shows("text:Desktop only")).toBe(true);
  expect(app.shows("label:pet-enabled")).toBe(false);
  expect(host.calls.some(call => call.command === "list_agent_companion_pets")).toBe(false);
});

/** The native desktop's wire (as `fixtures/installWire.ts` carries it), over the presence backend. */
function nativeHost(state: PresenceState) {
  const backend = withPresence(createBackend(), state);
  const invokes: Array<{ command: string; args: Record<string, unknown> }> = [];
  let seq = 0;
  let nextId = 500;
  const handlers: Record<string, (data: unknown) => unknown> = {
    "openbitfun.wireReady": () => JSON.stringify({ version: "9.8.7", platform: "macos", dataDir: "/tmp/openbitfun-test" }),
    "openbitfun.wirePickDirectory": () => "null",
    "openbitfun.wireInvoke": (data: unknown) => {
      const { command, argsJson } = data as { command: string; argsJson: string };
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      invokes.push({ command, args });
      if (command === "host_shell_attach" || command === "host_shell_respond") return "null";
      const keys = Object.keys(args);
      const requestShape = keys.length === 0 || (keys.length === 1 && keys[0] === "request");
      const reply = backend.handlers["openbitfun.invoke"](
        requestShape ? { action: command, request: args.request ?? null } : { action: command, raw: args },
      ) as { ok: boolean; value?: unknown; error?: string };
      if (!reply.ok) throw new Error(reply.error ?? `${command} failed`);
      return JSON.stringify(reply.value ?? null);
    },
    "openbitfun.invoke": () => ({ ok: false, error: "the page host must not be used" }),
  };
  return {
    handlers,
    invokes,
    shellRequest(op: string, args: Record<string, unknown>): { batch: string; id: number } {
      const id = nextId++;
      seq += 1;
      return { batch: JSON.stringify([{ seq, event: "host://shell-request", payload: { id, op, args } }]), id };
    },
  };
}

test("the native desktop announces the pet operations, answers them, and Settings › Pet writes this device's settings", async () => {
  const state = freshState(true);
  const wire = nativeHost(state);
  const app = await open("./fixtures/nativeApp.tsx", { ...DESKTOP, host: { handlers: wire.handlers } });

  await app.waitUntil(() => wire.invokes.some(call => call.command === "host_shell_attach"));
  const ops = ((wire.invokes.find(call => call.command === "host_shell_attach")?.args.request ?? {}) as { ops?: string[] }).ops ?? [];
  for (const op of ["pet.show", "pet.hide", "pet.resize"]) expect(ops).toContain(op);

  // The pet window opens on the native desktop; `hide_agent_companion_desktop_pet` closes it.
  await app.waitUntil(() => app.window("openbitfun-pet").state() !== null);
  const hide = wire.shellRequest("pet.hide", {});
  await app.host.send("openbitfun.wireEvents", hide.batch);
  await app.waitUntil(() =>
    wire.invokes.some(call => call.command === "host_shell_respond" && (call.args.request as { id?: number }).id === hide.id),
  );
  const reply = wire.invokes.find(
    call => call.command === "host_shell_respond" && (call.args.request as { id?: number }).id === hide.id,
  )?.args.request as { ok?: boolean };
  expect(reply.ok).toBe(true);
  await app.waitUntil(() => app.window("openbitfun-pet").state() === null);

  // Settings › Pet: the switches and the character grid of this device.
  await app.press("Settings");
  await app.press("nav-settings-page-pet");
  await app.waitFor("label:pet-enabled");
  await app.waitFor("label:pet-choose-bitblob");
  // Every character shows its still at once, the chosen one and the rest alike, with no hover.
  await app.waitFor("label:pet-still-image-bitblob");
  await app.waitFor("label:pet-still-image-capy");
  expect(state.stillReads.sort()).toEqual(["builtin:bitblob", "builtin:capy"]);
  // The picker never decodes a spritesheet for a tile.
  const sheetReads = wire.invokes.filter(call => call.command === "load_agent_companion_pet_spritesheet").length;
  await app.hover("label:pet-choose-capy");
  await app.wait(200);
  expect(wire.invokes.filter(call => call.command === "load_agent_companion_pet_spritesheet").length).toBe(sheetReads);
  await app.press("label:desktop-cards-enabled");
  await app.waitUntil(() => state.configWrites.some(write => write.path === "app.ai_experience.enable_desktop_cards"));
  expect(state.configWrites.find(write => write.path === "app.ai_experience.enable_desktop_cards")?.value).toBe(false);
});
