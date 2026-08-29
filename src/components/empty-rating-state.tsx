import type { Messages } from "@/i18n/messages";

import { StatusPanelIcon } from "./game-icons";

export function EmptyRatingState({
  messages,
}: {
  messages: Messages["home"]["noActiveRating"];
}) {
  return (
    <section aria-labelledby="rating-status" className="card overflow-hidden">
      <div aria-hidden="true" className="flex h-2">
        <span className="w-3/4 bg-brand" />
        <span className="w-1/4 bg-accent" />
      </div>
      <div className="px-5 py-6 sm:px-7 sm:py-8">
        <span className="status-badge">
          <StatusPanelIcon aria-hidden="true" />
          {messages.status}
        </span>
        <h2
          id="rating-status"
          className="score-font mt-5 text-2xl leading-tight text-foreground sm:text-3xl"
        >
          {messages.title}
        </h2>
        <p className="mt-3 max-w-2xl leading-7 text-muted">
          {messages.description}
        </p>
        <p className="game-inset mt-6 border-l-4 border-l-accent p-4 text-sm font-semibold leading-6 text-foreground">
          {messages.privacy}
        </p>
      </div>
    </section>
  );
}
