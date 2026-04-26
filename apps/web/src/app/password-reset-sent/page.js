import Link from "next/link";
import AuthShell from "@/components/auth-shell";

export const metadata = {
  title: "Check Your Email | Remnant System",
};

export default function PasswordResetSentPage() {
  return (
    <AuthShell
      eyebrow="Password Reset"
      title={
        <>
          Check your{" "}
          <span className="font-italic-accent text-[color:var(--qc-ink-2)]">
            email.
          </span>
        </>
      }
      description="If the address is enrolled, a secure link is on the way so you can finish resetting or setting your password."
      cardEyebrow="Email sent"
      cardTitle="Watch for the secure link"
      cardDescription="Open the message on the same device if possible, then follow the link to finish updating your password."
    >
      <div
        className="space-y-3 p-4 text-[13px] leading-[1.6] text-[color:var(--qc-ink-2)]"
        style={{
          border: "1px solid var(--qc-line)",
          borderRadius: "var(--qc-radius-sharp)",
        }}
      >
        <p>If that email is enrolled, we sent a link to finish setting or resetting the password.</p>
        <p>The link will bring you back here so you can choose a new password securely.</p>
      </div>

      <div
        className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-5 text-[12px]"
        style={{ borderTop: "1px solid var(--qc-line)" }}
      >
        <Link
          href="/portal"
          className="text-[color:var(--qc-ink-2)] hover:text-[color:var(--qc-ink-1)]"
          style={{
            textDecoration: "underline",
            textDecorationColor: "var(--qc-line-strong)",
            textUnderlineOffset: 4,
          }}
        >
          ← Back to sign in
        </Link>
        <Link
          href="/forgot-password"
          className="text-[color:var(--qc-ink-3)] hover:text-[color:var(--qc-ink-1)]"
        >
          Try a different email
        </Link>
      </div>
    </AuthShell>
  );
}
