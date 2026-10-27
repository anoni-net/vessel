import { useCtx } from "../context.ts";
import type { MessageKey } from "../i18n/index.ts";

/** Terms and privacy: the drafts are still with legal review (#433), so these pages say so for now. */
export function Legal({ titleKey }: { titleKey: MessageKey }) {
  const { t } = useCtx();
  return (
    <section class="wrap narrow">
      <h1>{t[titleKey]}</h1>
      <p class="muted">{t["legal.draft"]}</p>
    </section>
  );
}

export function NotFound() {
  const { t, href } = useCtx();
  return (
    <section class="wrap narrow">
      <h1>{t["notFound.title"]}</h1>
      <p><a href={href("/")}>{t["notFound.home"]}</a></p>
    </section>
  );
}
