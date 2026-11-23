// The Browser tool: an address bar over the presented page, and the layer
// that keeps every page's web view alive. It opens full width or as the
// inspector's Browser tab beside a session (visual spec §4.10, wave 22).
//
// Where the page lives decides what is drawn: on the native desktop that
// holds it, the page itself; on a phone, a browser or another desktop, a
// read-only live view of the device's page (`LiveView`), never a second
// browser. A workspace's HTML file previews over the same viewport.
//
// What a page is and what it does belongs to the backend and
// `src/browserStore.ts`; this file only lays pages out. `BrowserPageLayer`
// is mounted once by the shell around the scenes, so pages outlive this scene
// (an agent's page exists before anyone looks at it, and the user's page keeps
// its document across scene switches). The scene publishes where its viewport
// is; the layer places the presented page there and keeps the others off
// screen at their own size.

import { ToolPaneHeader } from "../ui/toolPane";
import {
  cleanup,
  Clipboard,
  computed,
  effect,
  Image,
  openUrl,
  signal,
  Text,
  View,
  WebView,
  type ViewRef,
  type WebViewNavigation,
  type WebViewRef,
} from "nsh";
import { inboxSheetOpen } from "../attentionStore";
import { backgroundOutputOpen } from "../backgroundCommandsStore";
import { entryDeviceId, fleetActive } from "../bridge";
import { sideQuestionOpen } from "../btwStore";
// Installs the browser's session hooks (inspector, composer, HTML preview).
import "../browserSession";
import {
  browserAddress,
  browserAvailability,
  browserGoBack,
  browserGoForward,
  browserLiveView,
  browserNotice,
  browserOccluded,
  browserPageEvents,
  browserPages,
  browserPicking,
  browserViewDriver,
  browserViewport,
  cancelElementPicker,
  closeBrowserPage,
  closeHtmlPreview,
  ensureUserPage,
  evictIdleBrowserPages,
  htmlPreview,
  htmlPreviewNotice,
  htmlPreviewOpensHere,
  isAgentPage,
  loadBrowserUrl,
  openHtmlPreviewInDefaultBrowser,
  openPresentedPageExternally,
  presentBrowserPage,
  presentedLabel,
  presentedPage,
  registerBrowserHandle,
  reloadBrowserPage,
  startBrowserEvents,
  startBrowserLiveView,
  startElementPicker,
  stopBrowserLoading,
  type BrowserNavigationFacts,
  type BrowserPage,
  type LiveViewSource,
} from "../browserStore";
import { fleetDeviceById } from "../fleetStore";
import { searchOpen } from "../globalSearchStore";
import { localizeHostError, tr } from "../i18n";
import { mcpAppOpen } from "../mcpAppStore";
import { reviewLauncherOpen } from "../reviewStore";
import {
  authPromptOpen,
  newWorkspaceModalOpen,
  portForwardModalOpen,
  remoteFileBrowserOpen,
  sshConnectionModalOpen,
} from "../sshRemoteStore";
import {
  activeSessionDevice,
  activeSessionId,
  activeWorkspaceKey,
  auxPaneHeight,
  auxPaneMaximized,
  auxPaneSide,
  auxPaneWidth,
  deviceContext,
  drawerOpen,
  navWidth,
  sessionSplitRatio,
  splitPaneOpen,
} from "../state";
import { compactLayout, layout, palette, radii, space, textStyle } from "../theme";
import { aboutOpen } from "../ui/AboutDialog";
import { accountAuthModalOpen } from "../ui/AccountAuthModal";
import { deviceException } from "../ui/fleet";
import { Spinner } from "../ui/motion";
import { DropdownMenu, pushToast, type DropdownMenuItem } from "../ui/overlays";
import { Button, EmptyStateCard, IconButton, InlineBanner, TextField, splitDragging } from "../ui/primitives";

let layerRef: ViewRef | undefined;
const shellOverlayOccluded = signal(false);

/** Count of open local browser toolbar menus across mounted instances. */
const openBrowserMenuCount = signal(0);

/**
 * Whether any global overlay (`⌘K`, `⌘I`, modals, overlay sidebar drawer) or
 * local browser dropdown is currently covering the native OS WebView surface.
 */
const globalOverlayOccludingBrowser = computed(() => {
  if (
    shellOverlayOccluded() ||
    searchOpen() ||
    inboxSheetOpen() ||
    aboutOpen() ||
    accountAuthModalOpen() ||
    newWorkspaceModalOpen() ||
    sshConnectionModalOpen() ||
    remoteFileBrowserOpen() ||
    portForwardModalOpen() ||
    authPromptOpen() ||
    reviewLauncherOpen() ||
    sideQuestionOpen() ||
    Boolean(backgroundOutputOpen()) ||
    Boolean(mcpAppOpen())
  ) {
    return true;
  }
  return false;
});

function syncBrowserOcclusion(): void {
  browserOccluded.set(openBrowserMenuCount() > 0 || globalOverlayOccludingBrowser());
}

// ── Viewport ownership ──
//
// The full-width tool and the inspector tab can both be on screen; a page
// can be in one place only. The browser view mounted last owns the
// viewport, and when it goes the previous one measures itself again.

interface ViewportClaim {
  id: number;
  measure: () => void;
}

const viewportClaims: ViewportClaim[] = [];
const viewportOwner = signal<number | null>(null);
let nextClaimId = 1;

function claimViewport(measure: () => void): number {
  const id = nextClaimId++;
  viewportClaims.push({ id, measure });
  viewportOwner.set(id);
  return id;
}

function releaseViewport(id: number): void {
  const index = viewportClaims.findIndex(claim => claim.id === id);
  if (index < 0) return;
  const owned = viewportOwner() === id;
  viewportClaims.splice(index, 1);
  if (!owned) return;
  const next = viewportClaims[viewportClaims.length - 1] ?? null;
  viewportOwner.set(next?.id ?? null);
  browserViewport.set(null);
  next?.measure();
}

function remeasureActiveViewport(): void {
  const owner = viewportOwner();
  if (owner === null) return;
  viewportClaims.find(claim => claim.id === owner)?.measure();
}

async function layerOrigin(): Promise<{ x: number; y: number }> {
  const measured = await layerRef?.measure();
  return measured?.pagePosition ?? { x: 0, y: 0 };
}

function facts(event: WebViewNavigation): BrowserNavigationFacts {
  return {
    url: event?.url ?? "",
    title: event?.title ?? "",
    loading: event?.loading === true,
    canGoBack: event?.canGoBack === true,
    canGoForward: event?.canGoForward === true,
  };
}

function pageTitle(page: BrowserPage): string {
  if (page.title) return page.title;
  if (page.url) return page.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return tr("browser.untitledPage");
}

/** One page's web view, placed over the scene's viewport while presented. */
function BrowserPageView(props: { page: () => BrowserPage }) {
  // Rows are keyed by label and a page's first URL never changes: later
  // navigations go through the ref, so both are read once on purpose.
  const label = props.page().label;
  const initialUrl = props.page().initialUrl;
  const events = browserPageEvents(label);
  const driver = browserViewDriver();
  cleanup(() => registerBrowserHandle(label, null));

  const placement = () => {
    const viewport = browserViewport();
    if (viewport && presentedLabel() === label && !browserOccluded() && !htmlPreview()) {
      return { position: "absolute" as const, left: viewport.x, top: viewport.y, width: viewport.width, height: viewport.height };
    }
    // Off screen at its own size: the document keeps running for agents.
    return { position: "absolute" as const, left: -40000, top: 0, width: props.page().width, height: props.page().height };
  };

  if (driver) {
    registerBrowserHandle(label, driver.createHandle(label, initialUrl, events));
    return (
      <View
        accessibilityLabel={`browser-page-${label}`}
        style={{ ...placement(), backgroundColor: palette().canvas }}
      >
        <Text style={textStyle("caption")}>{props.page().url}</Text>
      </View>
    );
  }

  return (
    <View
      style={{
        ...placement(),
        backgroundColor: palette().canvas,
        pointerEvents: splitDragging() ? "none" : "auto",
      }}
    >
      <WebView
        ref={(node: WebViewRef) => registerBrowserHandle(label, node ?? null)}
        src={initialUrl}
        style={{ flex: 1, pointerEvents: splitDragging() ? "none" : "auto" }}
        desktop={{ allowsBackForwardNavigationGestures: true }}
        onLoadStart={event => events.loadStart(facts(event))}
        onLoad={event => events.load(facts(event))}
        onError={event => events.error(event)}
        onNavigationStateChange={event => events.navigationState(facts(event))}
        onMessage={event => events.message(event?.data ?? "")}
      />
    </View>
  );
}

/** Every page's web view; mounted once at the shell root above the canvas and AuxPaneSheet. */
export function BrowserPageLayer(props: { overlayOccluded?: boolean } = {}) {
  startBrowserEvents();
  effect(() => {
    shellOverlayOccluded.set(Boolean(props.overlayOccluded));
    syncBrowserOcclusion();
  });
  cleanup(() => {
    shellOverlayOccluded.set(false);
    syncBrowserOcclusion();
  });
  return (
    <View
      ref={(node: ViewRef) => {
        layerRef = node ?? undefined;
      }}
      onLayout={() => remeasureActiveViewport()}
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "box-none" }}
    >
      <Each of={browserPages()} key={page => page.label}>
        {page => <BrowserPageView page={page} />}
      </Each>
    </View>
  );
}

/** The unsupported state (spec §4.10, §3 Empty states): centered, never boxed. */
function UnavailableState(props: { title: string; message: string }) {
  return (
    <View accessibilityLabel="browser-unavailable" style={{ flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center" }}>
      <EmptyStateCard icon="globe" title={props.title} subtitle={props.message || undefined} />
    </View>
  );
}

function pageMenuItems(): DropdownMenuItem[] {
  const presented = presentedLabel();
  return browserPages().map(page => ({
    id: `page-${page.label}`,
    label: pageTitle(page),
    hint: isAgentPage(page) ? tr("browser.agentPage") : tr("browser.yourPage"),
    icon: isAgentPage(page) ? ("bot" as const) : ("globe" as const),
    active: page.label === presented,
    accessibilityLabel: `browser-page-option-${page.label}`,
    onSelect: () => void presentBrowserPage(page.label),
  }));
}

/** The ⋯ menu: Pick element, Open in your browser, and closing an agent's page. */
function moreMenuItems(): DropdownMenuItem[] {
  const current = presentedPage();
  const items: DropdownMenuItem[] = [
    {
      id: "pick-element",
      label: browserPicking() ? tr("browser.pickCancel") : tr("browser.pickElement"),
      hint: tr("browser.pickElementHint"),
      icon: "compass",
      disabled: !current,
      accessibilityLabel: "browser-pick-element",
      onSelect: () => void startElementPicker(),
    },
    {
      id: "open-externally",
      label: tr("browser.openExternally"),
      icon: "external-link",
      disabled: !current,
      accessibilityLabel: "browser-open-externally",
      onSelect: () => void openPresentedPageExternally(),
    },
  ];
  if (current && isAgentPage(current)) {
    items.push({
      id: "close-agent-page",
      label: tr("browser.closeAgentPage"),
      icon: "close",
      separator: true,
      accessibilityLabel: "browser-close-agent-page",
      onSelect: () => closeBrowserPage(current.label),
    });
  }
  return items;
}

function Toolbar(props: { compact: boolean }) {
  const pagesMenuOpen = signal(false);
  const moreMenuOpen = signal(false);
  const pagesMenuAnchor = signal<ViewRef | null>(null);
  const moreMenuAnchor = signal<ViewRef | null>(null);
  let trackedOpen = false;
  const setLocalOcclusion = (open: boolean) => {
    if (open === trackedOpen) return;
    trackedOpen = open;
    openBrowserMenuCount.update(n => Math.max(0, n + (open ? 1 : -1)));
    syncBrowserOcclusion();
  };
  const setPagesMenuOpen = (open: boolean) => {
    pagesMenuOpen.set(open);
    setLocalOcclusion(open || moreMenuOpen());
  };
  const setMoreMenuOpen = (open: boolean) => {
    moreMenuOpen.set(open);
    setLocalOcclusion(open || pagesMenuOpen());
  };
  cleanup(() => {
    setLocalOcclusion(false);
  });
  const loading = () => presentedPage()?.loading === true;
  const hasPage = () => presentedPage() !== null;
  return (
    <View
      accessibilityLabel="browser-toolbar"
      style={{
        flexDirection: "row",
        flexWrap: compactLayout() ? "wrap" : "nowrap",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: props.compact ? space.sm : space.md,
        paddingVertical: space.sm,
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
      }}
    >
      <IconButton
        icon="chevron-left"
        size="sm"
        disabled={!(presentedPage()?.canGoBack ?? false)}
        tooltip={tr("browser.back")}
        accessibilityLabel="browser-back"
        onPress={() => void browserGoBack()}
      />
      <IconButton
        icon="chevron-right"
        size="sm"
        disabled={!(presentedPage()?.canGoForward ?? false)}
        tooltip={tr("browser.forward")}
        accessibilityLabel="browser-forward"
        onPress={() => void browserGoForward()}
      />
      <IconButton
        icon={loading() ? "close" : "refresh"}
        size="sm"
        disabled={!hasPage()}
        tooltip={loading() ? tr("browser.stop") : tr("browser.reload")}
        accessibilityLabel={loading() ? "browser-stop" : "browser-reload"}
        onPress={() => void (loading() ? stopBrowserLoading() : reloadBrowserPage())}
      />
      <TextField
        value={browserAddress()}
        onChange={value => browserAddress.set(value)}
        onSubmit={text => void loadBrowserUrl(text)}
        placeholder={tr("pane.browser.placeholder")}
        leadingIcon="globe"
        clearable
        clearLabel={tr("browser.clearAddress")}
        trailing={loading() ? <Spinner size={12} color={palette().textMuted} /> : undefined}
        size="md"
        accessibilityLabel="browser-address"
        style={{ flex: 1, minWidth: compactLayout() ? 180 : 120, marginHorizontal: space.xs }}
      />
      <If when={browserPages().length > 1}>
        <View ref={(node: ViewRef) => pagesMenuAnchor.set(node ?? null)} style={{ flexShrink: 0 }}>
          <IconButton
            icon="layers"
            size="sm"
            active={pagesMenuOpen()}
            tooltip={tr("browser.pages")}
            accessibilityLabel="browser-pages"
            onPress={() => setPagesMenuOpen(!pagesMenuOpen())}
          />
        </View>
        <DropdownMenu
          open={pagesMenuOpen()}
          anchor={pagesMenuAnchor()}
          align="end"
          items={pageMenuItems()}
          onClose={() => setPagesMenuOpen(false)}
        />
      </If>
      <View ref={(node: ViewRef) => moreMenuAnchor.set(node ?? null)} style={{ flexShrink: 0 }}>
        <IconButton
          icon="more"
          size="sm"
          active={moreMenuOpen()}
          tooltip={tr("browser.more")}
          accessibilityLabel="browser-more"
          onPress={() => setMoreMenuOpen(!moreMenuOpen())}
        />
      </View>
      <DropdownMenu
        open={moreMenuOpen()}
        anchor={moreMenuAnchor()}
        align="end"
        items={moreMenuItems()}
        onClose={() => setMoreMenuOpen(false)}
      />
    </View>
  );
}

/** The page itself, on the desktop that holds it. */
function NativeBody(props: { compact: boolean }) {
  let viewportRef: ViewRef | undefined;
  let claim = 0;
  let measureSeq = 0;

  const measureViewport = () => {
    const seq = ++measureSeq;
    void (async () => {
      if (viewportOwner() !== claim) return;
      const measured = await viewportRef?.measure();
      if (!measured || viewportOwner() !== claim || seq !== measureSeq) return;
      const origin = await layerOrigin();
      if (viewportOwner() !== claim || seq !== measureSeq) return;
      browserViewport.set({
        x: Math.round(measured.pagePosition.x - origin.x),
        y: Math.round(measured.pagePosition.y - origin.y),
        width: Math.max(2, Math.round(measured.bounds.size.width)),
        height: Math.max(2, Math.round(measured.bounds.size.height)),
      });
    })();
  };
  claim = claimViewport(measureViewport);

  // Leaving hides the page; its document keeps running.
  let frameTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSettleMeasure = () => {
    if (frameTimer) clearTimeout(frameTimer);
    frameTimer = setTimeout(() => {
      frameTimer = null;
      measureViewport();
    }, 16);
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      measureViewport();
    }, 250);
  };
  cleanup(() => {
    measureSeq++;
    if (frameTimer) {
      clearTimeout(frameTimer);
      frameTimer = null;
    }
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    releaseViewport(claim);
    cancelElementPicker();
  });
  effect(() => {
    // Re-measure when surrounding shell layout shifts the viewport's pagePosition
    // even if the viewport's own local size inside AuxPane stayed constant.
    drawerOpen();
    navWidth();
    auxPaneWidth();
    auxPaneHeight();
    auxPaneSide();
    auxPaneMaximized();
    splitPaneOpen();
    sessionSplitRatio();
    splitDragging();
    measureViewport();
    scheduleSettleMeasure();
  });
  effect(() => {
    if (browserAvailability() === "available") void ensureUserPage();
  });

  return (
    <If
      when={viewportOwner() === claim}
      else={
        <View
          accessibilityLabel="browser-shown-elsewhere"
          style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg }}
        >
          <Text style={{ ...textStyle("label", { color: palette().textMuted }), textAlign: "center" }}>
            {tr("browser.shownElsewhere")}
          </Text>
        </View>
      }
    >
      <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>
        <Toolbar compact={props.compact} />
        <If when={browserPicking() ? "picking" : ""}>
          <InlineBanner
            tone="info"
            icon="compass"
            message={tr("browser.picking")}
            actionLabel={tr("browser.pickCancel")}
            onAction={() => cancelElementPicker()}
            accessibilityLabel="browser-picking"
            style={{ marginHorizontal: space.md, marginTop: space.sm }}
          />
        </If>
        <If when={browserNotice() ?? ""}>
          {notice => (
            <InlineBanner
              tone="danger"
              message={localizeHostError(notice())}
              accessibilityLabel="browser-notice"
              onDismiss={() => browserNotice.set(null)}
              style={{ marginHorizontal: space.md, marginTop: space.sm }}
            />
          )}
        </If>
        <If when={presentedPage()?.error ?? ""}>
          {error => (
            <InlineBanner
              tone="warning"
              message={tr("browser.pageFailed", { error: localizeHostError(error()) })}
              actionLabel={tr("browser.reload")}
              onAction={() => void reloadBrowserPage()}
              accessibilityLabel="browser-page-error"
              style={{ marginHorizontal: space.md, marginTop: space.sm }}
            />
          )}
        </If>
        <View
          ref={(node: ViewRef) => {
            viewportRef = node ?? undefined;
            if (node) measureViewport();
          }}
          onLayout={() => measureViewport()}
          accessibilityLabel="browser-viewport"
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
        >
          <If when={!presentedPage()}>
            <EmptyStateCard
              icon="globe"
              title={tr("browser.noPage")}
              actionLabel={tr("browser.openHome")}
              onAction={() => void ensureUserPage()}
              style={{ flex: 1 }}
            />
          </If>
        </View>
      </View>
    </If>
  );
}

/** A workspace's HTML file, in a web view of its own. */
function PreviewBody(props: { compact: boolean }) {
  return (
    <View accessibilityLabel="browser-html-preview" style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>
      <View
        style={{
          minHeight: layout.touchTarget - space.md,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: props.compact ? space.sm : space.md,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
          <Text style={{ ...textStyle("caption"), numberOfLines: 1 }}>{tr("browser.preview.title")}</Text>
          <Text style={{ ...textStyle("mono", { color: palette().text }), numberOfLines: 1, textOverflow: "ellipsis-middle" }}>
            {htmlPreview()?.path ?? ""}
          </Text>
        </View>
        <If when={htmlPreviewOpensHere(htmlPreview())}>
          <Button
            label={tr("browser.preview.openDefault")}
            variant="ghost"
            size="sm"
            leadingIcon="external-link"
            accessibilityLabel="browser-preview-open-default"
            onPress={() => void openHtmlPreviewInDefaultBrowser()}
          />
        </If>
        <IconButton
          icon="close"
          size="sm"
          tooltip={tr("browser.preview.close")}
          accessibilityLabel="browser-preview-close"
          onPress={() => closeHtmlPreview()}
        />
      </View>
      <If when={htmlPreviewNotice() ?? ""}>
        {notice => (
          <InlineBanner
            tone="danger"
            message={localizeHostError(notice())}
            accessibilityLabel="browser-preview-notice"
            onDismiss={() => htmlPreviewNotice.set(null)}
            style={{ marginHorizontal: space.md, marginTop: space.sm }}
          />
        )}
      </If>
      <If when={htmlPreview()}>
        {preview => (
          <View
            style={{
              flex: 1,
              minHeight: 0,
              backgroundColor: palette().canvas,
              pointerEvents: splitDragging() ? "none" : "auto",
            }}
          >
            <WebView
              accessibilityLabel={`browser-preview-${preview().name}`}
              html={preview().html}
              incognito
              style={{ flex: 1, pointerEvents: splitDragging() ? "none" : "auto" }}
            />
          </View>
        )}
      </If>
    </View>
  );
}

function deviceName(deviceId: string | null): string {
  return fleetDeviceById(deviceId)?.name || tr("browser.live.thisDevice");
}

function isWebAddress(url: string): boolean {
  return /^https?:/i.test(url);
}

const liveStatus = computed(() => browserLiveView().status);

/** A live view state without a frame (spec §3 Empty states). */
function LiveEmpty(props: { title: string; subtitle?: string; actionLabel?: string; onAction?: () => void; onOpen?: () => void }) {
  return (
    <View accessibilityLabel="browser-live-empty" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <EmptyStateCard
        icon="globe"
        title={props.title}
        subtitle={props.subtitle}
        actionLabel={props.actionLabel ?? (props.onOpen ? tr("pane.browser.openExternal") : undefined)}
        onAction={props.onAction ?? props.onOpen}
      />
    </View>
  );
}

/**
 * The read-only live view of a desktop's page (phone, browser, another
 * desktop): a still copy refreshed while on screen, with the address and
 * "Open in your browser". Presses never reach the page.
 */
function LiveView(props: { source: () => LiveViewSource; compact: boolean }) {
  const retryTick = signal(0);
  const deviceOffline = () => {
    const id = props.source().deviceId;
    if (!id) return false;
    return deviceException(fleetDeviceById(id)?.state) === "offline";
  };
  effect(() => {
    retryTick();
    if (deviceOffline()) return;
    const stop = startBrowserLiveView(props.source);
    cleanup(stop);
  });
  const device = () => deviceName(props.source().deviceId);
  const url = () => {
    const view = browserLiveView();
    return view.status === "snapshot" || view.status === "ready" || view.status === "tooLarge" ? view.url : "";
  };
  const openInBrowser = () => {
    const address = url();
    if (isWebAddress(address)) void openUrl(address).catch(() => undefined);
  };
  const copyAddress = () => {
    const address = url();
    if (!address) return;
    void Clipboard.writeText(address).then(
      () => pushToast(tr("common.copied"), "success"),
      () => undefined,
    );
  };
  return (
    <View accessibilityLabel="browser-live-view" style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: compactLayout() ? layout.phoneGutter : props.compact ? space.md : space.xxl,
          paddingVertical: space.sm,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
          <Text accessibilityLabel="browser-live-device" style={{ ...textStyle("caption"), numberOfLines: 1 }}>
            {tr("browser.live.from", { device: device() })}
          </Text>
          <If when={url()}>
            {address => (
              <Text
                accessibilityLabel="browser-live-url"
                style={{ ...textStyle("mono", { color: palette().text }), numberOfLines: 1, textOverflow: "ellipsis-middle", userSelect: "text" }}
              >
                {address()}
              </Text>
            )}
          </If>
        </View>
        <If when={url()}>
          <IconButton
            icon="copy"
            size="sm"
            tooltip={tr("common.copy")}
            accessibilityLabel="browser-live-copy"
            onPress={copyAddress}
          />
        </If>
        <If when={isWebAddress(url())}>
          <If
            when={!compactLayout()}
            else={
              <IconButton
                icon="external-link"
                size="md"
                tooltip={tr("pane.browser.openExternal")}
                accessibilityLabel="browser-live-open"
                onPress={openInBrowser}
              />
            }
          >
            <Button
              label={tr("pane.browser.openExternal")}
              variant="ghost"
              size="sm"
              leadingIcon="external-link"
              accessibilityLabel="browser-live-open"
              onPress={openInBrowser}
            />
          </If>
        </If>
      </View>
      <View style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
        <If when={deviceOffline()}>
          <LiveEmpty title={tr("state.offline")} subtitle={tr("browser.live.from", { device: device() })} />
        </If>
        <If when={!deviceOffline() && liveStatus() === "snapshot"}>
            <View
              accessibilityLabel="browser-live-frame"
              style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas, overflow: "hidden", pointerEvents: "none" }}
            >
              <WebView
                html={(() => {
                  const view = browserLiveView();
                  return view.status === "snapshot" ? view.html : "";
                })()}
                baseUrl={url() || undefined}
                javaScriptEnabled={false}
                scrollable={false}
                incognito
                style={{ flex: 1 }}
              />
            </View>
        </If>
        <If when={!deviceOffline() && liveStatus() === "ready"}>
            <View accessibilityLabel="browser-live-frame" style={{ flex: 1, minHeight: 0, pointerEvents: "none" }}>
              <Image
                src={(() => {
                  const view = browserLiveView();
                  return view.status === "ready" ? view.dataUrl : "";
                })()}
                style={{ flex: 1, borderRadius: radii.xs, objectFit: "contain" }}
              />
            </View>
        </If>
        <If when={!deviceOffline() && liveStatus() === "loading"}>
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Spinner size={16} color={palette().textMuted} />
            </View>
        </If>
        <If when={!deviceOffline() && liveStatus() === "noPage"}>
          <LiveEmpty title={tr("browser.live.noPage", { device: device() })} subtitle={tr("browser.live.noPageBody")} />
        </If>
        <If when={!deviceOffline() && liveStatus() === "tooLarge"}>
          <LiveEmpty title={tr("browser.live.tooLarge")} onOpen={isWebAddress(url()) ? openInBrowser : undefined} />
        </If>
        <If when={!deviceOffline() && liveStatus() === "unsupported"}>
          <LiveEmpty title={tr("browser.live.unavailable", { device: device() })} />
        </If>
        <If when={!deviceOffline() && liveStatus() === "outdated"}>
          <LiveEmpty title={tr("browser.live.outdated", { device: device() })} />
        </If>
        <If when={!deviceOffline() && liveStatus() === "failed"}>
          <LiveEmpty
            title={tr("browser.live.failed", { device: device() })}
            subtitle={tr("browser.live.retrying")}
            actionLabel={tr("common.tryAgain")}
            onAction={() => retryTick.update(n => n + 1)}
          />
        </If>
      </View>
    </View>
  );
}

/** The device whose pages a live view shows, and the conversation that owns them. */
function liveSource(compact: boolean): LiveViewSource {
  const ctx = deviceContext();
  const sessionDevice = activeSessionDevice();
  const deviceId = (compact ? sessionDevice : ctx) || sessionDevice || activeWorkspaceKey()?.deviceId || ctx || null;
  const conversationId = compact || !fleetActive() || !deviceId || deviceId === sessionDevice ? activeSessionId() : null;
  return { deviceId, conversationId };
}

type BrowserMode = "checking" | "native" | "preview" | "live" | "unavailable";

export function BrowserScene(props: { compact?: boolean }) {
  startBrowserEvents();
  const compact = () => props.compact === true;
  cleanup(() => {
    evictIdleBrowserPages();
  });

  // Beside a session on another device, or when full-screen Browser targets a
  // remote fleet device, show that device's live view instead of this desktop's.
  const targetElsewhere = () => {
    const entry = entryDeviceId();
    if (compact()) {
      if (!activeSessionId()) return false;
      const device = activeSessionDevice();
      return Boolean(device) && Boolean(entry) && device !== entry;
    }
    const ctx = deviceContext();
    return fleetActive() && Boolean(ctx) && Boolean(entry) && ctx !== entry;
  };
  const source = () => liveSource(compact());
  const mode = computed((): BrowserMode => {
    if (htmlPreview() || htmlPreviewNotice()) return "preview";
    const availability = browserAvailability();
    if (availability === "checking") return "checking";
    if (availability === "available") return targetElsewhere() ? "live" : "native";
    if (availability === "noWebView") return "unavailable";
    // A phone or a browser: the page of the device in context, live.
    return source().deviceId || activeSessionId() ? "live" : "unavailable";
  });

  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }} accessibilityLabel="browser-scene">
      <If when={!compact()}>
        <ToolPaneHeader />
      </If>
      <If when={mode() === "checking"}>
        <View
          accessibilityLabel="browser-checking"
          style={{ flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", gap: space.sm }}
        >
          <Spinner size={16} color={palette().textMuted} />
          <Text style={textStyle("caption")}>{tr("common.loading")}</Text>
        </View>
      </If>
      <If when={mode() === "native"}>
        <NativeBody compact={compact()} />
      </If>
      <If when={mode() === "preview"}>
        <PreviewBody compact={compact()} />
      </If>
      <If when={mode() === "live"}>
        <LiveView source={source} compact={compact()} />
      </If>
      <If when={mode() === "unavailable"}>
        <UnavailableState
          title={browserAvailability() === "noWebView" ? tr("browser.unavailableTitle") : tr("pane.browser.desktopOnly")}
          message={browserAvailability() === "noWebView" ? tr("browser.noWebView") : ""}
        />
      </If>
    </View>
  );
}
