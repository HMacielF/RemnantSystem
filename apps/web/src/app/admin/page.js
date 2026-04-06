import { Suspense } from "react";
import AdminWorkspaceClient from "@/components/admin-workspace-client";

export default function AdminPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#edf2f7] px-6 py-10 text-[#18212d]">Loading super-admin workspace...</main>}>
      <AdminWorkspaceClient />
    </Suspense>
  );
}
