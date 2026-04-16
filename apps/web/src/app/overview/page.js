import Link from "next/link";

export default function OverviewPage() {
  const routes = [
    {
      href: "/",
      eyebrow: "Public",
      title: "Live inventory viewer",
      body: "Customer-facing remnant browsing with filters, image preview, and public hold requests.",
    },
    {
      href: "/manage",
      eyebrow: "Private",
      title: "Management workspace",
      body: "Internal inventory workflow with hold review, status updates, editing, uploads, and crop tools.",
    },
    {
      href: "/admin",
      eyebrow: "Super Admin",
      title: "Database workspace",
      body: "Direct table editing for trusted operators without opening the codebase.",
    },
  ];

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f5efe7_0%,#efe6dc_28%,#e9edf3_100%)] px-6 py-10 text-[#1f2937]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[34px] border border-white/70 bg-[linear-gradient(135deg,rgba(18,31,51,0.96),rgba(42,64,95,0.88))] px-8 py-8 text-white shadow-[0_30px_90px_rgba(15,23,39,0.18)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#f7bf97]">
                Workspace Overview
              </p>
              <h1 className="font-display mt-3 max-w-3xl text-4xl font-semibold leading-tight">
                One app for public browsing, management, and super-admin work.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-200">
                Use this page as a quick overview of the main workspaces.
              </p>
            </div>
            <div className="rounded-[26px] border border-white/15 bg-white/10 p-5 text-sm text-slate-100 backdrop-blur">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ffd4b3]">Current State</p>
              <p className="mt-3 max-w-xs leading-6">
                One local Node server, live Supabase data, and connected public, private, and admin routes.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {routes.map((route) => (
            <article
              key={route.href}
              className="flex flex-col justify-between rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_18px_50px_rgba(31,41,55,0.08)]"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#a16235]">
                  {route.eyebrow}
                </p>
                <h2 className="font-display mt-3 text-xl font-semibold text-[#18212d]">{route.title}</h2>
                <p className="mt-3 text-sm leading-6 text-[#5d6a78]">{route.body}</p>
              </div>
              <Link
                href={route.href}
                className="mt-6 inline-flex h-11 items-center justify-center rounded-2xl bg-[#152238] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#f08b49]"
              >
                Open {route.href}
              </Link>
            </article>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-[28px] border border-white/70 bg-white/92 p-6 shadow-[0_18px_50px_rgba(31,41,55,0.08)]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#a16235]">
              Current Setup
            </p>
            <h2 className="font-display mt-3 text-2xl font-semibold text-[#18212d]">The app is set up for day-to-day use.</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-[22px] border border-[#eadfd7] bg-[#fff8f2] p-4 text-sm leading-6 text-[#5f5146]">
                The public viewer is live and reading the current remnant inventory.
              </div>
              <div className="rounded-[22px] border border-[#eadfd7] bg-[#fff8f2] p-4 text-sm leading-6 text-[#5f5146]">
                The private editor supports image uploads and crop preparation inside the React workflow.
              </div>
              <div className="rounded-[22px] border border-[#eadfd7] bg-[#fff8f2] p-4 text-sm leading-6 text-[#5f5146]">
                The admin workspace stays locked to `super_admin` and edits real DB tables through the backend API.
              </div>
              <div className="rounded-[22px] border border-[#eadfd7] bg-[#fff8f2] p-4 text-sm leading-6 text-[#5f5146]">
                Local development runs through one Next-driven Node server.
              </div>
            </div>
          </article>

          <article className="rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#fff7f0_0%,#fffdfb_100%)] p-6 shadow-[0_18px_50px_rgba(31,41,55,0.08)]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#a16235]">
              Focus
            </p>
            <h2 className="font-display mt-3 text-2xl font-semibold text-[#18212d]">Keep improving workflow depth and polish.</h2>
            <p className="mt-3 text-sm leading-7 text-[#5d6a78]">
              The biggest remaining value is workflow polish: deeper editor flows, image handling refinements, and day-to-day usability improvements.
            </p>
          </article>
        </section>
      </div>
    </main>
  );
}
