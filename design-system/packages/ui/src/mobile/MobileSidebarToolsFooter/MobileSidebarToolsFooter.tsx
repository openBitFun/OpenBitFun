import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../internal/classNames";
import styles from "./MobileSidebarToolsFooter.module.css";

export interface MobileSidebarToolsFooterProps extends HTMLAttributes<HTMLDivElement> {
  leading?: ReactNode;
  onSettingsClick?: () => void;
  onToolsClick?: () => void;
  settingsLabel?: string;
}

function DefaultToolsGlyph() {
  return (
    <svg
      aria-hidden="true"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3z" />
    </svg>
  );
}

function DefaultSettingsGlyph() {
  return (
    <svg
      aria-hidden="true"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function MobileSidebarToolsFooter({
  className,
  leading,
  onSettingsClick,
  onToolsClick,
  settingsLabel = "Settings",
  ...props
}: MobileSidebarToolsFooterProps) {
  return (
    <div
      {...props}
      className={classNames(styles.root, className)}
      data-openbitfun-component="mobile-sidebar-tools-footer"
    >
      <button
        className={styles.toolPill}
        data-openbitfun-part="tools"
        onClick={onToolsClick}
        type="button"
      >
        <span className={styles.toolPillIcon} aria-hidden="true">
          <DefaultToolsGlyph />
        </span>
        {leading !== undefined && leading !== null && (
          <span className={styles.toolPillLabel} data-openbitfun-part="tools-label">{leading}</span>
        )}
      </button>
      <span className={styles.spacer} aria-hidden="true" />
      <button
        aria-label={settingsLabel}
        className={styles.settingsButton}
        data-openbitfun-part="settings"
        onClick={onSettingsClick}
        type="button"
      >
        <DefaultSettingsGlyph />
      </button>
    </div>
  );
}
