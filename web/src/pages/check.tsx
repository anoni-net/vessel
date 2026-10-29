import { useState } from "preact/hooks";
import { useCtx } from "../context.ts";
import { type Exit, encodeCheck, exitCheck, exitText, passed } from "../connection.ts";
import { type Verdict, runCheck } from "../dnscheck.ts";

type Result = { exit: Exit; dns: Verdict };

export function Check() {
  const { t, href } = useCtx();
  const [state, setState] = useState<"idle" | "running" | Result>("idle");
  const run = async () => {
    setState("running");
    const [exit, dns] = await Promise.all([exitCheck(), runCheck()]);
    setState({ exit, dns });
  };
  const result = typeof state === "object" ? state : null;
  return (
    <section class="wrap narrow stack">
      <h1>{t["check.title"]}</h1>
      <p class="lead">{t["check.lead"]}</p>

      <div class="card card--tint stack" data-testid="connection-check">
        <button class="nb-button nb-button--primary" type="button" onClick={run} disabled={state === "running"}>
          {state === "running" ? t["check.running"] : result ? t["check.again"] : t["check.button"]}
        </button>
        {result && (
          <>
            <dl class="check-results">
              <div>
                <dt>{t["check.exit"]}</dt>
                <dd data-testid="check-exit">{exitText(t, result.exit)}</dd>
              </div>
              <div>
                <dt>{t["check.dns"]}</dt>
                <dd data-testid="check-dns">{t[`dns.check.${result.dns}`]}</dd>
              </div>
            </dl>
            <p class="strong" role="status">{passed(result.exit, result.dns) ? t["check.ok"] : t["check.problem"]}</p>
            <a class="nb-button" href={href(`/feedback/?from=check&check=${encodeCheck(result.exit, result.dns)}`)}>
              {t["check.feedback"]}
            </a>
          </>
        )}
        <p class="muted small">{t["check.privacy"]}</p>
      </div>

      <h2>{t["check.next.title"]}</h2>
      <h3>{t["check.next.exit.title"]}</h3>
      <p>{t["check.next.exit.body"]}</p>
      <p class="small"><a href={href("/faq/#q-androidVpn")}>{t["faq.androidVpn.q"]}</a></p>
      <h3>{t["check.next.dns.title"]}</h3>
      <p>{t["check.next.dns.body"]}</p>
      <p class="small"><a href={href("/dns/")}>{t["dns.link"]}</a></p>
      <h3>{t["check.next.sites.title"]}</h3>
      <p>{t["check.next.sites.body"]}</p>
    </section>
  );
}
