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
  lifecycle,
  reduceMotion,
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
  concentricRadius,
  controlHeight,
  fontMono,
  isLightAppearance,
  palette,
  radii,
  textLineHeight,
  textSize,
  textTracking,
} from "../theme";
import { Icon, type IconName } from "./icons";
import {
  MOTION_DURATION,
  MOTION_EASE_STANDARD_BEZIER,
  enterMotion,
  paintTransition,
  popoverEnterMotion,
  popoverOrigin,
  pressTransition,
  tactileActiveStyle,
} from "./motion";

export type ModalSize = "sm" | "md" | "lg" | "xl";

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
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(15.5),
            fontWeight: "600",
            letterSpacing: textTracking(15.5),
            lineHeight: textLineHeight(15.5, 1.28),
          }}
        >
          {props.title}
        </Text>
        <If when={props.subtitle ?? ""}>
          {subtitleText => (
            <Text
              style={{
                color: palette().textElevatedMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.42),
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
          hitSlop={4}
          onPress={props.onClose}
          style={{
            width: controlHeight.sm,
            height: controlHeight.sm,
            flexShrink: 0,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
          activeStyle={tactileActiveStyle(0.94, { backgroundColor: palette().panelHover })}
          focusVisibleStyle={{
            outlineWidth: 2,
            outlineColor: palette().borderFocus,
            outlineOffset: 2,
          }}
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
      contentStyle={{ paddingHorizontal: 20, paddingVertical: 18, gap: 16 }}
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
        gap: 8,
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: "transparent",
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
  // Modals are viewport-centered (never trigger-anchored), so center origin is intentional.
  const motion = enterMotion("zoomIn", MOTION_DURATION.base);
  return (
    <View
      role="dialog"
      accessibilityLabel={props.accessibilityLabel ?? props.title ?? "Dialog"}
      style={[
        {
          width: "100%",
          maxWidth: modalMaxWidth(props.size ?? "md"),
          maxHeight: "90%",
          borderRadius: radii.xl,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surfaceElevated,
          boxShadow: `${palette().shadowOverlay}, ${palette().innerHighlight}`,
          overflow: "hidden",
          flexDirection: "column",
          transformOrigin: "center",
        },
        motion.style,
      ]}
    >
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
          backdropFilter: "blur(6px)",
        }}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          padding: 24,
          alignItems: "center",
          justifyContent: "center",
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
          boxShadow: `${palette().shadowOverlay}, ${palette().innerHighlight}`,
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
                      marginVertical: 3,
                      marginHorizontal: 4,
                      backgroundColor: palette().borderSubtle,
                    }}
                  />
                </If>
                <If when={Boolean(item().header) && Boolean(item().label)}>
                  <View
                    style={{
                      paddingHorizontal: 9,
                      paddingTop: 6,
                      paddingBottom: 3,
                      pointerEvents: "none",
                    }}
                  >
                    <Text
                      style={{
                        color: palette().textElevatedMuted,
                        fontSize: textSize(10),
                        fontWeight: "600",
                        letterSpacing: textTracking(10, true),
                        textTransform: "uppercase",
                        lineHeight: textLineHeight(10, 1.24),
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item().label}
                    </Text>
                  </View>
                </If>
                <If when={!item().header && Boolean(item().label)}>
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
                      props.onClose();
                      item().onSelect?.();
                    }}
                    style={{
                      minHeight: 30,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingHorizontal: 9,
                      paddingVertical: 5,
                      borderRadius: MENU_ITEM_RADIUS,
                      borderCurve: "continuous",
                      backgroundColor: item().active
                        ? palette().surfaceSubtle
                        : "transparent",
                      cursor: item().disabled ? "not-allowed" : "pointer",
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
                    focusVisibleStyle={{
                      outlineWidth: 2,
                      outlineColor: palette().borderFocus,
                      outlineOffset: -1,
                    }}
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
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Text
                        style={{
                          color: item().danger ? palette().danger : palette().text,
                          fontSize: textSize(12.5),
                          fontWeight: item().active ? "600" : "500",
                          lineHeight: textLineHeight(12.5, 1.24),
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
                              fontSize: textSize(10.5),
                              lineHeight: textLineHeight(10.5, 1.35),
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
                            fontSize: textSize(10.5),
                            fontWeight: "500",
                            fontVariant: ["tabular-nums"],
                            lineHeight: textLineHeight(10.5, 1.24),
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
          boxShadow: `${palette().shadowOverlay}, ${palette().innerHighlight}`,
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
            height: controlHeight.sm,
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 8,
            paddingVertical: 0,
            borderRadius: SELECT_INNER_RADIUS,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().inputBg,
            boxShadow: palette().shadowInset,
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
              color: palette().text,
              placeholderColor: palette().textElevatedMuted,
              caretColor: palette().accent,
              fontSize: textSize(12),
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
        <View style={{ gap: 2 }}>
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
                  minHeight: 30,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 9,
                  paddingVertical: 5,
                  borderRadius: SELECT_INNER_RADIUS,
                  borderCurve: "continuous",
                  backgroundColor:
                    opt().value === props.value ? palette().accentSoft : "transparent",
                  cursor: opt().disabled ? "not-allowed" : "pointer",
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
                focusVisibleStyle={{
                  outlineWidth: 2,
                  outlineColor: palette().borderFocus,
                  outlineOffset: -1,
                }}
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
                <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <Text
                    style={{
                      color:
                        opt().value === props.value
                          ? palette().text
                          : palette().textSecondary,
                      fontSize: textSize(12.5),
                      fontWeight: opt().value === props.value ? "600" : "500",
                      lineHeight: textLineHeight(12.5, 1.24),
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
                          fontSize: textSize(10.5),
                          lineHeight: textLineHeight(10.5, 1.35),
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
            <Text
              style={{
                color: palette().textElevatedMuted,
                fontSize: textSize(11.5),
                lineHeight: textLineHeight(11.5, 1.4),
                paddingHorizontal: 9,
                paddingVertical: 8,
              }}
            >
              {props.emptyLabel ?? tr("common.noMatchingOptions")}
            </Text>
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
          paddingHorizontal: (props.variant ?? "default") === "ghost" ? 8 : 11,
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
                : isLightAppearance()
                  ? palette().shadowButton
                  : undefined,
          flexDirection: "row",
          alignItems: "center",
          gap: (props.variant ?? "default") === "ghost" ? 5 : 8,
          cursor: props.disabled ? "not-allowed" : "pointer",
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
        focusVisibleStyle={{
          outlineWidth: 2,
          outlineColor: palette().borderFocus,
          outlineOffset: 2,
        }}
        disabledStyle={{ opacity: 0.48 }}
      >
        <Text
          style={{
            flex: (props.variant ?? "default") === "ghost" ? undefined : 1,
            flexShrink: 1,
            minWidth: 0,
            color: props.options.some(opt => opt.value === props.value)
              ? palette().text
              : palette().textMuted,
            fontSize: textSize((props.size ?? "md") === "sm" ? 12 : 12.5),
            lineHeight: textLineHeight((props.size ?? "md") === "sm" ? 12 : 12.5, 1.15),
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
          color={palette().textMuted}
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

export function pushToast(
  message: string,
  tone: ToastTone = "neutral",
  durationMs = 3200,
): string {
  const id = `toast-${++toastSeq}`;
  const current = toasts();
  const active = current.filter(t => !t.exiting);
  if (active.length >= 4) {
    const dropped = active.slice(0, active.length - 3);
    for (const d of dropped) clearToastTimer(d.id);
    const dropIds = new Set(dropped.map(d => d.id));
    toasts.set([...current.filter(item => !dropIds.has(item.id)), { id, message, tone }]);
  } else {
    toasts.set([...current, { id, message, tone }]);
  }
  if (durationMs > 0) {
    scheduleToastTimer(id, durationMs);
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
  const motion = createMotion({
    enter: reduceMotion()
      ? {
          keyframes: { opacity: [0, 1] },
          duration: 120,
          easing: "ease",
          ignoreReduceMotion: true,
        }
      : {
          keyframes: { opacity: [0, 1], translateY: [10, 0], scale: [0.97, 1] },
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
              keyframes: { opacity: [1, 0], translateY: [0, 6], scale: [1, 0.97] },
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
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: toastToneTokens(props.entry.tone).border,
          backgroundColor: palette().glassOverlayBg,
          backdropFilter: "blur(16px) saturate(1.2)",
          boxShadow: `${palette().shadowOverlay}, ${palette().innerHighlight}`,
          maxWidth: 440,
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
          fontSize: textSize(12.5),
          fontWeight: "500",
          lineHeight: textLineHeight(12.5, 1.4),
          numberOfLines: 3,
          textOverflow: "ellipsis",
        }}
      >
        {props.entry.message}
      </Text>
      <View
        role="button"
        accessibilityLabel={`dismiss-${props.entry.id}`}
        hitSlop={4}
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
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
        activeStyle={tactileActiveStyle(0.92, { backgroundColor: palette().panelHover })}
        focusVisibleStyle={{
          outlineWidth: 2,
          outlineColor: palette().borderFocus,
          outlineOffset: 2,
        }}
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
        style={{
          left: 0,
          right: 0,
          bottom: 20,
          alignItems: "center",
          pointerEvents: "box-none",
        }}
      >
        <View
          onMouseEnter={() => hovered.set(true)}
          onMouseLeave={() => hovered.set(false)}
          style={{ gap: 6, alignItems: "center", pointerEvents: "box-none" }}
        >
          <Each of={toasts()} key={item => item.id}>
            {item => <ToastCard entry={item()} />}
          </Each>
        </View>
      </Overlay>
    </If>
  );
}
