// Devices scene: "Use on phone" — open this computer's OpenBitFun on a phone.
//
// Same network: the LAN listener's one-time QR. Anywhere: the phone joins the
// account's device mesh with the EasyTier app, then scans the mesh listener's
// one-time QR. Both serve the same UI over OBP as a revocable `paired-client`
// (listed and revoked in "Open on phone or browser"); neither uses the old relay
// or `mobile-web`. The commands are controller-local: a paired phone or a
// browser tab gets an explicit note instead of the panel, and while this window
// drives another device the panel says the phone pairs with this computer.

import { Clipboard, openUrl, Text, View, type JSX } from "nsh";
import { formatRelativeTime } from "../format";
import { tr } from "../i18n";
import { obpStatus, setObpLanEnabled } from "../obpStore";
import { peerScope } from "../peerState";
import {
  createPhonePairing,
  joinConfigText,
  loadPhoneJoinInfo,
  phoneBusy,
  phoneJoinError,
  phoneJoinInfo,
  phonePairing,
  phonePairingError,
  phoneRoute,
  phoneSecretRevealed,
  selectPhoneRoute,
  type PhoneRoute,
} from "../phoneStore";
import { fontMono, palette, radii, textLineHeight, textSize, textStyle } from "../theme";
import { pushToast } from "../ui/overlays";
import { Button, InlineBanner, SegmentedTabs } from "../ui/primitives";
import { InsetGroup, InsetRow, QrCodeView, StudioSection } from "../ui/studio";

/** Official EasyTier clients (see docs/architecture/unified-client-architecture.md, phones). */
const EASYTIER_ANDROID_URL = "https://github.com/EasyTier/EasyTier/releases";
const EASYTIER_IOS_URL = "https://apps.apple.com/app/easytier/id6788989728";

function errorText(code: string): string {
  if (code === "phone_update_host") return tr("phone.updateHost");
  if (code === "phone_owner_only") return tr("phone.ownerOnly");
  if (code === "phone_mesh_signed_out") return tr("phone.meshSignedOut");
  if (code === "phone_lan_off") return tr("phone.lanOff");
  if (code === "phone_no_lan_address") return tr("phone.noLanAddress");
  if (code === "phone_obp_unavailable") return tr("phone.obpUnavailable");
  if (code.startsWith("phone_mesh_unavailable:")) {
    return tr("phone.meshUnavailable", { reason: code.slice("phone_mesh_unavailable:".length) });
  }
  return code;
}

async function copy(text: string): Promise<void> {
  try {
    await Clipboard.writeText(text);
    pushToast(tr("phone.copied"), "success");
  } catch {
    pushToast(tr("phone.copyFailed"), "danger");
  }
}

function openLink(url: string): void {
  void openUrl(url).catch(() => pushToast(tr("phone.openFailed", { url }), "danger"));
}

function CopyButton(props: { value: () => string; accessibilityLabel: string }) {
  return (
    <Button
      label={tr("phone.copy")}
      variant="ghost"
      size="sm"
      leadingIcon="copy"
      accessibilityLabel={props.accessibilityLabel}
      onPress={() => void copy(props.value())}
    />
  );
}

/** One numbered step heading. */
function StepTitle(props: { index: number; label: string }) {
  return (
    <Text
      style={{
        color: palette().text,
        fontSize: textSize(13),
        fontWeight: "600",
        lineHeight: textLineHeight(13, 1.4),
      }}
    >
      {tr("phone.step", { index: String(props.index), label: props.label })}
    </Text>
  );
}

function Caption(props: { text: string }) {
  return <Text style={textStyle("caption")}>{props.text}</Text>;
}

/** The QR of a one-time pairing offer for `route`. */
function PairingOffer(props: { route: PhoneRoute }) {
  const offer = () => {
    const current = phonePairing();
    return current && current.route === props.route ? current.offer : null;
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button
          label={offer() ? tr("phone.newCode") : tr("phone.showCode")}
          variant={offer() ? "secondary" : "primary"}
          size="sm"
          leadingIcon={offer() ? "refresh" : "link"}
          loading={phoneBusy()}
          disabled={phoneBusy()}
          accessibilityLabel={`phone-pair-${props.route}`}
          onPress={() => void createPhonePairing(props.route)}
        />
      </View>
      <If when={offer()}>
        {current => (
          <View
            accessibilityLabel={`phone-offer-${props.route}`}
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}
          >
            <View style={{ padding: 6, borderRadius: radii.md, borderCurve: "continuous", backgroundColor: "#ffffff" }}>
              <QrCodeView value={current().qrPayload} size={172} accessibilityLabel={`phone-qr-${props.route}`} />
            </View>
            <View style={{ flex: 1, minWidth: 200, gap: 6 }}>
              <Caption text={tr("phone.pairHint")} />
              <Text
                style={{
                  fontFamily: fontMono,
                  fontSize: textSize(11),
                  color: palette().textSecondary,
                  lineHeight: textLineHeight(11, 1.45),
                }}
              >
                {current().url}
              </Text>
              <Caption text={tr("phone.fingerprint", { fingerprint: current().fingerprint })} />
              <Caption text={tr("phone.expires", { time: formatRelativeTime(current().expiresAtMs) })} />
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <CopyButton value={() => current().url} accessibilityLabel={`phone-copy-link-${props.route}`} />
              </View>
            </View>
          </View>
        )}
      </If>
      <If when={phonePairingError()}>
        {code => <InlineBanner tone="warning" message={errorText(code())} accessibilityLabel="phone-pair-error" />}
      </If>
    </View>
  );
}

function SameNetworkTab() {
  const lanRunning = () => obpStatus()?.lan.running === true;
  return (
    <View accessibilityLabel="phone-tab-lan" style={{ gap: 12, padding: 16 }}>
      <Caption text={tr("phone.lanIntro")} />
      <If when={obpStatus()?.available === false}>
        <InlineBanner tone="info" message={tr("phone.obpUnavailable")} accessibilityLabel="phone-obp-unavailable" />
      </If>
      <If when={obpStatus()?.available === true && !lanRunning()}>
        <InlineBanner
          tone="info"
          message={tr("phone.lanOff")}
          actionLabel={tr("phone.turnOnLan")}
          onAction={() => void setObpLanEnabled(true)}
          accessibilityLabel="phone-lan-off"
        />
      </If>
      <If when={lanRunning()}>
        <PairingOffer route="lan" />
      </If>
    </View>
  );
}

function JoinValueRow(props: {
  first?: boolean;
  label: string;
  value: () => string;
  display?: () => string;
  accessibilityLabel: string;
  extra?: JSX.Element;
}) {
  return (
    <InsetRow
      first={props.first}
      label={props.label}
      detail={(props.display ?? props.value)()}
      accessibilityLabel={props.accessibilityLabel}
      trailing={
        <>
          {props.extra}
          <CopyButton value={props.value} accessibilityLabel={`${props.accessibilityLabel}-copy`} />
        </>
      }
    />
  );
}

function AnywhereTab() {
  return (
    <View accessibilityLabel="phone-tab-mesh" style={{ gap: 14, padding: 16 }}>
      <Caption text={tr("phone.meshIntro")} />
      <If when={phoneJoinError()}>
        {code => (
          <InlineBanner
            tone={code() === "phone_owner_only" ? "info" : "warning"}
            message={errorText(code())}
            actionLabel={tr("phone.retry")}
            onAction={() => void loadPhoneJoinInfo()}
            accessibilityLabel="phone-join-error"
          />
        )}
      </If>
      <If when={phoneJoinInfo()}>
        {info => (
          <View style={{ gap: 14 }}>
            <View style={{ gap: 6 }}>
              <StepTitle index={1} label={tr("phone.stepInstall")} />
              <Caption text={tr("phone.installAndroid")} />
              <Caption text={tr("phone.installIos")} />
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Button
                  label={tr("phone.getAndroid")}
                  variant="secondary"
                  size="sm"
                  leadingIcon="external-link"
                  accessibilityLabel="phone-easytier-android"
                  onPress={() => openLink(EASYTIER_ANDROID_URL)}
                />
                <Button
                  label={tr("phone.getIos")}
                  variant="secondary"
                  size="sm"
                  leadingIcon="external-link"
                  accessibilityLabel="phone-easytier-ios"
                  onPress={() => openLink(EASYTIER_IOS_URL)}
                />
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <StepTitle index={2} label={tr("phone.stepJoin")} />
              <Caption text={tr("phone.joinHint", { version: info().easytierVersion })} />
              <InsetGroup accessibilityLabel="phone-join-values" style={{ backgroundColor: palette().canvas }}>
                <JoinValueRow
                  first
                  label={tr("phone.networkName")}
                  value={() => info().networkName}
                  accessibilityLabel="phone-network-name"
                />
                <JoinValueRow
                  label={tr("phone.networkSecret")}
                  value={() => info().networkSecret}
                  display={() => (phoneSecretRevealed() ? info().networkSecret : "••••••••••••")}
                  accessibilityLabel="phone-network-secret"
                  extra={
                    <Button
                      label={phoneSecretRevealed() ? tr("phone.hideSecret") : tr("phone.revealSecret")}
                      variant="ghost"
                      size="sm"
                      leadingIcon={phoneSecretRevealed() ? "eye-off" : "eye"}
                      accessibilityLabel="phone-secret-toggle"
                      onPress={() => phoneSecretRevealed.set(!phoneSecretRevealed())}
                    />
                  }
                />
                <Each of={info().peers} key={peer => peer}>
                  {peer => (
                    <JoinValueRow
                      label={tr("phone.peer")}
                      value={() => peer()}
                      accessibilityLabel={`phone-peer-${peer()}`}
                    />
                  )}
                </Each>
              </InsetGroup>
              <Caption text={tr("phone.secretWarning")} />
              <If when={phoneSecretRevealed()}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
                  <View
                    style={{ padding: 6, borderRadius: radii.md, borderCurve: "continuous", backgroundColor: "#ffffff" }}
                  >
                    <QrCodeView value={joinConfigText(info())} size={172} accessibilityLabel="phone-join-qr" />
                  </View>
                  <View style={{ flex: 1, minWidth: 200, gap: 6 }}>
                    <Caption text={tr("phone.joinQrHint")} />
                    <CopyButton value={() => joinConfigText(info())} accessibilityLabel="phone-copy-config" />
                  </View>
                </View>
              </If>
            </View>
            <View style={{ gap: 6 }}>
              <StepTitle index={3} label={tr("phone.stepPair")} />
              <Caption
                text={
                  info().virtualIp && info().obpPort
                    ? tr("phone.pairMeshHint", { address: `https://${info().virtualIp}:${info().obpPort}` })
                    : tr("phone.meshNoAddress")
                }
              />
              <If when={!info().webUi}>
                <InlineBanner tone="warning" message={tr("phone.noWebUi")} accessibilityLabel="phone-no-web-ui" />
              </If>
              <PairingOffer route="mesh" />
            </View>
          </View>
        )}
      </If>
    </View>
  );
}

/** Devices › Use on phone. */
export function UseOnPhonePanel() {
  if (phoneRoute() === "mesh") void loadPhoneJoinInfo();
  return (
    <StudioSection
      title={tr("phone.title")}
      footnote={tr("phone.footnote")}
      accessibilityLabel="use-on-phone"
    >
      <If when={peerScope()}>
        {scope => (
          <InlineBanner
            tone="info"
            message={tr("phone.peerNote", { label: scope().label })}
            accessibilityLabel="phone-peer-note"
            style={{ marginBottom: 8 }}
          />
        )}
      </If>
      <InsetGroup accessibilityLabel="phone-panel">
        <View style={{ paddingTop: 12, paddingHorizontal: 16 }}>
          <SegmentedTabs<PhoneRoute>
            size="sm"
            value={phoneRoute()}
            onChange={selectPhoneRoute}
            options={[
              { value: "lan", label: tr("phone.tabLan"), icon: "wifi", accessibilityLabel: "phone-route-lan" },
              { value: "mesh", label: tr("phone.tabMesh"), icon: "globe", accessibilityLabel: "phone-route-mesh" },
            ]}
          />
        </View>
        <If when={phoneRoute() === "lan"}>
          <SameNetworkTab />
        </If>
        <If when={phoneRoute() === "mesh"}>
          <AnywhereTab />
        </If>
      </InsetGroup>
    </StudioSection>
  );
}
