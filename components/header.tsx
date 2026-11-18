"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const LINKS = [
  { href: "/tools", label: "All tools" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming" },
];

export function Header() {
  const pathname = usePathname();
  const me = useQuery(api.users.me);
  const links = me?.role === "admin" ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;

  return (
    <header className="site-header">
      <div className="container">
        <Link href="/" className="brand">
          LendLoop
        </Link>
        <Show when="signed-in">
          <nav className="nav" aria-label="Main">
            {links.map((link) => (
              <Link key={link.href} href={link.href} aria-current={pathname.startsWith(link.href) ? "page" : undefined}>
                {link.label}
              </Link>
            ))}
          </nav>
          <UserButton />
        </Show>
        <Show when="signed-out">
          <span style={{ flex: 1 }} />
          <SignInButton mode="modal" forceRedirectUrl="/tools">
            <button className="button small">Sign in</button>
          </SignInButton>
        </Show>
      </div>
    </header>
  );
}
