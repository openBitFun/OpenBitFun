// Devices scene: "Open on phone or browser" — this backend's own listener.
//
// The same UI, served by this backend, runs in a browser on this computer
// (loopback, owner session through a per-launch link) or on a phone or another
// computer on the local network (TLS, paired with a one-time QR code). Paired
// devices are listed here and revoked here. The card only exists for the
// backend's owner: a paired phone gets a note instead (the commands are
// controller-local and the backend refuses them).

import { Clipboard, Text, View } from "nsh";
import { formatRelativeTime } from "../format";
import { tr } from "../i18n";
import {
  createObpPairing,
  loadObpStatus,
  obpBusy,
  obpError,
  obpPairing,
  obpStatus,
  openOwnerBrowser,
  revokeObpClient,
  setObpLanEnabled,
  type ObpPairedClient,
} from "../obpStore";
import { fontMono, palette, radii, textSize, textStyle } from "../theme";
import { InsetGroup, InsetRow, QrCodeView, StudioSection } from "../ui/studio";
import { pushToast } from "../ui/overlays";
import { Button, InlineBanner, StatusPill, ToggleSwitch } from "../ui/primitives";

function errorText(code: string): string {
  if (code === "obp_update_host") return tr("devices.obp.updateHost");
  if (code === "obp_owner_only") return tr("devices.obp.ownerOnly");
  if (code === "obp_no_loopback") return tr("devices.obp.noLoopback");
  if (code.startsWith("obp_unavailable")) return tr("devices.obp.unavailable");
  if (code.startsWith("obp_no_lan_address")) return tr("devices.obp.noLanAddress");
  return code;
}

function clientDetail(client: ObpPairedClient): string {
  if (client.connected) return tr("devices.obp.clientConnected");
  if (client.lastSeenAtMs) return tr("devices.obp.clientLastSeen", { time: formatRelativeTime(client.lastSeenAtMs) });
  return tr("devices.obp.clientNeverSeen");
}

async function copyText(text: string): Promise<void> {
  try {
    await Clipboard.writeText(text);
    pushToast(tr("devices.obp.copied"), "success");
  } catch {
    pushToast(tr("devices.obp.copyFailed"), "danger");
  }
}

function PairingPanel() {
  return (
    <If when={obpPairing()}>
      {offer => (
        <View
          accessibilityLabel="obp-pairing-offer"
          style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, padding: 16, alignItems: "flex-start" }}
        >
          <View style={{ padding: 6, borderRadius: radii.md, borderCurve: "continuous", backgroundColor: "#ffffff" }}>
            <QrCodeView value={offer().qrPayload} size={180} accessibilityLabel="obp-pairing-qr" />
          </View>
          <View style={{ flex: 1, minWidth: 220, gap: 8 }}>
            <Text style={textStyle("cardTitle")}>{tr("devices.obp.pairTitle")}</Text>
            <Text style={textStyle("caption")}>{tr("devices.obp.pairHint")}</Text>
            <Text style={textStyle("caption")}>{tr("devices.obp.fingerprintLabel")}</Text>
            <Text
              style={{ fontFamily: fontMono, fontSize: textSize(11), color: palette().textSecondary }}
            >
              {offer().fingerprint}
            </Text>
            <Text style={textStyle("caption")}>
              {tr("devices.obp.pairExpires", { time: formatRelativeTime(offer().expiresAtMs) })}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button
                label={tr("devices.obp.copyLink")}
                variant="secondary"
                size="sm"
                leadingIcon="copy"
                accessibilityLabel="obp-copy-pairing-link"
                onPress={() => void copyText(offer().url)}
              />
              <Button
                label={tr("devices.obp.newCode")}
                variant="ghost"
                size="sm"
                leadingIcon="refresh"
                disabled={obpBusy()}
                accessibilityLabel="obp-new-pairing-code"
                onPress={() => void createObpPairing()}
              />
            </View>
          </View>
        </View>
      )}
    </If>
  );
}

export function ObpPairingCard() {
  void loadObpStatus();
  return (
    <StudioSection
      title={tr("devices.obp.title")}
      footnote={tr("devices.obp.footnote")}
      accessibilityLabel="obp-pairing-card"
    >
      <If when={obpError()}>
        {code => (
          <InlineBanner
            tone={code() === "obp_owner_only" ? "info" : "warning"}
            message={errorText(code())}
            accessibilityLabel="obp-error"
            style={{ marginBottom: 8 }}
          />
        )}
      </If>
      <If when={obpStatus()?.available === false}>
        <InlineBanner tone="info" message={tr("devices.obp.unavailable")} accessibilityLabel="obp-unavailable" />
      </If>
      <If when={obpStatus()?.available === true ? obpStatus() : null}>
        {status => (
          <InsetGroup accessibilityLabel="obp-listener">
            <InsetRow
              first
              icon="monitor"
              label={tr("devices.obp.browserHere")}
              detail={
                status().webUi
                  ? (status().loopbackUrl ?? tr("devices.obp.noLoopback"))
                  : tr("devices.obp.noWebUi")
              }
              trailing={
                <Button
                  label={tr("devices.obp.openBrowser")}
                  variant="secondary"
                  size="sm"
                  leadingIcon="external-link"
                  disabled={!status().ownerUrl || !status().webUi || obpBusy()}
                  accessibilityLabel="obp-open-browser"
                  onPress={() => void openOwnerBrowser()}
                />
              }
            />
            <InsetRow
              icon="smartphone"
              label={tr("devices.obp.lan")}
              detail={
                status().lan.error
                  ? tr("devices.obp.lanError", { error: status().lan.error ?? "" })
                  : status().lan.running
                    ? status().lan.urls.join("  ") || tr("devices.obp.noLanAddress")
                    : tr("devices.obp.lanOff")
              }
              trailing={
                <ToggleSwitch
                  value={status().lan.enabled}
                  disabled={obpBusy()}
                  accessibilityLabel="obp-lan-toggle"
                  onChange={next => void setObpLanEnabled(next)}
                />
              }
            />
            <If when={status().lan.running}>
              <InsetRow
                icon="link"
                label={tr("devices.obp.pairDevice")}
                detail={tr("devices.obp.pairDeviceHint")}
                trailing={
                  <Button
                    label={obpPairing() ? tr("devices.obp.hideCode") : tr("devices.obp.showCode")}
                    variant="primary"
                    size="sm"
                    disabled={obpBusy()}
                    accessibilityLabel="obp-pair-device"
                    onPress={() => (obpPairing() ? obpPairing.set(null) : void createObpPairing())}
                  />
                }
                below={<PairingPanel />}
              />
            </If>
            <Each of={status().pairedClients} key={client => client.id}>
              {client => (
                <InsetRow
                  indent
                  label={client().name || tr("devices.obp.unnamedClient")}
                  detail={clientDetail(client())}
                  leading={
                    <StatusPill
                      size="xs"
                      kind={client().connected ? "success" : "neutral"}
                      label={client().connected ? tr("devices.obp.online") : tr("devices.obp.offline")}
                    />
                  }
                  trailing={
                    <Button
                      label={tr("devices.obp.revoke")}
                      variant="danger"
                      size="sm"
                      disabled={obpBusy()}
                      accessibilityLabel={`obp-revoke-${client().id}`}
                      onPress={() => void revokeObpClient(client().id)}
                    />
                  }
                />
              )}
            </Each>
          </InsetGroup>
        )}
      </If>
    </StudioSection>
  );
}
