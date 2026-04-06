import { Suspense } from "react";
import PrivateWorkspaceClient from "@/components/private-workspace-client";

export default function ManagePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#edf1f6] px-6 py-10 text-[#172230]">Loading private workspace...</main>}>
      <PrivateWorkspaceClient />
    </Suspense>
  );
}
