import { useState } from "react";
import { useI18n } from "../i18n";
import {
  MobileIconButton,
  MobileMiniAppCard,
  MobileSidebar,
  MobileSidebarChildRow,
  MobileSidebarEntryRow,
  MobileSidebarHeader,
  MobileSidebarSectionLabel,
  MobileSidebarSessionRow,
  MobileSidebarToolsFooter,
  MobileSidebarWorkspaceRow,
} from "@openbitfun/ui/mobile";
import { MobileConversationExample, PhonePageHeader, PhoneSidebarButton, PhoneStatusBar } from "./LiveComponentExamples";
import { Icon } from "@openbitfun/ui";
import { OpenBitFunBrandMotion } from "@openbitfun/ui/brand";
import { ThemeRoot, type ColorScheme, type ContrastMode, type DensityMode, type TokenOverrides } from "@openbitfun/ui";

export interface MobileSceneTheme {
  colorScheme: ColorScheme;
  contrast: ContrastMode;
  density: DensityMode;
  tokenOverrides: TokenOverrides;
}

/* The three pages the OpenBitFun mobile demo actually renders. Each scene is its own component so
   the scenes page and the demo comparison page draw exactly the same markup. */
export function MobileHomeScene(props: MobileSceneTheme) {
  const { t } = useI18n();
  return (
    <>
    {/* Scene 1: Home — the demo's RecentRemoteHome: sidebar button, brand mark, greeting and the
        docked ComposerBar. The demo renders no session list on this page. */}
    <ThemeRoot className="design-phone-frame" {...props}>
      <div className="design-phone-screen" data-shell="home">
        <PhoneStatusBar />
        <PhoneSidebarButton />
        <div className="design-phone-body design-mobile-home-scene">
          <div className="design-mobile-home-inner">
            <OpenBitFunBrandMotion className="design-mobile-home-mark" size={160} variant="flow" />
            <div className="design-mobile-home-title">{t("scenes.mobile.home.greeting")}</div>
          </div>
        </div>
        <div className="design-phone-dock"><MobileConversationExample name="MobileComposer" state="collapsed" /></div>
        <div className="design-phone-gesture" />
      </div>
    </ThemeRoot>
    </>
  );
}

export function MobileMiniAppScene(props: MobileSceneTheme) {
  const { t } = useI18n();
  return (
    <>
    {/* Scene 2: Mini apps — the demo's MiniAppSurface in list view. */}
    <ThemeRoot className="design-phone-frame" {...props}>
      <div className="design-phone-screen" data-shell="page">
        <PhoneStatusBar />
        <PhonePageHeader title={t("scenes.mobile.miniApp.title")}
          trailing={<button type="button" className="design-phone-header-action" aria-label={t("scenes.mobile.miniApp.viewToggle")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
            </button>} />
        <div className="design-phone-body design-mobile-miniapp-list">
          {([["gomoku", "gomoku"], ["regex", "regex-playground"], ["divination", "daily-divination"]] as const).map(([key, cover]) => (
            <MobileMiniAppCard key={key} title={t(`scenes.mobile.miniApp.${key}`)} description={t(`scenes.mobile.miniApp.${key}Desc`)}
              media={<img src={`/assets/${cover}.webp`} alt="" draggable={false} />} />
          ))}
        </div>
        <div className="design-phone-gesture" />
      </div>
    </ThemeRoot>
    </>
  );
}

export function MobileSidebarScene(props: MobileSceneTheme) {
  const { t } = useI18n();
  // The demo opens with every workspace collapsed.
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});
  const toggleWorkspace = (name: string) =>
    setExpandedWorkspaces((current) => ({ ...current, [name]: !current[name] }));
  const workspaceNames = [
    t("scenes.mobile.sidebar.workspace1"),
    t("scenes.mobile.sidebar.workspace2"),
    t("scenes.mobile.sidebar.workspace3"),
  ];
  return (
    <>
    {/* Scene 3: Sidebar — the demo's slab drawer: a 295px panel over the dimmed home page, with
        the status bar staying on top. */}
    <ThemeRoot className="design-phone-frame" {...props}>
      <div className="design-phone-screen design-mobile-sidebar-scene" data-shell="home" data-color-scheme={props.colorScheme}>
        <PhoneStatusBar />
        <div className="design-phone-body design-mobile-home-scene" aria-hidden="true">
          <div className="design-mobile-home-inner">
            <OpenBitFunBrandMotion className="design-mobile-home-mark" size={160} variant="flow" active={false} />
            <div className="design-mobile-home-title">{t("scenes.mobile.home.greeting")}</div>
          </div>
        </div>
        <div className="design-phone-scrim" aria-hidden="true" />
        <div className="design-mobile-sidebar-drawer">
        <MobileSidebar
          header={
            <MobileSidebarHeader
              brand={t("scenes.mobile.sidebar.brand")}
              trailing={
                <>
                  <MobileIconButton icon={<Icon name="search" />} aria-label={t("scenes.mobile.sidebar.search")} />
                </>
              }
            />
          }
          footer={
            <MobileSidebarToolsFooter
              leading={t("scenes.mobile.sidebar.tools")}
              onSettingsClick={() => undefined}
              onToolsClick={() => undefined}
              settingsLabel={t("scenes.mobile.sidebar.settings")}
            />
          }
        >
          <div className="design-mobile-sidebar-scroll">
            <MobileSidebarEntryRow
              icon={<img src="/assets/bitfun-mascot.svg" alt="" draggable={false} />}
              label={t("scenes.mobile.sidebar.assistant")}
            />
            <MobileSidebarEntryRow
              icon={(
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2.2" />
                  <circle cx="17" cy="7" r="3.8" />
                  <rect x="3.2" y="13.2" width="7.6" height="7.6" rx="3.8" />
                  <circle cx="17" cy="17" r="3.8" />
                </svg>
              )}
              label={t("scenes.mobile.sidebar.miniApps")}
            />
            <MobileSidebarSectionLabel
              action={(
                <button type="button" aria-label={t("scenes.mobile.sidebar.addWorkspace")} className="design-mobile-sidebar-add">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            >
              {t("scenes.mobile.sidebar.workspace")}
            </MobileSidebarSectionLabel>
            {workspaceNames.map((name) => (
              <MobileSidebarWorkspaceRow
                key={name}
                expanded={Boolean(expandedWorkspaces[name])}
                label={name}
                onExpandChange={() => toggleWorkspace(name)}
              >
                <MobileSidebarChildRow label={t("scenes.mobile.sidebar.childRemote")} />
                <MobileSidebarChildRow label={t("scenes.mobile.sidebar.childLocal")} />
              </MobileSidebarWorkspaceRow>
            ))}
            <MobileSidebarSectionLabel className="design-mobile-sidebar-recent-label">{t("scenes.mobile.sidebar.recent")}</MobileSidebarSectionLabel>
            <MobileSidebarSessionRow label={t("scenes.mobile.sidebar.session1")} status="running" time="2m" />
            <MobileSidebarSessionRow label={t("scenes.mobile.sidebar.session2")} time="1h" />
            <MobileSidebarSessionRow label={t("scenes.mobile.sidebar.session3")} time="3h" />
            <MobileSidebarSessionRow label={t("scenes.mobile.sidebar.session4")} status="error" time="1d" />
            <MobileSidebarSessionRow label={t("scenes.mobile.sidebar.session5")} time="2d" />
          </div>
        </MobileSidebar>
        </div>
        <div className="design-phone-gesture" />
      </div>
    </ThemeRoot>
    </>
  );
}

export function MobileSceneGallery(props: MobileSceneTheme) {
  const { t } = useI18n();
  return (
    <div className="design-mobile-scenes" role="img" aria-label={t("scenes.mobile.label")}>
      <MobileHomeScene {...props} />
      <MobileMiniAppScene {...props} />
      <MobileSidebarScene {...props} />
    </div>
  );
}
