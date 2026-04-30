import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import RemnantConfirmClient from "@/components/remnant-confirm-client";
import { canRunInventoryCheck, createRequiredAuthedContext } from "@/server/private-api";

export const metadata = {
  title: "Inventory Check | Remnant System",
};

async function loadInventoryCheckProfile() {
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

  if (!canRunInventoryCheck(authContext.profile)) {
    redirect("/manage");
  }

  return authContext.profile;
}

export default async function ManageInventoryCheckPage() {
  const profile = await loadInventoryCheckProfile();
  return <RemnantConfirmClient profile={profile} />;
}
