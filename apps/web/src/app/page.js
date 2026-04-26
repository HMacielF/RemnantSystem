import { Suspense } from "react";
import { cookies } from "next/headers";
import PublicInventoryClient from "@/components/public-inventory-client";
import { createOptionalAuthedContext } from "@/server/private-api";

async function readInitialProfile() {
  try {
    const cookieStore = await cookies();
    const authContext = await createOptionalAuthedContext({
      cookies: {
        get(name) {
          return cookieStore.get(name);
        },
      },
    });
    return authContext?.profile || null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const initialProfile = await readInitialProfile();

  return (
    <Suspense fallback={<main className="font-inter min-h-screen bg-[color:var(--qc-bg-page)] px-8 py-10 text-[color:var(--qc-ink-2)]">Loading inventory…</main>}>
      <PublicInventoryClient initialProfile={initialProfile} />
    </Suspense>
  );
}
