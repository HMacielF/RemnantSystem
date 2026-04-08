import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import AuthShell, { AuthActions } from "@/components/auth-shell";
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
      title="Review and update live remnants in one place."
      description="Sign in to manage images, edit remnant details, and keep availability up to date without leaving the workspace."
      cardEyebrow="Account Access"
      cardTitle="Sign in"
      cardDescription="Access the management workspace to add remnants, update status, and maintain images."
    >
      <form method="POST" action="/api/auth/login" className="space-y-4">
        <div>
          <label
            htmlFor="portal-email"
            className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]"
          >
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
              className="h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-medium normal-case tracking-normal text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="portal-password"
            className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]"
          >
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
              className="h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-medium normal-case tracking-normal text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
            />
          </div>
        </div>

        <button
          type="submit"
          className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#232323] px-6 text-sm font-semibold uppercase tracking-[0.16em] text-white shadow-lg shadow-[#232323]/15 transition-all hover:-translate-y-0.5 hover:bg-[#E78B4B] active:translate-y-0"
        >
          Enter Workspace
        </button>
      </form>

      <div className="mt-5">
        <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
          <span className="h-px flex-1 bg-[#eadccf]" />
          <span>or</span>
          <span className="h-px flex-1 bg-[#eadccf]" />
        </div>
        <a
          href="/api/auth/google"
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-[#d8c7b8] bg-white px-6 text-sm font-semibold uppercase tracking-[0.12em] text-[#2d2623] shadow-sm transition hover:-translate-y-0.5 hover:border-[#E78B4B] hover:text-[#241c18]"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
            <path fill="#EA4335" d="M12 10.2v3.95h5.49c-.24 1.27-.96 2.34-2.04 3.06l3.3 2.56c1.92-1.77 3.03-4.38 3.03-7.48 0-.72-.06-1.42-.19-2.09z" />
            <path fill="#4285F4" d="M12 22c2.75 0 5.05-.91 6.73-2.47l-3.3-2.56c-.91.61-2.08.98-3.43.98-2.64 0-4.88-1.78-5.68-4.18H2.9v2.64A10 10 0 0 0 12 22z" />
            <path fill="#FBBC05" d="M6.32 13.77A5.99 5.99 0 0 1 6 12c0-.62.11-1.23.32-1.77V7.59H2.9A10 10 0 0 0 2 12c0 1.61.39 3.13 1.09 4.41z" />
            <path fill="#34A853" d="M12 6.05c1.49 0 2.82.51 3.87 1.5l2.9-2.9C17.04 3.03 14.75 2 12 2A10 10 0 0 0 2.9 7.59l3.42 2.64c.8-2.4 3.04-4.18 5.68-4.18z" />
          </svg>
          Continue With Google
        </a>
      </div>

      <AuthActions
        primary={{ href: "/forgot-password", label: "Forgot your password?" }}
        secondary={{ href: "/", label: "Back to live inventory" }}
      />
    </AuthShell>
  );
}
