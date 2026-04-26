import { Suspense } from "react";
import AdminWorkspaceClient from "@/components/admin-workspace-client";

export default function AdminPage() {
  return (
    <Suspense fallback={<main className="font-inter min-h-screen bg-[color:var(--qc-bg-page)] px-8 py-10 text-[color:var(--qc-ink-2)]">Loading super-admin workspace…</main>}>
      <AdminWorkspaceClient />
    </Suspense>
  );
}
