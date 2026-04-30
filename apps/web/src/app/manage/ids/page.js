import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ExternalIdsClient from "@/components/external-ids-client";
import { createRequiredAuthedContext } from "@/server/private-api";

export const metadata = {
  title: "External IDs | Remnant System",
};

const ALLOWED_ROLES = new Set(["super_admin", "manager"]);

async function loadExternalIdsProfile() {
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

  if (!ALLOWED_ROLES.has(authContext.profile.system_role)) {
    redirect("/manage");
  }

  return authContext.profile;
}

export default async function ManageExternalIdsPage() {
  const profile = await loadExternalIdsProfile();
  return <ExternalIdsClient profile={profile} />;
}
