import { useEffect, useState } from "preact/hooks";
import { ApiError, type Me, api, last } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatDate } from "../format.ts";
import { errorText } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { setSignedIn } from "../session.ts";
import { Busy, SkCard, SkLine, Spin } from "./skeleton.tsx";

/** Links shown on the signed-in pages. */
export function AccountNav() {
  const { t, href } = useCtx();
  const [leaving, setLeaving] = useState(false);
  const logout = async () => {
    setLeaving(true);
    await api.logout().catch(() => undefined);
    setSignedIn(false);
    navigate(href("/"));
  };
  return (
    <nav class="subnav" aria-label={t["nav.account"]}>
      <a href={href("/devices/")}>{t["nav.devices"]}</a>
      <a href={href("/account/")}>{t["nav.account"]}</a>
      <button class="link-button" type="button" onClick={logout} disabled={leaving} aria-busy={leaving}>
        {leaving ? <><Spin />{t["busy.logout"]}</> : t["nav.logout"]}
      </button>
    </nav>
  );
}

export function Account() {
  const { t, href, locale } = useCtx();
  const [me, setMe] = useState<Me | null>(last.me ?? null);
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.me().then(setMe).catch((x) => {
      if (x instanceof ApiError && x.code === "signed_out") {
        setSignedIn(false);
        navigate(href("/login/"), true);
      }
      else setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    });
  }, []);

  const remove = async () => {
    setDeleting(true);
    try {
      await api.deleteAccount();
      navigate(href("/"));
    } catch (x) {
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
      setDeleting(false);
    }
  };

  if (err && !me) return <section class="wrap narrow"><p class="error" role="alert">{err}</p></section>;
  if (!me) {
    return (
      <section class="wrap narrow stack" aria-busy="true">
        <AccountNav />
        <h1>{t["account.title"]}</h1>
        <div class="stack" aria-hidden="true">
          <SkLine w="mid" />
          <SkLine w="mid" />
          <SkCard lines={["mid", "full", "long", "short"]} />
        </div>
        <Busy />
      </section>
    );
  }

  return (
    <section class="wrap narrow stack">
      <AccountNav />
      <h1>{t["account.title"]}</h1>
      <dl class="facts">
        <dt>{t["account.created"]}</dt>
        <dd>{formatDate(locale, me.created_on)}</dd>
        <dt>{t["account.lastLogin"]}</dt>
        <dd>{me.last_login_on ? formatDate(locale, me.last_login_on) : "-"}</dd>
      </dl>
      <div class="card card--warn card--flat stack">
        <h2>{t["account.deleteTitle"]}</h2>
        <p>{t["account.deleteBody"]}</p>
        <label class="check">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.currentTarget.checked)} />
          {t["account.deleteCheck"]}
        </label>
        {err && <p class="error" role="alert">{err}</p>}
        <button class="nb-button nb-button--danger" type="button" disabled={!sure || deleting} aria-busy={deleting} onClick={remove}>
          {deleting ? <><Spin />{t["busy.delete"]}</> : t["account.deleteSubmit"]}
        </button>
      </div>
    </section>
  );
}
