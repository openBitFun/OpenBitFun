// Devices scene: "Browser and paired devices" — this backend's own listener.
//
// The same UI, served by this backend, runs in a browser on this computer
// (loopback, owner session through a per-launch link). Phones pair over the
// device mesh in "Use on phone"; every paired device is listed and revoked
// here. The card only exists for the backend's owner: a paired phone gets a
// note instead (the commands are controller-local and the backend refuses them).

import { formatRelativeTime } from "../format";
import { tr } from "../i18n";
import {
  loadObpStatus,
  obpBusy,
  obpError,
  obpStatus,
  openOwnerBrowser,
  revokeObpClient,
  type ObpPairedClient,
} from "../obpStore";
import { InsetGroup, InsetRow, StudioSection } from "../ui/studio";
import { Button, InlineBanner, StatusPill } from "../ui/primitives";

function errorText(code: string): string {
  if (code === "obp_update_host") return tr("devices.obp.updateHost");
  if (code === "obp_owner_only") return tr("devices.obp.ownerOnly");
  if (code === "obp_no_loopback") return tr("devices.obp.noLoopback");
  if (code.startsWith("obp_unavailable")) return tr("devices.obp.unavailable");
  return code;
}

function clientDetail(client: ObpPairedClient): string {
  if (client.connected) return tr("devices.obp.clientConnected");
  if (client.lastSeenAtMs) return tr("devices.obp.clientLastSeen", { time: formatRelativeTime(client.lastSeenAtMs) });
  return tr("devices.obp.clientNeverSeen");
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
