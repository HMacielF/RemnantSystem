"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import NavBoldLink, { isNavLinkActive } from "@/components/workspace-nav-link";

function deriveInitials(profile) {
  const name = String(profile?.full_name || "").trim();
  if (name) {
    const parts = name.split(/\s+/).slice(0, 2);
    return parts.map((part) => part[0]).join("").toUpperCase();
  }
  const email = String(profile?.email || "").trim();
  return email ? email[0].toUpperCase() : "?";
}

function deriveDisplayName(profile) {
  return (
    String(profile?.full_name || "").trim() ||
    String(profile?.email || "").trim() ||
    "Account"
  );
}

export default function PrivateHeader({ profile }) {
  const isSuperAdmin = profile?.system_role === "super_admin";
  const isManager = isSuperAdmin || profile?.system_role === "manager";
  const canInventoryCheck = isSuperAdmin || profile?.can_inventory_check === true;
  const pathname = usePathname() || "/";

  return (
    <header
      className="font-inter w-full bg-[color:var(--qc-bg-page)]"
      style={{ borderBottom: "1px solid var(--qc-line)" }}
    >
      <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-4 px-8 py-5">
        <Link
          href="/manage"
          className="inline-flex items-center"
          aria-label="Quick Countertop manage workspace"
        >
          <Image
            src="/assets/Quick_Logo.png"
            alt="Quick Countertop"
            width={194}
            height={36}
            priority
            className="h-9 w-auto"
          />
        </Link>

        <nav className="flex items-center gap-7 text-[14px]">
          <NavBoldLink href="/" label="Inventory" active={isNavLinkActive(pathname, "/")} />
          <NavBoldLink href="/manage" label="Manage" active={isNavLinkActive(pathname, "/manage")} />
          {isSuperAdmin ? (
            <>
              <NavBoldLink
                href="/slabs"
                label="Slabs"
                active={isNavLinkActive(pathname, "/slabs")}
                hideBelow="md"
              />
              <NavBoldLink
                href="/admin"
                label="Admin"
                active={isNavLinkActive(pathname, "/admin")}
                hideBelow="md"
              />
            </>
          ) : null}
          {isManager ? (
            <NavBoldLink
              href="/manage/ids"
              label="IDs"
              active={isNavLinkActive(pathname, "/manage/ids")}
              hideBelow="lg"
            />
          ) : null}
          {canInventoryCheck ? (
            <NavBoldLink
              href="/manage/inventory-check"
              label="Inventory Check"
              active={isNavLinkActive(pathname, "/manage/inventory-check")}
              hideBelow="lg"
            />
          ) : null}

          <span className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-[color:var(--qc-ink-2)]">
              <span
                aria-hidden="true"
                className="inline-flex h-7 w-7 items-center justify-center text-[11px] font-semibold text-white"
                style={{
                  backgroundColor: "var(--qc-ink-1)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                {deriveInitials(profile)}
              </span>
              <span className="hidden text-[13px] sm:inline">{deriveDisplayName(profile)}</span>
            </span>
            <a
              href="/api/auth/logout"
              className="text-[13px] text-[color:var(--qc-ink-2)] transition-colors hover:text-[color:var(--qc-orange)]"
              style={{
                textDecoration: "underline",
                textDecorationColor: "var(--qc-line-strong)",
                textUnderlineOffset: 4,
              }}
            >
              Log out
            </a>
          </span>
        </nav>
      </div>
    </header>
  );
}
