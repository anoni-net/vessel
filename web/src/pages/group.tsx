import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, type Group, type GroupAccount, type GroupDevice, type GroupIssue, type MadeGroupInvite, api } from "../api.ts";
import { announce } from "../announce.ts";
import { useCtx } from "../context.ts";
import { focusLater } from "../focus.ts";
import { formatDate, formatDay } from "../format.ts";
import { type MessageKey, errorText, fmt } from "../i18n/index.ts";
import { passkeysSupported } from "../passkey.ts";
import { navigate } from "../router.ts";
import { setSignedIn } from "../session.ts";
import { AccountNav } from "./account.tsx";
import { useReverify } from "./reverify.tsx";
import { Spin } from "./skeleton.tsx";

const ENDING_DAYS = 30;
const DAY_MS = 86_400_000;

type Ask = { kind: "device"; account: GroupAccount; device: GroupDevice } | { kind: "member"; account: GroupAccount };

/** The next aliases nobody has: A1, A2, ... after the highest in use, so a leader can leave them as they are. */
function nextLabels(taken: string[], n: number): string[] {
  const used = taken.map((l) => /^A(\d+)$/.exec(l)).filter(Boolean).map((m) => Number(m![1]));
  const from = used.length ? Math.max(...used) + 1 : 1;
  return Array.from({ length: n }, (_, i) => `A${from + i}`);
}

/** Copies, and when the browser will not, leaves the text on screen to select by hand. */
function CopyMessage({ text, label }: { text: string; label: string }) {
  const { t } = useCtx();
  const [state, setState] = useState<"idle" | "copied" | "shown">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      announce(t["group.message.copied"]);
    } catch {
      setState("shown");
    }
  };
  return (
    <>
      <button class="nb-button" type="button" onClick={copy} aria-label={`${t["group.message.copy"]}: ${label}`}>
        {state === "copied" ? t["group.message.copied"] : t["group.message.copy"]}
      </button>
      {state === "shown" && <textarea class="nb-input group-message" readOnly rows={5} value={text} aria-label={label} />}
    </>
  );
}

/**
 * Revoking cuts someone's connection, and they may be somewhere they cannot afford that, so one tap is never enough:
 * the first focus is on backing out, and the button that acts stays off until the box says this is the right one.
 */
function Confirm({ title, body, check, submit, busy, err, onCancel, onConfirm }: {
  title: string; body: string; check: string; submit: string; busy: boolean; err: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  const { t } = useCtx();
  const ref = useRef<HTMLDialogElement>(null);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} class="card verify-dialog stack" aria-labelledby="group-confirm-title" data-testid="group-confirm"
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
      // the browser may close it without a cancel event (Escape, before the page has seen a key or a tap)
      onClose={onCancel}>
      <h2 id="group-confirm-title">{title}</h2>
      <p>{body}</p>
      <label class="check">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.currentTarget.checked)} />
        {check}
      </label>
      {err && <p class="error" role="alert">{err}</p>}
      <button class="nb-button nb-button--ink" type="button" autoFocus onClick={onCancel} disabled={busy}>{t["group.keep"]}</button>
      <button class="nb-button nb-button--danger" type="button" onClick={onConfirm} disabled={!sure} aria-disabled={busy} aria-busy={busy}>
        {busy ? <><Spin />{t["busy.delete"]}</> : submit}
      </button>
    </dialog>
  );
}

export function GroupPage() {
  const { t, href, locale } = useCtx();
  const [group, setGroup] = useState<Group | null>(null);
  const [err, setErr] = useState("");
  const [hasPasskey, setHasPasskey] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [acting, setActing] = useState(false);
  const [askErr, setAskErr] = useState("");
  // the invite form: one alias per place being handed out; empty while it is closed
  const [labels, setLabels] = useState<string[]>([]);
  const [made, setMade] = useState<{ invites: MadeGroupInvite[]; days: number } | null>(null);
  const [inviteErr, setInviteErr] = useState("");
  const [making, setMaking] = useState(false);
  const madeCard = useRef<HTMLDivElement>(null);
  const { guard, dialog } = useReverify(hasPasskey);

  const load = () => api.group().then(setGroup).catch((x) => {
    if (x instanceof ApiError && x.code === "signed_out") {
      setSignedIn(false);
      return navigate(href("/login/"), true);
    }
    // a member, or a person with no group, who opened the address by hand
    if (x instanceof ApiError && x.code === "not_leader") return navigate(href("/devices/"), true);
    setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
  });

  useEffect(() => {
    void load();
    api.passkeys().then((p) => setHasPasskey(p.length > 0 && passkeysSupported())).catch(() => undefined);
  }, []);

  if (err) return <section class="wrap narrow"><p class="error" role="alert">{err}</p></section>;
  if (!group) return <section class="wrap narrow stack" aria-busy="true"><AccountNav leader /><h1>{t["group.title"]}</h1></section>;

  const day = (iso: string) => formatDate(locale, iso);
  const city = (id: string) => t[`region.${id}` as MessageKey] ?? id;
  const deviceName = (a: GroupAccount, d: GroupDevice) => fmt(t["group.device"], { label: a.label, name: d.name });
  const devicesLink = `${location.origin}${href("/devices/")}`;
  const message = (a: GroupAccount, d: GroupDevice, issue: GroupIssue) =>
    fmt(t[`group.message.${issue}`], { label: a.label, device: d.name, link: devicesLink });
  const members = group.accounts.filter((a) => a.role === "member");
  const leaders = group.accounts.filter((a) => a.role === "leader");
  const needs = group.accounts.flatMap((a) => a.devices.flatMap((d) => d.issues.map((issue) => ({ a, d, issue }))));
  const left = Math.ceil((Date.parse(group.ends_on) - Date.now()) / DAY_MS);

  const closeAsk = () => {
    setAsk(null);
    setAskErr("");
  };
  const act = async () => {
    if (!ask || acting) return;
    setActing(true);
    setAskErr("");
    const { account } = ask;
    const device = ask.kind === "device" ? ask.device : null;
    try {
      if (device) {
        await api.revokeGroupDevice(device.id);
        announce(fmt(t["group.revoke.done"], { device: deviceName(account, device) }));
      } else {
        await guard(() => api.removeGroupMember(account.label));
        announce(fmt(t["group.remove.done"], { label: account.label }));
      }
      closeAsk();
      await load();
      focusLater(() => document.querySelector("main h1"), true);
    } catch (x) {
      // backing out of confirming who they are leaves this dialog as it was
      if (!(x instanceof ApiError && x.code === "verify_cancelled")) {
        setAskErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
      }
    } finally {
      setActing(false);
    }
  };

  const taken = [...group.accounts.map((a) => a.label), ...group.invites.filter((i) => !i.expired).map((i) => i.label)];
  const openForm = () => {
    setInviteErr("");
    setLabels(nextLabels(taken, 1));
  };
  const addRow = () => setLabels((l) => [...l, nextLabels([...taken, ...l], 1)[0]]);
  const submitInvites = async (e: Event) => {
    e.preventDefault();
    if (making) return;
    setMaking(true);
    setInviteErr("");
    try {
      const result = await api.makeGroupInvites(labels);
      setMade(result);
      setLabels([]);
      await load();
      focusLater(() => madeCard.current);
    } catch (x) {
      setInviteErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      setMaking(false);
    }
  };
  const withdraw = async (id: number, label: string) => {
    setInviteErr("");
    try {
      await api.withdrawGroupInvite(id);
      announce(fmt(t["group.invites.withdrawn"], { label }));
      await load();
    } catch (x) {
      setInviteErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    }
  };

  return (
    <section class="wrap narrow stack group-page">
      <AccountNav leader />
      <h1>{t["group.title"]}</h1>
      {left <= ENDING_DAYS && (
        <p class="card card--warn card--flat" data-testid="group-ending">
          {left < 0 ? fmt(t["group.ended"], { date: day(group.ends_on) })
            : fmt(t["group.ending"], { date: day(group.ends_on), days: left })}
        </p>
      )}
      <dl class="facts">
        <dt>{t["group.code"]}</dt>
        <dd class="mono">{group.code}</dd>
        <dt>{t["group.endsOn"]}</dt>
        <dd>{day(group.ends_on)}</dd>
        <dt>{t["group.members"]}</dt>
        <dd data-testid="group-places">{fmt(t["group.membersValue"], { used: members.length, limit: group.account_limit, left: group.places_left })}</dd>
        <dt>{t["group.leaders"]}</dt>
        <dd data-testid="group-leaders">
          {leaders.map((a) => fmt(t["group.leaderJoined"], { label: a.label, date: day(a.joined_on) })).join(t["group.listSep"])}
        </dd>
      </dl>

      <div class="stack account-section" data-testid="group-needs">
        <h2>{t["group.needs.title"]}</h2>
        {needs.length === 0 ? <p>{t["group.needs.none"]}</p> : (
          <ul class="stack plain">
            {needs.map(({ a, d, issue }) => (
              <li class="card card--flat group-issue">
                <span>
                  <span class="strong">{deviceName(a, d)}</span>
                  <span class="muted small block">{t[`group.issue.${issue}`]}</span>
                </span>
                <CopyMessage text={message(a, d, issue)} label={deviceName(a, d)} />
              </li>
            ))}
          </ul>
        )}
        <p class="muted small">{t["group.needs.note"]}</p>
      </div>

      <div class="stack account-section" data-testid="group-accounts">
        <h2>{t["group.accounts.title"]}</h2>
        {[...members, ...leaders].map((a) => (
          <div class="card card--flat stack group-account" data-testid={`group-account-${a.label}`}>
            <div class="row">
              <span>
                <span class="strong big">{a.label}</span>{" "}
                {a.role === "leader" && <span class="badge">{t["group.role.leader"]}</span>}
                <span class="muted small block">{fmt(t["group.joined"], { date: day(a.joined_on) })}</span>
              </span>
              {a.role === "member" && (
                <button class="link-button" type="button" onClick={() => setAsk({ kind: "member", account: a })}>{t["group.remove"]}</button>
              )}
            </div>
            {a.devices.length === 0 ? <p class="muted small">{t["group.noDevices"]}</p> : (
              <ul class="stack-sm plain">
                {a.devices.map((d) => (
                  <li class="group-device">
                    <span>
                      <span class="strong">{d.name}</span>{" "}
                      <span class={`badge badge--${d.status}`}>{t[`status.${d.status}`]}</span>
                      <span class="muted small block">{city(d.region)} · {t[`filter.${d.dns_filter}`]}</span>
                    </span>
                    {d.status !== "revoking" && (
                      <button class="link-button" type="button" onClick={() => setAsk({ kind: "device", account: a, device: d })}
                        aria-label={`${t["group.revoke"]}: ${deviceName(a, d)}`}>{t["group.revoke"]}</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div class="stack account-section" data-testid="group-invites">
        <h2>{t["group.invites.title"]}</h2>
        {made && (
          <div class="card card--flat stack invite-made" data-testid="group-invites-made" ref={madeCard} tabIndex={-1}>
            <p class="strong">{fmt(t["group.invites.made"], { days: made.days })}</p>
            {made.invites.map((i) => {
              const link = `${location.origin}${href("/redeem/")}#${i.code}`;
              return (
                <div class="stack-sm">
                  <p class="strong">{i.label}</p>
                  <p class="mono number" data-testid="group-invite-code">{i.code}</p>
                  <p class="small invite-link">{link}</p>
                  <CopyMessage label={i.label}
                    text={fmt(t["group.invites.message"], { label: i.label, link, code: i.code, days: made.days })} />
                </div>
              );
            })}
            <button class="link-button" type="button" onClick={() => setMade(null)}>{t["group.invites.done"]}</button>
          </div>
        )}
        {labels.length > 0 ? (
          <form class="stack" onSubmit={submitInvites} data-testid="group-invite-form">
            <p class="muted small">{t["group.invites.aliasHint"]}</p>
            {labels.map((label, i) => (
              <div class="row group-invite-row">
                <input class="nb-input" required maxLength={40} value={label}
                  aria-label={fmt(t["group.invites.alias"], { n: i + 1 })}
                  onInput={(e) => { const v = e.currentTarget.value; setLabels((l) => l.map((x, j) => (j === i ? v : x))); }} />
                {labels.length > 1 && (
                  <button class="link-button" type="button" onClick={() => setLabels((l) => l.filter((_, j) => j !== i))}>{t["group.invites.removeRow"]}</button>
                )}
              </div>
            ))}
            {labels.length < group.places_left && (
              <button class="link-button" type="button" onClick={addRow}>{t["group.invites.add"]}</button>
            )}
            <button class="nb-button nb-button--ink" type="submit" aria-disabled={making} aria-busy={making}>
              {making ? <><Spin />{t["busy.invite"]}</> : t["group.invites.submit"]}
            </button>
            <button class="link-button" type="button" onClick={() => setLabels([])}>{t["group.invites.cancel"]}</button>
          </form>
        ) : group.places_left > 0 ? (
          <button class="nb-button nb-button--ink" type="button" onClick={openForm}>{t["group.invites.open"]}</button>
        ) : <p class="muted">{t["group.invites.none"]}</p>}
        {inviteErr && <p class="error" role="alert">{inviteErr}</p>}
        {group.invites.length > 0 && (
          <ul class="stack plain" data-testid="group-invites-list">
            {group.invites.map((i) => (
              <li class="card card--flat passkey-item">
                <span>
                  <span class="strong">{i.label}</span>{" "}
                  <span class="badge">{t[i.expired ? "group.invites.expired" : "group.invites.unused"]}</span>
                  <span class="muted small block">{fmt(t["group.invites.dates"], { made: formatDay(locale, i.created_at), until: formatDay(locale, i.expires_at) })}</span>
                </span>
                <button class="link-button" type="button" onClick={() => withdraw(i.id, i.label)}
                  aria-label={`${t["group.invites.withdraw"]}: ${i.label}`}>{t["group.invites.withdraw"]}</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {ask?.kind === "device" && (
        <Confirm busy={acting} err={askErr} onCancel={closeAsk} onConfirm={act}
          title={fmt(t["group.revoke.title"], { device: deviceName(ask.account, ask.device) })}
          body={t["group.revoke.body"]}
          check={fmt(t["group.revoke.check"], { device: deviceName(ask.account, ask.device) })}
          submit={t["group.revoke.submit"]} />
      )}
      {ask?.kind === "member" && (
        <Confirm busy={acting} err={askErr} onCancel={closeAsk} onConfirm={act}
          title={fmt(t["group.remove.title"], { label: ask.account.label })}
          body={t["group.remove.body"]}
          check={fmt(t["group.remove.check"], { label: ask.account.label })}
          submit={t["group.remove.submit"]} />
      )}
      {dialog}
    </section>
  );
}
