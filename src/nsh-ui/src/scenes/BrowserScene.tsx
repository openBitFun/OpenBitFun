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
import { entryDeviceId } from "../bridge";
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
import { tr } from "../i18n";
import { activeSessionDevice, activeSessionId, activeWorkspaceKey } from "../state";
import { compactLayout, layout, palette, radii, space, textStyle } from "../theme";
import { Spinner } from "../ui/motion";
import { DropdownMenu, type DropdownMenuItem } from "../ui/overlays";
import { Button, EmptyStateCard, IconButton, InlineBanner, TextField } from "../ui/primitives";

/** A page without a background of its own reads on white, as in a browser. */
const PAGE_BACKGROUND = "#ffffff";

let layerRef: ViewRef | undefined;
const pagesMenuOpen = signal(false);
const moreMenuOpen = signal(false);

function setPagesMenuOpen(open: boolean): void {
  pagesMenuOpen.set(open);
  browserOccluded.set(open || moreMenuOpen());
}

function setMoreMenuOpen(open: boolean): void {
  moreMenuOpen.set(open);
  browserOccluded.set(open || pagesMenuOpen());
}
const pagesMenuAnchor = signal<ViewRef | null>(null);
const moreMenuAnchor = signal<ViewRef | null>(null);

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
    <View style={{ ...placement(), backgroundColor: PAGE_BACKGROUND }}>
      <WebView
        ref={(node: WebViewRef) => registerBrowserHandle(label, node ?? null)}
        src={initialUrl}
        style={{ flex: 1 }}
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

/** Every page's web view; mounted once around the scenes. */
export function BrowserPageLayer() {
  startBrowserEvents();
  return (
    <View
      ref={(node: ViewRef) => {
        layerRef = node ?? undefined;
      }}
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
  const loading = () => presentedPage()?.loading === true;
  const hasPage = () => presentedPage() !== null;
  return (
    <View
      accessibilityLabel="browser-toolbar"
      style={{
        flexDirection: "row",
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
        size="sm"
        accessibilityLabel="browser-address"
        style={{ flex: 1, minWidth: 0, marginHorizontal: space.xs }}
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

  const measureViewport = () => {
    void (async () => {
      if (viewportOwner() !== claim) return;
      const measured = await viewportRef?.measure();
      if (!measured || viewportOwner() !== claim) return;
      const origin = await layerOrigin();
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
  cleanup(() => {
    releaseViewport(claim);
    setPagesMenuOpen(false);
    setMoreMenuOpen(false);
    cancelElementPicker();
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
              message={notice()}
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
              message={tr("browser.pageFailed", { error: error() })}
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
          <Text style={{ ...textStyle("mono", { color: palette().text }), numberOfLines: 1, textOverflow: "ellipsis" }}>
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
            message={notice()}
            accessibilityLabel="browser-preview-notice"
            onDismiss={() => htmlPreviewNotice.set(null)}
            style={{ marginHorizontal: space.md, marginTop: space.sm }}
          />
        )}
      </If>
      <If when={htmlPreview()}>
        {preview => (
          <View style={{ flex: 1, minHeight: 0, backgroundColor: PAGE_BACKGROUND }}>
            <WebView
              accessibilityLabel={`browser-preview-${preview().name}`}
              html={preview().html}
              incognito
              style={{ flex: 1 }}
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
function LiveEmpty(props: { title: string; subtitle?: string; onOpen?: () => void }) {
  return (
    <View accessibilityLabel="browser-live-empty" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <EmptyStateCard
        icon="globe"
        title={props.title}
        subtitle={props.subtitle}
        actionLabel={props.onOpen ? tr("pane.browser.openExternal") : undefined}
        onAction={props.onOpen}
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
  cleanup(startBrowserLiveView(props.source));
  const device = () => deviceName(props.source().deviceId);
  const url = () => {
    const view = browserLiveView();
    return view.status === "snapshot" || view.status === "ready" || view.status === "tooLarge" ? view.url : "";
  };
  const openInBrowser = () => {
    const address = url();
    if (isWebAddress(address)) void openUrl(address).catch(() => undefined);
  };
  return (
    <View accessibilityLabel="browser-live-view" style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
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
                style={{ ...textStyle("mono", { color: palette().text }), numberOfLines: 1, textOverflow: "ellipsis" }}
              >
                {address()}
              </Text>
            )}
          </If>
        </View>
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
        <If when={liveStatus() === "snapshot"}>
            <View
              accessibilityLabel="browser-live-frame"
              style={{ flex: 1, minHeight: 0, backgroundColor: PAGE_BACKGROUND, overflow: "hidden", pointerEvents: "none" }}
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
        <If when={liveStatus() === "ready"}>
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
        <If when={liveStatus() === "loading"}>
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Spinner size={16} color={palette().textMuted} />
            </View>
        </If>
        <If when={liveStatus() === "noPage"}>
          <LiveEmpty title={tr("browser.live.noPage", { device: device() })} subtitle={tr("browser.live.noPageBody")} />
        </If>
        <If when={liveStatus() === "tooLarge"}>
          <LiveEmpty title={tr("browser.live.tooLarge")} onOpen={openInBrowser} />
        </If>
        <If when={liveStatus() === "unsupported"}>
          <LiveEmpty title={tr("browser.live.unavailable", { device: device() })} />
        </If>
        <If when={liveStatus() === "outdated"}>
          <LiveEmpty title={tr("browser.live.outdated", { device: device() })} />
        </If>
        <If when={liveStatus() === "failed"}>
          <LiveEmpty title={tr("browser.live.failed", { device: device() })} subtitle={tr("browser.live.retrying")} />
        </If>
      </View>
    </View>
  );
}

/** The device whose pages a live view shows, and the conversation that owns them. */
function liveSource(): LiveViewSource {
  return {
    deviceId: activeSessionDevice() || activeWorkspaceKey()?.deviceId || null,
    conversationId: activeSessionId(),
  };
}

type BrowserMode = "checking" | "native" | "preview" | "live" | "unavailable";

export function BrowserScene(props: { compact?: boolean }) {
  startBrowserEvents();
  const compact = props.compact === true;

  // Beside a session on another device, its pages are that device's: the
  // inspector shows them live instead of this desktop's own browser.
  const sessionElsewhere = () => {
    if (!compact || !activeSessionId()) return false;
    const device = activeSessionDevice();
    return Boolean(device) && device !== entryDeviceId();
  };
  const mode = computed((): BrowserMode => {
    if (htmlPreview() || htmlPreviewNotice()) return "preview";
    const availability = browserAvailability();
    if (availability === "checking") return "checking";
    if (availability === "available") return sessionElsewhere() ? "live" : "native";
    if (availability === "noWebView") return "unavailable";
    // A phone or a browser: the page of the device in context, live.
    return liveSource().deviceId || activeSessionId() ? "live" : "unavailable";
  });

  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }} accessibilityLabel="browser-scene">
      <If when={!compact}>
        <ToolPaneHeader />
      </If>
      <If when={mode() === "native"}>
        <NativeBody compact={compact} />
      </If>
      <If when={mode() === "preview"}>
        <PreviewBody compact={compact} />
      </If>
      <If when={mode() === "live"}>
        <LiveView source={liveSource} compact={compact} />
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
