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
import { localizeHostError, tr } from "../i18n";
import { deviceContext } from "../state";
import { layout, palette, radii, space, textStyle } from "../theme";
import { deviceException } from "./fleet";
import { Spinner } from "./motion";
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
  if (status.cdpAvailable) {
    return tr(status.pageCount === 1 ? "browser.external.tabsOne" : "browser.external.tabs", {
      browser: name,
      count: formatCount(status.pageCount),
    });
  }
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
      return outcome.text;
    case "failed":
      return localizeHostError(outcome.text);
  }
}

/** One 48 row of the group: label and detail on the left, a single control on the right. */
function Row(props: {
  label: string;
  labelTone?: "default" | "danger";
  detail?: string;
  detailNode?: JSX.Element;
  first?: boolean;
  children?: JSX.Element;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      style={{
        position: "relative",
        minHeight: layout.touchTarget + space.xs,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: space.lg,
        rowGap: space.sm,
      }}
    >
      <If when={!props.first}>
        <View
          style={{
            position: "absolute",
            top: 0,
            left: space.lg,
            right: 0,
            height: 1,
            backgroundColor: palette().borderSubtle,
          }}
        />
      </If>
      <View style={{ flex: 1, minWidth: 180, gap: space.hair }}>
        <Text style={textStyle("body", { color: props.labelTone === "danger" ? palette().danger : palette().text })}>
          {props.label}
        </Text>
        <If when={Boolean(props.detailNode)}>{props.detailNode}</If>
        <If when={!props.detailNode && Boolean(props.detail)}>
          <Text style={textStyle("caption")}>{props.detail ?? ""}</Text>
        </If>
      </View>
      <If when={Boolean(props.children)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 0 }}>{props.children}</View>
      </If>
    </View>
  );
}

/** The section: status, connect or disconnect, and what the browser asks for next. */
export function ExternalBrowserSection() {
  const scopeDevice = () => fleetDeviceById(deviceContext());
  const deviceOffline = () => deviceException(scopeDevice()?.state) === "offline";
  // The browser is on the scope's device: read it again when the scope moves, skipping offline devices.
  effect(() => {
    deviceContext();
    if (deviceOffline()) return;
    void refreshExternalBrowser();
  });
  const busy = () => externalBrowserAction() !== null;
  const device = () => scopeDevice()?.name ?? "";
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
          disabled={externalBrowserLoading() || busy() || deviceOffline()}
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
          when={!deviceOffline()}
          else={
            <View style={{ opacity: 0.45 }} accessibilityLabel="external-browser-offline">
              <Row
                first
                label={tr("browser.external.status")}
                detail={tr("settings.offline")}
              />
            </View>
          }
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
              accessibilityLabel="external-browser-status"
              detailNode={
                <View style={{ gap: space.xs }}>
                  <If when={externalBrowserLoading() && !externalBrowserStatus()}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                      <Spinner size={12} color={palette().textMuted} />
                      <Text style={textStyle("caption")}>{tr("common.loading")}</Text>
                    </View>
                  </If>
                  <If when={externalBrowserError()}>
                    {err => (
                      <Text style={textStyle("caption", { color: palette().danger })}>
                        {localizeHostError(err())}
                      </Text>
                    )}
                  </If>
                  <If when={!externalBrowserError() ? externalBrowserStatus() : null}>
                    {status => (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.xs, rowGap: space.hair }}>
                        <Text
                          accessibilityLabel="external-browser-state"
                          style={{ ...textStyle("caption", { color: palette().textSecondary }), fontWeight: "500" }}
                        >
                          {externalBrowserStateText(status())}
                        </Text>
                        <If when={detailText()}>
                          {detail => (
                            <>
                              <Text style={textStyle("caption")}>·</Text>
                              <Text style={textStyle("caption")}>{detail()}</Text>
                            </>
                          )}
                        </If>
                      </View>
                    )}
                  </If>
                </View>
              }
            >
              <If
                when={Boolean(externalBrowserError()) && !externalBrowserStatus()}
                else={
                  <If
                    when={externalBrowserStatus()?.cdpAvailable === true}
                    else={
                      <Button
                        label={tr("browser.external.connect")}
                        size="sm"
                        variant="secondary"
                        loading={externalBrowserAction() === "connect"}
                        disabled={busy() || externalBrowserLoading() || !externalBrowserStatus()}
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
                }
              >
                <Button
                  label={tr("common.tryAgain")}
                  size="sm"
                  variant="ghost"
                  accessibilityLabel="external-browser-retry"
                  onPress={() => void refreshExternalBrowser()}
                />
              </If>
            </Row>
            <If when={externalBrowserOutcome()}>
              {outcome => (
                <Row
                  label={outcomeText(outcome())}
                  labelTone={outcome().kind === "failed" ? "danger" : "default"}
                  accessibilityLabel={`external-browser-outcome-${outcome().kind}`}
                  detailNode={
                    outcome().kind === "setup" && (outcome() as { setupUrl?: string }).setupUrl ? (
                      <View
                        style={{
                          alignSelf: "flex-start",
                          maxWidth: "100%",
                          paddingHorizontal: space.chip,
                          paddingVertical: space.hair,
                          borderRadius: radii.xs,
                          backgroundColor: palette().surfaceTertiary,
                        }}
                      >
                        <Text
                          style={{
                            ...textStyle("mono", { color: palette().textSecondary }),
                            userSelect: "text",
                            numberOfLines: 1,
                            textOverflow: "ellipsis-middle",
                          }}
                        >
                          {(outcome() as { setupUrl: string }).setupUrl}
                        </Text>
                      </View>
                    ) : undefined
                  }
                >
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
        </If>
      </View>
    </View>
  );
}
