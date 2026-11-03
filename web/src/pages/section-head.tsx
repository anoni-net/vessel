import { useCtx } from "../context.ts";

/** A section's heading with a short English label at the right, as on a drawing's title block; the label is an aid
 * beside the Chinese name, so the English pages leave it out. */
export function SectionHead({ title, en }: { title: string; en: string }) {
  const { locale } = useCtx();
  return (
    <div class="section-head">
      <h2>{title}</h2>
      {locale !== "en" && <span class="eyebrow" aria-hidden="true">{en}</span>}
    </div>
  );
}
