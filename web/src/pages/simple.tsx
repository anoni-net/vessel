import { useEffect, useState } from "preact/hooks";
import { useCtx } from "../context.ts";
import { type Locale, type MessageKey, fmt } from "../i18n/index.ts";
import type { Block, LegalDoc } from "../legal/types.ts";
import { Busy, SkLine } from "./skeleton.tsx";

const DOCS = import.meta.glob<{ default: LegalDoc }>("../legal/*.*.ts");
const LEGAL_PATHS: Record<string, "terms" | "privacy"> = { "/terms/": "terms", "/privacy/": "privacy" };
const loaded = new Map<string, LegalDoc>();
const keyOf = (doc: string, locale: Locale) => `../legal/${doc}.${locale}.ts`;

/** Load the document a page shows before rendering it, so the prerendered HTML and the first render agree. */
export async function preloadLegal(locale: Locale, path: string): Promise<void> {
  const doc = LEGAL_PATHS[path];
  if (!doc) return;
  const key = keyOf(doc, locale);
  const mod = await DOCS[key]?.();
  if (mod) loaded.set(key, mod.default);
}

/** Terms and privacy: still drafts under review (#433), and the page says so. */
export function Legal({ doc, titleKey }: { doc: "terms" | "privacy"; titleKey: MessageKey }) {
  const { t, locale } = useCtx();
  const [content, setContent] = useState<LegalDoc | null>(loaded.get(keyOf(doc, locale)) ?? null);
  useEffect(() => {
    const key = keyOf(doc, locale);
    const ready = loaded.get(key);
    if (ready) return setContent(ready);
    setContent(null);
    DOCS[key]?.().then((m) => {
      loaded.set(key, m.default);
      setContent(m.default);
    });
  }, [doc, locale]);
  return (
    <section class="wrap narrow legal legal-page">
      <h1>{t[titleKey]}</h1>
      <p class="card card--warn card--flat small">{t["legal.draft"]}</p>
      {content ? (
        <>
          <p class="muted small">{fmt(t["legal.updated"], { date: content.updated })}</p>
          <div class="legal-layout">
            <nav class="legal-toc" aria-label={t["legal.toc"]} data-testid="legal-toc">
              <p class="legal-toc__title">{t["legal.toc"]}</p>
              <ul class="plain">
                {content.blocks.map((b, i) => "h" in b && <li><a href={`#${b.id ?? `section-${i}`}`}>{b.h}</a></li>)}
              </ul>
            </nav>
            <div class="legal-body">
              {content.blocks.map((b, i) => <LegalBlock block={b} index={i} />)}
            </div>
          </div>
        </>
      ) : (
        <div class="stack" aria-busy="true">
          <div class="stack" aria-hidden="true">
            <SkLine w="short" />
            <SkLine w="mid" big />
            <SkLine />
            <SkLine />
            <SkLine w="long" />
            <SkLine w="mid" big />
            <SkLine />
            <SkLine w="mid" />
          </div>
          <Busy />
        </div>
      )}
    </section>
  );
}

function LegalBlock({ block, index }: { block: Block; index: number }) {
  if ("h" in block) return <h2 id={block.id ?? `section-${index}`}>{block.h}</h2>;
  if ("p" in block) return <p><Inline text={block.p} /></p>;
  if ("ul" in block) return <ul>{block.ul.map((li) => <li><Inline text={li} /></li>)}</ul>;
  return (
    <div class="table-wrap">
      {/* explicit roles: on phones the CSS makes the rows blocks, and browsers then drop the table's semantics */}
      <table role="table">
        <thead role="rowgroup"><tr role="row">{block.table.head.map((h) => <th role="columnheader" scope="col">{h}</th>)}</tr></thead>
        <tbody role="rowgroup">{block.table.rows.map((r) => <tr role="row">{r.map((c, i) => <td role="cell" data-label={block.table.head[i]}><Inline text={c} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

function Inline({ text }: { text: string }) {
  const { href } = useCtx();
  const out: preact.ComponentChildren[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    out.push(text.slice(last, m.index));
    const [, label, url] = m;
    out.push(url!.startsWith("/")
      ? <a href={href(url!)}>{label}</a>
      : url!.startsWith("mailto:") ? <a href={url}>{label}</a>
      : <a href={url} target="_blank" rel="noopener">{label}</a>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
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
