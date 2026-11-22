// The controller shell (visual spec §4.13): what a browser on the OpenBitFun
// domain (or the phone app) shows before it drives a device. Sign in with the
// email code (the shared sign-in column), then "Opening OpenBitFun…", then the
// UI itself — no device list, no device bar. Only when nothing can open does a
// quiet list of the account's devices show, under the reason and Try again.
// It draws the port's answers only: which devices exist, whether each can be
// connected and why not are the server's.

import { Scroll, effect, safeArea, signal, Text, untracked, View, type JSX } from "nsh";
import { formatRelativeTime } from "../format";
import { tr } from "../i18n";
import { compactLayout, controlHeight, layout, motionTiming, palette, radii, space, textStyle, touchSlop } from "../theme";
import { Icon } from "../ui/icons";
import { BrandSpinner, pressTransition, tactileActiveStyle } from "../ui/motion";
import { DeviceGlyph, EmptyStateCard, focusRingStyle } from "../ui/primitives";
import { SignInView } from "../ui/SignInView";
import type { ControllerDevice } from "./controllerPort";
import {
  connectControllerDevice,
  controllerAccount,
  controllerBusy,
  controllerChallenge,
  controllerConnecting,
  controllerDevices,
  controllerFailure,
  controllerPhase,
  requestControllerCode,
  restartControllerSignIn,
  signOutController,
  startController,
  verifyControllerCode,
  type ControllerFailure,
} from "./controllerStore";

const email = signal("");
const code = signal("");
/** When another code may be requested, from the challenge the server answered. */
const resendAt = signal<number | null>(null);
const shellWidth = signal(0);

/** The sign-in column starts at this share of the height (visual spec §4.1). */
const SIGN_IN_TOP_SHARE = 22;
/** "Opening OpenBitFun…" sits at this share of the height (visual spec §4.13). */
const OPENING_TOP_SHARE = 40;
/** On a phone the column starts this far down instead (96). */
const PHONE_SIGN_IN_TOP = space.x6l + space.x3l;
const OPENING_SPINNER = space.xxl;

function failureText(failure: ControllerFailure): string {
  switch (failure.code) {
    case "invalid_email":
      return tr("signin.errEmail");
    case "invalid_code":
      return tr("signin.errCode");
    case "rate_limited":
      return failure.retryAfterSeconds
        ? tr("signin.errRate", { seconds: String(failure.retryAfterSeconds) })
        : tr("controller.error.rateLimited");
    case "signed_out":
      return tr("controller.error.signedOut");
    case "network":
      return tr("signin.errNetwork");
    case "device_ui_unavailable":
      return failure.detail === "all" ? tr("controller.error.devicesUiUnavailable") : tr("controller.error.deviceUiUnavailable");
    case "page_outdated":
      return tr("launcher.pageOutdated");
    case "ui_verification_failed":
      return tr("launcher.verifyFailed");
    case "ui_load_failed":
      return tr("controller.error.uiLoad", { file: failure.detail ?? "" });
    default:
      // The server's own sentence (unreachable, unsupported, unavailable).
      return failure.message;
  }
}

function phone(): boolean {
  return shellWidth() > 0 && shellWidth() <= layout.phoneMaxWidth;
}

function SignInStep() {
  return (
    <SignInView
      idPrefix="controller"
      step={controllerPhase() === "code" ? "code" : "email"}
      busy={controllerBusy()}
      error={controllerFailure() ? failureText(controllerFailure()!) : ""}
      emailCode
      email={email()}
      onEmailChange={value => email.set(value)}
      onContinue={() => {
        if (email().trim()) void requestControllerCode(email());
      }}
      codeEmail={controllerChallenge()?.email ?? email()}
      codeLength={controllerChallenge()?.codeLength ?? undefined}
      code={code()}
      onCodeChange={value => code.set(value)}
      onSignIn={() => {
        if (code().trim()) void verifyControllerCode(code());
      }}
      resendAt={resendAt()}
      onResend={() => {
        code.set("");
        void requestControllerCode(controllerChallenge()?.email ?? email());
      }}
      onOtherEmail={() => {
        code.set("");
        restartControllerSignIn();
      }}
    />
  );
}

function deviceStatus(device: ControllerDevice): { text: string; warn: boolean } {
  const reason = device.unavailable;
  if (!reason) return { text: "", warn: false };
  if (reason.code === "offline" || !device.online) {
    const ago = formatRelativeTime(device.lastSeenAt ?? 0);
    return { text: ago ? tr("launcher.offline", { ago }) : tr("state.offline"), warn: false };
  }
  if (reason.code === "update_required" || reason.code === "unsupported") {
    return { text: tr("launcher.needsUpdate"), warn: true };
  }
  // The server's sentence for any other reason.
  return { text: reason.message, warn: false };
}

/** A quiet device row, 44 high: glyph · name · its exception in words. */
function DeviceRow(props: { device: () => ControllerDevice }) {
  const device = () => props.device();
  const usable = () => device().connectable && controllerConnecting() === null;
  return (
    <View
      role="button"
      accessibilityLabel={`controller-connect-${device().deviceId}`}
      accessibilityState={{ disabled: !usable() }}
      onPress={usable() ? () => void connectControllerDevice(device()) : undefined}
      style={{
        minHeight: layout.touchTarget,
        paddingHorizontal: space.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        borderRadius: radii.md,
        cursor: usable() ? "pointer" : "default",
        userSelect: "none",
        ...pressTransition(motionTiming.hover),
      }}
      hoverStyle={usable() ? { backgroundColor: palette().panelHover } : undefined}
      activeStyle={usable() ? tactileActiveStyle(0.985) : undefined}
      focusVisibleStyle={usable() ? focusRingStyle() : undefined}
    >
      <DeviceGlyph kind={device().kind ?? "laptop"} size={16} />
      <Text
        style={{
          ...textStyle("body"),
          flex: 1,
          minWidth: 0,
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {device().name}
      </Text>
      <If when={deviceStatus(device()).text}>
        {text => (
          <Text
            style={{
              ...textStyle("caption", {
                color: deviceStatus(device()).warn ? palette().warning : palette().textMuted,
                tabular: true,
              }),
              flexShrink: 1,
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {text()}
          </Text>
        )}
      </If>
      <If when={controllerConnecting() === device().deviceId}>
        <BrandSpinner variant="matrix" size={space.md} />
      </If>
      <If when={device().connectable && controllerConnecting() !== device().deviceId}>
        <Icon name="chevron-right" size={space.md} color={palette().textMuted} />
      </If>
    </View>
  );
}

/** Nothing could open: the reason, Try again, and the account's devices below. */
function NoneStep() {
  return (
    <View accessibilityLabel="controller-devices" style={{ width: "100%", maxWidth: layout.signInWidth, gap: space.xxl }}>
      <EmptyStateCard
        icon="monitor"
        title={tr("launcher.noneTitle")}
        subtitle={controllerFailure() ? failureText(controllerFailure()!) : tr("launcher.noneBody")}
        actionLabel={tr("launcher.tryAgain")}
        onAction={() => {
          if (!controllerBusy()) void startController();
        }}
        style={{ paddingVertical: 0, paddingHorizontal: 0 }}
      />
      <If when={(controllerDevices() ?? []).length > 0}>
        <View style={{ gap: space.xs }}>
          <Each of={controllerDevices() ?? []} key={device => device.deviceId}>
            {device => <DeviceRow device={device} />}
          </Each>
        </View>
      </If>
    </View>
  );
}

function OpeningStep(props: { label: string; accessibilityLabel: string }) {
  return (
    <View accessibilityLabel={props.accessibilityLabel} style={{ alignItems: "center", gap: space.md }}>
      <BrandSpinner variant="matrix" size={OPENING_SPINNER} />
      <Text style={textStyle("label", { color: palette().textSecondary })}>{props.label}</Text>
    </View>
  );
}

/** Footer of every launcher step: lock + "End-to-end encrypted" · "Sign out". */
function Footer() {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space.sm,
        paddingTop: space.lg,
        paddingBottom: space.x3l,
      }}
    >
      <Icon name="lock" size={space.md} color={palette().textMuted} />
      <Text style={textStyle("caption")}>{tr("launcher.encrypted")}</Text>
      <If when={controllerAccount() ? "1" : ""}>
        <Text style={textStyle("caption")}>·</Text>
        <View
          role="button"
          hitSlop={touchSlop(controlHeight.xs)}
          accessibilityLabel="controller-sign-out"
          onPress={() => void signOutController()}
          style={{
            minHeight: controlHeight.xs,
            paddingHorizontal: space.xs,
            borderRadius: radii.xs,
            justifyContent: "center",
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(motionTiming.hover),
          }}
          hoverStyle={{ backgroundColor: palette().panelHover }}
          activeStyle={tactileActiveStyle(0.97)}
          focusVisibleStyle={focusRingStyle()}
        >
          <Text style={textStyle("caption", { color: palette().textSecondary })} hoverStyle={{ color: palette().text }}>
            {tr("launcher.signOut")}
          </Text>
        </View>
      </If>
    </View>
  );
}

function Launcher() {
  const signingIn = () => controllerPhase() === "email" || controllerPhase() === "code";
  const topShare = () => (signingIn() || controllerPhase() === "devices" ? SIGN_IN_TOP_SHARE : OPENING_TOP_SHARE);
  return (
    <Scroll
      onLayout={event => {
        const width = event.bounds.size.width;
        if (width > 0 && Math.abs(width - shellWidth()) > 1) {
          shellWidth.set(width);
          compactLayout.set(phone());
        }
      }}
      style={{
        flex: 1,
        minHeight: 0,
        backgroundColor: palette().canvas,
      }}
      contentStyle={{
        flexGrow: 1,
        flexDirection: "column",
        alignItems: "stretch",
        paddingHorizontal: phone() ? space.xxl : layout.pageGutter,
      }}
    >
      <If
        when={phone() && signingIn()}
        else={<View style={{ flexGrow: topShare(), flexShrink: 1, minHeight: space.x3l }} />}
      >
        <View style={{ height: PHONE_SIGN_IN_TOP, flexShrink: 1 }} />
      </If>
      <View style={{ alignItems: "center", width: "100%" }}>
        <If when={controllerPhase() === "starting"}>
          {() => <OpeningStep label={tr("launcher.checking")} accessibilityLabel="controller-starting" />}
        </If>
        <If when={controllerPhase() === "opening"}>
          {() => <OpeningStep label={tr("launcher.opening")} accessibilityLabel="controller-opening" />}
        </If>
        <If when={signingIn()}>{() => <SignInStep />}</If>
        <If when={controllerPhase() === "devices"}>{() => <NoneStep />}</If>
      </View>
      <View style={{ flexGrow: 100 - topShare(), flexShrink: 1, minHeight: space.x3l }} />
      <Footer />
    </Scroll>
  );
}

/**
 * The controller entry: the launcher steps until a device is connected, then
 * `children` (the UI) filling the page.
 */
export function ControllerShell(props: { children: () => JSX.Element }) {
  void startController();
  effect(() => {
    const challenge = controllerChallenge();
    untracked(() => resendAt.set(challenge ? Date.now() + challenge.retryAfterSeconds * 1000 : null));
  });
  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        backgroundColor: palette().canvas,
        // A phone's status bar, notch and home indicator (zero elsewhere).
        paddingTop: safeArea().top,
        paddingBottom: safeArea().bottom,
        paddingLeft: safeArea().left,
        paddingRight: safeArea().right,
      }}
    >
      <If when={controllerPhase() === "connected"}>
        {() => (
          <View accessibilityLabel="controller-studio" style={{ flex: 1, minHeight: 0 }}>
            {props.children()}
          </View>
        )}
      </If>
      <If when={controllerPhase() !== "connected"}>{() => <Launcher />}</If>
    </View>
  );
}
