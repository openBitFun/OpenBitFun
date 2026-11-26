// The one sign-in column (visual spec §4.1, §4.13): the desktop's first run and
// account dialog and the browser launcher draw the same steps with the same copy.
//
// It is display only: the caller owns the flow (which step, the email, the code,
// the errors and every action) and passes them in, so the browser's and phone's
// controller port and the desktop host's account commands (`account_email_*`)
// all drive the same email and code steps. GitHub, the secondary option, is
// the only sign-in that goes through the user's browser (`browser`). One step
// replaces the next with a 160 ms crossfade; there is no stepper.

import { cleanup, effect, signal, Text, untracked, View, type JSX } from "nsh";
import { Input } from "nsh/base";
import { tr } from "../i18n";
import {
  compactLayout,
  controlHeight,
  fontMono,
  layout,
  motionTiming,
  palette,
  radii,
  space,
  textSize,
  textStyle,
  touchSlop,
} from "../theme";
import { DeviceBadge, type DeviceException } from "./fleet";
import { enterMotion, MOTION_DURATION, paintTransition, pressTransition, tactileActiveStyle } from "./motion";
import { Button, TextField, focusRingStyle } from "./primitives";
import { OpenBitFunLogoMark } from "./studio";
import { superAgentUi } from "../productGates"; // wave23-E

/**
 * The steps, in order. `browser` is the GitHub sign-in, the secondary option:
 * GitHub's own page in the user's browser authorizes it.
 */
export type SignInStep = "email" | "code" | "browser" | "ready" | "model";

/** One of the account's other devices on the "ready" step (backend facts only). */
export interface SignInDevice {
  deviceId: string;
  name: string;
  kind?: string;
  exception?: DeviceException | null;
}

export interface SignInViewProps {
  /** Prefixes every accessibility label (`controller`, `account-auth`). */
  idPrefix: string;
  step: SignInStep;
  /** Draw the matrix, title and body (full-canvas screens); a dialog draws them in its header. */
  header?: boolean;
  busy?: boolean;
  /** The failure to show under the field (already worded). */
  error?: string;

  // email
  /** Whether this host signs in with the email code; without it Continue starts the browser sign-in. */
  emailCode: boolean;
  email?: string;
  onEmailChange?: (value: string) => void;
  onContinue: () => void;
  /** "Use on this device only" (desktop only). */
  onLocalOnly?: () => void;
  /** "Sign in with GitHub": the secondary sign-in in the browser, when the host offers it. */
  onGitHub?: () => void;

  // code
  codeEmail?: string;
  codeLength?: number;
  code?: string;
  onCodeChange?: (value: string) => void;
  onSignIn?: () => void;
  onResend?: () => void;
  /** When another code may be requested (epoch ms); `null` = now. */
  resendAt?: number | null;
  onOtherEmail?: () => void;

  // browser
  browserCode?: string;
  browserExpired?: boolean;
  onCopyCode?: () => void;
  codeCopied?: boolean;
  onOpenPage?: () => void;
  onCheck?: () => void;
  onRestart?: () => void;
  onCancel?: () => void;
  /** A status line in place of "Waiting for you to confirm…" (the host's last answer). */
  browserNote?: string;

  // ready
  deviceName?: string;
  otherDevices?: SignInDevice[];
  onCopyInstall?: () => void;
  onOpenPhone?: () => void;
  onStart?: () => void;

  // model
  onChooseModel?: () => void;
  onLater?: () => void;
}

/** The step's title, for a dialog header. */
export function signInStepTitle(props: Pick<SignInViewProps, "step" | "deviceName">): string {
  switch (props.step) {
    case "code":
      return tr("signin.codeTitle");
    case "browser":
      return tr("signin.browserTitle");
    case "ready":
      return tr("signin.ready", { device: props.deviceName ?? "" });
    case "model":
      return tr("signin.modelTitle");
    default:
      return tr("signin.title");
  }
}

/** The step's one line under the title, for a dialog header. */
export function signInStepBody(props: Pick<SignInViewProps, "step" | "codeEmail" | "email">): string {
  switch (props.step) {
    case "code":
      return tr("signin.codeBody", { email: props.codeEmail ?? props.email ?? "" });
    case "browser":
      return tr("signin.githubBody");
    case "ready":
      return "";
    // wave23-E: the copy names Super Agent only while that gate is on (`productGates.ts`).
    case "model":
      return tr(superAgentUi() ? "signin.modelBody" : "gate.signinModelBody");
    default:
      return tr(superAgentUi() ? "signin.body" : "gate.signinBody");
  }
}

/** OpenBitFun's canonical fine-line hexagonal brand mark (`assets/brand/source/openbitfun-mark.svg`). */
export function BitMatrixMark(props: { size: number; color?: string }) {
  return (
    <OpenBitFunLogoMark
      size={props.size}
      color={props.color ?? palette().text}
      accessibilityLabel={tr("product.name")}
    />
  );
}

function Fade(props: { children: JSX.Element }) {
  const motion = enterMotion("fadeIn", motionTiming.crossfade);
  return <View style={[{ gap: space.lg, width: "100%" }, motion.style]}>{props.children}</View>;
}

function Header(outer: { p: SignInViewProps }) {
  const props = outer.p;
  return (
    <View style={{ alignItems: "center", width: "100%" }}>
      <OpenBitFunLogoMark size={MARK_SIZE} color={palette().text} accessibilityLabel={tr("product.name")} />
      <Text
        style={{
          ...textStyle("display"),
          marginTop: space.xl,
          textAlign: "center",
        }}
      >
        {signInStepTitle(props)}
      </Text>
      <If when={signInStepBody(props)}>
        {body => (
          <Text
            style={{
              ...textStyle("body", { color: palette().textSecondary }),
              marginTop: space.sm,
              textAlign: "center",
            }}
          >
            {body()}
          </Text>
        )}
      </If>
    </View>
  );
}

const MARK_SIZE = 56;

/** Phone buttons are 48 high (visual spec §4.1), the code field's height. */
function tallButton() {
  return compactLayout() ? { height: CODE_FIELD_HEIGHT } : undefined;
}

function ErrorLine(props: { text?: string; idPrefix: string }) {
  return (
    <If when={props.text ?? ""}>
      {text => (
        <Text
          role="alert"
          accessibilityLabel={`${props.idPrefix}-error`}
          style={textStyle("label", { color: palette().danger })}
        >
          {text()}
        </Text>
      )}
    </If>
  );
}

function LinkButton(props: {
  label: string;
  accessibilityLabel: string;
  disabled?: boolean;
  tabular?: boolean;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      hitSlop={touchSlop(controlHeight.sm)}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      onPress={props.disabled ? undefined : props.onPress}
      style={{
        alignSelf: "center",
        minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
        paddingHorizontal: space.sm,
        borderRadius: radii.md,
        justifyContent: "center",
        cursor: props.disabled ? "default" : "pointer",
        userSelect: "none",
        opacity: props.disabled ? 0.4 : 1,
        ...pressTransition(motionTiming.hover),
      }}
      hoverStyle={props.disabled ? undefined : { backgroundColor: palette().panelHover }}
      activeStyle={props.disabled ? undefined : tactileActiveStyle(0.97)}
      focusVisibleStyle={props.disabled ? undefined : focusRingStyle()}
    >
      <Text style={textStyle("label", { color: palette().textSecondary, tabular: props.tabular })}>
        {props.label}
      </Text>
    </View>
  );
}

function EmailStep(outer: { p: SignInViewProps }) {
  const props = outer.p;
  const submit = () => {
    if (props.busy) return;
    if (!props.emailCode || (props.email ?? "").trim()) props.onContinue();
  };
  return (
    <Fade>
      <If when={props.emailCode}>
        <TextField
          value={props.email ?? ""}
          onChange={value => props.onEmailChange?.(value)}
          onSubmit={submit}
          label={tr("signin.email")}
          placeholder={tr("signin.emailPlaceholder")}
          content="email"
          size="lg"
          autoFocus
          accessibilityLabel={`${props.idPrefix}-email-input`}
        />
      </If>
      <ErrorLine text={props.error} idPrefix={props.idPrefix} />
      <Button
        label={tr("signin.continue")}
        variant="primary"
        size="lg"
        fullWidth
        style={tallButton()}
        loading={Boolean(props.busy)}
        disabled={Boolean(props.busy) || (props.emailCode && !(props.email ?? "").trim())}
        accessibilityLabel={`${props.idPrefix}-continue`}
        onPress={submit}
      />
      <If when={props.onGitHub ? "1" : ""}>
        <Button
          label={tr("signin.github")}
          variant="secondary"
          size="lg"
          fullWidth
          style={tallButton()}
          disabled={Boolean(props.busy)}
          accessibilityLabel={`${props.idPrefix}-github`}
          onPress={() => props.onGitHub?.()}
        />
      </If>
      <If when={props.onLocalOnly ? "1" : ""}>
        <LinkButton
          label={tr("signin.localOnly")}
          accessibilityLabel={`${props.idPrefix}-local-only`}
          onPress={() => props.onLocalOnly?.()}
        />
      </If>
      <Text style={{ ...textStyle("caption"), textAlign: "center" }}>
        {props.emailCode ? tr("signin.codeNote") : tr("signin.browserNote")}
      </Text>
    </Fade>
  );
}

/** Seconds until another code may be requested, ticking once a second while shown. */
function useResendCountdown(resendAt: () => number | null | undefined): () => number {
  const now = signal(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  effect(() => {
    const at = resendAt();
    untracked(() => {
      stop();
      now.set(Date.now());
      if (at && at > Date.now()) {
        timer = setInterval(() => {
          now.set(Date.now());
          if (Date.now() >= at) stop();
        }, 1000);
      }
    });
  });
  cleanup(stop);
  return () => {
    const at = resendAt();
    return at ? Math.max(0, Math.ceil((at - now()) / 1000)) : 0;
  };
}

/**
 * What a typed or pasted code becomes: the mail shows it grouped ("1234 5678",
 * "1234-5678") and a paste may carry the line around it, so only letters and
 * digits stay, at most as many as the code has.
 */
export function normalizeSignInCode(raw: string, length: number): string {
  return raw.replace(/[^0-9A-Za-z]/g, "").slice(0, Math.max(1, length));
}

function CodeField(outer: { p: SignInViewProps; onSubmit: () => void }) {
  const props = outer.p;
  const length = (): number => props.codeLength ?? DEFAULT_CODE_LENGTH;
  // The last complete code sent on its own, so a full code signs in once without a press,
  // and a wrong one is not sent again until it is changed.
  let lastAutoSubmitted = "";
  return (
    <View
      style={{
        height: CODE_FIELD_HEIGHT,
        paddingHorizontal: space.lg,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.error ? palette().danger : palette().border,
        backgroundColor: palette().inputBg,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ borderColor: props.error ? palette().danger : palette().borderStrong }}
      focusWithinStyle={{ borderColor: props.error ? palette().danger : palette().fieldFocusBorder }}
    >
      <Input
        value={props.code ?? ""}
        placeholder={"0".repeat(props.codeLength ?? DEFAULT_CODE_LENGTH)}
        autoFocus
        keyboardType="number-pad"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="one-time-code"
        accessibilityLabel={`${props.idPrefix}-code-input`}
        onChange={event => {
          const code = normalizeSignInCode(event.value, length());
          props.onCodeChange?.(code);
          if (code.length === length() && code !== lastAutoSubmitted && !props.busy) {
            lastAutoSubmitted = code;
            // After this change is applied, so the submit reads the full code.
            queueMicrotask(() => outer.onSubmit());
          }
        }}
        onSubmit={() => outer.onSubmit()}
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          minHeight: CODE_FIELD_HEIGHT - 2,
          textAlign: "center",
          color: palette().text,
          placeholderColor: palette().textMuted,
          caretColor: palette().accent,
          fontFamily: fontMono,
          fontSize: compactLayout() ? Math.max(16, textSize(CODE_TEXT_SIZE)) : textSize(CODE_TEXT_SIZE),
          fontWeight: "500",
          letterSpacing: CODE_TRACKING,
        }}
      />
    </View>
  );
}

/** The code field (visual spec §4.1): mono 20 / 500, tracking 4, 8 characters, in a 48 field. */
const CODE_FIELD_HEIGHT = space.x5l;
const CODE_TEXT_SIZE = space.xl;
const CODE_TRACKING = space.xs;
/** The code length a server that names none uses. */
const DEFAULT_CODE_LENGTH = 8;

function CodeStep(outer: { p: SignInViewProps }) {
  const props = outer.p;
  const remaining = useResendCountdown(() => props.resendAt);
  const submit = () => {
    if (!props.busy && (props.code ?? "").trim()) props.onSignIn?.();
  };
  return (
    <Fade>
      <CodeField p={props} onSubmit={submit} />
      <ErrorLine text={props.error} idPrefix={props.idPrefix} />
      <Button
        label={tr("signin.signIn")}
        variant="primary"
        size="lg"
        fullWidth
        style={tallButton()}
        loading={Boolean(props.busy)}
        disabled={Boolean(props.busy) || !(props.code ?? "").trim()}
        accessibilityLabel={`${props.idPrefix}-verify`}
        onPress={submit}
      />
      <View style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: space.sm }}>
        <LinkButton
          label={remaining() > 0 ? tr("signin.resendIn", { seconds: remaining() }) : tr("signin.resend")}
          accessibilityLabel={`${props.idPrefix}-resend`}
          disabled={Boolean(props.busy) || remaining() > 0}
          tabular
          onPress={() => props.onResend?.()}
        />
        <LinkButton
          label={tr("signin.otherEmail")}
          accessibilityLabel={`${props.idPrefix}-other-email`}
          onPress={() => props.onOtherEmail?.()}
        />
      </View>
    </Fade>
  );
}

function BrowserStep(outer: { p: SignInViewProps }) {
  const props = outer.p;
  return (
    <Fade>
      <If when={props.browserCode ?? ""}>
        {code => (
          <View
            style={{
              height: CODE_FIELD_HEIGHT,
              paddingHorizontal: space.lg,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              borderRadius: radii.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().border,
              backgroundColor: palette().surfaceTertiary,
            }}
          >
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                color: palette().text,
                fontFamily: fontMono,
                fontSize: textSize(CODE_TEXT_SIZE),
                fontWeight: "500",
                letterSpacing: CODE_TRACKING,
                fontVariant: ["tabular-nums"],
              }}
            >
              {code()}
            </Text>
            <Button
              label={props.codeCopied ? tr("common.copied") : tr("signin.copyCode")}
              variant="ghost"
              size="sm"
              leadingIcon={props.codeCopied ? "check" : "copy"}
              accessibilityLabel="home-github-copy-code"
              onPress={() => props.onCopyCode?.()}
            />
          </View>
        )}
      </If>
      <ErrorLine text={props.error} idPrefix={props.idPrefix} />
      <If
        when={props.browserExpired ? "1" : ""}
        else={
          <>
            <Button
              label={tr("signin.openPage")}
              variant="primary"
              size="lg"
              fullWidth
              style={tallButton()}
              leadingIcon="external-link"
              accessibilityLabel="home-github-open-url"
              onPress={() => props.onOpenPage?.()}
            />
            <View style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: space.sm }}>
              <LinkButton
                label={props.busy ? tr("signin.checking") : tr("signin.checkNow")}
                accessibilityLabel="home-github-poll"
                disabled={Boolean(props.busy)}
                onPress={() => props.onCheck?.()}
              />
              <LinkButton
                label={tr("common.cancel")}
                accessibilityLabel="home-github-cancel"
                onPress={() => props.onCancel?.()}
              />
            </View>
            <Text style={{ ...textStyle("caption"), textAlign: "center" }}>{props.browserNote || tr("signin.waiting")}</Text>
          </>
        }
      >
        <Button
          label={tr("signin.startAgain")}
          variant="primary"
          size="lg"
          fullWidth
        style={tallButton()}
          loading={Boolean(props.busy)}
          disabled={Boolean(props.busy)}
          accessibilityLabel="home-github-restart"
          onPress={() => props.onRestart?.()}
        />
        <LinkButton
          label={tr("common.cancel")}
          accessibilityLabel="home-github-cancel"
          onPress={() => props.onCancel?.()}
        />
      </If>
    </Fade>
  );
}

function SectionLabel(props: { text: string }) {
  return <Text style={textStyle("label", { color: palette().textSecondary })}>{props.text}</Text>;
}

function ReadyStep(outer: { p: SignInViewProps }) {
  const props = outer.p;
  return (
    <Fade>
      <If when={(props.otherDevices ?? []).length > 0 ? "1" : ""}>
        <View style={{ gap: space.sm }}>
          <SectionLabel text={tr("signin.others")} />
          <View style={{ gap: space.sm }}>
            <Each of={props.otherDevices ?? []} key={device => device.deviceId}>
              {device => (
                <DeviceBadge
                  name={device().name}
                  kind={device().kind}
                  exception={device().exception ?? null}
                  maxWidth={layout.signInWidth}
                />
              )}
            </Each>
          </View>
        </View>
      </If>
      <View style={{ gap: space.xs }}>
        <Text style={textStyle("body", { color: palette().text })}>{tr("signin.addTitle")}</Text>
        <Text style={textStyle("caption")}>{tr("signin.addBody")}</Text>
      </View>
      <If when={props.onCopyInstall || props.onOpenPhone ? "1" : ""}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <If when={props.onCopyInstall ? "1" : ""}>
            <Button
              label={tr("signin.copyInstall")}
              variant="secondary"
              size="md"
              leadingIcon="copy"
              accessibilityLabel={`${props.idPrefix}-copy-install`}
              onPress={() => props.onCopyInstall?.()}
            />
          </If>
          <If when={props.onOpenPhone ? "1" : ""}>
            <Button
              label={tr("signin.phone")}
              variant="secondary"
              size="md"
              leadingIcon="smartphone"
              accessibilityLabel={`${props.idPrefix}-open-phone`}
              onPress={() => props.onOpenPhone?.()}
            />
          </If>
        </View>
      </If>
      <Button
        label={tr("signin.start")}
        variant="primary"
        size="lg"
        fullWidth
        style={tallButton()}
        accessibilityLabel={`${props.idPrefix}-start`}
        onPress={() => props.onStart?.()}
      />
    </Fade>
  );
}

function ModelStep(outer: { p: SignInViewProps }) {
  const props = outer.p;
  return (
    <Fade>
      <Button
        label={tr("signin.modelTitle")}
        variant="primary"
        size="lg"
        fullWidth
        style={tallButton()}
        accessibilityLabel={`${props.idPrefix}-choose-model`}
        onPress={() => props.onChooseModel?.()}
      />
      <LinkButton
        label={tr("signin.later")}
        accessibilityLabel={`${props.idPrefix}-later`}
        onPress={() => props.onLater?.()}
      />
    </Fade>
  );
}

/**
 * The sign-in column, `layout.signInWidth` wide. Each step is its own subtree,
 * so moving to the next one mounts it fresh and it fades in.
 */
export function SignInView(props: SignInViewProps) {
  return (
    <View
      accessibilityLabel={`${props.idPrefix}-${props.step}`}
      style={{ width: "100%", maxWidth: layout.signInWidth, alignSelf: "center", gap: space.x3l }}
    >
      <If when={props.header === false ? "" : "1"}>
        <Header p={props} />
      </If>
      <If when={props.step === "email" ? "1" : ""}>{() => <EmailStep p={props} />}</If>
      <If when={props.step === "code" ? "1" : ""}>{() => <CodeStep p={props} />}</If>
      <If when={props.step === "browser" ? "1" : ""}>{() => <BrowserStep p={props} />}</If>
      <If when={props.step === "ready" ? "1" : ""}>{() => <ReadyStep p={props} />}</If>
      <If when={props.step === "model" ? "1" : ""}>{() => <ModelStep p={props} />}</If>
    </View>
  );
}
