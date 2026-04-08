import { Suspense } from "react";
import GoogleCallbackClient from "@/components/google-callback-client";

export const metadata = {
  title: "Google Sign-In | Remnant System",
};

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={null}>
      <GoogleCallbackClient />
    </Suspense>
  );
}
