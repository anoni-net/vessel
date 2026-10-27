import { useEffect, useState } from "preact/hooks";
import { useCtx } from "../context.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";
import type { Block, LegalDoc } from "../legal/types.ts";

const DOCS = import.meta.glob<{ default: LegalDoc }>("../legal/*.*.ts");

/** Terms and privacy: still drafts under review (#433), and the page says so. */
export function Legal({ doc, titleKey }: { doc: "terms" | "privacy"; titleKey: MessageKey }) {
  const { t, locale } = useCtx();
  const [content, setContent] = useState<LegalDoc | null>(null);
  useEffect(() => {
    setContent(null);
    DOCS[`../legal/${doc}.${locale}.ts`]?.().then((m) => setContent(m.default));
  }, [doc, locale]);
  return (
    <section class="wrap narrow legal">
      <h1>{t[titleKey]}</h1>
      <p class="card card--warn card--flat small">{t["legal.draft"]}</p>
      {content && (
        <>
          <p class="muted small">{fmt(t["legal.updated"], { date: content.updated })}</p>
          {content.blocks.map((b) => <LegalBlock block={b} />)}
        </>
      )}
    </section>
  );
}

function LegalBlock({ block }: { block: Block }) {
  if ("h" in block) return <h2>{block.h}</h2>;
  if ("p" in block) return <p><Inline text={block.p} /></p>;
  if ("ul" in block) return <ul>{block.ul.map((li) => <li><Inline text={li} /></li>)}</ul>;
  return (
    <div class="table-wrap">
      <table>
        <thead><tr>{block.table.head.map((h) => <th scope="col">{h}</th>)}</tr></thead>
        <tbody>{block.table.rows.map((r) => <tr>{r.map((c, i) => <td data-label={block.table.head[i]}><Inline text={c} /></td>)}</tr>)}</tbody>
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
