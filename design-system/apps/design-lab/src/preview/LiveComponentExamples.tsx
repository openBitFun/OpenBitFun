import { useId, useState, type ReactNode } from "react";
import { Icon, SegmentedControl, TabGroup, type TabGroupSize } from "@openbitfun/ui";
import { MobileButton, MobileComposer, MobileDisclosure, MobileFloatingActions, MobileIconButton, MobileMessage, MobileScrim, MobileSegmentedControl } from "@openbitfun/ui/mobile";
import { useI18n } from "../i18n";

export function NavigationExample({ name, state, size = "sm" }: { name: string; state: string; size?: TabGroupSize }) {
  const { t } = useI18n();
  const id = useId();
  const [value, setValue] = useState(state === "unselected" ? "agent" : "chat");
  const options = [
    { label: t("components.preview.segmentedChat"), value: "chat" },
    { label: t("components.preview.segmentedAgent"), value: "agent", disabled: state === "disabled" },
  ];
  return <div className="design-navigation-example">
    {name === "TabGroup" ? <TabGroup aria-label={t("components.preview.tabGroupLabel")} value={value} onValueChange={setValue} size={size}
      data-openbitfun-preview-state={state === "hover" || state === "active" ? state : undefined}
      items={options.map(option => ({ ...option, id: `${id}-${option.value}`, panelId: `${id}-${option.value}-panel` }))} />
      : name === "MobileSegmentedControl" ? <MobileSegmentedControl aria-label={t("components.preview.segmentedLabel")} value={value} onChange={setValue} options={options} />
        : <SegmentedControl aria-label={t("components.preview.segmentedLabel")} value={value} onValueChange={setValue} options={options} disabled={state === "disabled"}
          data-openbitfun-preview-state={state === "hover" || state === "active" ? state : undefined} />}
    {options.map(option => <section className="design-navigation-content" key={option.value} hidden={value !== option.value}
      id={`${id}-${option.value}-panel`} role={name === "TabGroup" ? "tabpanel" : undefined}
      aria-labelledby={name === "TabGroup" ? `${id}-${option.value}` : undefined} data-selected-content={option.value}>
      <strong>{option.label}</strong><p>{t(option.value === "chat" ? "components.preview.composerPlaceholder" : "components.preview.actionCardDescription")}</p>
    </section>)}
  </div>;
}

export function MobileDisclosureExample({ state }: { state: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(state === "open");
  return <MobileDisclosure data-openbitfun-preview-state={state === "hover" ? "hover" : undefined} disabled={state === "disabled"} onToggle={() => setOpen(value => !value)} open={open} title={t("components.preview.appearance")}>
    {t("components.preview.appearanceDescription")}
  </MobileDisclosure>;
}

/* MobileComposer follows the demo's ComposerBar: a pill with add, a single-line field and one
   primary action that is the microphone while empty and the send button once there is a draft.
   MobileMessage shows the message in the selected role only; the demo has no chat thread, so the
   Lab does not invent one around it. */
export function MobileConversationExample({ name, state }: { name: string; state: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(state === "expanded");
  const [draft, setDraft] = useState("");
  if (name === "MobileMessage") {
    const role = state === "user" || state === "system" ? state : "assistant";
    return <div className="design-mobile-conversation">
      <MobileMessage roleType={role}>{t(role === "user" ? "design.contextUser" : role === "system" ? "components.preview.session" : "design.contextAssistant")}</MobileMessage>
    </div>;
  }
  const sendable = draft.trim().length > 0;
  return <MobileComposer expanded={expanded} onActivate={() => setExpanded(true)} aria-label={t("components.preview.composerLabel")}
    leading={<MobileIconButton appearance="plain" aria-label={t("components.preview.add")} icon={<Icon name="plus" />} />}
    endActions={<MobileIconButton appearance="plain" className="design-composer-action" data-sendable={sendable || undefined}
      aria-label={t(sendable ? "components.preview.composerSend" : "components.preview.composerVoice")}
      icon={sendable ? <span className="design-composer-send"><Icon name="arrow-up" /></span> : <Icon name="mic" />}
      onClick={() => { if (sendable) setDraft(""); }} />}>
    <textarea aria-label={t("components.preview.composerEditorLabel")} className={expanded ? undefined : "design-composer-input"} rows={expanded ? undefined : 1}
      placeholder={t("scenes.mobile.home.composerPlaceholder")} value={draft} onChange={event => setDraft(event.target.value)} />
  </MobileComposer>;
}

export function MobileFloatingActionsExample({ state }: { state: string }) {
  const { t } = useI18n();
  const [showComposer, setShowComposer] = useState(false);
  return <div className="design-mobile-footer-example" style={{ maxWidth: state === "narrow" ? 320 : undefined, paddingBottom: state === "safe-area" ? "var(--openbitfun-space-8)" : undefined }}>
    {showComposer && <MobileConversationExample name="MobileComposer" state="collapsed" />}
    <MobileFloatingActions leading={<MobileButton onClick={() => setShowComposer(value => !value)}>{t("components.preview.add")}</MobileButton>}
      trailing={<MobileIconButton appearance="floating" aria-label={t("components.preview.close")} icon={<Icon name="xmark" />} disabled={!showComposer} onClick={() => setShowComposer(false)} />} />
  </div>;
}

export function MobileScrimExample({ className, state }: { className?: string; state: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(state !== "hidden");
  return <section className="design-scrim-example">
    <MobileButton onClick={() => setOpen(true)}>{t("preview.scrim")}</MobileButton>
    <p>{t("preview.scrimHint")}</p>
    <MobileScrim aria-label={t("components.preview.close")} className={className} onClick={() => setOpen(false)} visible={open} />
  </section>;
}

/* Mobile detail previews render inside the page shells of the OpenBitFun mobile demo, never in a
   scene the demo does not have. "page" is the mini app page: a 56px header with back, title and a
   48px spacer over a body inset 20px. "home" is the recent home: the sidebar button floats at the
   top left and the specimen docks at the bottom like the demo's composer bar. Geometry comes from
   layout.mobilePage.* and layout.mobileDevice.*. Sheets keep their overlay inside the screen (the
   page scopes their portal host to the screen), so a demo sheet slides over the phone. */
export type PhoneShell = "page" | "home";

/* Status bar of the demo: time on the left of the Dynamic Island, cellular, Wi-Fi and battery on
   the right. These are system glyphs, outside the icon library. */
export function PhoneStatusBar() {
  return <div className="design-phone-status" aria-hidden="true">
    <span>9:41</span>
    <span className="design-phone-island" />
    <span>
      <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="7" width="3" height="5" rx="1" /><rect x="5" y="4.5" width="3" height="7.5" rx="1" /><rect x="10" y="2" width="3" height="10" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" opacity=".35" /></svg>
      <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 9.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zM8 5.5c1.7 0 3.2.7 4.3 1.8l-1.4 1.4A4 4 0 0 0 8 7.5a4 4 0 0 0-2.9 1.2L3.7 7.3A6 6 0 0 1 8 5.5zM8 1c2.8 0 5.3 1.1 7.1 2.9l-1.4 1.4A8 8 0 0 0 8 3a8 8 0 0 0-5.7 2.3L.9 3.9A10 10 0 0 1 8 1z" /></svg>
      <svg width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x=".5" y=".5" width="21" height="11" rx="3" stroke="currentColor" opacity=".4" /><rect x="2" y="2" width="14" height="8" rx="1.5" fill="currentColor" /><path d="M23.5 4v4a2 2 0 0 0 0-4z" fill="currentColor" opacity=".4" /></svg>
    </span>
  </div>;
}

export function PhonePageHeader({ title, trailing }: { title: ReactNode; trailing?: ReactNode }) {
  const { t } = useI18n();
  return <div className="design-phone-header">
    <MobileIconButton appearance="plain" aria-label={t("scenes.back")} icon={<Icon name="chevron-left" />} />
    <span className="design-phone-header-title">{title}</span>
    {trailing ?? <span className="design-phone-header-spacer" aria-hidden="true" />}
  </div>;
}

export function PhoneSidebarButton() {
  const { t } = useI18n();
  return <button type="button" className="design-phone-fab" aria-label={t("scenes.mobile.sidebar.open")}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2.5" /><path d="M9.5 5v14" /></svg>
  </button>;
}

export function PhoneScreenPreview({ children, shell = "page", title }: {
  children: ReactNode;
  shell?: PhoneShell;
  /** Header title of the page shell. */
  title?: ReactNode;
}) {
  return <div className="design-phone-frame">
    <div className="design-phone-screen" data-shell={shell}>
      <PhoneStatusBar />
      {shell === "page" ? <>
        <PhonePageHeader title={title} />
        <div className="design-phone-body">{children}</div>
      </> : <>
        <PhoneSidebarButton />
        <div className="design-phone-body" aria-hidden="true" />
        <div className="design-phone-dock">{children}</div>
      </>}
      <div className="design-phone-gesture" aria-hidden="true" />
    </div>
  </div>;
}
