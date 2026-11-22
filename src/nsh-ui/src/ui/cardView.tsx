// One card, drawn the same way everywhere (tauri-gap §4.3, §4.4): in its own
// floating window on the device that keeps it (`desktopPresence.ts`), and
// inline in Library › Spaces and on the OpenBitFun page of every client.
//
// The card's template is the agent's declarative layout; this file draws the
// record the host sent (JSON Pointers into the card data, numbers through the
// shared formatters) and forwards every action as the card's backend command.
// It decides nothing about the card: visibility, stacking, data and
// countdowns are the host's.

import { cleanup, effect, lifecycle, Scroll, signal, Text, untracked, View, WebView } from "nsh";
import { fleetActive, windowShellId } from "../bridge";
import {
  cardActionError,
  cardsDeviceForLibrary,
  cardsOf,
  deleteCard,
  deviceCards,
  deviceCardsProblems,
  isCardBusy,
  loadDeviceCards,
  refreshCard,
  setCardStacking,
  setCardVisible,
  setChecklistItem,
  type DesktopCard,
} from "../desktopCardsStore";
import { fleetDeviceById } from "../fleetStore";
import { formatCount, formatDate, formatRelativeTime, formatTime } from "../format";
import { localizeHostError, tr } from "../i18n";
import { navigateScene, openDevicePage, selectSession } from "../state";
import { compactLayout, layout, palette, radii, space, textStyle, touchSlop, type Palette } from "../theme";
import { DeviceBadge, deviceException, stateColor } from "./fleet";
import { Icon, type IconName } from "./icons";
import { documentWebViewsAvailable } from "./markdownEditor";
import { pressTransition, tactileActiveStyle } from "./motion";
import { Button, focusRingStyle, IconButton, InlineBanner, InlineConfirmBar, SkeletonBlock } from "./primitives";
import { GalleryGrid, galleryCardStyle, MoreMenu, StudioEmpty, StudioSection } from "./studio";
import type { DropdownMenuItem } from "./overlays";

// ── Sizes (the spacing scale) ───────────────────────────────────────────────

const CHART_LABEL_WIDTH = space.x6l + space.sm;
const CHECKBOX_SIZE = space.lg;
const METRIC_MIN_WIDTH = space.x6l + space.x3l;
const CUSTOM_MIN_HEIGHT = space.x6l + space.x3l;
const INLINE_CARD_MIN_HEIGHT = space.x6l * 2;
/** Gallery columns: the Library's, and the narrower OpenBitFun page's. */
const CARD_COLUMN = space.x6l * 4 + space.xxl;
const CARD_COLUMN_NARROW = space.x6l * 4;

// ── Reading a card ───────────────────────────────────────────────────────────

const CARD_ICONS: Record<string, IconName> = {
  activity: "activity",
  alarm: "clock",
  bell: "bell",
  calendar: "calendar",
  chart: "bar-chart",
  check: "check-circle",
  clock: "clock",
  cloud: "cloud",
  code: "code",
  flag: "pin",
  "git-pull-request": "git-pull-request",
  globe: "globe",
  "hard-drive": "hard-drive",
  info: "info",
  list: "list",
  note: "notes",
  package: "package",
  "pie-chart": "bar-chart",
  rocket: "zap",
  server: "server",
  star: "star",
  sun: "sun",
  terminal: "terminal",
  timer: "clock",
  "trending-up": "activity",
  zap: "zap",
};

/** The card's own tones, read as the semantic tokens every appearance defines. */
const TONE_TOKENS: Record<string, keyof Palette> = {
  neutral: "textSecondary",
  accent: "accent",
  info: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
};

function toneColor(tone: unknown, fallback: keyof Palette = "text"): string {
  const token = typeof tone === "string" ? TONE_TOKENS[tone] : undefined;
  return palette()[token ?? fallback] as string;
}

/** RFC 6901 JSON Pointer lookup; `undefined` for a missing path. */
export function resolvePointer(root: unknown, pointer: unknown): unknown {
  if (typeof pointer !== "string") return undefined;
  if (pointer === "") return root;
  if (!pointer.startsWith("/")) return undefined;
  let current: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (current !== null && typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Template paths read the last fetched value when the card has a data source. */
function cardData(card: DesktopCard): unknown {
  if (typeof card.dataSource?.kind === "string") return card.lastData?.value ?? null;
  return card.data ?? null;
}

function finite(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestampMs(value: unknown): number | null {
  const numeric = finite(value);
  if (numeric !== null) return Math.abs(numeric) < 1e11 ? numeric * 1000 : numeric;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function fixed(value: number, digits: unknown): string {
  const places = typeof digits === "number" ? Math.min(Math.max(Math.trunc(digits), 0), 8) : null;
  if (places === null) return Number.isInteger(value) ? formatCount(value) : String(Math.round(value * 100) / 100);
  const [whole, fraction] = Math.abs(value).toFixed(places).split(".");
  const grouped = formatCount(Number(whole));
  return `${value < 0 ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** A value as a metric or chart label says: number, percent, currency, date or text. */
export function formatCardValue(item: Record<string, unknown>, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "—";
  const numeric = finite(raw);
  let text: string;
  switch (item.format) {
    case "number":
      text = numeric === null ? String(raw) : fixed(numeric, item.digits);
      break;
    case "percent":
      text = numeric === null ? String(raw) : `${fixed(numeric, item.digits)}%`;
      break;
    case "currency":
      text =
        numeric === null ? String(raw) : `${typeof item.currency === "string" ? `${item.currency} ` : ""}${fixed(numeric, item.digits ?? 2)}`;
      break;
    case "datetime": {
      const ms = timestampMs(raw);
      text = ms === null ? String(raw) : `${formatDate(ms)} ${formatTime(ms)}`;
      break;
    }
    case "relativeTime": {
      const ms = timestampMs(raw);
      text = ms === null ? String(raw) : formatRelativeTime(ms);
      break;
    }
    default:
      text = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
  }
  return `${typeof item.prefix === "string" ? item.prefix : ""}${text}${typeof item.suffix === "string" ? item.suffix : ""}`;
}

function metricTone(item: Record<string, unknown>, raw: unknown): unknown {
  const map = item.toneMap as Record<string, string> | undefined;
  if (map && raw !== undefined && raw !== null) {
    const mapped = map[typeof raw === "string" ? raw : JSON.stringify(raw)];
    if (mapped) return mapped;
  }
  if (item.signTone === true) {
    const numeric = finite(raw);
    if (numeric !== null && numeric > 0) return "success";
    if (numeric !== null && numeric < 0) return "danger";
  }
  return item.tone;
}

interface ChartPoint {
  label: string;
  value: number;
  tone?: unknown;
}

const CHART_LIMITS: Record<string, number> = { bar: 12, column: 24, line: 120, donut: 6, stacked: 6 };

function chartPoints(template: Record<string, unknown>, data: unknown): ChartPoint[] {
  const limit = CHART_LIMITS[String(template.chart)] ?? 12;
  if (Array.isArray(template.items) && template.items.length > 0) {
    return (template.items as Array<Record<string, unknown>>)
      .map(item => ({ label: String(item.label ?? ""), value: finite(item.value) ?? 0, tone: item.tone }))
      .slice(0, limit);
  }
  const raw = resolvePointer(data, template.itemsPath);
  if (!Array.isArray(raw)) return [];
  const labels = resolvePointer(data, template.labelsPath);
  const labelKey = typeof template.labelKey === "string" ? template.labelKey : "label";
  const valueKey = typeof template.valueKey === "string" ? template.valueKey : "value";
  return raw
    .map((entry, index): ChartPoint | null => {
      if (typeof entry === "number" || typeof entry === "string") {
        const value = finite(entry);
        const label = Array.isArray(labels) ? String(labels[index] ?? index + 1) : String(index + 1);
        return value === null ? null : { label, value };
      }
      if (Array.isArray(entry)) {
        const value = finite(entry[1]);
        return value === null ? null : { label: String(entry[0] ?? ""), value };
      }
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const value = finite(record[valueKey]);
        return value === null ? null : { label: String(record[labelKey] ?? ""), value };
      }
      return null;
    })
    .filter((point): point is ChartPoint => point !== null)
    .slice(-limit);
}

// ── Template bodies ──────────────────────────────────────────────────────────

const bodyText = () => textStyle("body");
const metaText = () => textStyle("caption", { color: palette().textMuted });

function Note(props: { text: string }) {
  return <Text style={{ ...bodyText(), color: palette().text, userSelect: "text" }}>{props.text}</Text>;
}

function Checklist(props: { deviceId: string; card: DesktopCard }) {
  const items = () => (Array.isArray(props.card.template.items) ? (props.card.template.items as Array<Record<string, unknown>>) : []);
  const busy = () => isCardBusy(props.deviceId, props.card.id);
  return (
    <View style={{ gap: space.xs }}>
      <Each of={items()} key={item => String(item.id)}>
        {item => (
          <View
            role="checkbox"
            accessibilityLabel={`card-check-${props.card.id}-${String(item().id)}`}
            accessibilityState={{ checked: item().done === true, disabled: busy() }}
            disabled={busy()}
            hitSlop={touchSlop(32)}
            onPress={() => {
              if (busy()) return;
              void setChecklistItem(props.deviceId, props.card.id, String(item().id), item().done !== true);
            }}
            hoverStyle={busy() || compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
            activeStyle={busy() ? undefined : tactileActiveStyle(0.985)}
            focusVisibleStyle={focusRingStyle()}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: space.sm,
              minHeight: compactLayout() ? layout.touchTarget : space.x3l,
              paddingHorizontal: space.xs,
              paddingVertical: space.xs,
              borderRadius: radii.sm,
              opacity: busy() ? 0.45 : 1,
              cursor: busy() ? "default" : "pointer",
              userSelect: "none",
              ...pressTransition(120),
            }}
          >
            <View style={{ marginTop: space.hair, flexShrink: 0 }}>
              <If
                when={item().done === true}
                else={
                  <View
                    style={{
                      width: CHECKBOX_SIZE,
                      height: CHECKBOX_SIZE,
                      borderRadius: radii.xs,
                      borderWidth: 1,
                      borderColor: palette().textMuted,
                    }}
                  />
                }
              >
                <Icon name="check-square" size={CHECKBOX_SIZE} color={palette().textSecondary} />
              </If>
            </View>
            <Text
              style={{
                ...bodyText(),
                flex: 1,
                minWidth: 0,
                color: item().done === true ? palette().textMuted : palette().text,
                textDecorationLine: item().done === true ? "line-through" : "none",
              }}
            >
              {String(item().text ?? "")}
            </Text>
          </View>
        )}
      </Each>
    </View>
  );
}

/** A clock that ticks once a second while a countdown is active and visible. */
function useCountdownNow(target: () => number): () => number {
  const now = signal(Date.now());
  effect(() => {
    const end = target();
    if (end <= 0 || lifecycle() === "background") return;
    const current = Date.now();
    now.set(current);
    if (current >= end) return;
    const timer = setInterval(() => {
      const tick = Date.now();
      now.set(tick);
      if (tick >= end) clearInterval(timer);
    }, 1000);
    cleanup(() => clearInterval(timer));
  });
  return now;
}

function Countdown(props: { card: DesktopCard }) {
  const target = () => finite(props.card.template.targetAtMs) ?? 0;
  const now = useCountdownNow(target);
  const remaining = () => Math.max(target() - now(), 0);
  const clock = () => {
    const total = Math.ceil(remaining() / 1000);
    const days = Math.floor(total / 86400);
    const pad = (value: number) => String(value).padStart(2, "0");
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const time = hours > 0 || days > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
    return days > 0 ? tr("cards.countdownDays", { days, time }) : time;
  };
  const subtitle = () => {
    if (typeof props.card.template.message === "string" && props.card.template.message) {
      return props.card.template.message;
    }
    if (target() <= 0) return "";
    return tr("cards.countdownUntil", { time: `${formatDate(target())} ${formatTime(target())}` });
  };
  return (
    <View style={{ gap: space.xs }}>
      <Text
        accessibilityLabel={`card-countdown-${props.card.id}`}
        style={{
          ...textStyle("display", { tabular: true }),
          color: remaining() === 0 ? stateColor("done") : palette().text,
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {remaining() === 0 ? tr("cards.countdownDone") : clock()}
      </Text>
      <If when={subtitle()}>
        {text => <Text style={metaText()}>{text()}</Text>}
      </If>
    </View>
  );
}

function Progress(props: { card: DesktopCard }) {
  const data = () => cardData(props.card);
  const template = () => props.card.template;
  const value = () => finite(template().valuePath !== undefined ? resolvePointer(data(), template().valuePath) : template().value);
  const max = () => {
    const raw = finite(template().maxPath !== undefined ? resolvePointer(data(), template().maxPath) : template().max);
    return raw !== null && raw > 0 ? raw : 100;
  };
  const ratio = () => (value() === null ? 0 : Math.min(Math.max((value() as number) / max(), 0), 1));
  const status = () => {
    const raw = template().statusPath !== undefined ? resolvePointer(data(), template().statusPath) : template().status;
    return raw === undefined || raw === null || raw === "" ? "" : String(raw);
  };
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ ...textStyle("pageTitle", { tabular: true }), numberOfLines: 1, textOverflow: "ellipsis" }}>
        {value() === null ? "—" : `${Math.round(ratio() * 100)}%`}
      </Text>
      <View style={{ height: space.chip, borderRadius: radii.pill, backgroundColor: palette().surfaceTertiary, overflow: "hidden" }}>
        <View style={{ height: space.chip, width: `${ratio() * 100}%`, borderRadius: radii.pill, backgroundColor: toneColor(props.card.accent, "accent") }} />
      </View>
      <If when={status()}>{text => <Text style={metaText()}>{text()}</Text>}</If>
    </View>
  );
}

function Metrics(props: { card: DesktopCard }) {
  const items = () => (Array.isArray(props.card.template.items) ? (props.card.template.items as Array<Record<string, unknown>>) : []);
  const raw = (item: Record<string, unknown>) =>
    item.path !== undefined ? resolvePointer(cardData(props.card), item.path) : item.value;
  const hint = (item: Record<string, unknown>) => {
    const value = item.hintPath !== undefined ? resolvePointer(cardData(props.card), item.hintPath) : undefined;
    if (value !== undefined && value !== null && value !== "") return typeof value === "object" ? JSON.stringify(value) : String(value);
    return typeof item.hint === "string" ? item.hint : "";
  };
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg }}>
      <Each of={items()} key={(_item, index) => String(index)}>
        {item => (
          <View style={{ minWidth: METRIC_MIN_WIDTH, flexGrow: 1, flexShrink: 1, gap: space.hair }}>
            <Text style={{ ...metaText(), numberOfLines: 1, textOverflow: "ellipsis" }}>{String(item().label ?? "")}</Text>
            <Text
              style={{
                ...textStyle(item().emphasis === true ? "pageTitle" : "sectionTitle", { tabular: true }),
                color: toneColor(metricTone(item(), raw(item()))),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {formatCardValue(item(), raw(item()))}
            </Text>
            <If when={hint(item())}>{text => <Text style={metaText()}>{text()}</Text>}</If>
          </View>
        )}
      </Each>
    </View>
  );
}

function Chart(props: { card: DesktopCard }) {
  const points = () => chartPoints(props.card.template, cardData(props.card));
  const scale = () => Math.max(...points().map(point => Math.abs(point.value)), 1);
  return (
    <View style={{ gap: space.xs }}>
      <If when={points().length === 0}>
        <Text style={metaText()}>{tr("cards.noData")}</Text>
      </If>
      <Each of={points()} key={(_point, index) => String(index)}>
        {point => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}>
            <Text style={{ ...metaText(), width: CHART_LABEL_WIDTH, flexShrink: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>{point().label}</Text>
            <View style={{ flex: 1, minWidth: space.x4l, height: space.sm, borderRadius: radii.xs, backgroundColor: palette().surfaceTertiary, overflow: "hidden" }}>
              <View
                style={{
                  height: space.sm,
                  width: `${(Math.abs(point().value) / scale()) * 100}%`,
                  borderRadius: radii.xs,
                  backgroundColor: toneColor(point().tone ?? props.card.accent, "accent"),
                }}
              />
            </View>
            <Text
              style={{
                ...metaText(),
                fontVariant: ["tabular-nums"],
                maxWidth: METRIC_MIN_WIDTH,
                flexShrink: 0,
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {formatCardValue(props.card.template, point().value)}
            </Text>
          </View>
        )}
      </Each>
      <If when={typeof props.card.template.caption === "string" ? (props.card.template.caption as string) : ""}>
        {caption => <Text style={metaText()}>{caption()}</Text>}
      </If>
    </View>
  );
}

function Custom(props: { card: DesktopCard }) {
  const failed = signal(false);
  effect(() => {
    void props.card.template.html;
    failed.set(false);
  });
  return (
    <View style={{ flex: 1, minHeight: CUSTOM_MIN_HEIGHT }}>
      <If when={documentWebViewsAvailable() === null}>
        <SkeletonBlock width="100%" height={CUSTOM_MIN_HEIGHT} borderRadius={radii.sm} />
      </If>
      <If when={documentWebViewsAvailable() === true && !failed()}>
        <WebView
          accessibilityLabel={`card-html-${props.card.id}`}
          html={String(props.card.template.html ?? "")}
          incognito={true}
          javaScriptEnabled={false}
          onError={() => failed.set(true)}
          style={{ flex: 1, minHeight: CUSTOM_MIN_HEIGHT, borderRadius: radii.sm, overflow: "hidden" }}
        />
      </If>
      <If when={documentWebViewsAvailable() === false || failed()}>
        <Text accessibilityLabel={`card-html-fallback-${props.card.id}`} style={metaText()}>
          {tr("cards.unknownTemplate")}
        </Text>
      </If>
    </View>
  );
}

function CardBodyContent(props: { deviceId: string; card: DesktopCard }) {
  const kind = () => String(props.card.template?.kind ?? "");
  return (
    <>
      <If when={kind() === "note"}>
        <Note text={String(props.card.template.text ?? "")} />
      </If>
      <If when={kind() === "checklist"}>
        <Checklist deviceId={props.deviceId} card={props.card} />
      </If>
      <If when={kind() === "countdown"}>
        <Countdown card={props.card} />
      </If>
      <If when={kind() === "progress"}>
        <Progress card={props.card} />
      </If>
      <If when={kind() === "metrics"}>
        <Metrics card={props.card} />
      </If>
      <If when={kind() === "chart"}>
        <Chart card={props.card} />
      </If>
      <If when={kind() === "cronJob"}>
        <Text style={{ ...bodyText(), color: palette().textSecondary }}>{tr("cards.routine")}</Text>
      </If>
      <If when={kind() === "custom"}>
        <Custom card={props.card} />
      </If>
      <If when={!["note", "checklist", "countdown", "progress", "metrics", "chart", "cronJob", "custom"].includes(kind())}>
        <Text style={metaText()}>{tr("cards.unknownTemplate")}</Text>
      </If>
    </>
  );
}

function CardBody(props: { deviceId: string; card: DesktopCard; placement: "window" | "inline" }) {
  const kind = () => String(props.card.template?.kind ?? "");
  return (
    <If
      when={props.placement === "window" && kind() !== "custom"}
      else={
        <View style={{ flex: 1, minHeight: 0, gap: space.sm }}>
          <CardBodyContent deviceId={props.deviceId} card={props.card} />
        </View>
      }
    >
      <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ gap: space.sm }}>
        <CardBodyContent deviceId={props.deviceId} card={props.card} />
      </Scroll>
    </If>
  );
}

/** "Updated 5m ago", or the last fetch's error. Empty for a card without a data source. */
function dataLine(card: DesktopCard): { text: string; failed: boolean } | null {
  if (card.desktopPinFailure) {
    return { text: localizeHostError(card.desktopPinFailure), failed: true };
  }
  if (typeof card.dataSource?.kind !== "string") return null;
  const last = card.lastData;
  if (!last) return { text: tr("cards.loading"), failed: false };
  if (last.error) return { text: tr("cards.refreshFailed", { error: localizeHostError(last.error) }), failed: true };
  if (last.warning) return { text: localizeHostError(last.warning), failed: false };
  return { text: tr("cards.updated", { ago: formatRelativeTime(last.fetchedAtMs) }), failed: false };
}

// ── Actions ──────────────────────────────────────────────────────────────────

function pinned(card: DesktopCard): boolean {
  return card.desktopPinned === true && card.alwaysOnTop !== true;
}

/** Opens the conversation that made the card, on its device. */
export function openCardConversation(deviceId: string, card: DesktopCard): void {
  const sessionId = card.origin?.sessionId;
  if (!sessionId) return;
  selectSession(sessionId, fleetActive() ? deviceId : undefined);
  navigateScene("sessions");
}

export function cardMenuItems(
  deviceId: string,
  card: DesktopCard,
  options: { onOpenConversation?: () => void; onRequestDelete?: () => void } = {},
): DropdownMenuItem[] {
  const list = deviceCards()[deviceId];
  const items: DropdownMenuItem[] = [];
  const enabled = list?.enabled !== false;
  items.push({
    id: "visible",
    label: card.visible === false ? tr("cards.showOnDesktop") : tr("cards.hideFromDesktop"),
    icon: card.visible === false ? "eye" : "eye-off",
    disabled: card.visible === false && !enabled,
    accessibilityLabel: `card-visible-${card.id}`,
    onSelect: () => void setCardVisible(deviceId, card.id, card.visible === false),
  });
  items.push({
    id: "on-top",
    label: tr("cards.keepOnTop"),
    icon: "layers",
    active: card.alwaysOnTop !== false && !pinned(card),
    accessibilityLabel: `card-on-top-${card.id}`,
    onSelect: () => void setCardStacking(deviceId, card.id, card.alwaysOnTop === false || pinned(card), pinned(card) ? false : undefined),
  });
  if (list?.pinningSupported) {
    items.push({
      id: "pin",
      label: tr("cards.pinToDesktop"),
      icon: "pin",
      active: pinned(card),
      accessibilityLabel: `card-pin-${card.id}`,
      onSelect: () => void setCardStacking(deviceId, card.id, false, !pinned(card)),
    });
  }
  if (typeof card.dataSource?.kind === "string") {
    items.push({
      id: "refresh",
      label: tr("cards.refresh"),
      icon: "refresh",
      accessibilityLabel: `card-refresh-${card.id}`,
      onSelect: () => void refreshCard(deviceId, card.id),
    });
  }
  if (card.origin?.sessionId) {
    items.push({
      id: "conversation",
      label: tr("cards.openConversation"),
      icon: "message-circle",
      accessibilityLabel: `card-conversation-${card.id}`,
      onSelect: () => (options.onOpenConversation ?? (() => openCardConversation(deviceId, card)))(),
    });
  }
  items.push({
    id: "delete",
    label: tr("cards.delete"),
    icon: "trash",
    danger: true,
    separator: true,
    accessibilityLabel: `card-delete-${card.id}`,
    onSelect: () => {
      if (options.onRequestDelete) options.onRequestDelete();
      else void deleteCard(deviceId, card.id);
    },
  });
  return items;
}

// ── The card ─────────────────────────────────────────────────────────────────

export interface CardViewProps {
  deviceId: string;
  card: DesktopCard;
  /** `window`: fills its floating window (drag by the header); `inline`: a gallery card. */
  placement: "window" | "inline";
  /** The device's name, drawn on inline cards of another device. */
  deviceName?: string;
  /** The window's close: hides the card (the host keeps it). */
  onClose?: () => void;
  onOpenConversation?: () => void;
}

export function CardView(props: CardViewProps) {
  const confirmDelete = signal(false);
  const line = () => dataLine(props.card);
  const fleetDevice = () => fleetDeviceById(props.deviceId);
  return (
    <View
      testID={`card-${props.card.id}`}
      accessibilityLabel={`card-${props.card.id}`}
      style={{
        ...galleryCardStyle(),
        gap: space.md,
        flex: props.placement === "window" ? 1 : undefined,
        minHeight: props.placement === "window" ? 0 : INLINE_CARD_MIN_HEIGHT,
        ...(props.placement === "window" ? { borderRadius: radii.lg, overflow: "hidden" } : {}),
      }}
    >
      <View
        desktop={props.placement === "window" ? { windowDrag: true } : undefined}
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}
      >
        <If when={props.card.icon ? CARD_ICONS[props.card.icon] : undefined}>
          {icon => <Icon name={icon()} size={16} color={palette().textSecondary} />}
        </If>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...textStyle("body"), fontWeight: "500", numberOfLines: 1, textOverflow: "ellipsis" }}>
            {props.card.title}
          </Text>
          <If when={props.card.subtitle ?? ""}>
            {subtitle => <Text style={{ ...metaText(), numberOfLines: 1, textOverflow: "ellipsis" }}>{subtitle()}</Text>}
          </If>
        </View>
        <MoreMenu
          size="xs"
          accessibilityLabel={`card-menu-${props.card.id}`}
          tooltip={tr("cards.actions")}
          items={cardMenuItems(props.deviceId, props.card, {
            onOpenConversation: props.onOpenConversation,
            onRequestDelete: () => confirmDelete.set(true),
          })}
        />
        <If when={props.onClose}>
          {close => (
            <IconButton
              icon="close"
              size="xs"
              iconSize={12}
              accessibilityLabel={`card-close-${props.card.id}`}
              tooltip={tr("cards.hideFromDesktop")}
              onPress={() => close()()}
            />
          )}
        </If>
      </View>
      <If when={props.placement === "window" && cardActionError()}>
        {error => (
          <InlineBanner
            tone="danger"
            message={localizeHostError(error())}
            onDismiss={() => cardActionError.set("")}
          />
        )}
      </If>
      <If when={confirmDelete()}>
        <InlineConfirmBar
          danger
          message={props.card.title}
          confirmLabel={tr("cards.delete")}
          cancelLabel={tr("common.cancel")}
          onConfirm={() => {
            confirmDelete.set(false);
            void deleteCard(props.deviceId, props.card.id);
          }}
          onCancel={() => confirmDelete.set(false)}
        />
      </If>
      <CardBody deviceId={props.deviceId} card={props.card} placement={props.placement} />
      <If when={line() || (props.deviceName ? { text: "", failed: false } : null)}>
        {() => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}>
            <If when={props.deviceName ?? ""}>
              {name => (
                <DeviceBadge
                  name={name()}
                  kind={fleetDevice()?.hostKind}
                  exception={deviceException(fleetDevice()?.state)}
                  onPress={props.deviceId ? () => openDevicePage(props.deviceId) : undefined}
                />
              )}
            </If>
            <If when={line()?.text ?? ""}>
              {text => (
                <Text
                  style={{
                    ...metaText(),
                    flex: 1,
                    minWidth: 0,
                    color: line()?.failed ? palette().danger : palette().textMuted,
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {text()}
                </Text>
              )}
            </If>
          </View>
        )}
      </If>
    </View>
  );
}

// ── Lists ────────────────────────────────────────────────────────────────────

function deviceName(deviceId: string): string {
  if (!fleetActive()) return "";
  return fleetDeviceById(deviceId)?.name ?? "";
}

/** One device's cards as a gallery, in the host's order. */
export function CardsList(props: { deviceId: string; showDevice?: boolean; minColumn?: number }) {
  return (
    <GalleryGrid minColumn={props.minColumn ?? CARD_COLUMN} gap={space.md}>
      <Each of={cardsOf(props.deviceId)} key={card => card.id}>
        {card => (
          <CardView
            deviceId={props.deviceId}
            card={card()}
            placement="inline"
            deviceName={props.showDevice ? deviceName(props.deviceId) : undefined}
          />
        )}
      </Each>
    </GalleryGrid>
  );
}

/**
 * Library › Spaces: the cards of the device the Library looks at, with their
 * actions. A device that keeps no cards (a CLI host, an older desktop) says
 * so; one with cards turned off says that.
 */
export function CardsSection(props: { deviceId: string }) {
  effect(() => {
    const deviceId = props.deviceId;
    untracked(() => void loadDeviceCards(deviceId));
  });
  const problem = () => deviceCardsProblems()[props.deviceId];
  const list = () => deviceCards()[props.deviceId];
  const device = () => deviceName(props.deviceId) || tr("cards.thisDevice");
  return (
    <StudioSection title={tr("cards.title")} accessibilityLabel="cards-section">
      <If when={cardActionError()}>
        {error => <InlineBanner tone="danger" message={localizeHostError(error())} onDismiss={() => cardActionError.set("")} />}
      </If>
      <If when={list() === undefined && !problem()}>
        <GalleryGrid minColumn={CARD_COLUMN} gap={space.md}>
          <SkeletonBlock width="100%" height={INLINE_CARD_MIN_HEIGHT} borderRadius={radii.lg} />
          <SkeletonBlock width="100%" height={INLINE_CARD_MIN_HEIGHT} borderRadius={radii.lg} />
        </GalleryGrid>
      </If>
      <If when={problem()?.kind === "unsupported"}>
        <Text accessibilityLabel="cards-unsupported" style={metaText()}>
          {tr("cards.unsupported", { device: device() })}
        </Text>
      </If>
      <If when={problem()?.kind === "failed"}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
          <Text accessibilityLabel="cards-failed" style={{ ...metaText(), color: palette().danger, flexShrink: 1 }}>
            {tr("cards.loadFailed", { device: device() })}
          </Text>
          <Button
            label={tr("common.tryAgain")}
            size="xs"
            variant="ghost"
            accessibilityLabel="cards-retry"
            onPress={() => void loadDeviceCards(props.deviceId)}
          />
        </View>
      </If>
      <If when={list() && list()!.enabled === false}>
        <Text accessibilityLabel="cards-disabled" style={metaText()}>
          {tr("cards.turnedOff", { device: device() })}
        </Text>
      </If>
      <If when={list() && list()!.cards.length === 0}>
        <StudioEmpty icon="layout-grid" accessibilityLabel="cards-empty" message={tr("cards.emptyTitle")} detail={tr("cards.emptyBody")} />
      </If>
      <If when={(list()?.cards.length ?? 0) > 0}>
        <CardsList deviceId={props.deviceId} />
      </If>
    </StudioSection>
  );
}

/**
 * The OpenBitFun page on a phone or in a browser: the cards of the desktop
 * this client looks at (its device context, as the Library), with its name.
 * Other devices' cards are one device switch away; nothing reads every device
 * at start. The desktop draws its own cards as windows, so it shows none here.
 */
export function CardsStrip() {
  effect(() => {
    if (windowShellId() === "nsh-desktop") return;
    const deviceId = cardsDeviceForLibrary();
    untracked(() => void loadDeviceCards(deviceId));
  });
  const deviceId = () => cardsDeviceForLibrary();
  return (
    <If when={windowShellId() !== "nsh-desktop" && cardsOf(deviceId()).length > 0}>
      <StudioSection title={tr("cards.title")} accessibilityLabel="cards-strip">
        <CardsList deviceId={deviceId()} showDevice={fleetActive()} minColumn={CARD_COLUMN_NARROW} />
      </StudioSection>
    </If>
  );
}
