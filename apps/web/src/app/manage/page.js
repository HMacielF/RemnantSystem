import { Suspense } from "react";
import PrivateWorkspaceClient from "@/components/private-workspace-client";

export default function ManagePage() {
  return (
    <Suspense fallback={<main className="font-inter min-h-screen bg-[color:var(--qc-bg-page)] px-8 py-10 text-[color:var(--qc-ink-2)]">Loading private workspace…</main>}>
      <PrivateWorkspaceClient />
    </Suspense>
  );
}
