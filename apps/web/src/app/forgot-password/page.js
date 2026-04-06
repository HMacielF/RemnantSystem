import AuthShell, { AuthActions } from "@/components/auth-shell";

export const metadata = {
  title: "Reset Password | Remnant System",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Password Reset"
      title="Send yourself a secure link and get back into the workspace."
      description="Enter the email tied to your account and we will send a secure password reset link so you can finish the process without waiting on manual help."
      cardEyebrow="Recovery Email"
      cardTitle="Reset your password"
      cardDescription="We will email a secure link so you can choose a new password and return to management."
    >
      <form method="POST" action="/api/auth/forgot-password" className="space-y-4">
        <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
          Email
          <input
            type="email"
            name="email"
            placeholder="you@company.com"
            required
            className="mt-2 h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-medium normal-case tracking-normal text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
          />
        </label>

        <button
          type="submit"
          className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#232323] px-6 text-sm font-semibold uppercase tracking-[0.16em] text-white shadow-lg shadow-[#232323]/15 transition-all hover:-translate-y-0.5 hover:bg-[#E78B4B] active:translate-y-0"
        >
          Send Reset Link
        </button>
      </form>

      <AuthActions
        primary={{ href: "/portal", label: "Back to sign in" }}
        secondary={{ href: "/", label: "Back to live inventory" }}
      />
    </AuthShell>
  );
}
