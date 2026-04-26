import AuthShell, {
  AUTH_INPUT_CLASS,
  AUTH_INPUT_STYLE,
  AUTH_LABEL_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_PRIMARY_BUTTON_STYLE,
  AuthActions,
} from "@/components/auth-shell";

export const metadata = {
  title: "Reset Password | Remnant System",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Password Reset"
      title={
        <>
          Send yourself a{" "}
          <span className="font-italic-accent text-[color:var(--qc-ink-2)]">
            secure link.
          </span>
        </>
      }
      description="Enter the email tied to your account and we'll send a secure password reset link so you can finish the process without waiting on manual help."
      cardEyebrow="Recovery email"
      cardTitle="Reset your password"
      cardDescription="We'll email a secure link so you can choose a new password and return to management."
    >
      <form method="POST" action="/api/auth/forgot-password" className="space-y-4">
        <div>
          <label htmlFor="forgot-email" className={AUTH_LABEL_CLASS}>
            Email
          </label>
          <div className="mt-2">
            <input
              id="forgot-email"
              type="email"
              name="email"
              placeholder="you@company.com"
              required
              className={AUTH_INPUT_CLASS}
              style={AUTH_INPUT_STYLE}
            />
          </div>
        </div>

        <button
          type="submit"
          className={AUTH_PRIMARY_BUTTON_CLASS}
          style={AUTH_PRIMARY_BUTTON_STYLE}
        >
          Send reset link
        </button>
      </form>

      <AuthActions
        primary={{ href: "/portal", label: "← Back to sign in" }}
        secondary={{ href: "/", label: "Back to live inventory" }}
      />
    </AuthShell>
  );
}
