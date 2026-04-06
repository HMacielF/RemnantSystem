import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative min-h-screen bg-[linear-gradient(180deg,#f8f2eb_0%,#efe4d9_100%)] text-[#2d2623]">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-120px] top-[-80px] h-[360px] w-[360px] rounded-full bg-[#f7dcc5]/70 blur-3xl" />
        <div className="absolute bottom-[-120px] right-[-80px] h-[360px] w-[360px] rounded-full bg-[#ead0bc]/70 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-6 py-10">
        <section className="w-full max-w-2xl rounded-[34px] border border-white/75 bg-white/82 p-8 text-center shadow-[0_20px_50px_rgba(73,49,31,0.12)] backdrop-blur sm:p-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#9c7355]">
            404
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#241c18] sm:text-5xl">
            That page does not exist.
          </h1>
          <p className="mt-5 text-base leading-7 text-[#6d584b]">
            The link may be outdated, typed incorrectly, or moved to a
            different route.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#232323] px-6 text-sm font-semibold uppercase tracking-[0.16em] text-white shadow-lg shadow-[#232323]/15 transition-all hover:-translate-y-0.5 hover:bg-[#E78B4B] active:translate-y-0"
            >
              Live Inventory
            </Link>
            <Link
              href="/portal"
              className="inline-flex h-12 items-center justify-center rounded-2xl border border-[#d7b198] bg-white px-6 text-sm font-semibold text-[#8f4c1a] shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#fff8f1] active:translate-y-0"
            >
              Management Portal
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
