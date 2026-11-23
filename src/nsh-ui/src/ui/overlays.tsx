// Layer-4 overlay primitives: ModalDialog (Dialog), anchored DropdownMenu,
// SelectDropdown, ContextMenuOverlay, and Sonner-grade ToastHost.
// Built with origin-aware popover transitions, single-layer clean backdrops,
// flex-bounded scrolling, pause-on-hover toasts, and Break-UI overflow guards.

import {
  Overlay,
  Scroll,
  Text,
  View,
  cleanup,
  createMotion,
  effect,
  keymap,
  lifecycle,
  reduceMotion,
  safeArea,
  signal,
  type Align,
  type Bounds,
  type JSX,
  type Placement,
  type Point,
  type StyleProp,
  type ViewRef,
  type ViewStyle,
} from "nsh";
import { Dialog, Input } from "nsh/base";
import { tr } from "../i18n";
import {
  compactLayout,
  concentricRadius,
  controlHeight,
  elevationShadow,
  fontMono,
  isLightAppearance,
  layout,
  palette,
  radii,
  space,
  textLineHeight,
  textSize,
  textTracking,
  touchSlop,
} from "../theme";
import { Icon, type IconName } from "./icons";
import {
  MOTION_DURATION,
  MOTION_EASE_STANDARD_BEZIER,
  drawerEnterMotion,
  enterMotion,
  modalEnterMotion,
  paintTransition,
  popoverEnterMotion,
  popoverOrigin,
  pressTransition,
  tactileActiveStyle,
} from "./motion";
import { focusRingStyle } from "./primitives";

export type ModalSize = "sm" | "md" | "lg" | "xl";

// LIFO Escape stack so Escape always dismisses only the topmost open modal,
// menu, drawer, or sheet — even when no `<Input>` inside it holds focus.
const escapeStack: Array<() => void> = [];
let unbindEscapeKey: (() => void) | null = null;

function syncEscapeBinding(): void {
  if (escapeStack.length > 0 && !unbindEscapeKey) {
    try {
      unbindEscapeKey = keymap.bind("escape", () => {
        const top = escapeStack[escapeStack.length - 1];
        if (top) top();
      });
    } catch {
      unbindEscapeKey = null;
    }
  } else if (escapeStack.length === 0 && unbindEscapeKey) {
    const stop = unbindEscapeKey;
    unbindEscapeKey = null;
    stop();
  }
}

/**
 * Registers an Escape-key dismiss handler on the topmost overlay stack and
 * returns an unregister callback. Call inside a mounted overlay/sheet/drawer
 * and pair with `cleanup(...)`.
 */
export function registerEscapeDismiss(onDismiss: () => void): () => void {
  escapeStack.push(onDismiss);
  syncEscapeBinding();
  return () => {
    const idx = escapeStack.lastIndexOf(onDismiss);
    if (idx >= 0) escapeStack.splice(idx, 1);
    syncEscapeBinding();
  };
}

function modalMaxWidth(size: ModalSize): number {
  if (size === "sm") return 420;
  if (size === "lg") return 700;
  if (size === "xl") return 860;
  return 540;
}

export interface ModalHeaderProps {
  title: string;
  subtitle?: string;
  right?: JSX.Element;
  onClose?: () => void;
}

export function ModalHeader(props: ModalHeaderProps) {
  const hasSubtitle = () => Boolean(props.subtitle);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: hasSubtitle() ? "flex-start" : "center",
        flexShrink: 0,
        gap: space.md,
        paddingHorizontal: compactLayout() ? space.lg : space.xl,
        paddingTop: compactLayout() ? space.md : space.lg,
        paddingBottom: compactLayout() ? space.md : space.lg,
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(16),
            fontWeight: "600",
            letterSpacing: textTracking(16),
            lineHeight: textLineHeight(16, 22 / 16),
          }}
        >
          {props.title}
        </Text>
        <If when={props.subtitle ?? ""}>
          {subtitleText => (
            <Text
              style={{
                color: palette().textElevatedMuted,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.45),
              }}
            >
              {subtitleText()}
            </Text>
          )}
        </If>
      </View>
      <If when={Boolean(props.right)}>
        <View style={{ flexShrink: 0 }}>{props.right}</View>
      </If>
      <If when={Boolean(props.onClose)}>
        <View
          role="button"
          accessibilityLabel="modal-close"
          hitSlop={touchSlop(controlHeight.sm)}
          onPress={props.onClose}
          style={{
            width: controlHeight.sm,
            height: controlHeight.sm,
            marginTop: hasSubtitle() ? -2 : 0,
            marginRight: -space.xs,
            flexShrink: 0,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{ backgroundColor: palette().buttonSecondaryHover }}
          activeStyle={tactileActiveStyle(0.96, { backgroundColor: palette().buttonSecondaryPressed })}
          focusVisibleStyle={focusRingStyle()}
        >
          <Icon name="close" size={14} color={palette().textElevatedMuted} />
        </View>
      </If>
    </View>
  );
}

export interface ModalBodyProps {
  children?: JSX.Element;
  style?: StyleProp<ViewStyle>;
}

export function ModalBody(props: ModalBodyProps) {
  return (
    <Scroll
      style={[{ flexShrink: 1, minHeight: 0 }, props.style]}
      contentStyle={{
        paddingHorizontal: compactLayout() ? space.lg : space.xl,
        paddingTop: space.lg,
        paddingBottom: space.lg,
        gap: space.lg,
      }}
    >
      {props.children}
    </Scroll>
  );
}

export interface ModalFooterProps {
  children?: JSX.Element;
}

export function ModalFooter(props: ModalFooterProps) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "flex-end",
        gap: space.sm,
        paddingHorizontal: compactLayout() ? space.lg : space.xl,
        paddingTop: space.md,
        paddingBottom: compactLayout() ? space.md + safeArea().bottom : space.md,
        borderTopWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().surfaceSubtle,
      }}
    >
      {props.children}
    </View>
  );
}

export interface ModalDialogProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  size?: ModalSize;
  footer?: JSX.Element;
  closeOnBackdropPress?: boolean;
  closeOnEscape?: boolean;
  accessibilityLabel?: string;
  onClose: () => void;
  children?: JSX.Element;
}

function ModalCard(props: ModalDialogProps) {
  // Centered modal on desktop; bottom sheet with grab handle on phone (<720).
  const isSheet = compactLayout();
  const motion = isSheet ? drawerEnterMotion("bottom") : modalEnterMotion();
  if (props.closeOnEscape !== false) {
    cleanup(registerEscapeDismiss(() => props.onClose()));
  }
  return (
    <View
      role="dialog"
      accessibilityLabel={props.accessibilityLabel ?? props.title ?? "Dialog"}
      style={[
        {
          width: "100%",
          maxWidth: compactLayout() ? "100%" : modalMaxWidth(props.size ?? "md"),
          maxHeight: "90%",
          borderTopLeftRadius: radii.xl,
          borderTopRightRadius: radii.xl,
          borderBottomLeftRadius: compactLayout() ? 0 : radii.xl,
          borderBottomRightRadius: compactLayout() ? 0 : radii.xl,
          borderCurve: "continuous",
          borderWidth: 1,
          borderBottomWidth: compactLayout() ? 0 : 1,
          borderColor: palette().border,
          backgroundColor: palette().surfaceElevated,
          boxShadow: `${elevationShadow(3)}, ${palette().innerHighlight}`,
          overflow: "hidden",
          flexDirection: "column",
          paddingBottom: compactLayout() && !props.footer ? safeArea().bottom : 0,
          transformOrigin: compactLayout() ? "bottom center" : "center",
        },
        motion.style,
      ]}
    >
      <If when={compactLayout()}>
        <View style={{ alignItems: "center", paddingTop: space.sm, paddingBottom: space.xs, flexShrink: 0 }}>
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: radii.pill,
              backgroundColor: palette().borderStrong,
            }}
          />
        </View>
      </If>
      <If when={props.title ?? ""}>
        {titleText => (
          <ModalHeader
            title={titleText()}
            subtitle={props.subtitle}
            onClose={props.onClose}
          />
        )}
      </If>
      <ModalBody>{props.children}</ModalBody>
      <If when={Boolean(props.footer)}>
        <ModalFooter>{props.footer}</ModalFooter>
      </If>
    </View>
  );
}

export function ModalDialog(props: ModalDialogProps) {
  return (
    <If when={props.open}>
      <Dialog
        open={props.open}
        animation="none"
        accessibilityLabel={props.accessibilityLabel ?? props.title ?? "Dialog"}
        closeOnBackdropPress={props.closeOnBackdropPress ?? true}
        closeOnEscape={props.closeOnEscape ?? true}
        onOpenChange={event => {
          if (!event.open) props.onClose();
        }}
        onCancel={props.closeOnEscape === false ? undefined : props.onClose}
        backdropStyle={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          backgroundColor: palette().scrimBg,
          backdropFilter: "blur(14px)",
        }}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          padding: compactLayout() ? 0 : space.xl,
          alignItems: compactLayout() ? "stretch" : "center",
          justifyContent: compactLayout() ? "flex-end" : "center",
          pointerEvents: "box-none",
        }}
      >
        <ModalCard {...props} />
      </Dialog>
    </If>
  );
}

export interface DropdownMenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Optional second-line muted description below `label`. */
  hint?: string;
  /** Compact single-line right-aligned muted hint on the same row as `label`. */
  trailingHint?: string;
  shortcut?: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Renders a subtle hairline divider above this item. */
  separator?: boolean;
  /** Non-interactive section group header label (e.g. "Peer Devices", "SSH Hosts"). */
  header?: boolean;
  /** Transforms this menu row in-place into "Cancel | Confirm" instead of popping a modal. */
  confirmDelete?: boolean;
  /** Optional label for the in-place confirm button (defaults to `tr("common.confirm")`). */
  confirmLabel?: string;
  /** Optional accessibilityLabel for the in-place confirm button. */
  confirmAccessibilityLabel?: string;
  /** Optional accessibilityLabel for the in-place cancel button. */
  cancelAccessibilityLabel?: string;
  accessibilityLabel?: string;
  onSelect?: () => void;
}

export interface DropdownMenuProps {
  open: boolean;
  anchor: ViewRef | Point | Bounds | null | undefined;
  items: ReadonlyArray<DropdownMenuItem>;
  placement?: Placement;
  align?: Align;
  offset?: number;
  minWidth?: number;
  maxHeight?: number;
  onClose: () => void;
}

const MENU_OUTER_RADIUS = radii.lg;
const MENU_PADDING = 5;
const MENU_ITEM_RADIUS = concentricRadius(MENU_OUTER_RADIUS, MENU_PADDING);

function MenuSurface(props: {
  items: ReadonlyArray<DropdownMenuItem>;
  placement: Placement;
  align: Align;
  minWidth: number;
  maxHeight: number;
  onClose: () => void;
}) {
  const motion = popoverEnterMotion(props.placement, props.align, MOTION_DURATION.popover);
  const confirmingId = signal<string | null>(null);
  cleanup(registerEscapeDismiss(() => props.onClose()));
  return (
    <View
      role="menu"
      style={[
        {
          minWidth: props.minWidth,
          maxWidth: 340,
          maxHeight: props.maxHeight,
          padding: MENU_PADDING,
          borderRadius: MENU_OUTER_RADIUS,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().glassOverlayBg,
          backdropFilter: "blur(16px) saturate(1.2)",
          boxShadow: `${elevationShadow(2)}, ${palette().innerHighlight}`,
          transformOrigin: popoverOrigin(props.placement, props.align),
          gap: 2,
        },
        motion.style,
      ]}
    >
      <Scroll
        style={{
          flexShrink: 1,
          minHeight: 0,
          maxHeight: Math.max(96, props.maxHeight - MENU_PADDING * 2),
        }}
        scrollbar={true}
      >
        <View style={{ gap: 2 }}>
          <Each of={props.items} key={item => item.id}>
            {item => (
              <View style={{ gap: 2 }}>
                <If when={Boolean(item().separator)}>
                  <View
                    style={{
                      height: 1,
                      marginVertical: 4,
                      marginHorizontal: 6,
                      backgroundColor: palette().borderSubtle,
                    }}
                  />
                </If>
                <If when={Boolean(item().header) && Boolean(item().label)}>
                  <View
                    style={{
                      paddingHorizontal: space.sm,
                      paddingTop: space.sm,
                      paddingBottom: space.xs,
                      pointerEvents: "none",
                    }}
                  >
                    <Text
                      style={{
                        color: palette().textElevatedMuted,
                        fontSize: textSize(11),
                        fontWeight: "600",
                        letterSpacing: 0.2,
                        lineHeight: textLineHeight(11, 1.3),
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item().label}
                    </Text>
                  </View>
                </If>
                <If when={!item().header && Boolean(item().label)}>
                  <If
                    when={Boolean(item().confirmDelete && confirmingId() === item().id)}
                    else={
                      <View
                        role="menuitem"
                        disabled={item().disabled}
                        accessibilityLabel={item().accessibilityLabel ?? item().label}
                        accessibilityState={{
                          disabled: Boolean(item().disabled),
                          selected: Boolean(item().active),
                        }}
                        onPress={() => {
                          if (item().disabled) return;
                          if (item().confirmDelete) {
                            confirmingId.set(item().id);
                            return;
                          }
                          props.onClose();
                          item().onSelect?.();
                        }}
                        style={{
                          minHeight: compactLayout() ? layout.touchTarget : 30,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.sm,
                          paddingHorizontal: space.sm,
                          paddingVertical: space.chip,
                          borderRadius: MENU_ITEM_RADIUS,
                          borderCurve: "continuous",
                          backgroundColor: item().active
                            ? palette().surfaceSubtle
                            : "transparent",
                          cursor: item().disabled ? "not-allowed" : "pointer",
                          userSelect: "none",
                          ...pressTransition(MOTION_DURATION.fast),
                        }}
                        hoverStyle={{
                          backgroundColor: item().disabled
                            ? "transparent"
                            : item().danger
                              ? palette().dangerSoft
                              : palette().panelHover,
                        }}
                        activeStyle={tactileActiveStyle(0.985, {
                          backgroundColor: item().danger
                            ? palette().dangerHoverBg
                            : palette().panelHover,
                        })}
                        focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -1 }}
                        disabledStyle={{ opacity: 0.45 }}
                      >
                        <If when={item().icon ?? ""}>
                          {iconName => (
                            <Icon
                              name={iconName() as IconName}
                              size={14}
                              color={
                                item().danger
                                  ? palette().danger
                                  : item().active
                                    ? palette().text
                                    : palette().textSecondary
                              }
                            />
                          )}
                        </If>
                        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                          <Text
                            style={{
                              color: item().danger ? palette().danger : palette().text,
                              fontSize: textSize(13),
                              fontWeight: item().active ? "500" : "400",
                              lineHeight: textLineHeight(13, 1.24),
                              numberOfLines: 1,
                              textOverflow: "ellipsis",
                            }}
                          >
                            {item().label}
                          </Text>
                          <If when={item().hint ?? ""}>
                            {hintText => (
                              <Text
                                style={{
                                  color: palette().textElevatedMuted,
                                  fontSize: textSize(12),
                                  lineHeight: textLineHeight(12, 1.35),
                                  numberOfLines: 2,
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {hintText()}
                              </Text>
                            )}
                          </If>
                        </View>
                        <If when={item().trailingHint ?? ""}>
                          {trailingText => (
                            <Text
                              style={{
                                flexShrink: 0,
                                maxWidth: 120,
                                color: palette().textElevatedMuted,
                                fontSize: textSize(11),
                                fontWeight: "500",
                                lineHeight: textLineHeight(11, 1.24),
                                numberOfLines: 1,
                                textOverflow: "ellipsis",
                              }}
                            >
                              {trailingText()}
                            </Text>
                          )}
                        </If>
                        <If when={item().shortcut ?? ""}>
                          {shortcutText => (
                            <Text
                              style={{
                                flexShrink: 0,
                                color: palette().textElevatedMuted,
                                fontFamily: fontMono,
                                fontSize: textSize(11),
                                fontWeight: "500",
                                fontVariant: ["tabular-nums"],
                                lineHeight: textLineHeight(11, 1.24),
                              }}
                            >
                              {shortcutText()}
                            </Text>
                          )}
                        </If>
                        <If when={Boolean(item().active)}>
                          <Icon name="check" size={13} color={palette().accent} />
                        </If>
                      </View>
                    }
                  >
                    <View
                      accessibilityLabel={`${item().id}-inline-confirm`}
                      style={{
                        minHeight: compactLayout() ? layout.touchTarget : 30,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.xs,
                        paddingHorizontal: space.xs,
                        paddingVertical: 3,
                        borderRadius: MENU_ITEM_RADIUS,
                        borderCurve: "continuous",
                        backgroundColor: palette().dangerSoft,
                      }}
                    >
                      <View
                        role="button"
                        accessibilityLabel={item().cancelAccessibilityLabel ?? `${item().id}-cancel`}
                        onPress={() => confirmingId.set(null)}
                        style={{
                          flex: 1,
                          height: compactLayout() ? 32 : 24,
                          borderRadius: radii.xs,
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          userSelect: "none",
                          ...pressTransition(MOTION_DURATION.fast),
                        }}
                        hoverStyle={{ backgroundColor: palette().panelHover }}
                        activeStyle={tactileActiveStyle(0.96)}
                        focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -1 }}
                      >
                        <Text
                          style={{
                            color: palette().text,
                            fontSize: textSize(12),
                            lineHeight: textLineHeight(12, 1.25),
                            fontWeight: "500",
                          }}
                        >
                          {tr("common.cancel")}
                        </Text>
                      </View>
                      <View style={{ width: 1, height: 14, backgroundColor: palette().borderSubtle }} />
                      <View
                        role="button"
                        accessibilityLabel={item().confirmAccessibilityLabel ?? `${item().id}-confirm`}
                        onPress={() => {
                          confirmingId.set(null);
                          props.onClose();
                          item().onSelect?.();
                        }}
                        style={{
                          flex: 1,
                          height: compactLayout() ? 32 : 24,
                          borderRadius: radii.xs,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: palette().danger,
                          cursor: "pointer",
                          userSelect: "none",
                          ...pressTransition(MOTION_DURATION.fast),
                        }}
                        hoverStyle={{ opacity: 0.92 }}
                        activeStyle={tactileActiveStyle(0.96)}
                        focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -1 }}
                      >
                        <Text
                          style={{
                            color: palette().actionPrimaryFg,
                            fontSize: textSize(12),
                            lineHeight: textLineHeight(12, 1.25),
                            fontWeight: "600",
                          }}
                        >
                          {item().confirmLabel ?? tr("common.confirm")}
                        </Text>
                      </View>
                    </View>
                  </If>
                </If>
              </View>
            )}
          </Each>
        </View>
      </Scroll>
    </View>
  );
}

export function DropdownMenu(props: DropdownMenuProps) {
  const effectivePlacement = signal<Placement | null>(null);
  const availableHeight = signal<number | null>(null);

  const resolvedPlacement = (): Placement =>
    effectivePlacement() ?? props.placement ?? "bottom";

  const resolvedMaxHeight = (): number => {
    const requested = props.maxHeight ?? 440;
    const avail = availableHeight();
    if (avail && avail > 0) return Math.max(120, Math.min(requested, Math.floor(avail - 4)));
    return requested;
  };

  return (
    <If when={props.open}>
      <Overlay
        anchor={props.anchor ?? null}
        placement={props.placement ?? "bottom"}
        align={props.align ?? "start"}
        offset={props.offset ?? 6}
        margin={8}
        onPosition={pos => {
          effectivePlacement.set(pos.placement);
          availableHeight.set(pos.available.height);
        }}
        onPressOutside={() => {
          effectivePlacement.set(null);
          availableHeight.set(null);
          props.onClose();
        }}
        onCancel={() => {
          effectivePlacement.set(null);
          availableHeight.set(null);
          props.onClose();
        }}
      >
        <MenuSurface
          items={props.items}
          placement={resolvedPlacement()}
          align={props.align ?? "start"}
          minWidth={props.minWidth ?? 200}
          maxHeight={resolvedMaxHeight()}
          onClose={() => {
            effectivePlacement.set(null);
            availableHeight.set(null);
            props.onClose();
          }}
        />
      </Overlay>
    </If>
  );
}

export interface ContextMenuOverlayProps {
  open: boolean;
  position: Point | null;
  items: ReadonlyArray<DropdownMenuItem>;
  onClose: () => void;
}

export function ContextMenuOverlay(props: ContextMenuOverlayProps) {
  const effectivePlacement = signal<Placement>("bottom");
  const availableHeight = signal<number | null>(null);

  const resolvedMaxHeight = (): number => {
    const avail = availableHeight();
    if (avail && avail > 0) return Math.max(120, Math.min(400, Math.floor(avail - 4)));
    return 400;
  };

  const closeMenu = () => {
    effectivePlacement.set("bottom");
    availableHeight.set(null);
    props.onClose();
  };

  return (
    <If when={props.open && Boolean(props.position)}>
      <Overlay
        anchor={props.position ?? null}
        placement="bottom"
        align="start"
        offset={2}
        margin={8}
        onPosition={pos => {
          effectivePlacement.set(pos.placement);
          availableHeight.set(pos.available.height);
        }}
        onPressOutside={closeMenu}
        onCancel={closeMenu}
      >
        <MenuSurface
          items={props.items}
          placement={effectivePlacement()}
          align="start"
          minWidth={190}
          maxHeight={resolvedMaxHeight()}
          onClose={closeMenu}
        />
      </Overlay>
    </If>
  );
}

export interface SelectDropdownOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  icon?: IconName;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export type SelectDropdownVariant = "default" | "ghost";
export type SelectDropdownSize = "sm" | "md";

export interface SelectDropdownProps<T extends string = string> {
  options: ReadonlyArray<SelectDropdownOption<T>>;
  value: T | null | undefined;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  variant?: SelectDropdownVariant;
  size?: SelectDropdownSize;
  disabled?: boolean;
  accessibilityLabel?: string;
  minWidth?: number;
  maxWidth?: number;
  /** Stretch trigger horizontally to fill its parent container (e.g. a `ConfigRow` rail). */
  fullWidth?: boolean;
  placement?: Placement;
  align?: Align;
  style?: StyleProp<ViewStyle>;
  onChange: (value: T) => void;
}

const SELECT_OUTER_RADIUS = radii.lg;
const SELECT_PADDING = 5;
const SELECT_INNER_RADIUS = concentricRadius(SELECT_OUTER_RADIUS, SELECT_PADDING);

function SelectPopoverSurface<T extends string>(props: {
  options: ReadonlyArray<SelectDropdownOption<T>>;
  value: T | null | undefined;
  placement: Placement;
  align: Align;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  minWidth: number;
  maxHeight: number;
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  cleanup(registerEscapeDismiss(() => props.onClose()));
  const motion = popoverEnterMotion(props.placement, props.align, MOTION_DURATION.popover);
  const listMaxHeight = () =>
    Math.max(96, props.maxHeight - (props.searchable ? 56 : 12));

  return (
    <View
      style={[
        {
          minWidth: props.minWidth,
          maxWidth: 340,
          maxHeight: props.maxHeight,
          padding: SELECT_PADDING,
          borderRadius: SELECT_OUTER_RADIUS,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().glassOverlayBg,
          backdropFilter: "blur(16px) saturate(1.2)",
          boxShadow: `${elevationShadow(2)}, ${palette().innerHighlight}`,
          transformOrigin: popoverOrigin(props.placement, props.align),
          gap: 6,
        },
        motion.style,
      ]}
    >
      <If when={Boolean(props.searchable)}>
        <View
          style={{
            boxSizing: "border-box",
            height: compactLayout() ? 36 : controlHeight.sm,
            minHeight: compactLayout() ? 36 : controlHeight.sm,
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: space.chip,
            paddingHorizontal: space.sm,
            paddingVertical: 0,
            borderRadius: SELECT_INNER_RADIUS,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().inputBg,
            ...paintTransition(MOTION_DURATION.fast),
          }}
          focusWithinStyle={{
            borderColor: palette().fieldFocusBorder,
            boxShadow: `0 0 0 2px ${palette().accentSoft}`,
          }}
        >
          <Icon name="search" size={13} color={palette().textElevatedMuted} />
          <Input
            autoFocus
            value={props.query}
            placeholder={props.searchPlaceholder ?? `${tr("common.filter")}…`}
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              minHeight: compactLayout() ? 34 : controlHeight.sm - 2,
              color: palette().text,
              placeholderColor: palette().textElevatedMuted,
              caretColor: palette().accent,
              fontSize: compactLayout() ? Math.max(16, textSize(14)) : textSize(12),
            }}
            onChange={e => props.onQueryChange(e.value)}
            onSubmit={() => {
              const first = props.options.find(opt => !opt.disabled);
              if (first) props.onSelect(first.value);
            }}
            onKeyPress={e => {
              if (e.key === "Escape") props.onClose();
            }}
          />
        </View>
      </If>
      <Scroll
        style={{ flexShrink: 1, minHeight: 0, maxHeight: listMaxHeight() }}
        scrollbar={true}
      >
        <View style={{ gap: space.hair }}>
          <Each of={props.options} key={opt => opt.value}>
            {opt => (
              <View
                role="option"
                disabled={opt().disabled}
                accessibilityLabel={opt().accessibilityLabel ?? opt().label}
                accessibilityState={{
                  selected: opt().value === props.value,
                  disabled: Boolean(opt().disabled),
                }}
                onPress={() => {
                  if (opt().disabled) return;
                  props.onSelect(opt().value);
                }}
                style={{
                  minHeight: compactLayout() ? layout.touchTarget : 30,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  paddingHorizontal: space.sm,
                  paddingVertical: space.chip,
                  borderRadius: SELECT_INNER_RADIUS,
                  borderCurve: "continuous",
                  backgroundColor:
                    opt().value === props.value ? palette().accentSoft : "transparent",
                  cursor: opt().disabled ? "not-allowed" : "pointer",
                  userSelect: "none",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{
                  backgroundColor: opt().disabled
                    ? "transparent"
                    : opt().value === props.value
                      ? palette().accentSoft
                      : palette().panelHover,
                }}
                activeStyle={tactileActiveStyle(0.985, {
                  backgroundColor:
                    opt().value === props.value ? palette().accentSoft : palette().panelHover,
                })}
                focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -1 }}
                disabledStyle={{ opacity: 0.45 }}
              >
                <If when={opt().icon ?? ""}>
                  {iconName => (
                    <Icon
                      name={iconName() as IconName}
                      size={14}
                      color={
                        opt().value === props.value
                          ? palette().accent
                          : palette().textSecondary
                      }
                    />
                  )}
                </If>
                <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(13),
                      fontWeight: opt().value === props.value ? "500" : "400",
                      lineHeight: textLineHeight(13, 1.24),
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {opt().label}
                  </Text>
                  <If when={opt().description ?? ""}>
                    {desc => (
                      <Text
                        style={{
                          color: palette().textElevatedMuted,
                          fontSize: textSize(12),
                          lineHeight: textLineHeight(12, 1.35),
                          numberOfLines: 2,
                          textOverflow: "ellipsis",
                        }}
                      >
                        {desc()}
                      </Text>
                    )}
                  </If>
                </View>
                <If when={opt().value === props.value}>
                  <Icon name="check" size={13} color={palette().accent} />
                </If>
              </View>
            )}
          </Each>
          <If when={props.options.length === 0}>
            <View style={{ alignItems: "center", paddingHorizontal: space.md, paddingVertical: space.lg }}>
              <Text
                style={{
                  color: palette().textElevatedMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.4),
                  textAlign: "center",
                }}
              >
                {props.emptyLabel ?? tr("common.noMatchingOptions")}
              </Text>
            </View>
          </If>
        </View>
      </Scroll>
    </View>
  );
}

export function SelectDropdown<T extends string = string>(props: SelectDropdownProps<T>) {
  const open = signal(false);
  const query = signal("");
  const anchorRef = signal<ViewRef | null>(null);
  const effectivePlacement = signal<Placement | null>(null);
  const availableHeight = signal<number | null>(null);

  const selectedLabel = () => {
    const match = props.options.find(opt => opt.value === props.value);
    return match ? match.label : props.placeholder ?? tr("common.selectEllipsis");
  };

  const visibleOptions = () => {
    const needle = query().trim().toLowerCase();
    if (!needle) return props.options;
    return props.options.filter(
      opt =>
        opt.label.toLowerCase().includes(needle) ||
        (opt.description ?? "").toLowerCase().includes(needle),
    );
  };

  const closeMenu = () => {
    open.set(false);
    query.set("");
    effectivePlacement.set(null);
    availableHeight.set(null);
  };

  const resolvedMinWidth = (): number | undefined => {
    if (props.minWidth !== undefined) return props.minWidth;
    if ((props.variant ?? "default") === "ghost") return 0;
    if (props.maxWidth !== undefined) return Math.min(160, props.maxWidth);
    return 160;
  };

  const resolvedMaxHeight = (): number => {
    const avail = availableHeight();
    if (avail && avail > 0) return Math.max(120, Math.min(340, Math.floor(avail - 4)));
    return 340;
  };

  return (
    <View
      style={[
        {
          flex: props.fullWidth ? 1 : undefined,
          width: props.fullWidth ? "100%" : undefined,
          minWidth: props.fullWidth ? 0 : resolvedMinWidth(),
          maxWidth: props.maxWidth ?? "100%",
          flexShrink: 1,
        },
        props.style,
      ]}
    >
      <View
        ref={el => anchorRef.set(el)}
        role="combobox"
        disabled={props.disabled}
        hitSlop={touchSlop((props.size ?? "md") === "sm" ? controlHeight.sm : controlHeight.md)}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityState={{
          expanded: open(),
          disabled: Boolean(props.disabled),
        }}
        onPress={() => {
          if (props.disabled) return;
          if (open()) closeMenu();
          else open.set(true);
        }}
        style={{
          boxSizing: "border-box",
          height: (props.size ?? "md") === "sm" ? controlHeight.sm : controlHeight.md,
          maxWidth: "100%",
          paddingHorizontal: (props.variant ?? "default") === "ghost" ? space.sm : space.md,
          paddingVertical: 0,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor:
            (props.variant ?? "default") === "ghost"
              ? open()
                ? palette().border
                : "transparent"
              : open()
                ? palette().fieldFocusBorder
                : isLightAppearance()
                  ? palette().border
                  : palette().borderSubtle,
          backgroundColor:
            (props.variant ?? "default") === "ghost"
              ? open()
                ? palette().surfaceSubtle
                : "transparent"
              : palette().buttonSecondaryBg,
          boxShadow:
            (props.variant ?? "default") === "ghost"
              ? undefined
              : open()
                ? `0 0 0 3px ${palette().accentSoft}`
                : undefined,
          flexDirection: "row",
          alignItems: "center",
          gap: (props.variant ?? "default") === "ghost" ? space.xs : space.sm,
          cursor: props.disabled ? "not-allowed" : "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{
          borderColor:
            (props.variant ?? "default") === "ghost"
              ? open()
                ? palette().border
                : "transparent"
              : props.disabled
                ? isLightAppearance()
                  ? palette().border
                  : palette().borderSubtle
                : isLightAppearance()
                  ? palette().borderStrong
                  : palette().border,
          backgroundColor:
            props.disabled
              ? (props.variant ?? "default") === "ghost"
                ? "transparent"
                : palette().buttonSecondaryBg
              : (props.variant ?? "default") === "ghost"
                ? palette().surfaceSubtle
                : palette().buttonSecondaryHover,
        }}
        activeStyle={tactileActiveStyle(0.98)}
        focusVisibleStyle={focusRingStyle()}
        disabledStyle={{ opacity: 0.48 }}
      >
        <Text
          style={{
            flex: (props.variant ?? "default") === "ghost" ? undefined : 1,
            flexShrink: 1,
            minWidth: 0,
            color: props.options.some(opt => opt.value === props.value)
              ? palette().text
              : palette().textElevatedMuted,
            fontSize: textSize((props.size ?? "md") === "sm" ? 12 : 13),
            lineHeight: textLineHeight((props.size ?? "md") === "sm" ? 12 : 13, 1.15),
            fontWeight: "500",
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {selectedLabel()}
        </Text>
        <Icon
          name={open() ? "chevron-up" : "chevron-down"}
          size={(props.size ?? "md") === "sm" ? 12 : 13}
          color={palette().textElevatedMuted}
        />
      </View>

      <If when={open()}>
        <Overlay
          anchor={anchorRef()}
          placement={props.placement ?? "bottom"}
          align={props.align ?? "start"}
          offset={4}
          margin={8}
          onPosition={pos => {
            effectivePlacement.set(pos.placement);
            availableHeight.set(pos.available.height);
          }}
          onPressOutside={closeMenu}
          onCancel={closeMenu}
        >
          <SelectPopoverSurface
            options={visibleOptions()}
            value={props.value}
            placement={effectivePlacement() ?? props.placement ?? "bottom"}
            align={props.align ?? "start"}
            searchable={props.searchable}
            searchPlaceholder={props.searchPlaceholder}
            emptyLabel={props.emptyLabel}
            minWidth={Math.max(200, props.minWidth ?? 180)}
            maxHeight={resolvedMaxHeight()}
            query={query()}
            onQueryChange={q => query.set(q)}
            onSelect={val => {
              closeMenu();
              props.onChange(val);
            }}
            onClose={closeMenu}
          />
        </Overlay>
      </If>
    </View>
  );
}

export type ToastTone = "neutral" | "info" | "success" | "warning" | "danger" | "error";

export interface ToastEntry {
  id: string;
  message: string;
  tone: ToastTone;
}

interface InternalToastEntry extends ToastEntry {
  exiting?: boolean;
}

interface ToastTimerState {
  timer: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
  startedAt: number;
}

const TOAST_EXIT_MS = 160;
const toasts = signal<InternalToastEntry[]>([]);
const toastTimers = new Map<string, ToastTimerState>();
const toastExitTimers = new Map<string, ReturnType<typeof setTimeout>>();
let toastSeq = 0;
let toastsPaused = false;

function clearToastTimer(id: string): void {
  const rec = toastTimers.get(id);
  if (rec?.timer) clearTimeout(rec.timer);
  toastTimers.delete(id);
}

function removeToastNow(id: string): void {
  clearToastTimer(id);
  const exitHandle = toastExitTimers.get(id);
  if (exitHandle) {
    clearTimeout(exitHandle);
    toastExitTimers.delete(id);
  }
  toasts.update(current => current.filter(item => item.id !== id));
}

function scheduleToastTimer(id: string, ms: number): void {
  clearToastTimer(id);
  if (ms <= 0) return;
  if (toastsPaused) {
    toastTimers.set(id, { timer: null, remainingMs: ms, startedAt: 0 });
    return;
  }
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    toastTimers.delete(id);
    dismissToast(id);
  }, ms);
  toastTimers.set(id, { timer, remainingMs: ms, startedAt });
}

function setToastsPaused(paused: boolean): void {
  if (toastsPaused === paused) return;
  toastsPaused = paused;
  const now = Date.now();
  if (paused) {
    for (const [id, rec] of toastTimers.entries()) {
      if (rec.timer) {
        clearTimeout(rec.timer);
        const elapsed = rec.startedAt > 0 ? Math.max(0, now - rec.startedAt) : 0;
        rec.remainingMs = Math.max(450, rec.remainingMs - elapsed);
        rec.timer = null;
        rec.startedAt = 0;
        toastTimers.set(id, rec);
      }
    }
  } else {
    for (const [id, rec] of Array.from(toastTimers.entries())) {
      if (!rec.timer && rec.remainingMs > 0) {
        scheduleToastTimer(id, rec.remainingMs);
      }
    }
  }
}

export function dismissToast(id: string): void {
  clearToastTimer(id);
  const existing = toasts().find(item => item.id === id);
  if (!existing || existing.exiting) return;
  toasts.update(current =>
    current.map(item => (item.id === id ? { ...item, exiting: true } : item)),
  );
  const exitHandle = setTimeout(() => {
    toastExitTimers.delete(id);
    removeToastNow(id);
  }, reduceMotion() ? 80 : TOAST_EXIT_MS);
  toastExitTimers.set(id, exitHandle);
}

function defaultToastDurationMs(tone: ToastTone): number {
  if (tone === "danger" || tone === "error") return 8000;
  return 4000;
}

export function pushToast(
  message: string,
  tone: ToastTone = "neutral",
  durationMs?: number,
): string {
  const resolvedDuration = durationMs !== undefined ? durationMs : defaultToastDurationMs(tone);
  const id = `toast-${++toastSeq}`;
  const current = toasts();
  const active = current.filter(t => !t.exiting);
  if (active.length >= 3) {
    const dropped = active.slice(0, active.length - 2);
    for (const d of dropped) clearToastTimer(d.id);
    const dropIds = new Set(dropped.map(d => d.id));
    toasts.set([...current.filter(item => !dropIds.has(item.id)), { id, message, tone }]);
  } else {
    toasts.set([...current, { id, message, tone }]);
  }
  if (resolvedDuration > 0) {
    scheduleToastTimer(id, resolvedDuration);
  }
  return id;
}

function toastToneTokens(tone: ToastTone): {
  color: string;
  border: string;
  icon: IconName;
} {
  if (tone === "success") {
    return {
      color: palette().success,
      border: palette().successBorder,
      icon: "check-circle",
    };
  }
  if (tone === "warning") {
    return {
      color: palette().warning,
      border: palette().warningBorder,
      icon: "warning",
    };
  }
  if (tone === "danger" || tone === "error") {
    return {
      color: palette().danger,
      border: palette().dangerBorder,
      icon: "alert-circle",
    };
  }
  if (tone === "info") {
    return {
      color: palette().accent,
      border: palette().accentBorder,
      icon: "info",
    };
  }
  return {
    color: palette().textSecondary,
    border: palette().border,
    icon: "info",
  };
}

function ToastCard(props: { entry: InternalToastEntry }) {
  const fromTop = compactLayout();
  const motion = createMotion({
    enter: reduceMotion()
      ? {
          keyframes: { opacity: [0, 1] },
          duration: 120,
          easing: "ease",
          ignoreReduceMotion: true,
        }
      : {
          keyframes: {
            opacity: [0, 1],
            translateY: [fromTop ? -10 : 10, 0],
            scale: [0.97, 1],
          },
          duration: MOTION_DURATION.toast,
          easing: MOTION_EASE_STANDARD_BEZIER,
        },
  });

  let exitPlayed = false;
  effect(() => {
    if (props.entry.exiting && !exitPlayed) {
      exitPlayed = true;
      void motion.play(
        reduceMotion()
          ? {
              keyframes: { opacity: [1, 0] },
              duration: 80,
              easing: "ease",
              ignoreReduceMotion: true,
            }
          : {
              keyframes: {
                opacity: [1, 0],
                translateY: [0, fromTop ? -6 : 6],
                scale: [1, 0.97],
              },
              duration: TOAST_EXIT_MS,
              easing: MOTION_EASE_STANDARD_BEZIER,
            },
      );
    }
  });

  return (
    <View
      role="alert"
      accessibilityLabel={props.entry.message}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: toastToneTokens(props.entry.tone).border,
          backgroundColor: palette().glassOverlayBg,
          backdropFilter: "blur(16px) saturate(1.2)",
          boxShadow: elevationShadow(2),
          width: compactLayout() ? "100%" : undefined,
          maxWidth: compactLayout() ? "100%" : 380,
        },
        motion.style,
      ]}
    >
      <View style={{ flexShrink: 0 }}>
        <Icon
          name={toastToneTokens(props.entry.tone).icon}
          size={15}
          color={toastToneTokens(props.entry.tone).color}
        />
      </View>
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: palette().text,
          fontSize: textSize(13),
          fontWeight: "500",
          lineHeight: textLineHeight(13, 1.4),
          numberOfLines: 3,
          textOverflow: "ellipsis",
        }}
      >
        {props.entry.message}
      </Text>
      <View
        role="button"
        accessibilityLabel={`dismiss-${props.entry.id}`}
        hitSlop={touchSlop(controlHeight.xs)}
        onPress={() => dismissToast(props.entry.id)}
        style={{
          width: controlHeight.xs,
          height: controlHeight.xs,
          flexShrink: 0,
          borderRadius: radii.xs,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
        activeStyle={tactileActiveStyle(0.96, { backgroundColor: palette().panelHover })}
        focusVisibleStyle={focusRingStyle()}
      >
        <Icon name="close" size={12} color={palette().textElevatedMuted} />
      </View>
    </View>
  );
}

export function ToastHost() {
  const hovered = signal(false);

  effect(() => {
    const appHidden = lifecycle() !== "active";
    setToastsPaused(hovered() || appHidden);
  });

  cleanup(() => {
    setToastsPaused(false);
  });

  return (
    <If when={toasts().length > 0}>
      <Overlay
        style={
          compactLayout()
            ? {
                left: space.sm,
                right: space.sm,
                top: layout.phoneTopBarHeight + safeArea().top + space.sm,
                alignItems: "stretch",
                pointerEvents: "box-none",
              }
            : {
                right: space.xl,
                bottom: space.xl,
                alignItems: "flex-end",
                pointerEvents: "box-none",
              }
        }
      >
        <View
          onMouseEnter={() => hovered.set(true)}
          onMouseLeave={() => hovered.set(false)}
          style={{
            gap: space.sm,
            alignItems: compactLayout() ? "stretch" : "flex-end",
            pointerEvents: "box-none",
          }}
        >
          <Each of={toasts()} key={item => item.id}>
            {item => <ToastCard entry={item()} />}
          </Each>
        </View>
      </Overlay>
    </If>
  );
}
