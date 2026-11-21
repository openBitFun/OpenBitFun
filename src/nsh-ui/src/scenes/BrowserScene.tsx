// The Browser scene of the native desktop: an address bar over the presented
// page, and the layer that keeps every page's web view alive.
//
// What a page is and what it does belongs to the backend and
// `src/browserStore.ts`; this file only lays pages out. `BrowserPageLayer`
// is mounted once by the shell around the scenes, so pages outlive this scene
// (an agent's page exists before anyone looks at it, and the user's page keeps
// its document across scene switches). The scene publishes where its viewport
// is; the layer places the presented page there and keeps the others off
// screen at their own size.

import { ToolPaneHeader } from "../ui/toolPane";
import { cleanup, effect, signal, Text, View, WebView, type ViewRef, type WebViewNavigation, type WebViewRef } from "nsh";
import {
  browserAddress,
  browserAvailability,
  browserGoBack,
  browserGoForward,
  browserNotice,
  browserOccluded,
  browserPageEvents,
  browserPages,
  browserViewDriver,
  browserViewport,
  closeBrowserPage,
  ensureUserPage,
  isAgentPage,
  loadBrowserUrl,
  openPresentedPageExternally,
  presentBrowserPage,
  presentedLabel,
  presentedPage,
  registerBrowserHandle,
  reloadBrowserPage,
  startBrowserEvents,
  stopBrowserLoading,
  type BrowserNavigationFacts,
  type BrowserPage,
} from "../browserStore";
import { tr } from "../i18n";
import { palette, textLineHeight, textSize } from "../theme";
import { Icon } from "../ui/icons";
import { Spinner } from "../ui/motion";
import { DropdownMenu, type DropdownMenuItem } from "../ui/overlays";
import { Button, EmptyStateCard, IconButton, InlineBanner, TextField } from "../ui/primitives";

let layerRef: ViewRef | undefined;
const pagesMenuOpen = signal(false);

function setPagesMenuOpen(open: boolean): void {
  pagesMenuOpen.set(open);
  browserOccluded.set(open);
}
const pagesMenuAnchor = signal<ViewRef | null>(null);

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
    if (viewport && presentedLabel() === label && !browserOccluded()) {
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
        <Text style={{ color: palette().textMuted, fontSize: textSize(12) }}>{props.page().url}</Text>
      </View>
    );
  }

  return (
    // A page without a background of its own reads on white, as in a browser.
    <View style={{ ...placement(), backgroundColor: "#ffffff" }}>
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
  const items: DropdownMenuItem[] = browserPages().map(page => ({
    id: `page-${page.label}`,
    label: pageTitle(page),
    hint: isAgentPage(page) ? tr("browser.agentPage") : tr("browser.yourPage"),
    icon: isAgentPage(page) ? ("bot" as const) : ("globe" as const),
    active: page.label === presented,
    accessibilityLabel: `browser-page-option-${page.label}`,
    onSelect: () => void presentBrowserPage(page.label),
  }));
  const current = presentedPage();
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

function Toolbar() {
  const loading = () => presentedPage()?.loading === true;
  const hasPage = () => presentedPage() !== null;
  return (
    <View
      accessibilityLabel="browser-toolbar"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 8,
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
        trailing={loading() ? <Spinner size={13} color={palette().textMuted} /> : undefined}
        size="sm"
        accessibilityLabel="browser-address"
        style={{ flex: 1, minWidth: 0, marginHorizontal: 4 }}
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
      <IconButton
        icon="external-link"
        size="sm"
        disabled={!hasPage()}
        tooltip={tr("browser.openExternally")}
        accessibilityLabel="browser-open-externally"
        onPress={() => void openPresentedPageExternally()}
      />
    </View>
  );
}

export function BrowserScene() {
  startBrowserEvents();
  let viewportRef: ViewRef | undefined;

  const measureViewport = () => {
    void (async () => {
      const measured = await viewportRef?.measure();
      if (!measured) return;
      const origin = await layerOrigin();
      browserViewport.set({
        x: Math.round(measured.pagePosition.x - origin.x),
        y: Math.round(measured.pagePosition.y - origin.y),
        width: Math.max(2, Math.round(measured.bounds.size.width)),
        height: Math.max(2, Math.round(measured.bounds.size.height)),
      });
    })();
  };

  // Leaving the scene hides the page; its document keeps running.
  cleanup(() => {
    browserViewport.set(null);
    setPagesMenuOpen(false);
  });
  effect(() => {
    if (browserAvailability() === "available") void ensureUserPage();
  });

  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }} accessibilityLabel="browser-scene">
      <ToolPaneHeader />
      <If
        when={browserAvailability() === "available"}
        else={
          <If when={browserAvailability() !== "checking"}>
            <UnavailableState
              title={browserAvailability() === "noWebView" ? tr("browser.unavailableTitle") : tr("pane.browser.desktopOnly")}
              message={browserAvailability() === "noWebView" ? tr("browser.noWebView") : ""}
            />
          </If>
        }
      >
        <Toolbar />
        <If when={browserNotice() ?? ""}>
          {notice => (
            <InlineBanner
              tone="danger"
              message={notice()}
              accessibilityLabel="browser-notice"
              onDismiss={() => browserNotice.set(null)}
              style={{ marginHorizontal: 12, marginTop: 8 }}
            />
          )}
        </If>
        <If when={presentedPage()?.error ?? ""}>
          {error => (
            <InlineBanner
              tone="warning"
              message={tr("browser.pageFailed", { error: error() })}
              accessibilityLabel="browser-page-error"
              style={{ marginHorizontal: 12, marginTop: 8 }}
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
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
              <Icon name="globe" size={28} color={palette().textMuted} />
              <Text style={{ color: palette().textSecondary, fontSize: textSize(13) }}>{tr("browser.noPage")}</Text>
              <Button label={tr("browser.openHome")} size="sm" onPress={() => void ensureUserPage()} />
            </View>
          </If>
        </View>
      </If>
    </View>
  );
}
