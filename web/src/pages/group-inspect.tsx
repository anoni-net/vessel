import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, type Group, type GroupAccount, type GroupDevice, type InspectionSummary, api } from "../api.ts";
import { announce } from "../announce.ts";
import { useCtx } from "../context.ts";
import { formatDate } from "../format.ts";
import { type MessageKey, errorText, fmt } from "../i18n/index.ts";
import { isKey, keepLeaderKey, leaderKey, newKey, openSummary, publicOf } from "../inspection-key.ts";
import { progress } from "../inspection-progress.ts";
import { Spin } from "./skeleton.tsx";

// A leader asks for an inspection of a member's device (toomore/anoni-net-ws#483). The member agrees and confirms on
// the device; the leader's page shows where it stands, and a summary sealed to the leader's own key: the verdict and
// the kinds of finding. The sites, the counts and the hours are the member's.

const DAY_MS = 86_400_000;

type Guard = <T>(task: () => Promise<T>) => Promise<T>;

/** The leader's key in this browser, if it is the one the portal has. */
export function useLeaderKey(group: Group | null) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => setLocal(leaderKey()), []);
  const matches = !!(local && group?.leader_key && publicOf(local) === group.leader_key);
  return { local, setLocal, matches };
}

/** Where the leader's key stands, and making, copying or putting it back. Shown where the group can ask for inspections. */
export function LeaderKeyCard({ group, local, matches, setLocal, guard, reload }: {
  group: Group; local: string | null; matches: boolean; setLocal: (k: string) => void; guard: Guard; reload: () => Promise<unknown>;
}) {
  const { t } = useCtx();
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const make = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    const { key, publicKey } = newKey();
    try {
      await guard(() => api.setGroupKey(publicKey));
      keepLeaderKey(key);
      setLocal(key);
      setMade(key);
      await reload();
      announce(t["group.inspect.key.saved"]);
    } catch (x) {
      if (!(x instanceof ApiError && x.code === "verify_cancelled")) setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      setBusy(false);
    }
  };
  const restore = (e: Event) => {
    e.preventDefault();
    const key = typed.trim();
    if (isKey(key) && publicOf(key) === group.leader_key) {
      keepLeaderKey(key);
      setLocal(key);
      setTyped("");
      setWrong(false);
      announce(t["group.inspect.key.saved"]);
    } else {
      setWrong(true);
      field.current?.focus();
    }
  };

  return (
    <div class="card card--flat stack" data-testid="group-key">
      <h3>{t["group.inspect.key.title"]}</h3>
      {made ? (
        <>
          <p class="small">{t["group.inspect.key.made"]}</p>
          <code class="inspect-key" data-testid="group-key-value">{made}</code>
          <CopyText text={made} label={t["group.inspect.key.copy"]} />
        </>
      ) : matches ? (
        <>
          <p class="small">{t["group.inspect.key.ready"]}</p>
          <CopyText text={local!} label={t["group.inspect.key.copy"]} />
        </>
      ) : group.leader_key ? (
        <form class="stack" onSubmit={restore}>
          <p class="small">{t["group.inspect.key.missing"]}</p>
          <label class="stack small">{t["group.inspect.key.label"]}
            <input class="nb-input" ref={field} value={typed} autoComplete="off" spellcheck={false}
              onInput={(e) => setTyped(e.currentTarget.value)} aria-invalid={wrong}
              aria-describedby={wrong ? "group-key-wrong" : undefined} data-testid="group-key-input" />
          </label>
          {wrong && <p class="error" role="alert" id="group-key-wrong">{t["group.inspect.key.wrong"]}</p>}
          <button class="nb-button" type="submit">{t["group.inspect.key.restore"]}</button>
          <button class="link-button" type="button" onClick={make} aria-busy={busy}>{busy && <Spin />}{t["group.inspect.key.replace"]}</button>
        </form>
      ) : (
        <>
          <p class="small">{t["group.inspect.key.none"]}</p>
          <button class="nb-button nb-button--ink" type="button" onClick={make} aria-disabled={busy} aria-busy={busy}>
            {busy && <Spin />}{t["group.inspect.key.make"]}
          </button>
        </>
      )}
      {err && <p class="error" role="alert">{err}</p>}
    </div>
  );
}

function CopyText({ text, label }: { text: string; label: string }) {
  const { t } = useCtx();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      announce(t["group.message.copied"]);
    } catch {
      /* the text is on screen, or can be shown again, to select */
    }
  };
  return <button class="nb-button" type="button" onClick={copy}>{copied ? t["group.message.copied"] : label}</button>;
}

/** The summary of one inspection, opened with the leader's key. */
function Summary({ sealed, local }: { sealed: NonNullable<NonNullable<GroupDevice["inspection"]>["summary"]>; local: string | null }) {
  const { t } = useCtx();
  const [summary, setSummary] = useState<InspectionSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const ours = !!local && publicOf(local) === sealed.key;
  useEffect(() => {
    setSummary(null);
    setFailed(false);
    if (!ours || !sealed.sealed) return;
    openSummary<InspectionSummary>(sealed.sealed, local!).then(setSummary).catch(() => setFailed(true));
  }, [sealed.sealed?.ct, local]);

  if (!ours) return <p class="muted small" data-testid="group-summary-locked">{t["group.inspect.otherKey"]}</p>;
  if (!sealed.sealed) return <p class="muted small">{t["group.inspect.pending"]}</p>;
  if (failed) return <p class="muted small" data-testid="group-summary-locked">{t["group.inspect.otherKey"]}</p>;
  if (!summary) return null;
  if (summary.empty || !summary.verdict) return <p class="muted small" data-testid="group-summary">{t["group.inspect.empty"]}</p>;
  const kinds = (summary.kinds ?? []).map((k) => t[`inspect.kind.${k.kind}` as MessageKey] ?? k.kind);
  return (
    <div class={`stack-sm group-summary group-summary--${summary.verdict}`} data-testid="group-summary" data-verdict={summary.verdict}>
      <p class="strong">{t[`group.inspect.verdict.${summary.verdict}`]}</p>
      {kinds.length > 0 && <p class="small">{fmt(t["group.inspect.kinds"], { kinds: kinds.join(t["group.listSep"]) })}</p>}
      {summary.coverage && (
        <p class="muted small">{fmt(t["group.inspect.coverage"], { active: summary.coverage.active_hours, total: summary.coverage.total_hours })}</p>
      )}
    </div>
  );
}

/**
 * Where a device's inspection stands on the leader's page, with what the leader can do about it: ask, withdraw, or
 * clear a no or a deletion off the page. One the member agreed to is the member's to end.
 */
export function DeviceInspection({ group, account, device, local, ready, reload, name }: {
  group: Group; account: GroupAccount; device: GroupDevice; local: string | null; ready: boolean;
  reload: () => Promise<unknown>; name: string;
}) {
  const { t, locale, href } = useCtx();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const it = device.inspection ?? null;
  const limit = group.inspection_limit ?? 0;
  const day = (iso: string) => formatDate(locale, iso);
  const days = group.inspection_days ?? 7;

  const run = async (task: () => Promise<unknown>, said: string) => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await task();
      announce(said);
      await reload();
    } catch (x) {
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      setBusy(false);
    }
  };

  if (!it) {
    // asking needs the feature, the key in this browser, a device in use and room under the limit
    if (!limit || !ready || device.status !== "active" || group.closing_on || (group.inspections_in_use ?? 0) >= limit) return null;
    return (
      <div class="group-inspection">
        <button class="link-button" type="button" aria-busy={busy} aria-label={`${t["group.inspect.ask"]}: ${name}`}
          onClick={() => run(() => api.requestInspection(device.id), fmt(t["group.inspect.asked"], { device: name }))}>
          {busy && <Spin />}{t["group.inspect.ask"]}
        </button>
        {err && <p class="error small" role="alert">{err}</p>}
      </div>
    );
  }

  let line: string;
  if (it.status === "requested") line = fmt(t["group.inspect.status.requested"], { date: day(it.until!) });
  else if (it.status === "active") line = fmt(t["group.inspect.status.active"], progress({ ends_at: it.ends_at, days }));
  else if (it.status === "ended") line = fmt(t["group.inspect.status.ended"], { date: day(it.report_until!) });
  else line = t[`group.inspect.status.${it.status}`];
  const ran = it.ended_early && it.started_at && it.stopped_at
    ? Math.max(1, Math.ceil((Date.parse(it.stopped_at) - Date.parse(it.started_at)) / DAY_MS)) : null;
  const message = it.status === "requested"
    ? fmt(t["group.inspect.message"], { label: account.label, device: device.name, link: `${location.origin}${href("/devices/")}`, date: day(it.until!) })
    : null;

  return (
    <div class="stack-sm group-inspection" data-testid={`group-inspection-${device.id}`} data-status={it.status}>
      <p class="small"><span class="strong">{t["group.inspect.label"]}</span>{t["group.inspect.sep"]}{line}</p>
      {ran && <p class="small">{fmt(t["group.inspect.endedEarly"], { n: ran })}</p>}
      {(it.status === "active" || it.status === "ending" || it.status === "ended") && (
        it.summary ? <Summary sealed={it.summary} local={local} /> : <p class="muted small" data-testid="group-summary-none">{t["group.inspect.noSummary"]}</p>
      )}
      {it.status === "active" && <p class="muted small">{t["group.inspect.partial"]}</p>}
      <div class="row group-inspection__actions">
        {message && <CopyText text={message} label={t["group.message.copy"]} />}
        {it.status === "requested" && (
          <button class="link-button" type="button" aria-busy={busy} aria-label={`${t["group.inspect.withdraw"]}: ${name}`}
            onClick={() => run(() => api.withdrawInspection(device.id), fmt(t["group.inspect.withdrawn"], { device: name }))}>
            {t["group.inspect.withdraw"]}
          </button>
        )}
        {(it.status === "declined" || it.status === "deleted") && (
          <button class="link-button" type="button" aria-busy={busy} aria-label={`${t["group.inspect.clear"]}: ${name}`}
            onClick={() => run(() => api.withdrawInspection(device.id), fmt(t["group.inspect.cleared"], { device: name }))}>
            {t["group.inspect.clear"]}
          </button>
        )}
        {(it.status === "ended" || it.status === "declined" || it.status === "deleted") && limit > 0 && ready
          && device.status === "active" && !group.closing_on && (group.inspections_in_use ?? 0) < limit && (
          <button class="link-button" type="button" aria-busy={busy} aria-label={`${t["group.inspect.askAgain"]}: ${name}`}
            onClick={() => run(() => api.requestInspection(device.id), fmt(t["group.inspect.asked"], { device: name }))}>
            {t["group.inspect.askAgain"]}
          </button>
        )}
      </div>
      {err && <p class="error small" role="alert">{err}</p>}
    </div>
  );
}
