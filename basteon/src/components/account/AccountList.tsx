import Link from "next/link";
import type { ReactNode } from "react";

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

export function AccountListCard({ children, className = "", "aria-label": ariaLabel }: AccountCardProps) {
  return <div className={`account-list-card ${className}`.trim()} aria-label={ariaLabel}>{children}</div>;
}

export function AccountSectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="account-section-label">{children}</h2>;
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
    <span className="account-list-row-icon" aria-hidden="true">{icon}</span>
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
