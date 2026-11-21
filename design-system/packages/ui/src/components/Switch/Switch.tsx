import { useFieldAccessibility } from "../Field/FieldAccessibility";
import {
  forwardRef,
  type ChangeEventHandler,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { classNames } from "../../internal/classNames";
import styles from "./Switch.module.css";

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "children" | "type"> {
  appearance?: "plain" | "surface";
  description?: ReactNode;
  label?: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch({
  appearance = "plain",
  className,
  description,
  label,
  onChange,
  onCheckedChange,
  ...props
}, ref) {
  const fieldAccessibility = useFieldAccessibility(props);
  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    onChange?.(event);
    onCheckedChange?.(event.currentTarget.checked);
  };

  const switchControl = (
    <span
      className={classNames(styles.switch, className)}
      data-openbitfun-component="switch"
      data-appearance={appearance}
    >
      <input
        {...props}
        {...fieldAccessibility}
        className={styles.input}
        onChange={handleChange}
        ref={ref}
        role="switch"
        data-openbitfun-part="input"
        type="checkbox"
      />
      <span aria-hidden="true" className={styles.track} data-openbitfun-part="track">
        <span className={styles.thumb} data-openbitfun-part="thumb" />
      </span>
    </span>
  );

  if (label === undefined && description === undefined) return switchControl;

  return (
    <label className={styles.labeled}>
      <span className={styles.copy} data-openbitfun-part="copy">
        {label !== undefined && <span className={styles.label} data-openbitfun-part="label">{label}</span>}
        {description !== undefined && <span className={styles.description} data-openbitfun-part="description">{description}</span>}
      </span>
      {switchControl}
    </label>
  );
});
