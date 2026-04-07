export default function MigrationPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f5efe7_0%,#efe6dc_28%,#e9edf3_100%)] px-6 py-10 text-[#1f2937]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="overflow-hidden rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,rgba(18,31,51,0.94),rgba(42,64,95,0.88))] px-8 py-8 text-white shadow-[0_30px_90px_rgba(15,23,39,0.18)]">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#f7bf97]">
            Migration Workspace
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight">
            The Next app now has a live public inventory route running against the legacy API.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-200">
            This page remains as the migration dashboard while the homepage becomes the first real React surface.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            "Public viewer migrated first",
            "Private workspace now live at /manage",
            "Super-admin workspace now live at /admin",
          ].map((item) => (
            <article
              key={item}
              className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_18px_50px_rgba(31,41,55,0.08)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#a16235]">
                Status
              </p>
              <h2 className="mt-3 text-xl font-semibold text-[#18212d]">{item}</h2>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
