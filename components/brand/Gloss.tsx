import Link from "next/link";

/**
 * bhakta.us: Huible wordmark. Upstream was "Gloss" + a together.ai maker link;
 * we brand the fork with Huible in EB Garamond (the Huible site face) and drop
 * the third-party lockup entirely.
 */

/** Lines of text with a note in the margin: the whole idea in 24px. */
export function GlossMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M3 6.5h10.5M3 11.5h10.5M3 16.5h6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18.5 3v18" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.32" />
      <circle cx="18.5" cy="11.5" r="2.9" fill="var(--rubric)" />
    </svg>
  );
}

/** The wordmark, set in the Huible brand serif. */
export function GlossWordmark() {
  return (
    <span className="flex h-9 items-center gap-[7px] text-ink">
      <GlossMark className="size-[21px] shrink-0" />
      <span className="block translate-y-[2px] font-serif text-[21px] font-[440] leading-[21px] tracking-[-0.018em] [font-variation-settings:'opsz'_36]">
        Huible
      </span>
    </span>
  );
}

/** The app's mark. Logo click returns to the reader's library. */
export function Lockup({ href = "/library" }: { href?: string }) {
  return (
    <div className="flex h-9 items-center gap-3.5 max-[380px]:gap-2.5">
      <Link href={href} aria-label="Huible, back to your library" className="rounded-md">
        <GlossWordmark />
      </Link>
    </div>
  );
}
