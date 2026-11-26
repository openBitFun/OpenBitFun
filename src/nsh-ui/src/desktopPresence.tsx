// Desktop presence (tauri-gap §4.4): the desktop app's floating windows for
// desktop cards and the companion pet. Installed once by the native shell
// (`nshDesktopShell.ts`), never by a scene, so the windows outlive scene
// switches and never exist on a phone or in a browser.
//
// The windows draw backend facts and report back; they decide nothing:
// - one frameless window per visible card of this device, placed where the
//   host's store says (`position`, `size`), floating while the card keeps on
//   top and on the desktop layer while it is pinned. A settled move or resize
//   goes to `desktop_card_set_bounds`; the close button hides the card
//   (`desktop_card_set_visible`), which the host keeps.
// - one transparent window for the pet while `enable_agent_companion` is on,
//   animated along the fleet's attention state (`companionStore.ts`). A press
//   opens the main window and the Inbox. The backend's `pet.show`, `pet.hide`
//   and `pet.resize` shell operations act on it.

// `state.ts` and `sessionStatusStore.ts` import each other; the native shell
// loads this module before the UI, so the store goes first (the order the UI uses).
import "./sessionStatusStore";
import { effect, signal, untracked, type JSX } from "nsh";
import { displays, isAvailable, Window, type WindowOptions, type WindowRef } from "nsh/desktop";
import { listenEvent } from "./bridge";
import {
  cardsOf,
  deviceCards,
  loadDeviceCards,
  localCardsDevice,
  onCardChanged,
  reportCardBounds,
  setCardVisible,
  startDesktopCardsStore,
  type DesktopCard,
} from "./desktopCardsStore";
import {
  companionEnabled,
  loadCompanionSettings,
  petSessionBubbles,
  releasePetSheets,
  selectedPet,
  setCompanionEnabled,
  type PetSessionBubble,
} from "./companionStore";
import { space } from "./theme";
import { CardView, openCardConversation } from "./ui/cardView";
import {
  PET_BUBBLE_GAP,
  PET_BUBBLE_HEIGHT,
  PET_BUBBLE_SINGLE_HEIGHT,
  PET_BUBBLE_WIDTH,
  PetWindowContent,
} from "./ui/companion";

// ── Window driver ────────────────────────────────────────────────────────────

/** What presence needs of a window. */
export interface PresenceWindow {
  set(attributes: Partial<WindowOptions>): void;
  focus(): void;
  close(): void;
  setSize(size: { width: number; height: number }): void;
  setBounds?(bounds: { origin?: { x: number; y: number }; size: { width: number; height: number } }): void;
  bounds?(): { x: number; y: number; width: number; height: number } | null;
}

export interface PresenceWindowEvents {
  /** A settled move or resize, in points, screen coordinates. */
  onBounds?: (bounds: { x: number; y: number; width: number; height: number }) => void;
  /** The user pressed the close button (the window stays until presence closes it). */
  onClosePress?: () => void;
  /** It closed (by presence, or by the platform). */
  onClose?: () => void;
}

/** Opens app windows; tests install a stand-in (`installPresenceWindowDriver`). */
export interface PresenceWindowDriver {
  open(render: () => JSX.Element, options: WindowOptions, events: PresenceWindowEvents): PresenceWindow;
}

const nshWindowDriver: PresenceWindowDriver = {
  open(render, options, events) {
    const ref: WindowRef = Window.open(render, options);
    if (events.onBounds) {
      ref.on("boundsChange", ({ bounds }) =>
        events.onBounds?.({
          x: bounds.origin.x,
          y: bounds.origin.y,
          width: bounds.size.width,
          height: bounds.size.height,
        }),
      );
    }
    if (events.onClosePress) ref.on("closePress", () => events.onClosePress?.());
    if (events.onClose) ref.on("close", () => events.onClose?.());
    return {
      set: attributes => ref.set(attributes),
      focus: () => ref.focus(),
      close: () => ref.close(),
      setSize: size => ref.setBounds({ size }),
      setBounds: bounds => ref.setBounds(bounds),
      bounds: () => {
        const b = ref.state()?.bounds;
        return b ? { x: b.origin.x, y: b.origin.y, width: b.size.width, height: b.size.height } : null;
      },
    };
  },
};

let driver: PresenceWindowDriver = nshWindowDriver;

/** Replaces the window driver (headless tests). Returns the previous one. */
export function installPresenceWindowDriver(next: PresenceWindowDriver | null): PresenceWindowDriver {
  const previous = driver;
  driver = next ?? nshWindowDriver;
  return previous;
}

// ── Cards ────────────────────────────────────────────────────────────────────

export const CARD_WINDOW_PREFIX = "desktop-card-";
/** Space between a new card and the work area's edge, and between cascaded cards. */
const CARD_EDGE = space.xxl;
const CARD_CASCADE = space.x3l;

/** Window sizes of the templates (the host's `default_size`), for a card that has none. */
const TEMPLATE_SIZES: Record<string, { width: number; height: number }> = {
  countdown: { width: 260, height: 150 },
  checklist: { width: 280, height: 260 },
  note: { width: 280, height: 200 },
  progress: { width: 280, height: 150 },
  metrics: { width: 300, height: 210 },
  chart: { width: 320, height: 240 },
  cronJob: { width: 280, height: 170 },
  custom: { width: 320, height: 240 },
};

function cardSize(card: DesktopCard): { width: number; height: number } {
  return card.size ?? TEMPLATE_SIZES[String(card.template?.kind ?? "")] ?? { width: 280, height: 180 };
}

function cardPinned(card: DesktopCard): boolean {
  return card.desktopPinned === true && card.alwaysOnTop !== true;
}

function cardLevel(card: DesktopCard): WindowOptions["level"] {
  if (cardPinned(card)) return "desktopIcon";
  return card.alwaysOnTop === false ? "normal" : "floating";
}

/** Where a card without a stored place opens: the primary work area's top right, cascaded. */
function defaultCardPosition(size: { width: number; height: number }, index: number): { x: number; y: number } | undefined {
  const all = displays();
  const area = (all.find(display => display.primary) ?? all[0])?.visibleBounds;
  if (!area) return undefined;
  const steps = Math.max(1, Math.floor(area.size.height / 2 / CARD_CASCADE));
  const offset = (index % steps) * CARD_CASCADE;
  return {
    x: Math.max(area.origin.x, area.origin.x + area.size.width - size.width - CARD_EDGE - offset),
    y: area.origin.y + CARD_EDGE + offset,
  };
}

interface OpenCard {
  window: PresenceWindow;
  level: WindowOptions["level"];
}

const cardWindows = new Map<string, OpenCard>();
/** Card records by id for the windows' content (the window reads the live record). */
const liveCards = signal<Record<string, DesktopCard>>({});

function CardWindowContent(props: { cardId: string; deviceId: string; onOpenMain: () => void }) {
  const card = () => liveCards()[props.cardId];
  return (
    <>
      {card() ? (
        <CardView
          deviceId={props.deviceId}
          card={card()!}
          placement="window"
          onClose={() => void setCardVisible(props.deviceId, props.cardId, false)}
          onOpenConversation={() => {
            props.onOpenMain();
            openCardConversation(props.deviceId, card()!);
          }}
        />
      ) : null}
    </>
  );
}

function openCardWindow(deviceId: string, card: DesktopCard, index: number, onOpenMain: () => void): void {
  const size = cardSize(card);
  const position = card.position ?? defaultCardPosition(size, index);
  const level = cardLevel(card);
  const window = driver.open(
    () => <CardWindowContent cardId={card.id} deviceId={deviceId} onOpenMain={onOpenMain} />,
    {
      id: `${CARD_WINDOW_PREFIX}${card.id}`,
      title: card.title,
      kind: "panel",
      frame: "none",
      transparent: true,
      shadow: true,
      level,
      taskbar: false,
      resizable: true,
      movable: true,
      minimizable: false,
      maximizable: false,
      closeOnPress: false,
      activate: false,
      workspaces: cardPinned(card) ? "all" : "current",
      defaultSize: size,
      ...(position ? { defaultPosition: position } : {}),
    },
    {
      onBounds: bounds => void reportCardBounds(deviceId, card.id, bounds),
      onClosePress: () => void setCardVisible(deviceId, card.id, false),
      onClose: () => cardWindows.delete(card.id),
    },
  );
  cardWindows.set(card.id, { window, level });
  // A card opened without a stored place reports where it went.
  if (!card.position && position) void reportCardBounds(deviceId, card.id, { ...position, ...size });
}

function closeCardWindow(cardId: string): void {
  const open = cardWindows.get(cardId);
  if (!open) return;
  cardWindows.delete(cardId);
  open.window.close();
}

/** Opens, updates and closes card windows to match this device's records. */
function reconcileCards(deviceId: string, onOpenMain: () => void): void {
  const list = deviceCards()[deviceId];
  const shown = list && list.enabled !== false ? cardsOf(deviceId).filter(card => card.visible !== false) : [];
  const byId: Record<string, DesktopCard> = {};
  for (const card of cardsOf(deviceId)) byId[card.id] = card;
  liveCards.set(byId);
  const wanted = new Set(shown.map(card => card.id));
  for (const cardId of [...cardWindows.keys()]) if (!wanted.has(cardId)) closeCardWindow(cardId);
  shown.forEach((card, index) => {
    const open = cardWindows.get(card.id);
    if (!open) {
      openCardWindow(deviceId, card, index, onOpenMain);
      return;
    }
    const level = cardLevel(card);
    if (open.level !== level) {
      open.window.set({ level, workspaces: cardPinned(card) ? "all" : "current" });
      open.level = level;
    }
  });
}

// ── Pet ──────────────────────────────────────────────────────────────────────

export const PET_WINDOW_ID = "openbitfun-pet";
/** The pet's height in points (`pet.resize` changes it for this run). */
const PET_DEFAULT_HEIGHT = space.x6l + space.x3l;
export const petHeight = signal(PET_DEFAULT_HEIGHT);
/** Hidden for this run by the backend's `pet.hide`; `pet.show` brings it back. */
export const petHiddenForRun = signal(false);

let petWindow: PresenceWindow | null = null;
let petWindowKey = "";
let lastPetBounds: { x: number; y: number; width: number; height: number } | null = null;
let lastPetSize: { width: number; height: number } | null = null;

function petWindowSize(bubbleCount: number): { width: number; height: number } {
  const side = petHeight() + space.sm * 2;
  if (bubbleCount <= 0) return { width: side, height: side };
  const bubblesHeight =
    (bubbleCount === 1
      ? PET_BUBBLE_SINGLE_HEIGHT
      : bubbleCount * PET_BUBBLE_HEIGHT + Math.max(0, bubbleCount - 1) * space.xs) +
    space.sm * 2;
  return {
    width: PET_BUBBLE_WIDTH + PET_BUBBLE_GAP + side,
    height: Math.max(side, bubblesHeight),
  };
}

/** Keeps the pet anchored at its bottom-right edge as session bubbles appear or close on its left. */
function resizePetWindowAnchored(win: PresenceWindow, next: { width: number; height: number }): void {
  const current = win.bounds?.() ?? lastPetBounds;
  if (current) {
    if (current.width === next.width && current.height === next.height) {
      lastPetSize = next;
      return;
    }
    lastPetSize = next;
    if (win.setBounds) {
      const all = displays();
      const area = (all.find(display => display.primary) ?? all[0])?.visibleBounds;
      const minX = area ? area.origin.x : 0;
      const minY = area ? area.origin.y : 0;
      const origin = {
        x: Math.max(minX, Math.round(current.x + current.width - next.width)),
        y: Math.max(minY, Math.round(current.y + current.height - next.height)),
      };
      lastPetBounds = { x: origin.x, y: origin.y, width: next.width, height: next.height };
      win.setBounds({ origin, size: next });
      return;
    }
    win.setSize(next);
    return;
  }
  if (lastPetSize && lastPetSize.width === next.width && lastPetSize.height === next.height) return;
  lastPetSize = next;
  win.setSize(next);
}

function closePetWindow(): void {
  const open = petWindow;
  petWindow = null;
  petWindowKey = "";
  lastPetBounds = null;
  lastPetSize = null;
  open?.close();
}

function reconcilePet(actions: DesktopPresenceActions): void {
  const pet = selectedPet();
  const show = companionEnabled() === true && pet !== null && !petHiddenForRun();
  const bubbleCount = petSessionBubbles().length;
  if (!show || !pet) {
    closePetWindow();
    releasePetSheets();
    return;
  }
  const size = petWindowSize(bubbleCount);
  const key = pet.spritesheetPath;
  if (petWindow && petWindowKey === key) {
    resizePetWindowAnchored(petWindow, size);
    return;
  }
  closePetWindow();
  petWindowKey = key;
  lastPetSize = size;
  petWindow = driver.open(
    () => (
      <>
        {selectedPet() ? (
          <PetWindowContent
            pet={selectedPet()!}
            height={petHeight()}
            onOpen={() => actions.openInbox()}
            onOpenSession={bubble => {
              if (actions.openSession) actions.openSession(bubble);
              else actions.openInbox();
            }}
            onHide={() => void setCompanionEnabled(false)}
            onSettings={() => actions.openPetSettings()}
          />
        ) : null}
      </>
    ),
    {
      id: PET_WINDOW_ID,
      title: pet.displayName,
      kind: "panel",
      frame: "none",
      transparent: true,
      shadow: false,
      level: "floating",
      taskbar: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      closeOnPress: false,
      activate: false,
      workspaces: "all",
      defaultSize: size,
      restoreBounds: true,
    },
    {
      onBounds: bounds => {
        lastPetBounds = bounds;
        lastPetSize = { width: bounds.width, height: bounds.height };
      },
      onClose: () => {
        petWindow = null;
        petWindowKey = "";
        lastPetBounds = null;
        lastPetSize = null;
      },
    },
  );
}

/** The backend's shell operations on the pet window (`show/hide/resize_agent_companion_desktop_pet`). */
export const PET_SHELL_OPERATIONS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  "pet.show": async () => {
    if (!presenceRunning) throw new Error("unsupported_in_native_host: the desktop pet is not installed in this window");
    petHiddenForRun.set(false);
    if (companionEnabled() !== true) await setCompanionEnabled(true);
    return null;
  },
  "pet.hide": async () => {
    petHiddenForRun.set(true);
    return null;
  },
  "pet.resize": async args => {
    const height = typeof args.height === "number" && Number.isFinite(args.height) && args.height > 0 ? args.height : null;
    if (height === null) throw new Error("pet.resize needs a positive height");
    petHeight.set(Math.round(Math.max(space.x4l, Math.min(height, space.x6l * 4))));
    return null;
  },
};

// ── Install ──────────────────────────────────────────────────────────────────

export interface DesktopPresenceActions {
  /** Shows the main window and opens the Inbox. */
  openInbox(): void;
  /** Shows the main window and opens a specific session or conversation from a pet bubble. */
  openSession?(target: Pick<PetSessionBubble, "deviceId" | "workspaceId" | "sessionId" | "conversationId">): void;
  /** Shows the main window and opens Settings › Pet. */
  openPetSettings(): void;
  /** Shows the main window. */
  showMain(): void;
}

let presenceRunning = false;
let stopPresence: (() => void) | null = null;
/** Gates the reconciling effects, which live as long as their owner (the shell's App). */
const presenceActive = signal(false);
let presenceActions: DesktopPresenceActions | null = null;
let effectsInstalled = false;

const CONTROL_APPLIED_EVENT = "agentic://openbitfun-control-applied";

/** Starts the card and pet windows of this desktop; idempotent. */
export function startDesktopPresence(actions: DesktopPresenceActions, options: { force?: boolean } = {}): () => void {
  if (stopPresence) return stopPresence;
  if (!isAvailable && !options.force) return () => undefined;
  presenceRunning = true;
  presenceActions = actions;
  const stopCards = startDesktopCardsStore();
  const device = () => localCardsDevice();
  void loadCompanionSettings();
  presenceActive.set(true);

  if (!effectsInstalled) {
    effectsInstalled = true;
    // This device's cards, read again when its key is known (a fleet entry
    // names itself in its handshake, after the shell started).
    effect(() => {
      if (!presenceActive()) return;
      const deviceId = device();
      untracked(() => void loadDeviceCards(deviceId));
    });
    effect(() => {
      if (!presenceActive()) return;
      reconcileCards(device(), () => presenceActions?.showMain());
    });
    effect(() => {
      if (!presenceActive() || !presenceActions) return;
      reconcilePet(presenceActions);
    });
  }
  const stopFocus = onCardChanged((deviceId, payload) => {
    if (deviceId !== device() || !payload?.attention || !payload.cardId) return;
    cardWindows.get(payload.cardId)?.window.focus();
  });
  // An agent changed the pet through OpenBitFun control: read the settings again.
  const stopApplied = listenEvent<unknown>(CONTROL_APPLIED_EVENT, () => void loadCompanionSettings());

  stopPresence = () => {
    stopFocus();
    stopApplied();
    stopCards();
    presenceActive.set(false);
    for (const cardId of [...cardWindows.keys()]) closeCardWindow(cardId);
    closePetWindow();
    presenceRunning = false;
    presenceActions = null;
    stopPresence = null;
  };
  return stopPresence;
}

/** The open card windows' ids (tests). */
export function openCardWindowIds(): string[] {
  return [...cardWindows.keys()];
}

export function resetDesktopPresenceForTests(): void {
  stopPresence?.();
  petHeight.set(PET_DEFAULT_HEIGHT);
  petHiddenForRun.set(false);
  liveCards.set({});
}
