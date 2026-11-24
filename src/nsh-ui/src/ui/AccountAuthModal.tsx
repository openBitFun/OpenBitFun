// The account dialog and the first-run sign-in screen of the native desktop
// (visual spec §4.1). Both draw the shared sign-in column (`SignInView`).
//
// The desktop host signs in inside the app: Continue sends the email code
// (`account_email_start`), the code step completes it (`account_email_verify`),
// the same steps the browser and the phone draw. "Sign in with GitHub" is the
// secondary option and the only one that opens the browser
// (`account_github_start` / `account_github_poll`). Who is signed in comes from
// the backend's identity projection (`accountDisplay`).
// `openAccountAuthModal(...)` opens the dialog from any surface;
// `onAccountAuthChanged` listeners refresh device lists on sign-in or sign-out.

import { Scroll, cleanup, effect, signal, Text, untracked, View, type Signal } from "nsh";
import { accountDisplay } from "../accountDisplay";
import { entryDeviceId } from "../bridge";
import { controllerPort } from "../controller/controllerPort";
import { signOutController } from "../controller/controllerStore";
import { fleetDeviceById, fleetDevices } from "../fleetStore";
import {
  accountStatus,
  authError,
  authLoading,
  authNotice,
  cancelEmailSignIn,
  cancelGitHubSignIn,
  copyGitHubUserCode,
  emailChallenge,
  githubAuthFlow,
  loadAccountState,
  onAccountAuthChanged,
  openGitHubVerificationUrl,
  pollGitHubSignIn,
  requestEmailCode,
  signOutAccount,
  startGitHubSignIn,
  verifyEmailCode,
  type AccountAuthChangeListener,
} from "../homeStore";
import { tr } from "../i18n";
import { superAgentUi } from "../productGates";
import { compactLayout, layout, palette, space, textStyle } from "../theme";
import { deviceException } from "./fleet";
import { ModalDialog, pushToast } from "./overlays";
import { Button } from "./primitives";
import { SignInView, signInStepBody, signInStepTitle, type SignInDevice, type SignInStep } from "./SignInView";

export { onAccountAuthChanged, type AccountAuthChangeListener };

export interface OpenAccountAuthModalOptions {
  /** Called after sign-in completes and the account state is read again. */
  onSuccess?: () => void | Promise<void>;
  /**
   * Opened from a "Sign in" control. Kept for callers: the dialog opens on the
   * email field either way (nothing leaves the app until the user continues).
   */
  autoStart?: boolean;
}

/** Reactive open state for explicit `openAccountAuthModal()` triggers. */
export const accountAuthModalOpen: Signal<boolean> = signal(false);

const codeCopied = signal(false);
/** What the user typed into the email and code fields. */
const typedEmail = signal("");
const typedCode = signal("");
let pendingOnSuccess: (() => void | Promise<void>) | null = null;
/** A sign-in was left running when the dialog closed; its completion still deserves the toast. */
let resumedSignInPending = false;
let autoPollTimer: ReturnType<typeof setInterval> | null = null;
let copiedResetTimer: ReturnType<typeof setTimeout> | null = null;
/** How long "Copied" stays on the copy button. */
const COPIED_HOLD_MS = 1800;

function stopAutoPoll(): void {
  if (autoPollTimer !== null) {
    clearInterval(autoPollTimer);
    autoPollTimer = null;
  }
}

function clearCopiedTimer(): void {
  if (copiedResetTimer !== null) {
    clearTimeout(copiedResetTimer);
    copiedResetTimer = null;
  }
}

/** The signed-in account's name, from the backend's identity projection. */
function accountHandle(): string {
  return accountDisplay().identity?.displayName ?? "";
}

function handleAuthSuccess(): void {
  const callback = pendingOnSuccess;
  pendingOnSuccess = null;
  stopAutoPoll();
  clearCopiedTimer();
  codeCopied.set(false);
  typedCode.set("");
  accountAuthModalOpen.set(false);

  const account = accountHandle();
  pushToast(account ? tr("auth.signedInToast", { user: account }) : tr("signin.signedIn"), "success");

  if (callback) {
    void Promise.resolve(callback()).catch(() => undefined);
  }
}

function handleCopyUserCode(): void {
  copyGitHubUserCode();
  codeCopied.set(true);
  clearCopiedTimer();
  copiedResetTimer = setTimeout(() => {
    copiedResetTimer = null;
    codeCopied.set(false);
  }, COPIED_HOLD_MS);
}

/** Polls the host's browser sign-in at the interval it asked for while it is pending. */
function startAutoPoll(visible: () => boolean): void {
  effect(() => {
    const flow = githubAuthFlow();
    const shown = visible();
    untracked(() => {
      stopAutoPoll();
      if (shown && flow && flow.status === "pending") {
        const intervalMs = Math.max(flow.intervalSeconds || 5, 2) * 1000;
        let inFlight = false;
        autoPollTimer = setInterval(() => {
          const active = githubAuthFlow();
          if (!active || active.status !== "pending") {
            stopAutoPoll();
            return;
          }
          if (inFlight) return;
          inFlight = true;
          void pollGitHubSignIn({ silent: true }).finally(() => {
            inFlight = false;
          });
        }, intervalMs);
      }
    });
  });
  cleanup(() => {
    stopAutoPoll();
    clearCopiedTimer();
  });
}

/** Opens the account dialog from any scene or control; safe signed in or out. */
export function openAccountAuthModal(options?: OpenAccountAuthModalOptions): void {
  pendingOnSuccess = options?.onSuccess ?? null;
  if (!githubAuthFlow() && !emailChallenge()) {
    authError.set("");
    authNotice.set("");
  }
  codeCopied.set(false);
  accountAuthModalOpen.set(true);

  if (accountStatus() === null && !controllerPort()) {
    void loadAccountState();
  }
}

/**
 * Closes the account dialog. A sign-in in progress is kept, not cancelled: the
 * code may still be on its way, or the browser sign-in still open, and opening
 * the dialog again goes back to that step. "Use another email" and Cancel end
 * a sign-in on purpose.
 */
export function closeAccountAuthModal(): void {
  pendingOnSuccess = null;
  resumedSignInPending = Boolean(emailChallenge()) || Boolean(githubAuthFlow());
  clearCopiedTimer();
  codeCopied.set(false);
  accountAuthModalOpen.set(false);
}

/** Whether a sign-in is under way that a stray click must not throw away. */
function signInInProgress(): boolean {
  return Boolean(emailChallenge()) || Boolean(githubAuthFlow()) || typedEmail().trim() !== "";
}

/** The sign-in step the host's state is at (signed in is not a sign-in step). */
function hostStep(): SignInStep {
  if (emailChallenge()) return "code";
  return githubAuthFlow() ? "browser" : "email";
}

/** The shared view, wired to the desktop host's account commands. */
function HostSignIn(props: { header: boolean; step: () => SignInStep; extra?: Partial<Parameters<typeof SignInView>[0]> }) {
  return (
    <SignInView
      idPrefix="account-auth"
      header={props.header}
      step={props.step()}
      busy={authLoading()}
      error={authError()}
      emailCode
      email={typedEmail()}
      onEmailChange={value => {
        typedEmail.set(value);
        if (authError()) authError.set("");
      }}
      onContinue={() => void requestEmailCode(typedEmail())}
      onGitHub={() => void startGitHubSignIn()}
      onLocalOnly={props.extra?.onLocalOnly}
      codeEmail={emailChallenge()?.email ?? typedEmail()}
      codeLength={emailChallenge()?.codeLength}
      code={typedCode()}
      onCodeChange={value => {
        typedCode.set(value);
        if (authError()) authError.set("");
      }}
      onSignIn={() => {
        void verifyEmailCode(typedCode()).then(done => {
          if (done) typedCode.set("");
        });
      }}
      resendAt={emailChallenge()?.resendAt ?? null}
      onResend={() => {
        typedCode.set("");
        void requestEmailCode(emailChallenge()?.email ?? typedEmail());
      }}
      onOtherEmail={() => {
        typedCode.set("");
        cancelEmailSignIn();
      }}
      browserCode={githubAuthFlow()?.userCode ?? ""}
      browserExpired={githubAuthFlow()?.status === "expired"}
      browserNote={authNotice()}
      codeCopied={codeCopied()}
      onCopyCode={handleCopyUserCode}
      onOpenPage={() => void openGitHubVerificationUrl()}
      onCheck={() => void pollGitHubSignIn()}
      onRestart={() => void startGitHubSignIn()}
      onCancel={() => {
        stopAutoPoll();
        cancelGitHubSignIn();
      }}
      deviceName={props.extra?.deviceName}
      otherDevices={props.extra?.otherDevices}
      onCopyInstall={props.extra?.onCopyInstall}
      onOpenPhone={props.extra?.onOpenPhone}
      onStart={props.extra?.onStart}
      onChooseModel={props.extra?.onChooseModel}
      onLater={props.extra?.onLater}
    />
  );
}

/** The signed-in account in the dialog: who, and nothing else. */
function SignedInAccount() {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={textStyle("body", { color: palette().text })}>
        {accountHandle() ? tr("signin.signedInAs", { account: accountHandle() }) : tr("signin.signedIn")}
      </Text>
      <If when={authError()}>{err => <Text style={textStyle("label", { color: palette().danger })}>{err()}</Text>}</If>
    </View>
  );
}

export function AccountAuthModal() {
  const unsubAuth = onAccountAuthChanged(signedIn => {
    if (signedIn && (accountAuthModalOpen() || pendingOnSuccess !== null || resumedSignInPending)) {
      resumedSignInPending = false;
      handleAuthSuccess();
    }
  });
  // The first-run screen runs the same sign-in without the dialog, so only an explicit open shows it.
  const modalVisible = (): boolean => accountAuthModalOpen();
  // A browser sign-in keeps being checked after the dialog is closed: it can finish there meanwhile.
  startAutoPoll(() => true);

  cleanup(() => {
    stopAutoPoll();
    clearCopiedTimer();
    unsubAuth();
  });

  const signedInView = () => !githubAuthFlow() && !emailChallenge() && accountDisplay().signedIn;

  return (
    <ModalDialog
      open={modalVisible()}
      size="sm"
      title={signedInView() ? tr("signin.accountTitle") : signInStepTitle({ step: hostStep() })}
      subtitle={signedInView() ? undefined : signInStepBody({ step: hostStep(), codeEmail: emailChallenge()?.email })}
      accessibilityLabel="account-auth-modal"
      keepOpenOnBackdrop={!signedInView() && signInInProgress()}
      keepsInputOnClose={true}
      onClose={closeAccountAuthModal}
      footer={
        <If when={signedInView()}>
          <Button
            label={authLoading() ? tr("signin.checking") : tr("launcher.signOut")}
            variant="danger"
            size="md"
            loading={authLoading()}
            disabled={authLoading()}
            accessibilityLabel="account-auth-sign-out"
            onPress={() => void (controllerPort() ? signOutController() : signOutAccount())}
          />
          <Button
            label={tr("common.done")}
            variant="primary"
            size="md"
            accessibilityLabel="account-auth-done"
            onPress={closeAccountAuthModal}
          />
        </If>
      }
    >
      <If when={signedInView()} else={<HostSignIn header={false} step={hostStep} />}>
        <SignedInAccount />
      </If>
    </ModalDialog>
  );
}

export interface SignInScreenProps {
  /** "Use on this device only": the shell takes over without an account. */
  onLocalOnly?: () => void;
  /** The welcome steps are done (Start, or Later on the model step). */
  onDone: () => void;
  /** Whether this device has no model yet (a backend fact the caller reads); adds "Choose a model". */
  needsModel?: () => boolean;
  /** Opens the model settings from "Choose a model". */
  onChooseModel?: () => void;
  /** Copies the install command for another device, when the caller has one. */
  onCopyInstall?: () => void;
  /** Opens "Use on your phone", when the caller has it. */
  onOpenPhone?: () => void;
}

/** This device and the account's other runtime devices, as the fleet navigator lists them. */
function thisDeviceName(): string {
  return fleetDeviceById(entryDeviceId())?.name ?? "";
}

function otherDevices(): SignInDevice[] {
  const self = entryDeviceId();
  return fleetDevices()
    .filter(
      device =>
        device.deviceId !== self &&
        !device.isClientDevice &&
        (superAgentUi() || device.hostKind.toLowerCase() !== "cloud"),
    )
    .map(device => ({
      deviceId: device.deviceId,
      name: device.name,
      kind: device.hostKind,
      exception: deviceException(device.state),
    }));
}

/**
 * The native first run (visual spec §4.1): the canvas alone, the sign-in column
 * 360 wide starting at 22 % of the height, then "{device} is ready" and, when
 * the device has no model, "Choose a model". The caller decides when it shows.
 */
export function SignInScreen(props: SignInScreenProps) {
  const welcome = signal<"ready" | "model" | null>(null);
  const unsubAuth = onAccountAuthChanged(signedIn => {
    if (signedIn) welcome.set("ready");
  });
  startAutoPoll(() => welcome() === null);
  effect(() => {
    if (accountStatus() === null) void loadAccountState();
  });
  cleanup(() => {
    stopAutoPoll();
    unsubAuth();
  });

  const step = (): SignInStep => welcome() ?? hostStep();
  const finish = () => {
    welcome.set(null);
    props.onDone();
  };
  return (
    <Scroll
      accessibilityLabel="sign-in-screen"
      style={{
        flex: 1,
        minHeight: 0,
        backgroundColor: palette().canvas,
      }}
      contentStyle={{
        flexGrow: 1,
        flexDirection: "column",
        paddingHorizontal: compactLayout() ? layout.phoneGutter : layout.pageGutter,
      }}
    >
      <View style={{ flexGrow: SIGN_IN_TOP_SHARE, flexShrink: 1, minHeight: space.x3l }} />
      <HostSignIn
        header
        step={step}
        extra={{
          onLocalOnly: props.onLocalOnly,
          deviceName: thisDeviceName(),
          otherDevices: otherDevices(),
          onCopyInstall: props.onCopyInstall,
          onOpenPhone: props.onOpenPhone,
          onStart: () => (props.needsModel?.() ? welcome.set("model") : finish()),
          onChooseModel: () => {
            finish();
            props.onChooseModel?.();
          },
          onLater: finish,
        }}
      />
      <View style={{ flexGrow: 100 - SIGN_IN_TOP_SHARE, flexShrink: 1, minHeight: space.x3l }} />
    </Scroll>
  );
}

/** The sign-in column starts at this share of the height (visual spec §4.1). */
const SIGN_IN_TOP_SHARE = 22;
