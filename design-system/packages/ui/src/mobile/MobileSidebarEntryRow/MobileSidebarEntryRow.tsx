import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classNames } from "../../internal/classNames";
import styles from "./MobileSidebarEntryRow.module.css";

export interface MobileSidebarEntryRowProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: ReactNode;
  label: ReactNode;
}

export function MobileSidebarEntryRow({
  className,
  icon,
  label,
  type = "button",
  ...props
}: MobileSidebarEntryRowProps) {
  return (
    <button
      {...props}
      className={classNames(styles.root, className)}
      data-openbitfun-component="mobile-sidebar-entry-row"
      type={type}
    >
      <span className={styles.icon} data-openbitfun-part="icon">{icon}</span>
      <span className={styles.label} data-openbitfun-part="label">{label}</span>
    </button>
  );
}
