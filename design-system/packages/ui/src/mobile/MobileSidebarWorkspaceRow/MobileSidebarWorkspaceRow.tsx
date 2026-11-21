import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classNames } from "../../internal/classNames";
import styles from "./MobileSidebarWorkspaceRow.module.css";

export interface MobileSidebarWorkspaceRowProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children?: ReactNode;
  expanded: boolean;
  label: ReactNode;
  onExpandChange?: (expanded: boolean) => void;
}

function DefaultChevron() {
  return (
    <svg
      aria-hidden="true"
      className={styles.chevron}
      height="12"
      viewBox="0 0 24 24"
      width="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function MobileSidebarWorkspaceRow({
  children,
  className,
  expanded,
  label,
  onExpandChange,
  onClick,
  type = "button",
  ...props
}: MobileSidebarWorkspaceRowProps) {
  return (
    <div
      className={classNames(styles.group, className)}
      data-expanded={expanded ? "true" : "false"}
      data-openbitfun-component="mobile-sidebar-workspace-row"
    >
      <button
        {...props}
        aria-expanded={expanded}
        className={styles.row}
        data-openbitfun-part="row"
        onClick={(event) => {
          onExpandChange?.(!expanded);
          onClick?.(event);
        }}
        type={type}
      >
        <span className={styles.label} data-openbitfun-part="label">{label}</span>
        <span className={styles.chevronWrap} data-openbitfun-part="chevron">
          <DefaultChevron />
        </span>
      </button>
      {children !== undefined && children !== null && (
        <div className={styles.children} data-openbitfun-part="children">
          {children}
        </div>
      )}
    </div>
  );
}
