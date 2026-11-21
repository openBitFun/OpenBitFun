import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classNames } from "../../internal/classNames";
import styles from "./MobileSidebarChildRow.module.css";

export interface MobileSidebarChildRowProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: ReactNode;
  selected?: boolean;
}

export function MobileSidebarChildRow({
  className,
  label,
  selected = false,
  type = "button",
  ...props
}: MobileSidebarChildRowProps) {
  return (
    <button
      {...props}
      aria-current={selected ? "true" : undefined}
      className={classNames(styles.root, className)}
      data-openbitfun-component="mobile-sidebar-child-row"
      data-selected={selected ? "true" : "false"}
      type={type}
    >
      <span className={styles.dot} aria-hidden="true" data-openbitfun-part="dot" />
      <span className={styles.label} data-openbitfun-part="label">{label}</span>
    </button>
  );
}
