import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Button, Icon, StatusPill, TabGroup, type ColorScheme, type ContrastMode, type DensityMode, type TokenOverrides } from "@openbitfun/ui";
import { MobileHomeScene, MobileMiniAppScene, MobileSidebarScene, type MobileSceneTheme } from "../preview/MobileSceneGallery";
import { useI18n, type MessageKey } from "../i18n";

/* Demo comparison: the OpenBitFun mobile demo runs in an iframe next to the Design Lab scene, and
   both sides are measured live in the same 402 x 874 screen coordinates. Nothing in the table is
   typed by hand, so a drift in either side shows up the next time the page is opened. */

type SceneId = "home" | "miniapp" | "sidebar";
type Prop = "x" | "y" | "w" | "h";

interface CompareItem {
  label: MessageKey;
  demo: string;
  lab: string;
  props: readonly Prop[];
  /** A drift the demo itself causes; the Lab follows the documented spec instead. */
  demoIssue?: MessageKey;
}

interface SceneSpec {
  id: SceneId;
  label: MessageKey;
  Scene: ComponentType<MobileSceneTheme>;
  /** Drives the demo into the page this scene reproduces. */
  prepare: (doc: Document) => void;
  items: readonly CompareItem[];
}

const SCREEN_WIDTH = 402;
const TOLERANCE = 1;
const box: readonly Prop[] = ["x", "y", "w", "h"];

const click = (doc: Document, selector: string) => (doc.querySelector(selector) as HTMLElement | null)?.click();

const scenes: readonly SceneSpec[] = [
  {
    id: "home",
    label: "compare.scene.home",
    Scene: MobileHomeScene,
    prepare: () => undefined,
    items: [
      { label: "compare.item.sidebarButton", demo: "#openDrawer", lab: ".design-phone-fab", props: box },
      { label: "compare.item.brandMark", demo: ".brand-flow", lab: ".design-mobile-home-mark", props: box },
      { label: "compare.item.greeting", demo: ".recent-title", lab: ".design-mobile-home-title", props: ["y", "h"] },
      { label: "compare.item.composer", demo: ".composer-pill", lab: "[data-openbitfun-component=\"mobile-composer\"]", props: box },
      { label: "compare.item.composerAdd", demo: ".composer-add", lab: "[data-openbitfun-part=\"leading\"] button", props: box },
      { label: "compare.item.composerAction", demo: ".composer-action", lab: "[data-openbitfun-part=\"end-actions\"] button", props: box },
      { label: "compare.item.homeIndicator", demo: ".home-indicator", lab: "::home-indicator", props: box },
    ],
  },
  {
    id: "miniapp",
    label: "compare.scene.miniapp",
    Scene: MobileMiniAppScene,
    prepare: doc => { click(doc, "#goMiniApps"); click(doc, "#viewToggle"); },
    items: [
      { label: "compare.item.header", demo: ".miniapp-header", lab: ".design-phone-header", props: box },
      { label: "compare.item.back", demo: "#backHome", lab: ".design-phone-header > button:first-child", props: box },
      { label: "compare.item.title", demo: ".miniapp-header .title", lab: ".design-phone-header-title", props: ["y", "h"] },
      { label: "compare.item.viewToggle", demo: "#viewToggle", lab: ".design-phone-header > button:last-child", props: box },
      { label: "compare.item.card", demo: "#appGrid .app-card", lab: "[data-openbitfun-component=\"mobile-mini-app-card\"]", props: box },
      { label: "compare.item.cardCover", demo: "#appGrid .app-cover-wrap", lab: "[data-openbitfun-part=\"media\"]", props: box },
      { label: "compare.item.cardTitle", demo: "#appGrid .app-name", lab: "[data-openbitfun-component=\"mobile-mini-app-card\"] [data-openbitfun-part=\"title\"]", props: ["x", "y", "h"], demoIssue: "compare.issue.appName" },
      { label: "compare.item.cardDescription", demo: "#appGrid .app-desc", lab: "[data-openbitfun-component=\"mobile-mini-app-card\"] [data-openbitfun-part=\"description\"]", props: ["x", "y"], demoIssue: "compare.issue.appName" },
    ],
  },
  {
    id: "sidebar",
    label: "compare.scene.sidebar",
    Scene: MobileSidebarScene,
    prepare: doc => click(doc, "#openDrawer"),
    items: [
      { label: "compare.item.sidebarPanel", demo: "#sidebarPanel", lab: ".design-mobile-sidebar-drawer", props: box },
      { label: "compare.item.sidebarHeader", demo: ".sidebar-header", lab: "[data-openbitfun-component=\"mobile-sidebar-header\"]", props: box },
      { label: "compare.item.sidebarBrand", demo: ".sidebar-brand", lab: "[data-openbitfun-component=\"mobile-sidebar-header\"] [data-openbitfun-part=\"brand\"]", props: ["x", "y", "h"], demoIssue: "compare.issue.brandFont" },
      { label: "compare.item.assistantRow", demo: ".assistant-row", lab: "[data-openbitfun-component=\"mobile-sidebar-entry-row\"]", props: box },
      { label: "compare.item.workspaceLabel", demo: ".workspace-label", lab: "[data-openbitfun-component=\"mobile-sidebar-section-label\"]", props: box },
      { label: "compare.item.workspaceRow", demo: ".ws-row", lab: "[data-openbitfun-component=\"mobile-sidebar-workspace-row\"] [data-openbitfun-part=\"row\"]", props: box },
      { label: "compare.item.sessionRow", demo: ".ws-recent-item", lab: "[data-openbitfun-component=\"mobile-sidebar-session-row\"]", props: box },
      { label: "compare.item.sidebarFooter", demo: ".sidebar-footer", lab: "[data-openbitfun-component=\"mobile-sidebar-tools-footer\"]", props: box },
      { label: "compare.item.toolsPill", demo: ".tool-pill", lab: "[data-openbitfun-part=\"tools\"]", props: box },
      { label: "compare.item.settings", demo: ".settings-btn", lab: "[data-openbitfun-part=\"settings\"]", props: box },
    ],
  },
];

type Rect = Record<Prop, number>;
interface Row { label: MessageKey; prop: Prop; demo?: number; lab?: number; demoIssue?: MessageKey }

function relative(element: Element | null, origin: DOMRect, inset: number, scale: number): Rect | undefined {
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  return {
    x: (rect.left - origin.left - inset) * scale,
    y: (rect.top - origin.top - inset) * scale,
    w: rect.width * scale,
    h: rect.height * scale,
  };
}

function measureDemo(doc: Document, selector: string): Rect | undefined {
  const device = doc.querySelector(".device");
  if (!device) return undefined;
  const element = Array.from(doc.querySelectorAll(selector)).find(candidate => { const rect = candidate.getBoundingClientRect(); return rect.width > 0 || rect.height > 0; }) ?? null;
  return relative(element, device.getBoundingClientRect(), 0, 1);
}

function measureLab(root: HTMLElement, selector: string): Rect | undefined {
  const screen = root.querySelector(".design-phone-screen");
  if (!screen) return undefined;
  const origin = screen.getBoundingClientRect();
  // The Lab column is CSS-scaled; convert the bezel to rendered pixels before removing it.
  const renderScale = origin.width / (screen as HTMLElement).offsetWidth;
  const inset = parseFloat(getComputedStyle(screen).borderTopWidth) * renderScale;
  const scale = SCREEN_WIDTH / (origin.width - 2 * inset);
  if (selector === "::home-indicator") {
    // The home indicator is the gesture strip's ::after, so its box comes from the computed style.
    const gesture = screen.querySelector(".design-phone-gesture");
    if (!gesture) return undefined;
    const after = getComputedStyle(gesture, "::after");
    const strip = gesture.getBoundingClientRect();
    const width = parseFloat(after.width) * renderScale;
    const height = parseFloat(after.height) * renderScale;
    const bottom = parseFloat(after.bottom) * renderScale;
    return {
      x: (strip.left + (strip.width - width) / 2 - origin.left - inset) * scale,
      y: (strip.bottom - bottom - height - origin.top - inset) * scale,
      w: width * scale,
      h: height * scale,
    };
  }
  return relative(screen.querySelector(selector), origin, inset, scale);
}

export function DemoComparePage(theme: { colorScheme: ColorScheme; contrast: ContrastMode; density: DensityMode; tokenOverrides: TokenOverrides }) {
  const { t } = useI18n();
  const [sceneId, setSceneId] = useState<SceneId>("home");
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const labRef = useRef<HTMLDivElement>(null);
  const scene = scenes.find(candidate => candidate.id === sceneId) ?? scenes[0]!;

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const lab = labRef.current;
    if (!doc || !lab) return;
    setRows(scene.items.flatMap(item => {
      const demo = measureDemo(doc, item.demo);
      const labRect = measureLab(lab, item.lab);
      return item.props.map(prop => ({ label: item.label, prop, demo: demo?.[prop], lab: labRect?.[prop], demoIssue: item.demoIssue }));
    }));
  }, [scene]);

  /* The iframe can finish loading before React attaches onLoad, so the page polls for the demo
     document instead of relying on the event. Each scene reloads the iframe (key) and prepares the
     fresh document once. */
  useEffect(() => {
    setReady(false);
    setRows([]);
    let settle: number | undefined;
    const poll = window.setInterval(() => {
      const doc = frameRef.current?.contentDocument;
      if (!doc || doc.readyState !== "complete" || !doc.querySelector(".device") || doc.documentElement.dataset.labPrepared) return;
      window.clearInterval(poll);
      doc.documentElement.dataset.labPrepared = "true";
      // Show only the slab device: hide the demo's own preview bar and stage chrome.
      const style = doc.createElement("style");
      style.textContent = ".preview-bar{display:none!important}body{background:transparent!important}.stage{padding:0!important;overflow:visible!important}";
      doc.head.append(style);
      click(doc, ".device-btn[data-mode=\"slab\"]");
      scene.prepare(doc);
      // Let the demo's drawer and page transitions (320ms) settle before measuring.
      settle = window.setTimeout(() => { setReady(true); measure(); }, 900);
    }, 100);
    return () => { window.clearInterval(poll); window.clearTimeout(settle); };
  }, [measure, scene, sceneId]);

  const matched = rows.filter(row => row.demo !== undefined && row.lab !== undefined && Math.abs(row.demo - row.lab) <= TOLERANCE).length;
  const demoIssues = rows.filter(row => row.demoIssue && !(row.demo !== undefined && row.lab !== undefined && Math.abs(row.demo - row.lab) <= TOLERANCE)).length;
  const Scene = scene.Scene;

  return (
    <main className="lab-page lab-page--demo-compare" id="demo-compare">
      <header className="page-heading">
        <h1>{t("nav.demoCompare")}</h1>
        <p>{t("compare.intro", { tolerance: TOLERANCE })}</p>
      </header>

      <div className="demo-compare-toolbar">
        <TabGroup aria-label={t("compare.sceneLabel")} value={sceneId} onValueChange={value => setSceneId(value as SceneId)}
          items={scenes.map(item => ({ value: item.id, label: t(item.label) }))} />
        {ready && rows.length > 0 && (
          <StatusPill tone={matched + demoIssues === rows.length ? "success" : "warning"}>{t("compare.summary", { matched, total: rows.length })}{demoIssues > 0 ? ` · ${t("compare.summaryIssues", { count: demoIssues })}` : ""}</StatusPill>
        )}
        <Button size="sm" variant="text" onClick={measure} leadingIcon={<Icon name="refresh" />}>{t("compare.remeasure")}</Button>
      </div>

      <div className="demo-compare-stage">
        <section className="demo-compare-column">
          <h2>{t("compare.demo")}</h2>
          <div className="demo-compare-viewport">
            <iframe key={sceneId} ref={frameRef} className="demo-compare-frame" src="/demo/mobile/index.html" title={t("compare.demo")} />
          </div>
        </section>
        <section className="demo-compare-column">
          <h2>{t("compare.lab")}</h2>
          <div className="demo-compare-viewport demo-compare-lab" ref={labRef}>
            <Scene {...theme} />
          </div>
        </section>
      </div>

      <div className="demo-compare-table-scroll">
        <table className="demo-compare-table">
          <thead>
            <tr>
              <th scope="col">{t("compare.column.element")}</th>
              <th scope="col">{t("compare.column.property")}</th>
              <th scope="col">{t("compare.demo")}</th>
              <th scope="col">{t("compare.lab")}</th>
              <th scope="col">{t("compare.column.delta")}</th>
              <th scope="col">{t("compare.column.result")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const delta = row.demo !== undefined && row.lab !== undefined ? row.lab - row.demo : undefined;
              const ok = delta !== undefined && Math.abs(delta) <= TOLERANCE;
              return (
                <tr key={`${row.label}-${row.prop}`} data-result={ok ? "match" : row.demoIssue ? "demo-issue" : "drift"}>
                  <th scope="row">{index === 0 || rows[index - 1]?.label !== row.label ? t(row.label) : ""}</th>
                  <td><code>{row.prop}</code></td>
                  <td>{row.demo === undefined ? t("compare.missing") : Math.round(row.demo)}</td>
                  <td>{row.lab === undefined ? t("compare.missing") : Math.round(row.lab)}</td>
                  <td>{delta === undefined ? "—" : `${delta > 0 ? "+" : ""}${Math.round(delta)}`}</td>
                  <td>{ok ? t("compare.match") : row.demoIssue ? <span title={t(row.demoIssue)}>{t("compare.demoIssue")}</span> : t("compare.drift")}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6}>{t("compare.measuring")}</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
