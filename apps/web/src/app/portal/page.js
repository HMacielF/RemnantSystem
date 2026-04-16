import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import AuthShell, { AuthActions } from "@/components/auth-shell";
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
              className="h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-medium normal-case tracking-normal text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition-colors focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
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
              className="h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-medium normal-case tracking-normal text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition-colors focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
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
        <GoogleSignInButton />
      </div>

      <AuthActions
        primary={{ href: "/forgot-password", label: "Forgot your password?" }}
        secondary={{ href: "/", label: "Back to live inventory" }}
      />
    </AuthShell>
  );
}
