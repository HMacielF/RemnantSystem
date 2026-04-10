import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import RemnantConfirmClient from "@/components/remnant-confirm-client";
import { createRequiredAuthedContext } from "@/server/private-api";

export const metadata = {
  title: "Inventory Confirm | Remnant System",
};

async function requireSuperAdminAccess() {
  const cookieStore = await cookies();
  const authContext = await createRequiredAuthedContext({
    cookies: {
      get(name) {
        return cookieStore.get(name);
      },
    },
  });

  if (authContext?.errorResponse) {
    redirect("/portal");
  }

  if (authContext.profile.system_role !== "super_admin") {
    redirect("/manage");
  }
}

export default async function ManageConfirmPage() {
  await requireSuperAdminAccess();
  return <RemnantConfirmClient />;
}
