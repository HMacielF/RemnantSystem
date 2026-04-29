"use client";

import Link from "next/link";

const VISIBILITY = {
  always: "inline-grid",
  md: "hidden md:inline-grid",
  lg: "hidden lg:inline-grid",
};

export default function NavBoldLink({
  href,
  label,
  active = false,
  hideBelow = "always",
  className = "",
}) {
  const visibility = VISIBILITY[hideBelow] || VISIBILITY.always;
  const visibleClasses = active
    ? "col-start-1 row-start-1 font-semibold text-[color:var(--qc-ink-1)] transition-colors group-hover:text-[color:var(--qc-orange)]"
    : "col-start-1 row-start-1 font-normal text-[color:var(--qc-ink-2)] transition-colors group-hover:font-semibold group-hover:text-[color:var(--qc-ink-1)]";
  return (
    <Link
      href={href}
      className={`group ${visibility} ${className}`.trim()}
      aria-current={active ? "page" : undefined}
    >
      <span aria-hidden="true" className="col-start-1 row-start-1 invisible font-semibold">
        {label}
      </span>
      <span className={visibleClasses}>{label}</span>
    </Link>
  );
}

export function isNavLinkActive(pathname, href) {
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  const target = String(href || "").replace(/\/+$/, "") || "/";
  if (target === "/") return path === "/";
  if (target === "/manage") return path === "/manage";
  return path === target || path.startsWith(`${target}/`);
}
