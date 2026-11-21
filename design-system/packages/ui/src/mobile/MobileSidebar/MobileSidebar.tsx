import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../internal/classNames";
import styles from "./MobileSidebar.module.css";

export interface MobileSidebarProps extends HTMLAttributes<HTMLElement> {
  footer?: ReactNode;
  header?: ReactNode;
}

export function MobileSidebar({ children, className, footer, header, ...props }: MobileSidebarProps) {
  return (
    <aside
      {...props}
      className={classNames(styles.root, className)}
      data-openbitfun-component="mobile-sidebar"
    >
      {header !== undefined && header !== null && (
        <div className={styles.header} data-openbitfun-part="header">{header}</div>
      )}
      <div className={styles.scroll} data-openbitfun-part="scroll">{children}</div>
      {footer !== undefined && footer !== null && (
        <div className={styles.footer} data-openbitfun-part="footer">{footer}</div>
      )}
    </aside>
  );
}
