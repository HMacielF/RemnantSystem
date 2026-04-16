import Link from "next/link";
import AuthShell from "@/components/auth-shell";

export const metadata = {
  title: "Check Your Email | Remnant System",
};

export default function PasswordResetSentPage() {
  return (
    <AuthShell
      eyebrow="Password Reset"
      title="Check your email."
      description="If the address is enrolled, a secure link is on the way so you can finish resetting or setting your password."
      cardEyebrow="Email Sent"
      cardTitle="Watch for the secure link"
      cardDescription="Open the message on the same device if possible, then follow the link to finish updating your password."
    >
      <div className="space-y-4 rounded-[26px] border border-[#f0e0d4] bg-[#fffdfb] p-5 text-sm leading-6 text-[#6d584b]">
        <p>
          If that email is enrolled, we sent a link to finish setting or
          resetting the password.
        </p>
        <p>
          The link will bring you back here so you can choose a new password
          securely.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link
          href="/portal"
          className="font-medium text-[#b85b1b] transition-colors hover:text-[#8f4517]"
        >
          Back to sign in
        </Link>
        <Link
          href="/forgot-password"
          className="font-medium text-[#6d584b] transition-colors hover:text-[#2d2623]"
        >
          Try a different email
        </Link>
      </div>
    </AuthShell>
  );
}
