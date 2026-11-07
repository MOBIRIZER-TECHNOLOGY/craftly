import type { ReactNode } from "react";
import { IconArrowLeft, IconButton, IconClose, cx } from "@/ui";
import "./PanelHeader.css";

export interface PanelHeaderProps {
  title: ReactNode;
  /** small grey line under the title */
  subtitle?: ReactNode;
  /** shows a back arrow */
  onBack?: () => void;
  backLabel?: string;
  /** shows a close button */
  onClose?: () => void;
  closeLabel?: string;
  /** extra controls before the close button */
  actions?: ReactNode;
  className?: string;
}

/** Title row of a sub-page: optional back arrow, title (16px / 700), optional actions and close button. */
export function PanelHeader({ title, subtitle, onBack, backLabel = "Back", onClose, closeLabel = "Close", actions, className }: PanelHeaderProps) {
  return (
    <header className={cx("cf-pheader", className)}>
      {onBack ? <IconButton label={backLabel} icon={<IconArrowLeft />} onClick={onBack} className="cf-pheader__back" /> : null}
      <div className="cf-pheader__text">
        <h2 className="cf-pheader__title">{title}</h2>
        {subtitle ? <p className="cf-pheader__subtitle">{subtitle}</p> : null}
      </div>
      {actions}
      {onClose ? <IconButton label={closeLabel} icon={<IconClose />} onClick={onClose} /> : null}
    </header>
  );
}
