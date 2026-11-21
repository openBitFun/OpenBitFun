// Settings › Device › Browser and desktop control: the user's own Chrome or
// Edge that agents drive (wave 22). Draws `browserControlStore.ts`; every
// state and what a connect needs next come from the device in Settings'
// scope (visual spec §3 Settings row, §4.9).

import { Clipboard, effect, Text, View, type JSX } from "nsh";
import {
  connectExternalBrowser,
  disconnectExternalBrowser,
  dismissExternalBrowserOutcome,
  externalBrowserAction,
  externalBrowserError,
  externalBrowserLoading,
  externalBrowserOutcome,
  externalBrowserStateText,
  externalBrowserStatus,
  externalBrowserUnsupported,
  refreshExternalBrowser,
  restartExternalBrowser,
  type ExternalBrowserOutcome,
} from "../browserControlStore";
import { fleetDeviceById } from "../fleetStore";
import { formatCount } from "../format";
import { tr } from "../i18n";
import { deviceContext } from "../state";
import { layout, palette, radii, space, textStyle } from "../theme";
import { pushToast } from "./overlays";
import { Button, IconButton } from "./primitives";

/** The browser's display name, as the host reports its kind. */
function browserName(kind: string): string {
  switch (kind.toLowerCase()) {
    case "chrome":
      return "Google Chrome";
    case "edge":
      return "Microsoft Edge";
    case "":
    case "default":
      return tr("browser.external.defaultBrowser");
    default:
      return kind;
  }
}

function detailText(): string {
  const status = externalBrowserStatus();
  if (!status) return "";
  const name = browserName(status.browserKind);
  if (status.cdpAvailable) return tr("browser.external.tabs", { browser: name, count: formatCount(status.pageCount) });
  if (status.browserReady) return tr("browser.external.readyDetail", { browser: name });
  return tr("browser.external.notConnectedDetail", { browser: name });
}

function outcomeText(outcome: ExternalBrowserOutcome): string {
  switch (outcome.kind) {
    case "connected":
      return tr("browser.external.connectedTo", { browser: browserName(outcome.browser) });
    case "disconnected":
      return tr("browser.external.disconnectedFrom", { browser: browserName(outcome.browser) });
    case "setup":
      return tr("browser.external.setup", { browser: browserName(outcome.browser) });
    case "restart":
      return tr("browser.external.restart", { browser: browserName(outcome.browser) });
    case "message":
    case "failed":
      return outcome.text;
  }
}

/** One 48 row of the group: label and detail on the left, the control on the right. */
function Row(props: { label: string; detail?: string; first?: boolean; children?: JSX.Element; accessibilityLabel?: string }) {
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      style={{
        minHeight: layout.touchTarget + space.xs,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: space.lg,
        rowGap: space.sm,
        borderTopWidth: props.first ? 0 : 1,
        borderColor: palette().borderSubtle,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
        <Text style={textStyle("body", { color: palette().text })}>{props.label}</Text>
        <If when={props.detail ?? ""}>{detail => <Text style={textStyle("caption")}>{detail()}</Text>}</If>
      </View>
      <If when={Boolean(props.children)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 0 }}>{props.children}</View>
      </If>
    </View>
  );
}

/** The section: status, connect or disconnect, and what the browser asks for next. */
export function ExternalBrowserSection() {
  // The browser is on the scope's device: read it again when the scope moves.
  effect(() => {
    deviceContext();
    void refreshExternalBrowser();
  });
  const busy = () => externalBrowserAction() !== null;
  const device = () => fleetDeviceById(deviceContext())?.name ?? "";
  const copySetupUrl = (url: string) =>
    void Clipboard.writeText(url).then(
      () => pushToast(tr("browser.external.copied"), "success"),
      () => undefined,
    );
  return (
    <View accessibilityLabel="external-browser-section" style={{ gap: layout.sectionHeaderGap }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: space.xxl, paddingHorizontal: space.xs }}>
        <Text role="header" style={{ ...textStyle("label", { color: palette().textSecondary }), fontWeight: "600", flex: 1 }}>
          {tr("browser.external.title")}
        </Text>
        <IconButton
          icon="refresh"
          size="xs"
          disabled={externalBrowserLoading() || busy()}
          tooltip={tr("browser.external.refresh")}
          accessibilityLabel="external-browser-refresh"
          onPress={() => void refreshExternalBrowser()}
        />
      </View>
      <View
        style={{
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().panelRaised,
          overflow: "hidden",
        }}
      >
        <If
          when={!externalBrowserUnsupported()}
          else={
            <View style={{ opacity: 0.4 }} accessibilityLabel="external-browser-unsupported">
              <Row
                first
                label={tr("browser.external.status")}
                detail={device() ? tr("settings.unsupported", { device: device() }) : tr("settings.unsupportedHere")}
              />
            </View>
          }
        >
          <Row
            first
            label={tr("browser.external.status")}
            detail={externalBrowserError() ?? detailText()}
            accessibilityLabel="external-browser-status"
          >
            <If when={externalBrowserStatus()}>
              {status => (
                <Text accessibilityLabel="external-browser-state" style={textStyle("caption", { color: palette().textSecondary })}>
                  {externalBrowserStateText(status())}
                </Text>
              )}
            </If>
            <If
              when={externalBrowserStatus()?.cdpAvailable === true}
              else={
                <Button
                  label={tr("browser.external.connect")}
                  size="sm"
                  variant="secondary"
                  loading={externalBrowserAction() === "connect"}
                  disabled={busy() || !externalBrowserStatus()}
                  accessibilityLabel="external-browser-connect"
                  onPress={() => void connectExternalBrowser()}
                />
              }
            >
              <Button
                label={tr("browser.external.disconnect")}
                size="sm"
                variant="ghost"
                loading={externalBrowserAction() === "disconnect"}
                disabled={busy()}
                accessibilityLabel="external-browser-disconnect"
                onPress={() => void disconnectExternalBrowser()}
              />
            </If>
          </Row>
          <If when={externalBrowserOutcome()}>
            {outcome => (
              <Row label={outcomeText(outcome())} accessibilityLabel={`external-browser-outcome-${outcome().kind}`}>
                <If when={outcome().kind === "setup" && (outcome() as { setupUrl?: string }).setupUrl ? "url" : ""}>
                  <Button
                    label={tr("browser.external.copyAddress")}
                    size="sm"
                    variant="ghost"
                    leadingIcon="copy"
                    accessibilityLabel="external-browser-copy-setup"
                    onPress={() => copySetupUrl((outcome() as { setupUrl: string }).setupUrl)}
                  />
                </If>
                <If when={outcome().kind === "restart"}>
                  <Button
                    label={tr("browser.external.restartAction")}
                    size="sm"
                    variant="secondary"
                    loading={externalBrowserAction() === "restart"}
                    disabled={busy()}
                    accessibilityLabel="external-browser-restart"
                    onPress={() => void restartExternalBrowser()}
                  />
                </If>
                <IconButton
                  icon="close"
                  size="xs"
                  tooltip={tr("browser.external.dismiss")}
                  accessibilityLabel="external-browser-dismiss"
                  onPress={dismissExternalBrowserOutcome}
                />
              </Row>
            )}
          </If>
        </If>
      </View>
    </View>
  );
}
