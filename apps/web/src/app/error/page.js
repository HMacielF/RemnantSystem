import Link from "next/link";
import AuthShell, {
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_PRIMARY_BUTTON_STYLE,
  AUTH_SECONDARY_BUTTON_CLASS,
  AUTH_SECONDARY_BUTTON_STYLE,
} from "@/components/auth-shell";

export const metadata = {
  title: "Access Error | Remnant System",
};

function resolveErrorContent(reason, message) {
  switch (reason) {
    case "missing_credentials":
      return {
        eyebrow: "Missing details",
        title: "Enter both your email and password.",
        description: "Both fields are required before the portal can try to sign you in.",
        cardEyebrow: "Missing information",
        cardTitle: "We need both fields",
        message: message || "Email and password are required.",
      };
    case "account_inactive":
      return {
        eyebrow: "Account inactive",
        title: "Your account is currently inactive.",
        description: "An administrator will need to reactivate this portal account before you can sign in again.",
        cardEyebrow: "Access status",
        cardTitle: "Account disabled",
        message: "This portal account exists, but it is marked inactive.",
      };
    case "invalid_login":
      return {
        eyebrow: "Sign-in failed",
        title: "That email or password didn't match.",
        description: "Try again, or use the password reset flow if you need a new one.",
        cardEyebrow: "Credential check",
        cardTitle: "We couldn't sign you in",
        message: "Check your email and password, then try again.",
      };
    case "oauth_start_failed":
      return {
        eyebrow: "Google sign-in",
        title: "Google sign-in could not start.",
        description: "The provider setup or redirect configuration is not ready yet. Review the message, then try again after setup is complete.",
        cardEyebrow: "OAuth setup",
        cardTitle: "Google login is unavailable",
        message: message || "Google sign-in is unavailable right now.",
      };
    case "oauth_callback_failed":
      return {
        eyebrow: "Google sign-in",
        title: "We couldn't finish your Google sign-in.",
        description: "The Google account was accepted, but the final callback into the portal did not complete. Review the message, then try again.",
        cardEyebrow: "OAuth callback",
        cardTitle: "Sign-in didn't finish",
        message: message || "Unable to finish Google sign-in.",
      };
    default:
      return {
        eyebrow: "Access error",
        title: "Something interrupted the sign-in flow.",
        description: "The request could not be completed as expected. Review the message on the right, then head back to the portal and try again.",
        cardEyebrow: "Request error",
        cardTitle: "We couldn't finish that step",
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
      <p
        className="font-italic-accent px-4 py-3 text-[14.5px] leading-[1.5] text-[color:var(--qc-status-sold-fg)]"
        style={{
          border: "1px solid var(--qc-line)",
          borderLeft: "2px solid var(--qc-status-sold-dot)",
          borderRadius: "var(--qc-radius-sharp)",
        }}
      >
        {content.message}
      </p>

      <div className="mt-5 space-y-3">
        <Link
          href="/portal"
          className={AUTH_PRIMARY_BUTTON_CLASS}
          style={AUTH_PRIMARY_BUTTON_STYLE}
        >
          ← Back to sign in
        </Link>
        <Link
          href="/"
          className={AUTH_SECONDARY_BUTTON_CLASS}
          style={AUTH_SECONDARY_BUTTON_STYLE}
        >
          View live inventory
        </Link>
      </div>
    </AuthShell>
  );
}
