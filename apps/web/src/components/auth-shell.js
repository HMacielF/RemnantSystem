import Link from "next/link";

export default function AuthShell({
  eyebrow,
  title,
  description,
  cardEyebrow,
  cardTitle,
  cardDescription,
  children,
}) {
  return (
    <main className="relative min-h-screen bg-[linear-gradient(180deg,#f8f2eb_0%,#efe4d9_100%)] text-[#2d2623]">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-120px] top-[-80px] h-[360px] w-[360px] rounded-full bg-[#f7dcc5]/70 blur-3xl" />
        <div className="absolute bottom-[-120px] right-[-80px] h-[360px] w-[360px] rounded-full bg-[#ead0bc]/70 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1240px] items-center px-8 py-12 lg:px-12">
        <div className="grid w-full gap-10 lg:grid-cols-[minmax(0,1.08fr)_460px] lg:items-center">
          <section className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#9c7355]">
              {eyebrow}
            </p>
            <h1 className="mt-4 text-[2.85rem] font-semibold tracking-tight text-[#241c18] lg:text-[3.35rem]">
              {title}
            </h1>
            <p className="mt-5 max-w-2xl text-[1.02rem] leading-8 text-[#6d584b]">
              {description}
            </p>
          </section>

          <section className="max-w-[460px] rounded-[34px] border border-white/75 bg-white/82 p-8 shadow-[0_20px_50px_rgba(73,49,31,0.12)] backdrop-blur lg:ml-auto">
            <div className="rounded-[26px] border border-[#f0e0d4] bg-[#fff9f4] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9c7355]">
                {cardEyebrow}
              </p>
              <h2 className="mt-3 text-3xl font-semibold text-[#241c18]">
                {cardTitle}
              </h2>
              {cardDescription ? (
                <p className="mt-2 text-sm leading-6 text-[#6d584b]">
                  {cardDescription}
                </p>
              ) : null}
            </div>

            <div className="mt-6">{children}</div>
          </section>
        </div>
      </div>
    </main>
  );
}

export function AuthActions({ primary, secondary }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
      {primary ? (
        <Link
          href={primary.href}
          className="font-medium text-[#b85b1b] transition hover:text-[#8f4517]"
        >
          {primary.label}
        </Link>
      ) : (
        <span />
      )}
      {secondary ? (
        <Link
          href={secondary.href}
          className="font-medium text-[#6d584b] transition hover:text-[#2d2623]"
        >
          {secondary.label}
        </Link>
      ) : null}
    </div>
  );
}
