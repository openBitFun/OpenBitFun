import { enUSMessages } from "../i18n/messages";
import { useI18n, type MessageKey } from "../i18n";
import { Fragment, useSyncExternalStore } from "react";
import { OpenBitFunSolidMark } from "@openbitfun/ui/brand";
import {
  focusFoundationSection,
  foundationSections,
  getActiveFoundationSection,
  subscribeFoundationSection,
} from "../foundationNavigation";
import { LabComponentIndex } from "./LabComponentIndex";
import { componentRegistry } from "@openbitfun/ui/registry";

type Page = "components" | "foundations" | "brand" | "colors" | "tokens" | "getting-started" | "resources" | "patterns" | "mobile-patterns" | "flow-chat" | "flow-chat-mock" | "mobile" | "subagent-ip";
type NavigationProps = { page: string; componentName?: string; onNavigate: (page: Page) => void };
function sectionFor(page: string) {
  return ["brand", "subagent-ip"].includes(page) ? "brand"
    : ["foundations", "colors", "tokens", "getting-started", "resources"].includes(page) ? "foundations"
    : page === "overview" ? undefined : "components";
}
/** Whether this route has a section level at all. The shell needs to know before it renders, so
 *  it can give the rail a column instead of a single centred one. */
export function hasSectionNavigation(page: string) {
  return sectionFor(page) !== undefined;
}
/* Top-level site navigation, labelled from the English catalog in every locale: like the
   homepage slogan, these names are the Lab's own identity rather than page copy, and a
   design system's canonical naming does not move with the reader's language. Everything
   inside the pages still follows the active locale. */
export function LabNavigation({ page, componentName, onNavigate }: NavigationProps) {
  const { t } = useI18n();
  /* The catalog splits into two surface tabs at the top level: Desktop and Handheld. An open
     component stays highlighted under whichever tab lists its category. */
  /* The catalog splits into two surface tabs at the top level: Desktop and Handheld. An open
     component stays highlighted under whichever tab lists its category. */
  const libraryTab = page === "component"
    ? componentRegistry.find(item => item.name === componentName)?.category === "mobile" ? "mobile" : "components"
    : page === "mobile" || page === "components" ? page : undefined;
  return <nav aria-label={t("app.pagesLabel")} className="lab-navigation design-primary-navigation">
    {(["components", "mobile", "foundations", "brand"] as const).map(target => <a key={target} href={`#${target}`}
      aria-current={target === "components" || target === "mobile" ? libraryTab === target ? "true" : undefined : sectionFor(page) === target ? "true" : undefined}
      onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate(target); }}>
      {target === "components" ? enUSMessages["design.web"] : target === "mobile" ? enUSMessages["design.mobile"] : enUSMessages[`design.${target}`]}</a>)}
  </nav>;
}
export function LabSectionNavigation({ page, componentName, onNavigate }: NavigationProps) {
  const { t } = useI18n();
  const section = sectionFor(page);
  /* Handheld surface keeps its own rail: the mobile component index plus the mobile-only
     scenes pages. The Desktop rail lists the web catalog and web patterns instead. */
  const mobileSurface = page === "mobile" || page === "mobile-patterns"
    || (page === "component" && componentRegistry.find(item => item.name === componentName)?.category === "mobile");
  const activeChapter = useSyncExternalStore(subscribeFoundationSection, getActiveFoundationSection);
  const links: readonly [Page, MessageKey][] = section === "brand"
    ? [["brand", "design.identity"], ["subagent-ip", "design.characters"]]
    : section === "foundations"
      ? [["foundations", "design.foundations"], ["colors", "nav.colors"], ["tokens", "design.tokens"], ["getting-started", "nav.gettingStarted"], ["resources", "nav.resources"]]
      : section === "components"
        ? (mobileSurface
          ? [["components", "design.mobile"], ["mobile-patterns", "design.contexts"], ["flow-chat-mock", "design.conversation"]]
          : [["components", "design.web"], ["patterns", "design.contexts"], ["flow-chat-mock", "design.conversation"]])
        : [];
  if (!links.length) return null;
  return <nav className="design-secondary-navigation" aria-label={t(`design.${section!}`)}>
    {links.map(([target, label]) => <Fragment key={target}>
      <a href={`#${target}`} aria-current={page === target || (target === "components" && ["component", "mobile", "flow-chat"].includes(page)) ? "page" : undefined}
        data-group={target === "foundations" || target === "components" ? "open" : undefined}
        className={target === "components" ? "design-navigation-library" : undefined}
        onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate(target); }}>
        {t(label)}
        {/* The library's own row wears the mark — the same artwork and the same flattening the
            topbar's wordmark uses, one step down in size (the 16px control-icon step), and
            decorative: the row's text already names the route. */}
        {target === "components" && <OpenBitFunSolidMark className="design-app-mark" size={16} />}
      </a>
      {/* Both indexes hang under their route: one tree per section, so the rail and the page never
          show two competing lists of the same thing. The rail follows the topbar's active tab:
          Desktop lists the non-mobile catalog, Handheld lists the touch-first kit. */}
      {target === "components" && <LabComponentIndex selected={componentName} scope={mobileSurface ? "mobile" : "web"} />}
      {target === "foundations" && <ul className="design-navigation-chapters" aria-label={t("foundations.contents")}>
        {foundationSections.map(chapter => <li key={chapter.id}>
          <a href={`#foundations/${chapter.id}`}
            aria-current={page === "foundations" && activeChapter === chapter.id ? "location" : undefined}
            onClick={event => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              // Same chapter as the address bar: no hash change follows, so move the reader here.
              if (window.location.hash === `#foundations/${chapter.id}`) {
                event.preventDefault();
                focusFoundationSection(chapter.id);
              }
            }}>{t(chapter.label)}</a>
        </li>)}
      </ul>}
    </Fragment>)}
  </nav>;
}
