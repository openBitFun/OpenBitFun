import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classNames } from "../../internal/classNames";
import styles from "./MobileSidebarSessionRow.module.css";

export type MobileSidebarSessionStatus = "error" | "running";

export interface MobileSidebarSessionRowProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: ReactNode;
  selected?: boolean;
  status?: MobileSidebarSessionStatus;
  time?: ReactNode;
}

export function MobileSidebarSessionRow({
  className,
  label,
  selected = false,
  status,
  time,
  type = "button",
  ...props
}: MobileSidebarSessionRowProps) {
  return (
    <button
      {...props}
      aria-current={selected ? "true" : undefined}
      className={classNames(styles.root, className)}
      data-openbitfun-component="mobile-sidebar-session-row"
      data-selected={selected ? "true" : "false"}
      data-status={status}
      type={type}
    >
      <span className={styles.label} data-openbitfun-part="label">{label}</span>
      {status !== undefined && (
        <span
          aria-hidden="true"
          className={styles.statusDot}
          data-openbitfun-part="status-dot"
          data-status={status}
        />
      )}
      {time !== undefined && time !== null && (
        <span className={styles.time} data-openbitfun-part="time">{time}</span>
      )}
    </button>
  );
}
