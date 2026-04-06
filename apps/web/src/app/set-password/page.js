import { Suspense } from "react";
import SetPasswordClient from "@/components/set-password-client";

export const metadata = {
  title: "Set Password | Remnant System",
};

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordClient />
    </Suspense>
  );
}
