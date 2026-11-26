import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../internal/classNames";
import styles from "./MobileSidebarHeader.module.css";

export interface MobileSidebarHeaderProps extends HTMLAttributes<HTMLDivElement> {
  brand: ReactNode;
  trailing?: ReactNode;
}

export function MobileSidebarHeader({ brand, className, trailing, ...props }: MobileSidebarHeaderProps) {
  return (
    <div
      {...props}
      className={classNames(styles.root, className)}
      data-openbitfun-component="mobile-sidebar-header"
    >
      <span className={styles.brand} data-openbitfun-part="brand">{brand}</span>
      {trailing !== undefined && trailing !== null && (
        <span className={styles.trailing} data-openbitfun-part="trailing">{trailing}</span>
      )}
    </div>
  );
}
