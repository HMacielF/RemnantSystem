import { Suspense } from "react";
import PublicInventoryClient from "@/components/public-inventory-client";

export default function Home() {
  return (
    <Suspense fallback={<main className="font-inter min-h-screen bg-[color:var(--qc-bg-page)] px-8 py-10 text-[color:var(--qc-ink-2)]">Loading inventory…</main>}>
      <PublicInventoryClient />
    </Suspense>
  );
}
