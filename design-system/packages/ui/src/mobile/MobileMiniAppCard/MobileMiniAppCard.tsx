import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classNames } from "../../internal/classNames";
import styles from "./MobileMiniAppCard.module.css";

export type MobileMiniAppCardSize = "default" | "wide";

export interface MobileMiniAppCardProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title"> {
  /** Two-line clamped description under the title. */
  description?: ReactNode;
  /** Cover artwork; fills the leading square edge to edge. */
  media?: ReactNode;
  /** `wide` is the trifold form, where cards sit two per row with a 160px cover. */
  size?: MobileMiniAppCardSize;
  title: ReactNode;
}

export function MobileMiniAppCard({
  className,
  description,
  media,
  size = "default",
  title,
  type = "button",
  ...props
}: MobileMiniAppCardProps) {
  return (
    <button
      {...props}
      className={classNames(styles.root, className)}
      data-openbitfun-component="mobile-mini-app-card"
      data-size={size}
      type={type}
    >
      <span className={styles.media} data-openbitfun-part="media">{media}</span>
      <span className={styles.info}>
        <span className={styles.text}>
          <span className={styles.title} data-openbitfun-part="title">{title}</span>
          {description !== undefined && description !== null && (
            <span className={styles.description} data-openbitfun-part="description">{description}</span>
          )}
        </span>
      </span>
    </button>
  );
}
