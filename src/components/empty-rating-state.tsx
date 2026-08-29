export function EmptyRatingState() {
  return (
    <section aria-labelledby="rating-status" className="card overflow-hidden">
      <div className="h-2 bg-[linear-gradient(90deg,var(--color-brand)_0_70%,var(--color-accent)_70%)]" />
      <div className="px-5 py-8 sm:px-8 sm:py-10">
        <span className="inline-flex min-h-8 items-center rounded-full bg-stone-100 px-3 text-xs font-bold uppercase tracking-wide text-muted">
          Voting closed
        </span>
        <h2 id="rating-status" className="mt-5 text-2xl font-bold">
          No active rating
        </h2>
        <p className="mt-2 max-w-lg leading-7 text-muted">
          The next rating will appear after a match. Only players who took part,
          plus the head coach, will be eligible for your ballot.
        </p>
        <p className="mt-6 border-l-4 border-accent pl-4 text-sm font-semibold">
          Results stay hidden while voting is open to keep every rating
          independent.
        </p>
      </div>
    </section>
  );
}
