import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SlabCatalogShell from "@/components/slab-catalog-shell";
import { createRequiredAuthedContext } from "@/server/private-api";

export const metadata = {
  title: "Slab Catalog | Remnant System",
};

async function requireWorkspaceAccess() {
  const cookieStore = await cookies();
  const authContext = await createRequiredAuthedContext(
    {
      cookies: {
        get(name) {
          return cookieStore.get(name);
        },
      },
    },
  );

  if (authContext?.errorResponse) {
    redirect("/portal");
  }

  if (authContext.profile.system_role !== "super_admin") {
    redirect("/manage");
  }
}

export default async function SlabsPage() {
  await requireWorkspaceAccess();
  return <SlabCatalogShell />;
}
