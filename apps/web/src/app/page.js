import { Suspense } from "react";
import PublicInventoryClient from "@/components/public-inventory-client";

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[linear-gradient(180deg,#f8f1ea_0%,#f4ede6_26%,#efe7de_100%)] px-6 py-10 text-[#2d2623]">Loading inventory...</main>}>
      <PublicInventoryClient />
    </Suspense>
  );
}
