import { useCtx } from "../context.ts";
import type { MessageKey } from "../i18n/index.ts";

const GROUPS = {
  start: ["invite", "cost", "lost", "number", "share"],
  setup: ["app", "ios", "twoDevices", "newPhone", "filter", "trouble", "speed", "cities"],
  rules: ["expire", "quota", "p2p"],
  privacy: ["see", "law", "cloudflare", "delete"],
} as const;

type Question = (typeof GROUPS)[keyof typeof GROUPS][number];

// the home page shows these; the rest are on /faq/
const ON_HOME: Question[] = ["invite", "cost", "app", "ios", "lost", "twoDevices", "newPhone", "expire", "quota", "see"];

function Questions({ ids }: { ids: readonly Question[] }) {
  const { t } = useCtx();
  return (
    <div class="faq">
      {ids.map((id) => (
        <details class="faq__item">
          <summary>{t[`faq.${id}.q` as MessageKey]}</summary>
          <p>{t[`faq.${id}.a` as MessageKey]}</p>
        </details>
      ))}
    </div>
  );
}

export function HomeFaq() {
  const { t, href } = useCtx();
  return (
    <section id="faq" class="band band--grey">
      <div class="wrap">
        <h2>{t["faq.title"]}</h2>
        <Questions ids={ON_HOME} />
        <p class="faq__more"><a class="strong" href={href("/faq/")}>{t["faq.all"]}</a></p>
      </div>
    </section>
  );
}

export function Faq() {
  const { t } = useCtx();
  return (
    <section class="wrap faq-page">
      <h1>{t["faq.title"]}</h1>
      {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((g) => (
        <section>
          <h2>{t[`faq.group.${g}`]}</h2>
          <Questions ids={GROUPS[g]} />
        </section>
      ))}
    </section>
  );
}
