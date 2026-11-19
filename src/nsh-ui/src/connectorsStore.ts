// Controller-local Remote Connect and IM Bot connectors state.
//
// All `remote_connect_*` commands are declared `ControllerLocal` in the Product
// Operation Registry (`peerSurface.ts`), so `bridge.ts` always routes them to
// this controller machine even while Peer Device Mode drives another device.

import { Clipboard, Storage, signal } from "nsh";
import { invokeCommand, invokeRawCommand } from "./bridge";
import { tr } from "./i18n";

export interface ConnectorMethodInfo {
  id: string;
  name: string;
  available: boolean;
  description: string;
}

export interface RelayRouteStatus {
  method: string;
  relayConnected: boolean;
  relayUrl: string;
  clientCount: number;
}

export interface ConnectorClient {
  id: string;
  name: string;
}

export interface ConnectorStatus {
  connections: RelayRouteStatus[];
  relayConnected: boolean;
  relayUrl: string;
  activeMethod: string;
  clients: ConnectorClient[];
  botConnected: string | null;
  botVerboseMode: boolean;
  /** `undefined` when the host does not report it (an older build). */
  remoteControlAllowed?: boolean;
}

export interface RelayPairingInfo {
  method: string;
  qrUrl: string;
  qrData: string;
  botPairingCode: string;
  botLink: string;
  pairingState: string;
}

export interface WeixinQrState {
  sessionKey: string;
  qrImageUrl: string;
  message: string;
  status: string;
}

export const connectorsSupported = signal<boolean | null>(null);
export const connectorsLoading = signal(false);
export const connectorBusy = signal(false);
export const connectorNotice = signal("");
export const connectorError = signal("");

export const connectorStatus = signal<ConnectorStatus | null>(null);
export const connectorMethods = signal<ConnectorMethodInfo[]>([]);

export const telegramToken = signal("");
export const feishuAppId = signal("");
export const feishuAppSecret = signal("");
export const weixinIlinkToken = signal("");
export const weixinBaseUrl = signal("");
export const weixinBotAccountId = signal("");
export const weixinQr = signal<WeixinQrState | null>(null);
/** The number WeChat shows on the phone when the login asks for it (`need_verify_code`). */
export const weixinVerifyCode = signal("");

export const lanIpInput = signal("");
export const relayPairing = signal<RelayPairingInfo | null>(null);
export const botVerboseMode = signal(false);

let loaded = false;

function readStr(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function readActiveMethod(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if ("lan" in obj) return "lan";
    const firstKey = Object.keys(obj)[0];
    return firstKey ?? "";
  }
  return "";
}

function readPairingState(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "failed" in (raw as Record<string, unknown>)) {
    const failed = (raw as { failed?: { reason?: string } }).failed;
    return failed?.reason ? `failed: ${failed.reason}` : "failed";
  }
  return "";
}

function parseClients(raw: unknown): ConnectorClient[] {
  if (!Array.isArray(raw)) return [];
  const rows: ConnectorClient[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = readStr(rec, ["id", "client_id", "clientId"]);
    const name = readStr(rec, ["name", "display_name", "displayName"]) || id;
    if (id || name) rows.push({ id: id || name, name: name || id });
  }
  return rows;
}

function parseStatus(raw: Record<string, unknown>): ConnectorStatus {
  const connections: RelayRouteStatus[] = [];
  if (Array.isArray(raw.connections)) {
    for (const entry of raw.connections) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const method = readStr(rec, ["method"]);
      if (!method) continue;
      connections.push({
        method,
        relayConnected: rec.relay_connected === true || rec.relayConnected === true,
        relayUrl: readStr(rec, ["relay_url", "relayUrl"]),
        clientCount: Array.isArray(rec.clients) ? rec.clients.length : 0,
      });
    }
  }
  const botConnectedRaw = raw.bot_connected ?? raw.botConnected;
  return {
    connections,
    relayConnected: raw.relay_connected === true || raw.relayConnected === true,
    relayUrl: readStr(raw, ["relay_url", "relayUrl"]),
    activeMethod: readActiveMethod(raw.active_method ?? raw.activeMethod),
    clients: parseClients(raw.clients),
    botConnected: typeof botConnectedRaw === "string" && botConnectedRaw ? botConnectedRaw : null,
    botVerboseMode: raw.bot_verbose_mode === true || raw.botVerboseMode === true,
    remoteControlAllowed:
      typeof raw.remote_control_allowed === "boolean"
        ? raw.remote_control_allowed
        : typeof raw.remoteControlAllowed === "boolean"
          ? raw.remoteControlAllowed
          : undefined,
  };
}

function parseMethods(raw: unknown): ConnectorMethodInfo[] {
  if (!Array.isArray(raw)) return [];
  const rows: ConnectorMethodInfo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = readStr(rec, ["id"]);
    if (!id) continue;
    rows.push({
      id,
      name: readStr(rec, ["name"]) || id,
      available: rec.available !== false,
      description: readStr(rec, ["description"]),
    });
  }
  return rows;
}

export function isRelayRouteConnected(method: "lan" | "openbitfun_server"): boolean {
  const status = connectorStatus();
  if (!status) return false;
  const route = status.connections.find(item => item.method === method);
  if (route) return route.relayConnected;
  return status.relayConnected && status.activeMethod === method;
}

export function relayUrlForMethod(method: "lan" | "openbitfun_server"): string {
  const status = connectorStatus();
  const route = status?.connections.find(item => item.method === method);
  if (route?.relayUrl) return route.relayUrl;
  const pairing = relayPairing();
  if (pairing && pairing.method === method) {
    return pairing.qrUrl || pairing.botLink || pairing.qrData;
  }
  if (status?.activeMethod === method && status.relayUrl) return status.relayUrl;
  return "";
}

export function ensureConnectors(): void {
  if (loaded) return;
  loaded = true;
  void loadConnectors();
}

export const remoteControlSaving = signal(false);

/**
 * Whether other devices may control this one (`remote_connect_set_allowed`).
 * Off makes this device read as offline to the others; it can still drive them.
 */
export async function setRemoteControlAllowed(allowed: boolean): Promise<void> {
  if (remoteControlSaving()) return;
  remoteControlSaving.set(true);
  connectorError.set("");
  try {
    await invokeCommand<unknown>("remote_connect_set_allowed", { allowed });
    await refreshConnectorStatus();
  } catch (error) {
    connectorError.set(
      `${tr("devices.remoteControlFailed")}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    remoteControlSaving.set(false);
  }
}

export async function refreshConnectorStatus(): Promise<void> {
  try {
    const rawStatus = await invokeRawCommand<Record<string, unknown>>("remote_connect_status", {});
    if (!rawStatus || typeof rawStatus !== "object") {
      connectorsSupported.set(false);
      connectorStatus.set(null);
      return;
    }
    const parsed = parseStatus(rawStatus);
    connectorStatus.set(parsed);
    botVerboseMode.set(parsed.botVerboseMode);
    connectorsSupported.set(true);
  } catch {
    // Keep existing error/support state untouched if only status refresh failed after support was confirmed.
  }
}

export async function loadConnectors(): Promise<void> {
  if (connectorsLoading()) return;
  connectorsLoading.set(true);
  connectorError.set("");
  try {
    const [statusRes, methodsRes, formRes, verboseRes] = await Promise.allSettled([
      invokeRawCommand<Record<string, unknown>>("remote_connect_status", {}),
      invokeRawCommand<Array<Record<string, unknown>>>("remote_connect_get_methods", {}),
      invokeRawCommand<Record<string, unknown>>("remote_connect_get_form_state", {}),
      invokeRawCommand<boolean>("remote_connect_get_bot_verbose_mode", {}),
    ]);

    if (
      statusRes.status !== "fulfilled" ||
      !statusRes.value ||
      typeof statusRes.value !== "object"
    ) {
      connectorsSupported.set(false);
      connectorStatus.set(null);
      return;
    }

    const parsedStatus = parseStatus(statusRes.value);
    connectorStatus.set(parsedStatus);
    connectorsSupported.set(true);

    if (methodsRes.status === "fulfilled") {
      connectorMethods.set(parseMethods(methodsRes.value));
    }
    if (formRes.status === "fulfilled" && formRes.value && typeof formRes.value === "object") {
      const form = formRes.value;
      telegramToken.set(readStr(form, ["telegram_bot_token"]));
      feishuAppId.set(readStr(form, ["feishu_app_id"]));
      feishuAppSecret.set(readStr(form, ["feishu_app_secret"]));
      weixinIlinkToken.set(readStr(form, ["weixin_ilink_token"]));
      weixinBaseUrl.set(readStr(form, ["weixin_base_url"]));
      weixinBotAccountId.set(readStr(form, ["weixin_bot_account_id"]));
    }
    if (verboseRes.status === "fulfilled" && typeof verboseRes.value === "boolean") {
      botVerboseMode.set(verboseRes.value);
    } else {
      botVerboseMode.set(parsedStatus.botVerboseMode);
    }
  } finally {
    connectorsLoading.set(false);
  }
}

async function saveFormState(): Promise<void> {
  await invokeCommand<unknown>("remote_connect_set_form_state", {
    telegram_bot_token: telegramToken().trim(),
    feishu_app_id: feishuAppId().trim(),
    feishu_app_secret: feishuAppSecret().trim(),
    ...(weixinIlinkToken().trim() ? { weixin_ilink_token: weixinIlinkToken().trim() } : {}),
    ...(weixinBaseUrl().trim() ? { weixin_base_url: weixinBaseUrl().trim() } : {}),
    ...(weixinBotAccountId().trim() ? { weixin_bot_account_id: weixinBotAccountId().trim() } : {}),
  });
}

function capturePairingResult(method: string, raw: Record<string, unknown> | null | undefined): void {
  if (!raw || typeof raw !== "object") return;
  const qrUrl = readStr(raw, ["qr_url", "qrUrl"]);
  const qrData = readStr(raw, ["qr_data", "qrData"]);
  const botPairingCode = readStr(raw, ["bot_pairing_code", "botPairingCode"]);
  const botLink = readStr(raw, ["bot_link", "botLink"]);
  const pairingState = readPairingState(raw.pairing_state ?? raw.pairingState);
  if (qrUrl || qrData || botPairingCode || botLink || pairingState) {
    relayPairing.set({ method, qrUrl, qrData, botPairingCode, botLink, pairingState });
  }
}

/** The desktop's key, so agreeing on either surface counts for both. */
export const REMOTE_CONNECT_DISCLAIMER_KEY = "openbitfun:remote-connect:disclaimer-agreed:v1";
export const remoteDisclaimerAgreed = signal(false);
export const remoteDisclaimerOpen = signal(false);
let disclaimerLoaded: Promise<void> | null = null;
let pendingAfterDisclaimer: (() => Promise<void>) | null = null;

function loadRemoteDisclaimer(): Promise<void> {
  if (!disclaimerLoaded) {
    disclaimerLoaded = Storage.getItem(REMOTE_CONNECT_DISCLAIMER_KEY)
      .then(value => {
        if (value === "true") remoteDisclaimerAgreed.set(true);
      })
      .catch(() => undefined);
  }
  return disclaimerLoaded;
}

/**
 * The desktop shows the Remote Connect disclaimer before the first connection
 * and starts nothing until it is agreed. Returns whether `action` may run now;
 * otherwise it runs after the user agrees.
 */
async function ensureRemoteDisclaimer(action: () => Promise<void>): Promise<boolean> {
  await loadRemoteDisclaimer();
  if (remoteDisclaimerAgreed()) return true;
  pendingAfterDisclaimer = action;
  remoteDisclaimerOpen.set(true);
  return false;
}

export function openRemoteDisclaimer(): void {
  void loadRemoteDisclaimer();
  pendingAfterDisclaimer = null;
  remoteDisclaimerOpen.set(true);
}

export function declineRemoteDisclaimer(): void {
  pendingAfterDisclaimer = null;
  remoteDisclaimerOpen.set(false);
}

export async function agreeRemoteDisclaimer(): Promise<void> {
  remoteDisclaimerAgreed.set(true);
  remoteDisclaimerOpen.set(false);
  try {
    await Storage.setItem(REMOTE_CONNECT_DISCLAIMER_KEY, "true");
  } catch {
    // Storage failures fall back to the in-memory agreement for this run.
  }
  const action = pendingAfterDisclaimer;
  pendingAfterDisclaimer = null;
  if (action) await action();
}

export async function saveAndConnectTelegram(): Promise<void> {
  if (!(await ensureRemoteDisclaimer(saveAndConnectTelegram))) return;
  const token = telegramToken().trim();
  if (!token) {
    connectorError.set(tr("devices.store.telegramTokenFirst"));
    return;
  }
  connectorBusy.set(true);
  connectorError.set("");
  connectorNotice.set("");
  try {
    await saveFormState();
    await invokeCommand<unknown>("remote_connect_configure_bot", {
      bot_type: "telegram",
      app_id: null,
      app_secret: null,
      bot_token: token,
      weixin_ilink_token: null,
      weixin_base_url: null,
      weixin_bot_account_id: null,
    });
    const result = await invokeCommand<Record<string, unknown>>("remote_connect_start", {
      method: "bot_telegram",
      lan_ip: null,
    });
    capturePairingResult("bot_telegram", result);
    await refreshConnectorStatus();
    connectorNotice.set(tr("devices.store.telegramConnected"));
  } catch (error) {
    connectorError.set(error instanceof Error ? error.message : String(error));
  } finally {
    connectorBusy.set(false);
  }
}

export async function saveAndConnectFeishu(): Promise<void> {
  if (!(await ensureRemoteDisclaimer(saveAndConnectFeishu))) return;
  const appId = feishuAppId().trim();
  const appSecret = feishuAppSecret().trim();
  if (!appId || !appSecret) {
    connectorError.set(tr("devices.store.feishuFieldsFirst"));
    return;
  }
  connectorBusy.set(true);
  connectorError.set("");
  connectorNotice.set("");
  try {
    await saveFormState();
    await invokeCommand<unknown>("remote_connect_configure_bot", {
      bot_type: "feishu",
      app_id: appId,
      app_secret: appSecret,
      bot_token: null,
      weixin_ilink_token: null,
      weixin_base_url: null,
      weixin_bot_account_id: null,
    });
    const result = await invokeCommand<Record<string, unknown>>("remote_connect_start", {
      method: "bot_feishu",
      lan_ip: null,
    });
    capturePairingResult("bot_feishu", result);
    await refreshConnectorStatus();
    connectorNotice.set(tr("devices.store.feishuConnected"));
  } catch (error) {
    connectorError.set(error instanceof Error ? error.message : String(error));
  } finally {
    connectorBusy.set(false);
  }
}

export async function stopBotConnector(): Promise<void> {
  connectorBusy.set(true);
  connectorError.set("");
  connectorNotice.set("");
  try {
    await invokeRawCommand<unknown>("remote_connect_stop_bot", {});
    await refreshConnectorStatus();
    connectorNotice.set(tr("devices.store.botStopped"));
  } catch (error) {
    connectorError.set(error instanceof Error ? error.message : String(error));
  } finally {
    connectorBusy.set(false);
  }
}

export async function startWeixinQr(): Promise<void> {
  if (!(await ensureRemoteDisclaimer(startWeixinQr))) return;
  connectorBusy.set(true);
  connectorError.set("");
  connectorNotice.set("");
  try {
    const res = await invokeCommand<Record<string, unknown>>("remote_connect_weixin_qr_start", {
      base_url: null,
      existing_ilink_token: null,
      existing_bot_account_id: null,
    });
    const sessionKey = readStr(res ?? {}, ["session_key", "sessionKey"]);
    const qrImageUrl = readStr(res ?? {}, ["qr_image_url", "qrImageUrl"]);
    const message = readStr(res ?? {}, ["message"]);
    weixinVerifyCode.set("");
    weixinQr.set({ sessionKey, qrImageUrl, message, status: "wait" });
    connectorNotice.set(message || tr("devices.store.weixinQrReady"));
  } catch (error) {
    connectorError.set(error instanceof Error ? error.message : String(error));
  } finally {
    connectorBusy.set(false);
  }
}

export async function pollWeixinQr(): Promise<void> {
  const qr = weixinQr();
  if (!qr?.sessionKey) return;
  connectorBusy.set(true);
  connectorError.set("");
  try {
    // A code typed for `need_verify_code` travels with the next poll only.
    const verifyCode = qr.status === "need_verify_code" ? weixinVerifyCode().trim() || null : null;
    const res = await invokeCommand<Record<string, unknown>>("remote_connect_weixin_qr_poll", {
      session_key: qr.sessionKey,
      base_url: weixinBaseUrl().trim() || null,
      verify_code: verifyCode,
    });
    if (verifyCode) weixinVerifyCode.set("");
    const status = readStr(res ?? {}, ["status"]) || "wait";
    const message = readStr(res ?? {}, ["message"]);
    const nextUrl = readStr(res ?? {}, ["qr_image_url", "qrImageUrl"]) || qr.qrImageUrl;
    const ilinkToken = readStr(res ?? {}, ["ilink_token", "ilinkToken"]);
    const botAccountId = readStr(res ?? {}, ["bot_account_id", "botAccountId"]);
    const baseUrl = readStr(res ?? {}, ["base_url", "baseUrl"]);
    weixinQr.set({ sessionKey: qr.sessionKey, qrImageUrl: nextUrl, message, status });
    if (status === "confirmed" && ilinkToken) {
      weixinIlinkToken.set(ilinkToken);
      if (baseUrl) weixinBaseUrl.set(baseUrl);
      if (botAccountId) weixinBotAccountId.set(botAccountId);
      await saveFormState();
      await invokeCommand<unknown>("remote_connect_configure_bot", {
        bot_type: "weixin",
        app_id: null,
        app_secret: null,
        bot_token: null,
        weixin_ilink_token: ilinkToken,
        weixin_base_url: baseUrl || null,
        weixin_bot_account_id: botAccountId || null,
      });
      await invokeCommand<Record<string, unknown>>("remote_connect_start", {
        method: "bot_weixin",
        lan_ip: null,
      });
      await refreshConnectorStatus();
      connectorNotice.set(tr("devices.store.weixinConnected"));
    } else if (message) {
      connectorNotice.set(message);
    }
  } catch (error) {
    connectorError.set(error instanceof Error ? error.message : String(error));
  } finally {
    connectorBusy.set(false);
  }
}

export async function startRelayConnector(method: "lan" | "openbitfun_server"): Promise<void> {
  if (!(await ensureRemoteDisclaimer(() => startRelayConnector(method)))) return;
  connectorBusy.set(true);
  connectorError.set("");
  connectorNotice.set("");
  try {
    const lanIp = method === "lan" ? lanIpInput().trim() || null : null;
    const res = await invokeCommand<Record<string, unknown>>("remote_connect_start", {
      method,
      lan_ip: lanIp,
    });
    capturePairingResult(method, res);
    await refreshConnectorStatus();
    connectorNotice.set(method === "lan" ? tr("devices.store.lanStarted") : tr("devices.store.serverStarted"));
  } catch (error) {
    connectorError.set(error instanceof Error ? error.message : String(error));
  } finally {
    connectorBusy.set(false);
  }
}

export async function stopRelayConnector(method?: "lan" | "openbitfun_server"): Promise<void> {
  connectorBusy.set(true);
  connectorError.set("");
  connectorNotice.set("");
  try {
    await invokeCommand<unknown>("remote_connect_stop", method ? { method } : undefined);
    if (!method || relayPairing()?.method === method) {
      relayPairing.set(null);
    }
    await refreshConnectorStatus();
    connectorNotice.set(
      method === "lan"
        ? tr("devices.store.lanStopped")
        : method === "openbitfun_server"
          ? tr("devices.store.serverStopped")
          : tr("devices.store.relayStopped"),
    );
  } catch (error) {
    connectorError.set(error instanceof Error ? error.message : String(error));
  } finally {
    connectorBusy.set(false);
  }
}

export async function setBotVerboseConnectorMode(verbose: boolean): Promise<void> {
  connectorBusy.set(true);
  connectorError.set("");
  try {
    await invokeRawCommand<unknown>("remote_connect_set_bot_verbose_mode", { verbose });
    botVerboseMode.set(verbose);
    connectorStatus.update(current =>
      current ? { ...current, botVerboseMode: verbose } : current,
    );
    connectorNotice.set(verbose ? tr("devices.store.verboseOn") : tr("devices.store.verboseOff"));
  } catch (error) {
    connectorError.set(error instanceof Error ? error.message : String(error));
  } finally {
    connectorBusy.set(false);
  }
}

export async function copyPairingLink(url: string): Promise<void> {
  if (!url) return;
  try {
    await Clipboard.writeText(url);
    connectorNotice.set(tr("devices.store.copiedPairing"));
  } catch (error) {
    connectorError.set(error instanceof Error ? error.message : String(error));
  }
}
