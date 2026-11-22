// Devices scene: "Browser and paired devices" — this backend's own listener.
//
// Retained for standalone/legacy compatibility (not mounted on 2.0 Account ›
// Devices, which uses email-code sign-in). Errors are sanitized through
// `localizeHostError` and destructive revocations require explicit confirmation.

import { signal, Text, View } from "nsh";
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
import { palette, space, textStyle } from "../theme";
import { InsetGroup, InsetRow, StudioSection } from "../ui/studio";
import { ModalDialog } from "../ui/overlays";
import { Button, InlineBanner } from "../ui/primitives";

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

export function ObpPairingCard() {
  const pendingRevoke = signal<ObpPairedClient | null>(null);
  void loadObpStatus();
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
                detail={status().webUi ? undefined : tr("devices.obp.noWebUi")}
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
                    trailing={
                      <Button
                        label={tr("devices.obp.revoke")}
                        variant="danger"
                        size="sm"
                        disabled={obpBusy()}
                        accessibilityLabel={`obp-revoke-${client().id}`}
                        onPress={() => pendingRevoke.set(client())}
                      />
                    }
                  />
                )}
              </Each>
            </InsetGroup>
          )}
        </If>
      </View>
      <ModalDialog
        open={pendingRevoke() !== null}
        title={tr("devices.obp.revoke")}
        size="sm"
        accessibilityLabel="obp-revoke-confirm-dialog"
        onClose={() => pendingRevoke.set(null)}
        footer={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space.sm, flex: 1 }}>
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="md"
              accessibilityLabel="obp-revoke-cancel"
              onPress={() => pendingRevoke.set(null)}
            />
            <Button
              label={tr("devices.obp.revoke")}
              variant="danger"
              size="md"
              disabled={obpBusy()}
              accessibilityLabel="obp-revoke-confirm"
              onPress={() => {
                const target = pendingRevoke();
                pendingRevoke.set(null);
                if (target) void revokeObpClient(target.id);
              }}
            />
          </View>
        }
      >
        <Text style={textStyle("body", { color: palette().textSecondary })}>
          {pendingRevoke()?.name || tr("devices.obp.unnamedClient")}
        </Text>
      </ModalDialog>
    </StudioSection>
  );
}
