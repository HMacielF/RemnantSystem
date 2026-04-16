import Link from "next/link";
import AuthShell from "@/components/auth-shell";

export const metadata = {
  title: "Access Error | Remnant System",
};

function resolveErrorContent(reason, message) {
  switch (reason) {
    case "missing_credentials":
      return {
        eyebrow: "Missing Details",
        title: "Enter both your email and password.",
        description: "Both fields are required before the portal can try to sign you in.",
        cardEyebrow: "Missing Information",
        cardTitle: "We need both fields",
        message: message || "Email and password are required.",
      };
    case "account_inactive":
      return {
        eyebrow: "Account Inactive",
        title: "Your account is currently inactive.",
        description: "An administrator will need to reactivate this portal account before you can sign in again.",
        cardEyebrow: "Access Status",
        cardTitle: "Account disabled",
        message: "This portal account exists, but it is marked inactive.",
      };
    case "invalid_login":
      return {
        eyebrow: "Sign-In Failed",
        title: "That email or password didn't match.",
        description: "Try again, or use the password reset flow if you need a new one.",
        cardEyebrow: "Credential Check",
        cardTitle: "We could not sign you in",
        message: "Check your email and password, then try again.",
      };
    case "oauth_start_failed":
      return {
        eyebrow: "Google Sign-In",
        title: "Google sign-in could not start.",
        description: "The provider setup or redirect configuration is not ready yet. Review the message, then try again after setup is complete.",
        cardEyebrow: "OAuth Setup",
        cardTitle: "Google login is unavailable",
        message: message || "Google sign-in is unavailable right now.",
      };
    case "oauth_callback_failed":
      return {
        eyebrow: "Google Sign-In",
        title: "We could not finish your Google sign-in.",
        description: "The Google account was accepted, but the final callback into the portal did not complete. Review the message, then try again.",
        cardEyebrow: "OAuth Callback",
        cardTitle: "Sign-in did not finish",
        message: message || "Unable to finish Google sign-in.",
      };
    default:
      return {
        eyebrow: "Access Error",
        title: "Something interrupted the sign-in flow.",
        description: "The request could not be completed as expected. Review the message on the right, then head back to the portal and try again.",
        cardEyebrow: "Request Error",
        cardTitle: "We could not finish that step",
        message: message || "Unknown error",
      };
  }
}

export default async function ErrorPage({ searchParams }) {
  const params = await searchParams;
  const reason = String(params?.reason || "").trim();
  const message = params?.msg || "";
  const content = resolveErrorContent(reason, message);

  return (
    <AuthShell
      eyebrow={content.eyebrow}
      title={content.title}
      description={content.description}
      cardEyebrow={content.cardEyebrow}
      cardTitle={content.cardTitle}
    >
      <p className="rounded-2xl border border-[#efd4c5] bg-white/80 px-4 py-4 text-sm leading-6 text-[#7b4f33]">
        {content.message}
      </p>

      <div className="mt-6 space-y-3 text-sm">
        <Link
          href="/portal"
          className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#232323] px-6 text-sm font-semibold uppercase tracking-[0.16em] text-white shadow-lg shadow-[#232323]/15 transition-all hover:-translate-y-0.5 hover:bg-[#E78B4B] active:translate-y-0"
        >
          Back to Sign In
        </Link>
        <Link
          href="/"
          className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[#d8c7b8] bg-white px-6 text-sm font-semibold uppercase tracking-[0.16em] text-[#6d584b] shadow-sm transition-colors hover:border-[#E78B4B] hover:text-[#241c18]"
        >
          View Live Inventory
        </Link>
      </div>
    </AuthShell>
  );
}
