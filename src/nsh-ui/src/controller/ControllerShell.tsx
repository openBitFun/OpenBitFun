// The controller shell: what a browser on the OpenBitFun domain (or the phone
// app) shows before it drives a device — sign in with the email code, pick one
// of the account's devices, connect — and the thin bar above the studio while
// it drives one. It draws the port's answers only: which devices exist, whether
// each can be connected and why not are the server's.

import { safeArea, signal, Text, View, type JSX } from "nsh";
import { formatRelativeTime } from "../format";
import { tr } from "../i18n";
import { palette, radii, textSize, textStyle } from "../theme";
import { Button, DeviceGlyph, InlineBanner, TextField } from "../ui/primitives";
import { controllerPort, type ControllerDevice } from "./controllerPort";
import {
  connectControllerDevice,
  controllerAccount,
  controllerBusy,
  controllerChallenge,
  controllerConnecting,
  controllerConnectMs,
  controllerDevice,
  controllerDevices,
  controllerFailure,
  controllerPhase,
  leaveControllerDevice,
  refreshControllerDevices,
  requestControllerCode,
  restartControllerSignIn,
  signOutController,
  startController,
  verifyControllerCode,
  type ControllerFailure,
} from "./controllerStore";

const email = signal("");
const code = signal("");

function failureText(failure: ControllerFailure): string {
  switch (failure.code) {
    case "invalid_email":
      return tr("controller.error.invalidEmail");
    case "invalid_code":
      return tr("controller.error.invalidCode");
    case "rate_limited":
      return failure.retryAfterSeconds
        ? tr("controller.error.rateLimitedFor", { seconds: String(failure.retryAfterSeconds) })
        : tr("controller.error.rateLimited");
    case "signed_out":
      return tr("controller.error.signedOut");
    case "network":
      return tr("controller.error.network");
    default:
      // The server's own sentence (unreachable, unsupported, unavailable).
      return failure.message;
  }
}

function FailureBanner() {
  return (
    <If when={controllerFailure()}>
      {failure => (
        <InlineBanner tone="warning" message={failureText(failure())} accessibilityLabel="controller-error" />
      )}
    </If>
  );
}

function Card(props: { children: JSX.Element; accessibilityLabel: string }) {
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      style={{
        width: "100%",
        maxWidth: 440,
        gap: 16,
        padding: 24,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().border,
        backgroundColor: palette().canvas,
      }}
    >
      {props.children}
    </View>
  );
}

function Heading(props: { title: string; detail?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={textStyle("pageTitle")}>{props.title}</Text>
      <If when={props.detail ?? ""}>{detail => <Text style={textStyle("body", { color: palette().textSecondary })}>{detail()}</Text>}</If>
    </View>
  );
}

function EmailStep() {
  const submit = () => {
    if (email().trim()) void requestControllerCode(email());
  };
  return (
    <Card accessibilityLabel="controller-email">
      <Heading title={tr("controller.signIn.title")} detail={tr("controller.signIn.detail")} />
      <TextField
        value={email()}
        onChange={value => email.set(value)}
        onSubmit={submit}
        label={tr("controller.signIn.email")}
        placeholder="name@example.com"
        content="email"
        autoFocus
        accessibilityLabel="controller-email-input"
      />
      <FailureBanner />
      <Button
        label={tr("controller.signIn.sendCode")}
        variant="primary"
        fullWidth
        loading={controllerBusy()}
        disabled={controllerBusy() || !email().trim()}
        accessibilityLabel="controller-send-code"
        onPress={submit}
      />
    </Card>
  );
}

function CodeStep() {
  const submit = () => {
    if (code().trim()) void verifyControllerCode(code());
  };
  return (
    <Card accessibilityLabel="controller-code">
      <Heading
        title={tr("controller.code.title")}
        detail={tr("controller.code.detail", {
          email: controllerChallenge()?.email ?? email(),
          length: String(controllerChallenge()?.codeLength ?? 8),
        })}
      />
      <TextField
        value={code()}
        onChange={value => code.set(value)}
        onSubmit={submit}
        label={tr("controller.code.label")}
        placeholder="12345678"
        monospace
        content="one-time-code"
        autoFocus
        accessibilityLabel="controller-code-input"
      />
      <FailureBanner />
      <Button
        label={tr("controller.code.verify")}
        variant="primary"
        fullWidth
        loading={controllerBusy()}
        disabled={controllerBusy() || !code().trim()}
        accessibilityLabel="controller-verify"
        onPress={submit}
      />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button
          label={tr("controller.code.resend")}
          variant="ghost"
          size="sm"
          disabled={controllerBusy()}
          accessibilityLabel="controller-resend"
          onPress={() => void requestControllerCode(controllerChallenge()?.email ?? email())}
        />
        <Button
          label={tr("controller.code.otherEmail")}
          variant="ghost"
          size="sm"
          accessibilityLabel="controller-other-email"
          onPress={() => {
            code.set("");
            restartControllerSignIn();
          }}
        />
      </View>
    </Card>
  );
}

function deviceDetail(device: ControllerDevice): string {
  if (device.unavailable) return device.unavailable.message;
  const parts = [device.os, device.clientVersion ? `OpenBitFun ${device.clientVersion}` : null].filter(Boolean);
  return parts.join(" · ");
}

function DeviceRow(props: { device: () => ControllerDevice }) {
  const device = () => props.device();
  return (
    <View
      accessibilityLabel={`controller-device-${device().deviceId}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderColor: palette().border,
      }}
    >
      {/* The directory's presence is a hint (hosts on Link keep no relay socket): no red dot. */}
      <DeviceGlyph kind={device().kind ?? "laptop"} status={device().online ? "online" : undefined} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={textStyle("cardTitle")}>{device().name}</Text>
        <Text style={textStyle("caption")}>{deviceDetail(device())}</Text>
        <If when={!device().online && device().lastSeenAt}>
          {() => (
            <Text style={textStyle("meta")}>
              {tr("controller.devices.lastSeen", { time: formatRelativeTime(device().lastSeenAt ?? 0) })}
            </Text>
          )}
        </If>
      </View>
      <Button
        label={tr("controller.devices.connect")}
        variant={device().connectable ? "primary" : "secondary"}
        size="sm"
        loading={controllerConnecting() === device().deviceId}
        disabled={!device().connectable || controllerConnecting() !== null}
        accessibilityLabel={`controller-connect-${device().deviceId}`}
        onPress={() => void connectControllerDevice(device())}
      />
    </View>
  );
}

function DevicesStep() {
  return (
    <Card accessibilityLabel="controller-devices">
      <Heading
        title={tr("controller.devices.title")}
        detail={tr("controller.devices.signedInAs", {
          account: controllerAccount()?.email ?? controllerAccount()?.login ?? controllerAccount()?.accountId ?? "",
        })}
      />
      <FailureBanner />
      <If when={controllerDevices()}>
        {devices => (
          <View>
            <If when={devices().length === 0}>
              <Text style={textStyle("body", { color: palette().textSecondary })}>{tr("controller.devices.none")}</Text>
            </If>
            <Each of={devices()} key={device => device.deviceId}>
              {device => <DeviceRow device={device} />}
            </Each>
          </View>
        )}
      </If>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button
          label={tr("controller.devices.refresh")}
          variant="secondary"
          size="sm"
          leadingIcon="refresh"
          loading={controllerBusy()}
          disabled={controllerBusy()}
          accessibilityLabel="controller-refresh"
          onPress={() => void refreshControllerDevices()}
        />
        <Button
          label={tr("controller.signOut")}
          variant="ghost"
          size="sm"
          accessibilityLabel="controller-sign-out"
          onPress={() => void signOutController()}
        />
      </View>
      <Text style={textStyle("micro", { color: palette().textMuted })}>
        {controllerPort()?.kind === "native" ? tr("controller.devices.privacyApp") : tr("controller.devices.privacy")}
      </Text>
    </Card>
  );
}

/** The bar above the studio while this window drives a device. */
function DeviceBar() {
  return (
    <View
      accessibilityLabel="controller-bar"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderBottomWidth: 1,
        borderColor: palette().border,
        backgroundColor: palette().canvas,
      }}
    >
      <Text style={[textStyle("caption"), { flex: 1, fontSize: textSize(12) }]}>
        {tr("controller.bar.driving", {
          device: controllerDevice()?.name ?? "",
          time: String(controllerConnectMs() ?? 0),
        })}
      </Text>
      <Button
        label={tr("controller.bar.switch")}
        variant="ghost"
        size="sm"
        accessibilityLabel="controller-switch-device"
        onPress={() => void leaveControllerDevice()}
      />
    </View>
  );
}

/**
 * The controller entry: the sign-in and device steps until a device is
 * connected, then `children` (the studio) under the device bar.
 */
export function ControllerShell(props: { children: () => JSX.Element }) {
  void startController();
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
          <View style={{ flex: 1, minHeight: 0, flexDirection: "column" }}>
            <DeviceBar />
            <View style={{ flex: 1, minHeight: 0 }}>{props.children()}</View>
          </View>
        )}
      </If>
      <If when={controllerPhase() !== "connected"}>
        {() => (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
              backgroundColor: palette().canvas,
            }}
          >
            <View style={{ alignItems: "center", gap: 4, marginBottom: 20 }}>
              <Text style={textStyle("display")}>{tr("product.name")}</Text>
              <Text style={textStyle("caption")}>{tr("controller.tagline")}</Text>
            </View>
            <If when={controllerPhase() === "starting"}>
              <Text style={textStyle("caption")}>{tr("controller.starting")}</Text>
            </If>
            <If when={controllerPhase() === "email"}>{() => <EmailStep />}</If>
            <If when={controllerPhase() === "code"}>{() => <CodeStep />}</If>
            <If when={controllerPhase() === "devices"}>{() => <DevicesStep />}</If>
          </View>
        )}
      </If>
    </View>
  );
}
