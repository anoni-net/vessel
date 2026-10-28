import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, type Device, type DnsFilter, type Me, type Region, api, last } from "../api.ts";
import { resultOf, track } from "../analytics.ts";
import { useCtx } from "../context.ts";
import { formatBytes } from "../format.ts";
import { type MessageKey, errorText, fmt } from "../i18n/index.ts";
import { generateKeyPair, generatePresharedKey } from "../keys.ts";
import { PLANNED, flagOf } from "../regions.ts";
import { navigate } from "../router.ts";
import { setSignedIn } from "../session.ts";
import { faqAnchor } from "./faq.tsx";
import { NewDeviceSkeleton } from "./skeleton.tsx";
import { type Platform, buildConfig, configFileName, detectPlatform, qrSvg } from "../wgconfig.ts";

const PLATFORMS: Platform[] = ["android", "apple", "windows"];
const FILTERS: DnsFilter[] = ["none", "malware", "ads"];
const IMPORT_STEPS: Record<Platform, number> = { android: 4, apple: 4, windows: 3 };
const POLL_MS = 2000;
const POLL_TRIES = 60;

type Step = "install" | "region" | "name" | "config";

type Gate = "ok" | "limit" | "quota";

/**
 * Whether the account can add a device. The backend checks again when the device is created; this only spares
 * walking through the steps first. Unknown until both answers are in.
 */
function gateOf(me?: Me | null, devices?: Device[] | null): Gate | undefined {
  if (!me || !devices) return undefined;
  if (devices.filter((d) => d.status !== "revoking").length >= me.device_limit) return "limit";
  if (me.used_bytes >= me.monthly_quota_bytes) return "quota";
  return "ok";
}

type CityState = "open" | "closed" | "planned";

/** Open cities first, then the ones being set up, then the ones still in talks with a host. */
function cityChoices(regions: Region[]): { id: string; state: CityState }[] {
  const rank: Record<CityState, number> = { open: 0, closed: 1, planned: 2 };
  const known = new Set(regions.map((r) => r.id));
  return [
    ...regions.map((r) => ({ id: r.id, state: (r.open ? "open" : "closed") as CityState })),
    ...PLANNED.filter((id) => !known.has(id)).map((id) => ({ id, state: "planned" as CityState })),
  ].sort((a, b) => rank[a.state] - rank[b.state]);
}

export function NewDevice() {
  const { t, href, locale } = useCtx();
  const [me, setMe] = useState<Me | null>(last.me ?? null);
  const [gate, setGate] = useState<Gate | undefined>(() => gateOf(last.me, last.devices));
  // once a device is being created here, the page stays on its steps, even though the account is now full
  const started = useRef(false);
  const tracked = useRef(false);
  const [step, setStep] = useState<Step>("install");
  const [platform, setPlatform] = useState<Platform>(detectPlatform());
  const [regions, setRegions] = useState<Region[] | null>(null);
  const [region, setRegion] = useState("");
  const [name, setName] = useState("");
  const [filter, setFilter] = useState<DnsFilter>("none");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [config, setConfig] = useState<{ text: string; file: string } | null>(null);

  const fail = (x: unknown) => {
    if (x instanceof ApiError && x.code === "signed_out") {
      setSignedIn(false);
      return navigate(href("/login/"), true);
    }
    setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
  };

  useEffect(() => {
    api.regions().then(setRegions).catch(fail);
    Promise.all([api.me(), api.devices()]).then(([m, d]) => {
      setMe(m);
      if (!started.current) setGate(gateOf(m, d));
    }).catch((x) => {
      // without an answer, let them try: the backend still refuses a device over the limit
      setGate((g) => g ?? "ok");
      fail(x);
    });
  }, []);

  useEffect(() => {
    if (gate !== "ok" || tracked.current) return;
    tracked.current = true;
    track("device-step", { step: "install", platform });
  }, [gate]);

  // the private key lives only in this page; warn before it is lost
  useEffect(() => {
    if (!config) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [config]);

  const go = (s: Step) => {
    setErr("");
    setStep(s);
    track("device-step", { step: s, platform });
    window.scrollTo(0, 0);
  };

  const create = async (e: Event) => {
    e.preventDefault();
    started.current = true;
    setBusy(true);
    setErr("");
    const keys = generateKeyPair();
    const psk = generatePresharedKey();
    try {
      const created = await api.createDevice({ name, region, dns_filter: filter, public_key: keys.publicKey, preshared_key: psk });
      let node = created.config;
      for (let i = 0; !node && i < POLL_TRIES; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        node = (await api.deviceConfig(created.id)).config;
      }
      if (!node) {
        track("device-create", { result: "timeout", platform });
        setErr(errorText(t, "timeout"));
        return;
      }
      track("device-create", { result: "ok", platform });
      setConfig({ text: buildConfig(node, keys.privateKey, psk), file: configFileName(region, created.id) });
      go("config");
    } catch (x) {
      track("device-create", { result: resultOf(x), platform });
      fail(x);
    } finally {
      setBusy(false);
    }
  };

  const stepLabel = (n: number) => <p class="muted strong">{fmt(t["new.step"], { n })}</p>;
  const errorLine = err && <p class="error" role="alert">{err}</p>;

  if (gate === undefined) return <NewDeviceSkeleton />;
  if (gate !== "ok" && me && !started.current) {
    const full = gate === "limit";
    return (
      <section class="wrap narrow stack" data-testid="device-gate">
        <h1>{t[full ? "new.fullTitle" : "new.quotaTitle"]}</h1>
        <p>{fmt(t[full ? "new.fullBody" : "new.quotaBody"], { max: me.device_limit, quota: formatBytes(locale, me.monthly_quota_bytes) })}</p>
        <a class="nb-button nb-button--primary" href={href("/devices/")}>{t["new.back"]}</a>
      </section>
    );
  }

  if (step === "install") {
    return (
      <section class="wrap narrow stack">
        {stepLabel(1)}
        <h1>{t["install.title"]}</h1>
        <p>{t["install.body"]}</p>
        <p class="small"><a class="strong" href={href(`/faq/#${faqAnchor("protocols")}`)}>{t["faq.protocols.q"]}</a></p>
        <div class="tabs" role="group" aria-label={t["install.platform"]}>
          {PLATFORMS.map((p) => (
            <button type="button" class={`tab${p === platform ? " tab--on" : ""}`} aria-pressed={p === platform}
              onClick={() => setPlatform(p)}>{t[`platform.${p}`]}</button>
          ))}
        </div>
        <p class="muted small">{fmt(t["install.detected"], { platform: t[`platform.${detectPlatform()}`] })}</p>
        <div class="card stack">
          {platform === "android" && (
            <>
              <a class="nb-button nb-button--primary" href="https://play.google.com/store/apps/details?id=org.amnezia.awg"
                target="_blank" rel="noopener">{t["install.android.store"]}</a>
              <a class="center small strong" href="https://github.com/amnezia-vpn/amneziawg-android/releases/latest"
                target="_blank" rel="noopener">{t["install.android.apk"]}</a>
            </>
          )}
          {platform === "apple" && (
            <>
              <a class="nb-button nb-button--primary" href="https://apps.apple.com/app/id6478942365" target="_blank"
                rel="noopener">{t["install.apple.store"]}</a>
              <p class="small">{t["install.apple.note"]}</p>
            </>
          )}
          {platform === "windows" && (
            <>
              <a class="nb-button nb-button--primary" href="https://github.com/amnezia-vpn/amneziawg-windows-client/releases/latest"
                target="_blank" rel="noopener">{t["install.windows.download"]}</a>
              <p class="small">{t["install.windows.note"]}</p>
            </>
          )}
        </div>
        <button class="nb-button nb-button--ink" type="button" onClick={() => go("region")}>{t["install.next"]}</button>
        <a class="center strong" href={href("/devices/")}>{t["cancel"]}</a>
      </section>
    );
  }

  if (step === "region") {
    return (
      <section class="wrap narrow stack">
        {stepLabel(2)}
        <h1>{t["pick.title"]}</h1>
        <p class="muted">{t["pick.body"]}</p>
        {errorLine}
        {regions && cityChoices(regions).map(({ id, state }) => (
          <button type="button" class="choice choice--city" disabled={state !== "open"} data-state={state}
            onClick={() => { setRegion(id); go("name"); }}>
            {flagOf(id) && <img class="flag" src={flagOf(id)} alt="" width="32" height="24" />}
            <span class="choice__text">
              <span class="strong big">{t[`region.${id}` as MessageKey] ?? id}</span>
              <span class="muted small">{t[`pick.${state}`]}</span>
            </span>
          </button>
        ))}
        <button class="link-button" type="button" onClick={() => go("install")}>{t["back"]}</button>
      </section>
    );
  }

  if (step === "name") {
    return (
      <section class="wrap narrow">
        <form class="stack" onSubmit={create}>
          {stepLabel(3)}
          <h1>{t["name.title"]}</h1>
          <label for="device-name" class="strong">{t["name.label"]}</label>
          <input id="device-name" class="nb-input" maxLength={40} required placeholder={t["name.placeholder"]}
            value={name} onInput={(e) => setName(e.currentTarget.value)} aria-describedby="name-hint" />
          <p id="name-hint" class="muted small">{t["name.hint"]}</p>
          <fieldset class="stack plain-fieldset">
            <legend class="strong">{t["filter.title"]}</legend>
            {FILTERS.map((f) => (
              <label class={`choice choice--radio${f === filter ? " choice--on" : ""}`}>
                <input type="radio" name="filter" value={f} checked={f === filter} onChange={() => setFilter(f)} />
                <span>
                  <span class="strong">{t[`filter.${f}`]}</span>
                  <span class="muted small block">{t[`filter.${f}.desc`]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p class="muted small">
            {t["filter.doh"]}{" "}
            {/* a new tab, so the device being set up is not lost */}
            <a href={href("/dns/")} target="_blank" rel="noopener">{t["dns.link"]}</a>
          </p>
          <p class="card card--tint card--flat small">{t["name.keysNote"]}</p>
          {busy && <p class="muted" role="status">{t["config.waiting"]}</p>}
          {errorLine}
          <button class="nb-button nb-button--primary" type="submit" disabled={busy}>{t["name.submit"]}</button>
          <button class="link-button" type="button" onClick={() => go("region")} disabled={busy}>{t["back"]}</button>
        </form>
      </section>
    );
  }

  return <ConfigStep config={config!} platform={platform} />;
}

function ConfigStep({ config, platform }: { config: { text: string; file: string }; platform: Platform }) {
  const { t, href } = useCtx();
  const [showQr, setShowQr] = useState(false);
  const [showText, setShowText] = useState(false);
  const download = () => {
    track("device-config", { how: "download" });
    const url = URL.createObjectURL(new Blob([config.text], { type: "application/octet-stream" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: config.file });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const steps = Array.from({ length: IMPORT_STEPS[platform] }, (_, i) => t[`import.${platform}.${i + 1}` as MessageKey]);

  return (
    <section class="wrap narrow stack">
      <p class="muted strong">{fmt(t["new.step"], { n: 4 })}</p>
      <h1>{t["config.title"]}</h1>
      <button class="nb-button nb-button--primary" type="button" onClick={download}>{t["config.download"]}</button>
      <ol class="steps">
        {steps.map((s) => <li>{s}</li>)}
      </ol>
      <button class="link-button" type="button" aria-expanded={showQr} onClick={() => { if (!showQr) track("device-config", { how: "qr" }); setShowQr(!showQr); }}>
        {showQr ? t["config.qrHide"] : t["config.qrShow"]}
      </button>
      {showQr && (
        // generated locally from the config; nothing in it comes from outside this page
        <div class="qr card" role="img" aria-label={t["config.qrLabel"]} dangerouslySetInnerHTML={{ __html: qrSvg(config.text) }} />
      )}
      <button class="link-button" type="button" aria-expanded={showText} onClick={() => { if (!showText) track("device-config", { how: "text" }); setShowText(!showText); }}>
        {showText ? t["config.textHide"] : t["config.textShow"]}
      </button>
      {showText && <pre class="config-text" data-testid="config-text">{config.text}</pre>}
      <p class="card card--warn card--flat small">{t["config.warn"]}</p>
      <a class="nb-button nb-button--ink" href={href("/devices/")} onClick={() => track("device-config", { how: "done" })}>{t["config.done"]}</a>
    </section>
  );
}
