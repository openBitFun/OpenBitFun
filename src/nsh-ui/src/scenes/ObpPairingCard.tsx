// Devices scene: "Browser and paired devices" — this backend's own listener.
//
// Mounted in 2.0 Account › Devices when `obp_get_status` reports active paired
// clients so users can inspect the loopback URL and revoke paired browsers/devices.
// Errors are sanitized through `localizeHostError` and destructive revocations
// require explicit confirmation.

import { Text, View } from "nsh";
import { formatRelativeTime } from "../format";
import { localizeHostError, tr } from "../i18n";
import {
  loadObpStatus,
  obpBusy,
  obpError,
  obpStatus,
  openOwnerBrowser,
  revokeObpClient,
  type ObpPairedClient,
} from "../obpStore";
import { compactLayout, layout, palette, space, textStyle } from "../theme";
import { InsetGroup, InsetRow, StudioSection } from "../ui/studio";
import { Button, InlineBanner, InlineDeleteConfirm } from "../ui/primitives";

function errorText(code: string): string {
  if (code === "obp_update_host") return tr("devices.obp.updateHost");
  if (code === "obp_owner_only") return tr("devices.obp.ownerOnly");
  if (code === "obp_no_loopback") return tr("devices.obp.noLoopback");
  if (code.startsWith("obp_unavailable")) return tr("devices.obp.unavailable");
  return localizeHostError(code);
}

function clientDetail(client: ObpPairedClient): string {
  if (client.connected) return tr("devices.obp.clientConnected");
  if (client.lastSeenAtMs) return tr("devices.obp.clientLastSeen", { time: formatRelativeTime(client.lastSeenAtMs) });
  return tr("devices.obp.clientNeverSeen");
}

export function ObpPairingCard(props: { autoload?: boolean } = {}) {
  if (props.autoload !== false) void loadObpStatus();
  return (
    <StudioSection
      title={tr("devices.obp.title")}
      footnote={tr("devices.obp.footnote")}
      accessibilityLabel="obp-pairing-card"
    >
      <View style={{ gap: space.sm, minWidth: 0 }}>
        <If when={obpError()}>
          {code => (
            <InlineBanner
              tone={code() === "obp_owner_only" ? "info" : "warning"}
              message={errorText(code())}
              accessibilityLabel="obp-error"
            />
          )}
        </If>
        <If when={!obpError() && obpStatus() === null}>
          <InsetGroup accessibilityLabel="obp-loading">
            <InsetRow first label={tr("common.loading")} />
          </InsetGroup>
        </If>
        <If when={!obpError() && obpStatus()?.available === false}>
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
                    size={compactLayout() ? "md" : "sm"}
                    leadingIcon="external-link"
                    disabled={!status().ownerUrl || !status().webUi || obpBusy()}
                    accessibilityLabel="obp-open-browser"
                    style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
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
                    trailing={
                      <InlineDeleteConfirm
                        label={tr("devices.obp.revoke")}
                        variant="danger"
                        size={compactLayout() ? "md" : "sm"}
                        disabled={obpBusy()}
                        accessibilityLabel={`obp-revoke-${client().id}`}
                        confirmAccessibilityLabel="obp-revoke-confirm"
                        cancelAccessibilityLabel="obp-revoke-cancel"
                        onConfirm={() => void revokeObpClient(client().id)}
                      />
                    }
                  />
                )}
              </Each>
            </InsetGroup>
          )}
        </If>
      </View>
    </StudioSection>
  );
}
