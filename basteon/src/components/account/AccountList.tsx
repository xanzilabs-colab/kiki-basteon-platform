import Link from "next/link";
import { useRef, type PointerEvent, type ReactNode } from "react";

type AccountCardProps = {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
};

type AccountListRowProps = {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  className?: string;
} & (
  | { href: string; onClick?: never }
  | { href?: never; onClick: () => void }
);

export type AccountSegment = { value: string; label: string; icon?: ReactNode };

export function AccountListCard({ children, className = "", "aria-label": ariaLabel }: AccountCardProps) {
  return <div className={`account-list-card ${className}`.trim()} aria-label={ariaLabel}>{children}</div>;
}

export function AccountFeedCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <article className={`account-feed-card ${className}`.trim()}>{children}</article>;
}

export function AccountSectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="account-section-label">{children}</h2>;
}

export function AccountIconBadge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`account-icon-badge ${className}`.trim()} aria-hidden="true">{children}</span>;
}

export function AccountStatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "positive" | "warning" | "critical" | "neutral" }) {
  return <span className={`account-status-pill is-${tone}`}><span className="account-status-pill-copy">{children}</span></span>;
}

export function AccountSegmented({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: AccountSegment[];
  onChange: (value: string) => void;
  label: string;
}) {
  return <div className="account-segmented" role="group" aria-label={label}>
    {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
      {option.icon}{option.label}
    </button>)}
  </div>;
}

export function AccountChip({ children, selected = false, onClick }: { children: ReactNode; selected?: boolean; onClick: () => void }) {
  return <button type="button" className="account-chip" aria-pressed={selected} onClick={onClick}>{children}</button>;
}

export function AccountStatTile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return <div className="account-stat-tile">
    <span className="account-stat-icon" aria-hidden="true">{icon}</span>
    <span className="account-stat-label">{label}</span>
    <strong>{value}</strong>
  </div>;
}

export function AccountBanner({ children, href, onClick, icon }: { children: ReactNode; href?: string; onClick?: () => void; icon?: ReactNode }) {
  const content = <>{icon && <span className="account-banner-icon" aria-hidden="true">{icon}</span>}<span>{children}</span></>;
  if (href) return <Link className="account-banner" href={href}>{content}</Link>;
  return <button className="account-banner" type="button" onClick={onClick}>{content}</button>;
}

export function AccountToggleRow({
  icon,
  title,
  subtitle,
  checked,
  disabled,
  onChange,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return <div className="account-toggle-row">
    {icon && <AccountIconBadge>{icon}</AccountIconBadge>}
    <span className="account-list-row-copy">
      <strong>{title}</strong>
      {subtitle && <small>{subtitle}</small>}
    </span>
    <button type="button" className="account-toggle" role="switch" aria-label={title} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>
  </div>;
}

export function AccountBottomSheet({
  level,
  onLevelChange,
  children,
}: {
  level: 0 | 1 | 2;
  onLevelChange: (level: 0 | 1 | 2) => void;
  children: ReactNode;
}) {
  const startY = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    startY.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (startY.current === null) return;
    const delta = event.clientY - startY.current;
    startY.current = null;
    if (Math.abs(delta) < 18) return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    onLevelChange(delta < 0 ? Math.min(2, level + 1) as 0 | 1 | 2 : Math.max(0, level - 1) as 0 | 1 | 2);
  };

  return <section className={`account-bottom-sheet level-${level}`} aria-label="Map details">
    <button className="account-sheet-handle" type="button" aria-label="Expand or collapse map details" onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} onPointerCancel={() => { startY.current = null; }} onClick={() => {
      if (suppressClick.current) return;
      onLevelChange(level === 2 ? 0 : (level + 1) as 1 | 2);
    }}>
      <span aria-hidden="true" />
    </button>
    <div className="account-sheet-content">{children}</div>
  </section>;
}

export function AccountListRow({
  href,
  onClick,
  icon,
  title,
  subtitle,
  trailing,
  className = "",
}: AccountListRowProps) {
  const content = <>
    <AccountIconBadge>{icon}</AccountIconBadge>
    <span className="account-list-row-copy">
      <strong>{title}</strong>
      {subtitle && <small>{subtitle}</small>}
    </span>
    {trailing && <span className="account-list-row-trailing">{trailing}</span>}
  </>;

  if (href) {
    return <Link className={`account-list-row ${className}`.trim()} href={href}>{content}</Link>;
  }

  return <button className={`account-list-row ${className}`.trim()} type="button" onClick={onClick}>{content}</button>;
}
