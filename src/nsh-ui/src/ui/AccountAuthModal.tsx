// Shared controller-local OpenBitFun GitHub Account & Device-Flow Auth Modal.
//
// Mount `<AccountAuthModal />` once globally in `App.tsx` and open it from any
// surface (`DevicesScene`, `HomeScene`, `SidebarDeviceSwitcher`, `SettingsScene`)
// via `openAccountAuthModal(...)`. Runs the real `account_github_start` /
// `account_github_poll` / `account_logout` commands via `homeStore`, supports
// live background polling with clean teardown, and notifies `onAccountAuthChanged`
// listeners so device lists refresh automatically on sign-in or sign-out.

import { cleanup, effect, signal, Text, untracked, View, type Signal } from "nsh";
import {
  accountStatus,
  authError,
  authLoading,
  authNotice,
  cancelGitHubSignIn,
  copyGitHubUserCode,
  githubAuthFlow,
  githubUser,
  isAccountSignedIn,
  loadAccountState,
  onAccountAuthChanged,
  openGitHubVerificationUrl,
  pollGitHubSignIn,
  signOutAccount,
  startGitHubSignIn,
  type AccountAuthChangeListener,
} from "../homeStore";
import { tr } from "../i18n";
import { peerScope } from "../peerState";
import {
  fontMono,
  palette,
  radii,
  textLineHeight,
  textSize,
} from "../theme";
import { MOTION_DURATION, paintTransition } from "./motion";
import { ModalDialog, pushToast } from "./overlays";
import { Button, InlineBanner, StatusDot } from "./primitives";

export { onAccountAuthChanged, type AccountAuthChangeListener };

export interface OpenAccountAuthModalOptions {
  /** Optional callback invoked after GitHub sign-in completes and account state refreshes. */
  onSuccess?: () => void | Promise<void>;
  /**
   * When `true` and the user is currently signed out with no active flow,
   * immediately initiates `account_github_start` upon opening.
   */
  autoStart?: boolean;
}

/** Reactive open state for explicit `openAccountAuthModal()` triggers. */
export const accountAuthModalOpen: Signal<boolean> = signal(false);

const codeCopied = signal(false);
let pendingOnSuccess: (() => void | Promise<void>) | null = null;
let autoPollTimer: ReturnType<typeof setInterval> | null = null;
let copiedResetTimer: ReturnType<typeof setTimeout> | null = null;

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

function accountHandle(): string {
  const login = githubUser()?.login;
  if (login) return `@${login}`;
  return accountStatus()?.userId || tr("home.signedIn");
}

function handleAuthSuccess(): void {
  const callback = pendingOnSuccess;
  pendingOnSuccess = null;
  stopAutoPoll();
  clearCopiedTimer();
  codeCopied.set(false);
  accountAuthModalOpen.set(false);

  const login = githubUser()?.login;
  const userLabel = login ? `@${login}` : accountStatus()?.userId ?? "";
  pushToast(
    userLabel ? tr("auth.signedInToast", { user: userLabel }) : tr("auth.signedInNotice"),
    "success",
  );

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
  }, 1800);
}

/**
 * Opens the shared Account & GitHub Sign-In modal from any scene or sidebar
 * control. Safe to call when signed out or already signed in.
 */
export function openAccountAuthModal(options?: OpenAccountAuthModalOptions): void {
  pendingOnSuccess = options?.onSuccess ?? null;
  if (!githubAuthFlow()) {
    authError.set("");
    authNotice.set("");
  }
  codeCopied.set(false);
  accountAuthModalOpen.set(true);

  if (accountStatus() === null) {
    void loadAccountState();
  }
  if (options?.autoStart && !isAccountSignedIn() && !githubAuthFlow()) {
    void startGitHubSignIn();
  }
}

/**
 * Closes the shared Account & GitHub Sign-In modal, cancelling any in-progress
 * device-flow polling cleanly.
 */
export function closeAccountAuthModal(): void {
  pendingOnSuccess = null;
  stopAutoPoll();
  clearCopiedTimer();
  codeCopied.set(false);
  if (githubAuthFlow()) {
    cancelGitHubSignIn();
  } else {
    authError.set("");
    authNotice.set("");
  }
  accountAuthModalOpen.set(false);
}

export function AccountAuthModal() {
  const unsubAuth = onAccountAuthChanged(signedIn => {
    if (signedIn && (accountAuthModalOpen() || pendingOnSuccess !== null)) {
      handleAuthSuccess();
    }
  });

  effect(() => {
    const flow = githubAuthFlow();
    const visible = accountAuthModalOpen() || flow !== null;
    untracked(() => {
      stopAutoPoll();
      if (visible && flow && flow.status === "pending") {
        const intervalMs = Math.max(flow.intervalSeconds || 5, 2) * 1000;
        autoPollTimer = setInterval(() => {
          const active = githubAuthFlow();
          if (!active || active.status !== "pending") {
            stopAutoPoll();
            return;
          }
          void pollGitHubSignIn({ silent: true });
        }, intervalMs);
      }
    });
  });

  cleanup(() => {
    stopAutoPoll();
    clearCopiedTimer();
    unsubAuth();
  });

  const modalVisible = (): boolean => accountAuthModalOpen() || githubAuthFlow() !== null;

  const modalTitle = (): string =>
    githubAuthFlow() ? tr("home.githubSignIn") : tr("auth.modalTitle");

  const modalSubtitle = (): string => {
    const flow = githubAuthFlow();
    if (flow) {
      return flow.userCode ? tr("home.githubAuthDesc") : tr("auth.browserAuthDesc");
    }
    return isAccountSignedIn()
      ? tr("auth.modalSubtitleSignedIn")
      : tr("auth.modalSubtitleSignedOut");
  };

  return (
    <ModalDialog
      open={modalVisible()}
      size="sm"
      title={modalTitle()}
      subtitle={modalSubtitle()}
      accessibilityLabel="github-auth-modal"
      onClose={closeAccountAuthModal}
      footer={
        <>
          {/* Active GitHub Device / Browser Flow Footer */}
          <If when={githubAuthFlow()}>
            {flow => (
              <>
                <Button
                  label={tr("common.cancel")}
                  variant="ghost"
                  size="sm"
                  accessibilityLabel="home-github-cancel"
                  onPress={closeAccountAuthModal}
                />
                <If when={flow().status === "expired"}>
                  <Button
                    label={authLoading() ? tr("home.starting") : tr("auth.restartSignIn")}
                    variant="primary"
                    size="sm"
                    loading={authLoading()}
                    disabled={authLoading()}
                    accessibilityLabel="home-github-restart"
                    onPress={() => void startGitHubSignIn()}
                  />
                </If>
                <If when={flow().status !== "expired"}>
                  <Button
                    label={authLoading() ? tr("home.checking") : tr("home.pollStatus")}
                    variant="primary"
                    size="sm"
                    loading={authLoading()}
                    disabled={authLoading()}
                    accessibilityLabel="home-github-poll"
                    onPress={() => void pollGitHubSignIn()}
                  />
                </If>
              </>
            )}
          </If>

          {/* Signed-Out Idle Footer */}
          <If when={!githubAuthFlow() && !isAccountSignedIn()}>
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              accessibilityLabel="account-auth-cancel"
              onPress={closeAccountAuthModal}
            />
            <Button
              label={authLoading() ? tr("home.starting") : tr("home.githubSignIn")}
              variant="primary"
              size="sm"
              leadingIcon="external-link"
              loading={authLoading()}
              disabled={authLoading()}
              accessibilityLabel="account-auth-start"
              onPress={() => void startGitHubSignIn()}
            />
          </If>

          {/* Signed-In Profile Footer */}
          <If when={!githubAuthFlow() && isAccountSignedIn()}>
            <Button
              label={authLoading() ? tr("home.signingOut") : tr("home.githubSignOut")}
              variant="danger"
              size="sm"
              loading={authLoading()}
              disabled={authLoading()}
              accessibilityLabel="account-auth-sign-out"
              onPress={() => void signOutAccount()}
            />
            <Button
              label={tr("common.done")}
              variant="primary"
              size="sm"
              accessibilityLabel="account-auth-done"
              onPress={closeAccountAuthModal}
            />
          </If>
        </>
      }
    >
      <View style={{ gap: 14 }}>
        <If when={peerScope()}>
          {scope => (
            <InlineBanner
              tone="info"
              icon="laptop"
              message={tr("auth.peerControllerNote", { label: scope().label })}
            />
          )}
        </If>

        {/* Active GitHub Device / Browser Authorization Flow */}
        <If when={githubAuthFlow()}>
          {flow => (
            <View style={{ gap: 12 }}>
              <If when={flow().userCode}>
                {code => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 12,
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      borderRadius: radii.lg,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().borderSubtle,
                      backgroundColor: palette().panelRaised,
                      ...paintTransition(MOTION_DURATION.fast),
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <Text
                        style={{
                          color: palette().textSecondary,
                          fontSize: textSize(12),
                          lineHeight: textLineHeight(12, 1.3),
                        }}
                      >
                        {tr("home.oneTimeCode")}
                      </Text>
                      <Text
                        style={{
                          color: palette().text,
                          fontSize: textSize(22),
                          lineHeight: textLineHeight(22, 1.2),
                          fontWeight: "600",
                          fontFamily: fontMono,
                          letterSpacing: 2,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {code()}
                      </Text>
                    </View>
                    <View style={{ flexShrink: 0 }}>
                      <Button
                        label={codeCopied() ? tr("common.copied") : tr("home.copyCode")}
                        variant="secondary"
                        size="sm"
                        leadingIcon={codeCopied() ? "check" : "copy"}
                        accessibilityLabel="home-github-copy-code"
                        onPress={handleCopyUserCode}
                      />
                    </View>
                  </View>
                )}
              </If>

              <If when={flow().verificationUri}>
                {uri => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      paddingHorizontal: 4,
                    }}
                  >
                    <Text
                      style={{
                        flex: 1,
                        minWidth: 0,
                        color: palette().textSecondary,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.38),
                        fontFamily: fontMono,
                        numberOfLines: 1,
                        textOverflow: "ellipsis-middle",
                      }}
                    >
                      {uri()}
                    </Text>
                    <View style={{ flexShrink: 0 }}>
                      <Button
                        label={tr("home.openGithub")}
                        variant="ghost"
                        size="sm"
                        leadingIcon="external-link"
                        accessibilityLabel="home-github-open-url"
                        onPress={() => void openGitHubVerificationUrl()}
                      />
                    </View>
                  </View>
                )}
              </If>

              <If when={flow().status === "pending"}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 2,
                  }}
                >
                  <StatusDot kind="accent" size={6} pulse={true} />
                  <Text
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.4),
                    }}
                  >
                    {tr("auth.waitingForBrowser")}
                  </Text>
                </View>
              </If>
            </View>
          )}
        </If>

        {/* Signed out: one plain paragraph, no box. */}
        <If when={!githubAuthFlow() && !isAccountSignedIn()}>
          <View style={{ gap: 4, paddingHorizontal: 4 }}>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(14),
                fontWeight: "600",
                lineHeight: textLineHeight(14, 1.35),
              }}
            >
              {tr("auth.githubCardTitle")}
            </Text>
            <Text
              style={{
                color: palette().textSecondary,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.5),
              }}
            >
              {tr("auth.githubCardBody")}
            </Text>
          </View>
        </If>

        {/* Signed-In Account Card */}
        <If when={!githubAuthFlow() && isAccountSignedIn()}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 12,
              minHeight: 44,
              borderRadius: radii.lg,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().panelRaised,
            }}
          >
            <StatusDot kind="success" size={8} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(14),
                    fontWeight: "600",
                    lineHeight: textLineHeight(14, 1.32),
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {accountHandle()}
                </Text>
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontSize: textSize(13),
                    lineHeight: textLineHeight(13, 1.32),
                  }}
                >
                  {tr("home.signedIn")}
                </Text>
              </View>
              <If when={githubUser()?.email ?? ""}>
                {email => (
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.38),
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {email()}
                  </Text>
                )}
              </If>
              <If when={githubUser()?.accountId || accountStatus()?.userId || ""}>
                {id => (
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontFamily: fontMono,
                      fontSize: textSize(11),
                      lineHeight: textLineHeight(11, 1.36),
                      numberOfLines: 1,
                      textOverflow: "ellipsis-middle",
                    }}
                  >
                    {tr("auth.accountIdLabel", { id: id() })}
                  </Text>
                )}
              </If>
            </View>
          </View>
        </If>

        <If when={authNotice()}>
          {notice => <InlineBanner tone={githubAuthFlow() ? "info" : "success"} message={notice()} />}
        </If>
        <If when={authError()}>
          {err => <InlineBanner tone="danger" message={err()} />}
        </If>
      </View>
    </ModalDialog>
  );
}
