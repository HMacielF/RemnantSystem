export default function GoogleSignInButton({ next = "/manage" } = {}) {
  const href = `/api/auth/google?next=${encodeURIComponent(next)}`;

  return (
    <a
      href={href}
      className="font-inter inline-flex h-11 w-full items-center justify-center gap-2.5 bg-white px-5 text-[13px] font-medium text-[color:var(--qc-ink-1)] transition-colors hover:border-[color:var(--qc-ink-1)]"
      style={{
        border: "1px solid var(--qc-line)",
        borderRadius: "var(--qc-radius-sharp)",
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
        <path fill="#EA4335" d="M12 10.2v3.95h5.49c-.24 1.27-.96 2.34-2.04 3.06l3.3 2.56c1.92-1.77 3.03-4.38 3.03-7.48 0-.72-.06-1.42-.19-2.09z" />
        <path fill="#4285F4" d="M12 22c2.75 0 5.05-.91 6.73-2.47l-3.3-2.56c-.91.61-2.08.98-3.43.98-2.64 0-4.88-1.78-5.68-4.18H2.9v2.64A10 10 0 0 0 12 22z" />
        <path fill="#FBBC05" d="M6.32 13.77A5.99 5.99 0 0 1 6 12c0-.62.11-1.23.32-1.77V7.59H2.9A10 10 0 0 0 2 12c0 1.61.39 3.13 1.09 4.41z" />
        <path fill="#34A853" d="M12 6.05c1.49 0 2.82.51 3.87 1.5l2.9-2.9C17.04 3.03 14.75 2 12 2A10 10 0 0 0 2.9 7.59l3.42 2.64c.8-2.4 3.04-4.18 5.68-4.18z" />
      </svg>
      Continue with Google
    </a>
  );
}
