import { useState } from "preact/hooks";
import { useCtx } from "../context.ts";
import { SAMPLE_SPAN, sampleCheck, sampleThreat } from "../sample-report.ts";
import { ReportView } from "./inspect.tsx";

// What an inspection report shows, before anyone has one (toomore/anoni-net-ws#480): the report page's own view of a
// made-up report, so the sample can never drift from the real thing, with notes between its parts. Two cases: a phone
// like most, and one with stalkerware. Every card says it is a sample, so that a screenshot of one does not pass for
// someone's report. Nothing is fetched and nothing can be downloaded.
const CASES = { check: sampleCheck, threat: sampleThreat } as const;
type Case = keyof typeof CASES;

export function SampleReport() {
  const { t, href, locale } = useCtx();
  const [which, setWhich] = useState<Case>("check");
  const note = (id: "verdict" | "findings" | "details") => (
    <aside class="sample-note" data-testid={`sample-note-${id}`}>
      <p class="sample-note__title">{t[`sample.note.${id}.title`]}</p>
      <p>{t[`sample.note.${id}.body`]}</p>
    </aside>
  );
  return (
    <section class="wrap narrow stack inspect-page sample-page">
      <h1>{t["sample.title"]}</h1>
      <p class="lead">{t["sample.lead"]}</p>
      <p class="card card--warn card--flat" data-testid="sample-fake">{t["sample.fake"]}</p>
      <div class="stack">
        <div class="actions sample-cases" role="group" aria-label={t["sample.cases"]}>
          {(Object.keys(CASES) as Case[]).map((c) => (
            <button type="button" class={`nb-button${which === c ? " nb-button--primary" : ""}`} aria-pressed={which === c}
              onClick={() => setWhich(c)} data-testid={`sample-case-${c}`}>
              {t[`sample.case.${c}`]}
            </button>
          ))}
        </div>
        <p data-testid="sample-case-body">{t[`sample.case.${which}.body`]}</p>
      </div>
      <div class="inspect-wide">
        <ReportView key={which} report={CASES[which]()} locale={locale} span={SAMPLE_SPAN} sample={t["sample.mark"]}
          notes={{ verdict: note("verdict"), findings: note("findings"), details: note("details") }} />
      </div>
      <div class="card card--flat stack" data-testid="sample-start">
        <h2>{t["sample.start.title"]}</h2>
        <p>{t["sample.start.personal"]}</p>
        <p>{t["sample.start.group"]}</p>
        <div class="actions">
          <a class="nb-button nb-button--primary" href={href("/devices/")}>{t["home.devices"]}</a>
          <a class="nb-button" href={href("/for-groups/")}>{t["home.groups.link"]}</a>
        </div>
        <p class="small"><a href={href("/privacy/#inspection")}>{t["sample.start.privacy"]}</a></p>
      </div>
    </section>
  );
}
