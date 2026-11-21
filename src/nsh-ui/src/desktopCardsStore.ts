// Desktop cards (tauri-gap §1.3, §4.3, §4.4): small live cards an agent leaves
// on a device. A card is a fact of the device that made it: its store, refresh
// and countdowns run there (`desktop_cards` in the desktop backend). This store
// keeps each device's `desktop_card_list` answer as it came and follows
// `desktop-card://changed`; it never sorts, merges or derives a card.
//
// Where a card is drawn differs per client, not what it is: the device's own
// native shell opens a floating window per visible card (`desktopPresence.ts`),
// and every client (phone, browser, other desktops) lists the same records
// inline in Library › Spaces and on the OpenBitFun page. Every action is the
// backend command, addressed to the card's device.

import { signal } from "nsh";
import { errorMessageOf } from "./backendConnection";
import { entryDeviceId, fleetActive, fleetDeviceContext, invokeCommand, listenEvent } from "./bridge";

export const DESKTOP_CARD_CHANGED_EVENT = "desktop-card://changed";
export const DESKTOP_CARD_STATE_EVENT = "desktop-card://state";

/** A card record as the host stores it (`DesktopCardRecord`); fields stay optional. */
export interface DesktopCard {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  accent?: string;
  template: { kind?: string } & Record<string, unknown>;
  data?: unknown;
  dataSource?: { kind?: string; intervalSeconds?: number } & Record<string, unknown>;
  link?: string;
  size?: { width: number; height: number };
  position?: { x: number; y: number };
  visible?: boolean;
  alwaysOnTop?: boolean;
  origin?: { sessionId?: string; agentType?: string; workspacePath?: string };
  createdAtMs?: number;
  updatedAtMs?: number;
  lastData?: { fetchedAtMs: number; value?: unknown; error?: string; warning?: string };
  desktopPinned?: boolean;
  desktopPinFailure?: string;
  [key: string]: unknown;
}

/** One device's cards, as its `desktop_card_list` answered. */
export interface DeviceCards {
  enabled: boolean;
  pinningSupported: boolean;
  cards: DesktopCard[];
}

/** Why a device shows no cards: it keeps none (CLI, older hosts) or could not be read. */
export type DeviceCardsProblem = "unsupported" | "failed";

/** Cards by device id (`""`: the one backend of a connection without the fleet layer). */
export const deviceCards = signal<Record<string, DeviceCards>>({});
export const deviceCardsProblems = signal<Record<string, { kind: DeviceCardsProblem; message: string }>>({});
/** Card ids with an action in flight (`<deviceId>/<cardId>`). */
export const cardBusy = signal<Record<string, boolean>>({});
export const cardActionError = signal("");

/** The key of this client's own backend: the fleet entry's device, else `""`. */
export function localCardsDevice(): string {
  return fleetActive() ? (entryDeviceId() ?? "") : "";
}

function targetOf(deviceId: string): { target?: string } | undefined {
  return fleetActive() && deviceId ? { target: deviceId } : undefined;
}

function isUnsupported(error: unknown): boolean {
  const message = errorMessageOf(error).toLowerCase();
  return (
    message.includes("unsupported") ||
    message.includes("unknown command") ||
    message.includes("unknown_command") ||
    message.includes("no fixture") ||
    message.includes("not found: desktop_card")
  );
}

function readList(answer: unknown): DeviceCards {
  const record = (answer ?? {}) as Record<string, unknown>;
  return {
    enabled: record.enabled !== false,
    pinningSupported: record.desktopPinningSupported === true,
    cards: Array.isArray(record.cards) ? (record.cards as DesktopCard[]) : [],
  };
}

function setProblem(deviceId: string, problem: { kind: DeviceCardsProblem; message: string } | null): void {
  const next = { ...deviceCardsProblems() };
  if (problem) next[deviceId] = problem;
  else delete next[deviceId];
  deviceCardsProblems.set(next);
}

/** Reads one device's cards. */
export async function loadDeviceCards(deviceId: string): Promise<void> {
  try {
    const answer = await invokeCommand<unknown>("desktop_card_list", {}, targetOf(deviceId));
    deviceCards.set({ ...deviceCards(), [deviceId]: readList(answer) });
    setProblem(deviceId, null);
  } catch (error) {
    const next = { ...deviceCards() };
    delete next[deviceId];
    deviceCards.set(next);
    setProblem(deviceId, {
      kind: isUnsupported(error) ? "unsupported" : "failed",
      message: errorMessageOf(error),
    });
  }
}

export function cardsOf(deviceId: string): DesktopCard[] {
  return deviceCards()[deviceId]?.cards ?? [];
}

interface ChangedPayload {
  cardId?: string;
  card?: DesktopCard | null;
  deleted?: boolean;
  attention?: boolean;
}

/** Applies one change event to the device it came from. */
export function applyCardChange(deviceId: string, payload: ChangedPayload): void {
  const current = deviceCards()[deviceId];
  if (!current || !payload?.cardId) return;
  const cards = current.cards.filter(card => card.id !== payload.cardId);
  if (!payload.deleted && payload.card) {
    const index = current.cards.findIndex(card => card.id === payload.cardId);
    if (index >= 0) cards.splice(index, 0, payload.card);
    else cards.push(payload.card);
  }
  deviceCards.set({ ...deviceCards(), [deviceId]: { ...current, cards } });
}

const changeListeners = new Set<(deviceId: string, payload: ChangedPayload) => void>();

/** Hears every change event after the store applied it (the presence windows). */
export function onCardChanged(listener: (deviceId: string, payload: ChangedPayload) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

let stopEvents: (() => void) | null = null;

/** Follows card events of every device; idempotent. */
export function startDesktopCardsStore(): () => void {
  if (stopEvents) return stopEvents;
  const unChanged = listenEvent<ChangedPayload>(DESKTOP_CARD_CHANGED_EVENT, (payload, meta) => {
    const deviceId = meta?.origin ?? "";
    if (!deviceCards()[deviceId]) void loadDeviceCards(deviceId);
    else applyCardChange(deviceId, payload);
    for (const listener of [...changeListeners]) listener(deviceId, payload);
  });
  const unState = listenEvent<{ enabled?: boolean }>(DESKTOP_CARD_STATE_EVENT, (payload, meta) => {
    const deviceId = meta?.origin ?? "";
    const current = deviceCards()[deviceId];
    if (current) deviceCards.set({ ...deviceCards(), [deviceId]: { ...current, enabled: payload?.enabled !== false } });
    else void loadDeviceCards(deviceId);
  });
  stopEvents = () => {
    unChanged();
    unState();
    stopEvents = null;
  };
  return stopEvents;
}

async function runCardAction<T>(
  deviceId: string,
  cardId: string,
  command: string,
  request: Record<string, unknown>,
): Promise<T | null> {
  const key = `${deviceId}/${cardId}`;
  cardBusy.set({ ...cardBusy(), [key]: true });
  cardActionError.set("");
  try {
    const answer = await invokeCommand<T>(command, request, targetOf(deviceId));
    // A card the host answers with replaces the stored one at once; the
    // change event that follows carries the same record.
    if (answer && typeof answer === "object" && "id" in (answer as Record<string, unknown>)) {
      applyCardChange(deviceId, { cardId, card: answer as unknown as DesktopCard });
    }
    return answer;
  } catch (error) {
    cardActionError.set(errorMessageOf(error));
    return null;
  } finally {
    const next = { ...cardBusy() };
    delete next[key];
    cardBusy.set(next);
  }
}

export function isCardBusy(deviceId: string, cardId: string): boolean {
  return cardBusy()[`${deviceId}/${cardId}`] === true;
}

export const setCardVisible = (deviceId: string, cardId: string, visible: boolean) =>
  runCardAction<DesktopCard>(deviceId, cardId, "desktop_card_set_visible", { cardId, visible });

/** Keep on top, or pin to the desktop layer (`desktopPinned`, only where the host offers it). */
export const setCardStacking = (deviceId: string, cardId: string, alwaysOnTop: boolean, desktopPinned?: boolean) =>
  runCardAction<DesktopCard>(deviceId, cardId, "desktop_card_set_always_on_top", {
    cardId,
    alwaysOnTop,
    ...(desktopPinned === undefined ? {} : { desktopPinned }),
  });

export const refreshCard = (deviceId: string, cardId: string) =>
  runCardAction<DesktopCard>(deviceId, cardId, "desktop_card_refresh", { cardId });

export const setChecklistItem = (deviceId: string, cardId: string, itemId: string, done: boolean) =>
  runCardAction<DesktopCard>(deviceId, cardId, "desktop_card_set_checklist_item", { cardId, itemId, done });

export async function deleteCard(deviceId: string, cardId: string): Promise<void> {
  const done = await runCardAction<unknown>(deviceId, cardId, "desktop_card_delete", { cardId });
  if (done !== null || !cardActionError()) applyCardChange(deviceId, { cardId, deleted: true });
}

/** The settled geometry of a card window (the device's own shell only). */
export async function reportCardBounds(
  deviceId: string,
  cardId: string,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
  try {
    await invokeCommand<void>("desktop_card_set_bounds", { cardId, ...bounds }, targetOf(deviceId));
  } catch (error) {
    cardActionError.set(errorMessageOf(error));
  }
}

export function resetDesktopCardsForTests(): void {
  stopEvents?.();
  deviceCards.set({});
  deviceCardsProblems.set({});
  cardBusy.set({});
  cardActionError.set("");
  changeListeners.clear();
}

/** The device whose cards Library shows: the device context on a fleet entry, else the one backend. */
export function cardsDeviceForLibrary(): string {
  return fleetActive() ? (fleetDeviceContext() ?? localCardsDevice()) : "";
}
