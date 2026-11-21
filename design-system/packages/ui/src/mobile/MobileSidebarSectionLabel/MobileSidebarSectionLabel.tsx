import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../internal/classNames";
import styles from "./MobileSidebarSectionLabel.module.css";

export interface MobileSidebarSectionLabelProps extends HTMLAttributes<HTMLDivElement> {
  action?: ReactNode;
}

export function MobileSidebarSectionLabel({ action, children, className, ...props }: MobileSidebarSectionLabelProps) {
  return (
    <div
      {...props}
      className={classNames(styles.root, className)}
      data-openbitfun-component="mobile-sidebar-section-label"
    >
      <span className={styles.label} data-openbitfun-part="label">{children}</span>
      {action !== undefined && action !== null && (
        <span className={styles.action} data-openbitfun-part="action">{action}</span>
      )}
    </div>
  );
}
