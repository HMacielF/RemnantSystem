import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import AuthShell, {
  AUTH_INPUT_CLASS,
  AUTH_INPUT_STYLE,
  AUTH_LABEL_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_PRIMARY_BUTTON_STYLE,
} from "@/components/auth-shell";
import GoogleSignInButton from "@/components/google-sign-in-button";
import { createOptionalAuthedContext } from "@/server/private-api";

export const metadata = {
  title: "Management Portal | Remnant System",
};

async function redirectIfAuthed() {
  const cookieStore = await cookies();
  const authContext = await createOptionalAuthedContext({
    cookies: {
      get(name) {
        return cookieStore.get(name);
      },
    },
  });

  if (authContext?.profile) {
    redirect("/manage");
  }
}

export default async function PortalPage() {
  await redirectIfAuthed();
  return (
    <AuthShell
      eyebrow="Management Portal"
      title={
        <>
          Keep the yard{" "}
          <span className="font-italic-accent text-[color:var(--qc-ink-2)]">
            online.
          </span>
        </>
      }
      description="Add remnants, update status, swap photos. Changes go live the moment you save — customers see the same inventory you do."
      liveStatus="Inventory live · realtime"
      cardEyebrow="Sign in"
      cardTitle="Welcome back."
    >
      <form method="POST" action="/api/auth/login" className="space-y-4">
        <div>
          <label htmlFor="portal-email" className={AUTH_LABEL_CLASS}>
            Email
          </label>
          <div suppressHydrationWarning className="mt-2">
            <input
              id="portal-email"
              type="email"
              name="email"
              placeholder="you@company.com"
              autoComplete="username"
              required
              className={AUTH_INPUT_CLASS}
              style={AUTH_INPUT_STYLE}
            />
          </div>
        </div>

        <div>
          <label htmlFor="portal-password" className={AUTH_LABEL_CLASS}>
            Password
          </label>
          <div suppressHydrationWarning className="mt-2">
            <input
              id="portal-password"
              type="password"
              name="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              required
              className={AUTH_INPUT_CLASS}
              style={AUTH_INPUT_STYLE}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 pt-1 text-[12.5px]">
          <label className="inline-flex items-center gap-2 text-[color:var(--qc-ink-2)]">
            <input
              type="checkbox"
              name="remember"
              defaultChecked
              className="h-3.5 w-3.5 accent-[color:var(--qc-ink-1)]"
            />
            Stay signed in
          </label>
          <Link
            href="/forgot-password"
            className="text-[color:var(--qc-ink-2)] hover:text-[color:var(--qc-ink-1)]"
            style={{
              textDecoration: "underline",
              textDecorationColor: "var(--qc-line-strong)",
              textUnderlineOffset: 4,
            }}
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          className={AUTH_PRIMARY_BUTTON_CLASS}
          style={AUTH_PRIMARY_BUTTON_STYLE}
        >
          Enter workspace
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="m13 5 7 7-7 7" />
          </svg>
        </button>
      </form>

      <div className="mt-6">
        <div className="flex items-center gap-3 text-[10.5px] uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
          <span className="h-px flex-1" style={{ backgroundColor: "var(--qc-line)" }} />
          <span>or</span>
          <span className="h-px flex-1" style={{ backgroundColor: "var(--qc-line)" }} />
        </div>
        <div className="mt-4">
          <GoogleSignInButton />
        </div>
      </div>

      <div
        className="mt-7 flex items-center justify-between gap-3 pt-5 text-[12px]"
        style={{ borderTop: "1px solid var(--qc-line)" }}
      >
        <span
          className="text-[color:var(--qc-ink-3)]"
          style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
        >
          Staff access only
        </span>
        <Link
          href="/"
          className="text-[color:var(--qc-ink-2)] hover:text-[color:var(--qc-ink-1)]"
          style={{
            textDecoration: "underline",
            textDecorationColor: "var(--qc-line-strong)",
            textUnderlineOffset: 4,
          }}
        >
          ← Back to inventory
        </Link>
      </div>
    </AuthShell>
  );
}
