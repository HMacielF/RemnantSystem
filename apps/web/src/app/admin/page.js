import { Suspense } from "react";
import AdminWorkspaceClient from "@/components/admin-workspace-client";

export default function AdminPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,var(--brand-white)_52%,rgba(247,134,57,0.08)_100%)] px-6 py-10 text-[var(--brand-ink)]">Loading super-admin workspace...</main>}>
      <AdminWorkspaceClient />
    </Suspense>
  );
}
