// Settings › Account › Devices and chat apps (visual spec §4.9, ux-redesign §3.8).
//
// The account's devices as quiet rows (a device opens its page), one "Open on
// your phone" row whose address and QR open in a sheet, and the chat apps
// (Telegram, Feishu, WeChat) this device's bot connector serves. Everything is the backend's answer: the fleet navigator
// for devices, the connector store for chat apps.

import { signal, Text, View } from "nsh";
import {
  botVerboseMode,
  connectorBusy,
  connectorError,
  connectorNotice,
  connectorStatus,
  connectorsLoading,
  connectorsSupported,
  copyPairingLink,
  ensureConnectors,
  feishuAppId,
  feishuAppSecret,
  loadConnectors,
  pollWeixinQr,
  saveAndConnectFeishu,
  saveAndConnectTelegram,
  setBotVerboseConnectorMode,
  startWeixinQr,
  stopBotConnector,
  telegramToken,
  weixinQr,
  weixinVerifyCode,
  agreeRemoteDisclaimer,
  declineRemoteDisclaimer,
  openRemoteDisclaimer,
  remoteDisclaimerAgreed,
  remoteDisclaimerOpen,
  remoteControlSaving,
  setRemoteControlAllowed,
} from "../connectorsStore";
import { fleetDevices } from "../fleetStore";
import { localizeHostError, tr, type MessageKey } from "../i18n";
import * as navigation from "../state";
import { fontMono, layout, palette, radii, space, textStyle } from "../theme";
import { DeviceGlyph } from "../ui/fleet";
import { UseOnPhonePanel } from "./UseOnPhonePanel";
import { ObpPairingCard } from "./ObpPairingCard";
import { Icon, type IconName } from "../ui/icons";
import { InsetGroup, InsetRow, MoreMenu, QrCodeView, StudioEmpty, StudioSection } from "../ui/studio";
import { ModalDialog, type DropdownMenuItem } from "../ui/overlays";
import { Button, InlineBanner, InputBox, StatusDot, StatusPill, ToggleSwitch } from "../ui/primitives";

type ChannelId = "telegram" | "feishu" | "weixin";

const activeChannelModal = signal<ChannelId | null>(null);
const phoneSheetOpen = signal(false);

function isBotActive(keyword: string): boolean {
  const bot = (connectorStatus()?.botConnected ?? "").toLowerCase();
  if (!bot) return false;
  return bot.includes(keyword);
}

/** A wrapping secondary line under an inset row's label. */
function RowNote(props: { text: string }) {
  return (
    <Text
      style={{
        ...textStyle("caption", { color: palette().textMuted }),
      }}
    >
      {props.text}
    </Text>
  );
}

function ChannelRow(props: {
  icon: IconName;
  label: string;
  description: string;
  active: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <InsetRow
      icon={props.icon}
      label={props.label}
      detail={props.description}
      chevron
      trailing={props.active ? <StatusDot kind="success" size={7} /> : undefined}
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
    />
  );
}

function channelMenuItems(): DropdownMenuItem[] {
  return [
    {
      id: "refresh",
      label: tr("devices.refreshChannels"),
      icon: "refresh",
      disabled: connectorsLoading(),
      accessibilityLabel: "connectors-refresh",
      onSelect: () => void loadConnectors(),
    },
    {
      id: "disclaimer",
      label: tr("devices.remote.disclaimerReview"),
      icon: "shield",
      accessibilityLabel: "remote-disclaimer-review",
      onSelect: () => openRemoteDisclaimer(),
    },
  ];
}

function ChannelsSection() {
  ensureConnectors();

  return (
    <StudioSection
      title={tr("devices.polish.channelsSection")}
      accessibilityLabel="channels-section"
      footnote={connectorsSupported() === true ? tr("devices.channelsSubtitle") : undefined}
      trailing={
        <>
          <MoreMenu
            accessibilityLabel="channels-menu"
            tooltip={tr("common.actions")}
            minWidth={200}
            items={channelMenuItems()}
          />
        </>
      }
    >
      <View style={{ gap: space.md, minWidth: 0 }}>
        <If when={connectorsSupported() === false}>
          <StudioEmpty
            icon="wifi"
            message={tr("devices.connectorsUnavailable")}
            detail={tr("devices.connectorsUnavailableSubtitle")}
          />
        </If>
        <If when={connectorsSupported() === true}>
          <If when={connectorNotice()}>
            {notice => <InlineBanner tone="success" message={localizeHostError(notice())} />}
          </If>
          <If when={connectorError()}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>
          <InsetGroup accessibilityLabel="channels-list">
            <InsetRow
              first
              label={tr("devices.remoteControlAllowed")}
              below={<RowNote text={tr("devices.remoteControlAllowedHint")} />}
              value={
                connectorStatus()?.remoteControlAllowed === undefined ? tr("devices.remoteControlUnreported") : undefined
              }
              trailing={
                connectorStatus()?.remoteControlAllowed !== undefined ? (
                  <ToggleSwitch
                    value={connectorStatus()?.remoteControlAllowed === true}
                    disabled={remoteControlSaving()}
                    accessibilityLabel="remote-control-allowed"
                    onChange={next => void setRemoteControlAllowed(next)}
                  />
                ) : undefined
              }
            />
            <InsetRow
              leading={
                <View style={{ width: 16, alignItems: "center" }}>
                  <StatusDot kind={connectorStatus()?.botConnected ? "success" : "muted"} size={7} />
                </View>
              }
              label={
                connectorStatus()?.botConnected
                  ? tr("devices.activeBot", { bot: connectorStatus()!.botConnected! })
                  : tr("devices.noBotConnected")
              }
              trailing={
                connectorStatus()?.botConnected ? (
                  <Button
                    label={tr("devices.stopBot")}
                    variant="ghost"
                    size="sm"
                    accessibilityLabel="connector-bot-stop"
                    disabled={connectorBusy()}
                    onPress={() => void stopBotConnector()}
                  />
                ) : undefined
              }
            />
            <InsetRow
              label={tr("devices.verboseBotMode")}
              trailing={
                <ToggleSwitch
                  value={botVerboseMode()}
                  accessibilityLabel="connector-bot-verbose"
                  disabled={connectorBusy()}
                  onChange={next => void setBotVerboseConnectorMode(next)}
                />
              }
            />
            <ChannelRow
              icon="message-circle"
              label={tr("devices.telegram")}
              description={
                isBotActive("telegram")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.telegramDesc")
              }
              active={isBotActive("telegram")}
              accessibilityLabel="channel-toggle-telegram"
              onPress={() => activeChannelModal.set("telegram")}
            />
            <ChannelRow
              icon="globe"
              label={tr("devices.feishu")}
              description={
                isBotActive("feishu") || isBotActive("lark")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.feishuDesc")
              }
              active={isBotActive("feishu") || isBotActive("lark")}
              accessibilityLabel="channel-toggle-feishu"
              onPress={() => activeChannelModal.set("feishu")}
            />
            <ChannelRow
              icon="smartphone"
              label={tr("devices.wechat")}
              description={
                isBotActive("weixin") || isBotActive("wechat")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.wechatDesc")
              }
              active={isBotActive("weixin") || isBotActive("wechat")}
              accessibilityLabel="channel-toggle-weixin"
              onPress={() => activeChannelModal.set("weixin")}
            />
          </InsetGroup>
        </If>
      </View>

      {/* Telegram Modal */}
      <ModalDialog
        open={activeChannelModal() === "telegram"}
        title={tr("devices.telegramBot")}
        subtitle={tr("devices.telegramSubtitle")}
        size="sm"
        accessibilityLabel="connector-modal-telegram"
        onClose={() => activeChannelModal.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("common.done")}
              variant="ghost"
              size="sm"
              onPress={() => activeChannelModal.set(null)}
            />
            <Button
              label={tr("devices.saveConnectTelegram")}
              variant="primary"
              size="sm"
              accessibilityLabel="connector-telegram-connect"
              disabled={connectorBusy()}
              onPress={() => void saveAndConnectTelegram()}
            />
          </View>
        }
      >
        <View style={{ gap: space.md }}>
          <InputBox
            label={tr("devices.botToken")}
            leadingIcon="key"
            masked={true}
            monospace
            value={telegramToken()}
            placeholder={tr("devices.botTokenPlaceholder")}
            accessibilityLabel="connector-telegram-token"
            onChange={val => telegramToken.set(val)}
          />
          <If when={connectorNotice()}>
            {msg => <InlineBanner tone="success" message={localizeHostError(msg())} />}
          </If>
          <If when={connectorError()}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>
        </View>
      </ModalDialog>

      {/* Feishu Modal */}
      <ModalDialog
        open={activeChannelModal() === "feishu"}
        title={tr("devices.feishuBot")}
        subtitle={tr("devices.feishuSubtitle")}
        size="md"
        accessibilityLabel="connector-modal-feishu"
        onClose={() => activeChannelModal.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("common.done")}
              variant="ghost"
              size="sm"
              onPress={() => activeChannelModal.set(null)}
            />
            <Button
              label={tr("devices.saveConnectFeishu")}
              variant="primary"
              size="sm"
              accessibilityLabel="connector-feishu-connect"
              disabled={connectorBusy()}
              onPress={() => void saveAndConnectFeishu()}
            />
          </View>
        }
      >
        <View style={{ gap: space.md }}>
          <InputBox
            label={tr("devices.appId")}
            monospace
            value={feishuAppId()}
            placeholder={tr("devices.appIdPlaceholder")}
            accessibilityLabel="connector-feishu-app-id"
            onChange={val => feishuAppId.set(val)}
          />
          <InputBox
            label={tr("devices.appSecret")}
            leadingIcon="key"
            masked={true}
            monospace
            value={feishuAppSecret()}
            placeholder={tr("devices.appSecretPlaceholder")}
            accessibilityLabel="connector-feishu-app-secret"
            onChange={val => feishuAppSecret.set(val)}
          />
          <If when={connectorNotice()}>
            {msg => <InlineBanner tone="success" message={localizeHostError(msg())} />}
          </If>
          <If when={connectorError()}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>
        </View>
      </ModalDialog>

      {/* WeChat Modal */}
      <ModalDialog
        open={activeChannelModal() === "weixin"}
        title={tr("devices.wechatBot")}
        subtitle={tr("devices.wechatSubtitle")}
        size="md"
        accessibilityLabel="connector-modal-weixin"
        onClose={() => activeChannelModal.set(null)}
        footer={
          <Button
            label={tr("common.done")}
            variant="ghost"
            size="sm"
            onPress={() => activeChannelModal.set(null)}
          />
        }
      >
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("devices.startWechatQr")}
              variant="primary"
              size="sm"
              leadingIcon="smartphone"
              accessibilityLabel="connector-weixin-qr-start"
              disabled={connectorBusy()}
              onPress={() => void startWeixinQr()}
            />
          </View>
          <If when={weixinQr()}>
            {qr => (
              <View
                style={{
                  gap: space.md,
                  paddingTop: space.md,
                  borderTopWidth: 1,
                  borderColor: palette().borderSubtle,
                }}
              >
                <Text
                  style={{
                    ...textStyle("label", { color: palette().text }),
                  }}
                >
                  {qr().message || tr("devices.qrStatus", { status: qr().status })}
                </Text>
                <If
                  when={
                    qr().status === "wait" &&
                    qr().qrImageUrl &&
                    !/^data:image\//i.test(qr().qrImageUrl) &&
                    !/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(qr().qrImageUrl)
                      ? qr().qrImageUrl
                      : ""
                  }
                >
                  {content => (
                    <View style={{ alignSelf: "flex-start", borderRadius: radii.md, overflow: "hidden" }}>
                      <QrCodeView value={content()} size={164} accessibilityLabel="connector-weixin-qr" />
                    </View>
                  )}
                </If>
                <If when={qr().status === "need_verify_code"}>
                  <View style={{ gap: space.sm }}>
                    <Text style={textStyle("caption")}>{tr("devices.weixinVerifyHint")}</Text>
                    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <InputBox
                          value={weixinVerifyCode()}
                          placeholder={tr("devices.weixinVerifyPlaceholder")}
                          accessibilityLabel="connector-weixin-verify-code"
                          onChange={value => weixinVerifyCode.set(value)}
                          onSubmit={() => {
                            if (weixinVerifyCode().trim()) void pollWeixinQr();
                          }}
                        />
                      </View>
                      <Button
                        label={tr("devices.weixinVerifySubmit")}
                        variant="primary"
                        size="sm"
                        accessibilityLabel="connector-weixin-verify-submit"
                        disabled={connectorBusy() || !weixinVerifyCode().trim()}
                        onPress={() => void pollWeixinQr()}
                      />
                    </View>
                  </View>
                </If>
                <If when={qr().qrImageUrl}>
                  {url => (
                    <View
                      style={{
                        paddingHorizontal: space.md,
                        paddingVertical: space.sm,
                        borderRadius: radii.sm,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderColor: palette().borderSubtle,
                        backgroundColor: palette().canvas,
                      }}
                    >
                      <Text
                        style={{
                          minWidth: 0,
                          fontFamily: fontMono,
                          ...textStyle("caption", { color: palette().textSecondary }),
                          numberOfLines: 2,
                          textOverflow: "ellipsis-middle",
                        }}
                      >
                        {url()}
                      </Text>
                    </View>
                  )}
                </If>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  <If when={qr().qrImageUrl}>
                    {url => (
                      <Button
                        label={tr("devices.copyQrUrl")}
                        variant="secondary"
                        size="sm"
                        leadingIcon="copy"
                        accessibilityLabel="connector-weixin-copy-url"
                        onPress={() => void copyPairingLink(url())}
                      />
                    )}
                  </If>
                  <Button
                    label={tr("devices.checkWechatQr")}
                    variant="primary"
                    size="sm"
                    accessibilityLabel="connector-weixin-qr-poll"
                    disabled={connectorBusy()}
                    onPress={() => void pollWeixinQr()}
                  />
                </View>
              </View>
            )}
          </If>
          <If when={connectorNotice()}>
            {msg => <InlineBanner tone="success" message={localizeHostError(msg())} />}
          </If>
          <If when={connectorError()}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>
        </View>
      </ModalDialog>

    </StudioSection>
  );
}

const DISCLAIMER_KEY_ITEMS = [
  "devices.remote.disclaimerItemGeneralRisk",
  "devices.remote.disclaimerItemSecurity",
  "devices.remote.disclaimerItemEncryption",
  "devices.remote.disclaimerItemPrivacy",
] as const;
const DISCLAIMER_DETAIL_ITEMS = [
  "devices.remote.disclaimerItemOpenSource",
  "devices.remote.disclaimerItemDataUsage",
  "devices.remote.disclaimerItemCredentials",
  "devices.remote.disclaimerItemQrCode",
  "devices.remote.disclaimerItemRelay",
  "devices.remote.disclaimerItemNetwork",
  "devices.remote.disclaimerItemBot",
  "devices.remote.disclaimerItemBotPersistence",
  "devices.remote.disclaimerItemMobileBrowser",
  "devices.remote.disclaimerItemCompliance",
  "devices.remote.disclaimerItemLiability",
] as const;

function DisclaimerList(props: { items: readonly MessageKey[]; start: number }) {
  return (
    <View style={{ gap: space.sm }}>
      <Each of={props.items}>
        {(key, index) => (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
            <Text
              style={{
                width: space.xl,
                flexShrink: 0,
                ...textStyle("label", { color: palette().textMuted }),
                fontWeight: "400",
              }}
            >
              {`${props.start + index()}.`}
            </Text>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                ...textStyle("label", { color: palette().textSecondary }),
                fontWeight: "400",
              }}
            >
              {tr(key())}
            </Text>
          </View>
        )}
      </Each>
    </View>
  );
}

/** The desktop's Remote Connect disclaimer: a gate before the first connection. */
function RemoteDisclaimerModal() {
  const detailsOpen = signal(false);
  return (
    <ModalDialog
      open={remoteDisclaimerOpen()}
      title={tr("devices.remote.disclaimerTitle")}
      size="md"
      accessibilityLabel="remote-disclaimer-modal"
      onClose={() => declineRemoteDisclaimer()}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Button
            label={remoteDisclaimerAgreed() ? tr("common.close") : tr("devices.remote.disclaimerDecline")}
            variant="ghost"
            size="sm"
            accessibilityLabel="remote-disclaimer-decline"
            onPress={() => declineRemoteDisclaimer()}
          />
          <If when={!remoteDisclaimerAgreed()}>
            <Button
              label={tr("devices.remote.disclaimerAgree")}
              variant="primary"
              size="sm"
              accessibilityLabel="remote-disclaimer-agree"
              onPress={() => void agreeRemoteDisclaimer()}
            />
          </If>
        </View>
      }
    >
      <View style={{ gap: space.lg }}>
        <View style={{ flexDirection: "row" }}>
          <StatusPill
            label={
              remoteDisclaimerAgreed()
                ? tr("devices.remote.disclaimerStatusAgreed")
                : tr("devices.remote.disclaimerStatusPending")
            }
            kind={remoteDisclaimerAgreed() ? "success" : "warning"}
          />
        </View>
        <Text
          style={{
            ...textStyle("label", { color: palette().textSecondary }),
            fontWeight: "400",
          }}
        >
          {tr("devices.remote.disclaimerIntro")}
        </Text>
        <Text style={textStyle("body", { color: palette().text })}>{tr("devices.remote.disclaimerKeyRisks")}</Text>
        <DisclaimerList items={DISCLAIMER_KEY_ITEMS} start={1} />
        <View
          role="button"
          accessibilityLabel="remote-disclaimer-details"
          onPress={() => detailsOpen.update(open => !open)}
          style={{ flexDirection: "row", alignItems: "center", gap: space.chip, cursor: "pointer" }}
        >
          <Icon name={detailsOpen() ? "chevron-down" : "chevron-right"} size={14} color={palette().textMuted} />
          <Text style={textStyle("label", { color: palette().accent })}>
            {tr("devices.remote.disclaimerFullDetails")}
          </Text>
        </View>
        <If when={detailsOpen()}>
          <DisclaimerList items={DISCLAIMER_DETAIL_ITEMS} start={5} />
        </If>
      </View>
    </ModalDialog>
  );
}

/** The exception words a device row carries; a healthy device shows none. */
function deviceException(state: string): { text: string; warning: boolean } | null {
  if (state === "offline" || state === "unreachable") return { text: tr("state.offline"), warning: false };
  if (state === "update_required") return { text: tr("state.updateNeeded"), warning: true };
  return null;
}

function AccountDevicesSection() {
  return (
    <StudioSection title={tr("settings.devicesPage.devices")} accessibilityLabel="account-devices-section">
      <If
        when={fleetDevices().length > 0}
        else={<Text style={textStyle("caption", { color: palette().textMuted })}>{tr("settings.devicesPage.none")}</Text>}
      >
        <InsetGroup accessibilityLabel="account-devices-list">
          <Each of={fleetDevices()} key={device => device.deviceId}>
            {(device, index) => (
              <InsetRow
                first={index() === 0}
                leading={<DeviceGlyph kind={device().hostKind} size={16} />}
                label={device().name}
                trailing={
                  deviceException(device().state) ? (
                    <Text
                      style={textStyle("caption", {
                        color: deviceException(device().state)!.warning ? palette().warning : palette().textMuted,
                      })}
                    >
                      {deviceException(device().state)!.text}
                    </Text>
                  ) : undefined
                }
                chevron
                accessibilityLabel={`account-device-${device().deviceId}`}
                onPress={() => navigation.openDevicePage(device().deviceId)}
              />
            )}
          </Each>
        </InsetGroup>
      </If>
      <View style={{ height: space.sm }} />
      <InsetGroup accessibilityLabel="account-phone-group">
        <InsetRow
          first
          icon="smartphone"
          label={tr("settings.devicesPage.phone")}
          chevron
          accessibilityLabel="account-open-on-phone"
          onPress={() => phoneSheetOpen.set(true)}
        />
      </InsetGroup>
      <ModalDialog
        open={phoneSheetOpen()}
        title={tr("settings.devicesPage.phone")}
        size="md"
        accessibilityLabel="account-phone-sheet"
        onClose={() => phoneSheetOpen.set(false)}
      >
        <UseOnPhonePanel />
      </ModalDialog>
      {/* Browsers that drive this computer (signed-in clients), each revocable here. */}
      <ObpPairingCard />
    </StudioSection>
  );
}

/** The page body Settings draws for Account › Devices and chat apps. */
export function AccountDevicesPage() {
  return (
    <View style={{ gap: layout.sectionGap }}>
      <AccountDevicesSection />
      <ChannelsSection />
      <RemoteDisclaimerModal />
    </View>
  );
}
