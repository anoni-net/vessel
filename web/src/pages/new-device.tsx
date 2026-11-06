import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../icons.tsx";
import { ApiError, type Device, type DnsFilter, type Me, type Region, type Relay, api, last } from "../api.ts";
import { resultOf, track } from "../analytics.ts";
import { useCtx } from "../context.ts";
import { formatBytes } from "../format.ts";
import { type MessageKey, errorText, fmt } from "../i18n/index.ts";
import { generateKeyPair, generatePresharedKey } from "../keys.ts";
import { PLANNED, flagOf, relayEntry } from "../regions.ts";
import { navigate } from "../router.ts";
import { setSignedIn } from "../session.ts";
import { faqAnchor } from "./faq.tsx";
import { FILTERS, Layers } from "./layers.tsx";
import { NewDeviceSkeleton, Spin } from "./skeleton.tsx";
import { type Platform, buildConfig, configFileName, detectPlatform, qrSvg } from "../wgconfig.ts";
import { saveFile } from "../save-file.ts";
import { IS_ONION } from "../site.ts";

const PLATFORMS: Platform[] = ["android", "apple", "windows"];
// the steps inside AmneziaWG, after the config is saved
const IMPORT_STEPS: Record<Platform, number> = { android: 3, apple: 3, windows: 2 };
const POLL_MS = 2000;
const POLL_TRIES = 60;

type Step = "install" | "region" | "name" | "filter" | "config";

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
  // the open relay routes, and the one picked (undefined: a direct connection to the region's node)
  const [relays, setRelays] = useState<Relay[]>([]);
  const [relay, setRelay] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  // the malware list rarely blocks a site by mistake, so new devices start protected; "connect only" stays one tap away
  const [filter, setFilter] = useState<DnsFilter>("malware");
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
    // an older backend has no relays: the page shows the cities alone
    api.relays().then((r) => setRelays(Array.isArray(r) ? r.filter((x) => x.open) : [])).catch(() => setRelays([]));
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
      const created = await api.createDevice({
        name, region, dns_filter: filter, public_key: keys.publicKey, preshared_key: psk, ...(relay ? { relay } : {}),
      });
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
      setConfig({ text: buildConfig(node, keys.privateKey, psk), file: configFileName(region, created.id, relay) });
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
    // two things to do, numbered (.todo): get the app, then come back; the longer notes open on request
    return (
      <section class="wrap narrow stack" key="install">
        {stepLabel(1)}
        <h1>{t["install.title"]}</h1>
        <p>{t["install.body"]}</p>
        <ol class="todo">
          <li class="todo__step">
            <h2 class="todo__title">{t["install.get"]}</h2>
            <div class="tabs" role="group" aria-label={t["install.platform"]}>
              {PLATFORMS.map((p) => (
                <button type="button" class={`tab${p === platform ? " tab--on" : ""}`} aria-pressed={p === platform}
                  onClick={() => setPlatform(p)}>{t[`platform.${p}`]}</button>
              ))}
            </div>
            {platform === "android" && (
              <>
                <a class="nb-button" href="https://play.google.com/store/apps/details?id=org.amnezia.awg"
                  target="_blank" rel="noopener">{t["install.android.store"]}</a>
                <a class="small strong" href="https://github.com/amnezia-vpn/amneziawg-android/releases/latest"
                  target="_blank" rel="noopener">{t["install.android.apk"]}</a>
              </>
            )}
            {platform === "apple" && (
              <>
                <a class="nb-button" href="https://apps.apple.com/app/id6478942365" target="_blank"
                  rel="noopener">{t["install.apple.store"]}</a>
                <p class="muted small">{t["install.apple.note"]}</p>
                <details class="todo__more">
                  <summary>{t["install.apple.missing"]}</summary>
                  <p class="small">{t["install.apple.missingBody"]}</p>
                </details>
              </>
            )}
            {platform === "windows" && (
              <>
                <a class="nb-button" href="https://github.com/amnezia-vpn/amneziawg-windows-client/releases/latest"
                  target="_blank" rel="noopener">{t["install.windows.download"]}</a>
                <p class="muted small">{t["install.windows.note"]}</p>
                <details class="todo__more">
                  <summary>{t["install.windows.blocked"]}</summary>
                  <p class="small">{t["install.windows.blockedBody"]}</p>
                </details>
              </>
            )}
          </li>
          <li class="todo__step">
            <h2 class="todo__title">{t["install.back"]}</h2>
            <button class="nb-button nb-button--ink" type="button" onClick={() => go("region")}>{t["install.next"]}</button>
            <p class="muted small">{t["install.update"]}</p>
          </li>
        </ol>
        <a class="center strong" href={href("/devices/")}>{t["cancel"]}</a>
        <ul class="plain install-more small">
          <li><a href={href("/learn/")}>{t["learn.link"]}</a></li>
          <li><a href={href(`/faq/#${faqAnchor("protocols")}`)}>{t["faq.protocols.q"]}</a></li>
        </ul>
      </section>
    );
  }

  if (step === "region") {
    return (
      <section class="wrap narrow stack" key="region">
        {stepLabel(2)}
        <h1>{t["pick.title"]}</h1>
        <p class="muted">{t["pick.body"]}</p>
        {errorLine}
        {regions && cityChoices(regions).map(({ id, state }) => (
          <button type="button" class="choice choice--city" disabled={state !== "open"} data-state={state}
            onClick={() => { setRegion(id); setRelay(undefined); go("name"); }}>
            {flagOf(id) && <img class="flag" src={flagOf(id)} alt="" width="32" height="24" />}
            <span class="choice__text">
              <span class="strong big">{t[`region.${id}` as MessageKey] ?? id}</span>
              <span class="muted small">{t[`pick.${state}`]}</span>
            </span>
          </button>
        ))}
        {/* relay routes, under the cities: the connection enters elsewhere and exits in the city shown */}
        {relays.length > 0 && (
          <div class="stack pick-relays" data-testid="relay-routes">
            <h2 class="pick-group">{t["pick.relays"]}</h2>
            <p class="muted small">{t["pick.relaysBody"]}</p>
            {relays.map((r) => {
              const city = t[`region.${r.region}` as MessageKey] ?? r.region;
              return (
                <button type="button" class="choice choice--city" data-state="open"
                  onClick={() => { setRegion(r.region); setRelay(r.id); go("name"); }}>
                  {flagOf(r.region) && <img class="flag" src={flagOf(r.region)} alt="" width="32" height="24" />}
                  <span class="choice__text">
                    <span class="strong big">{fmt(t["pick.relayRoute"], { entry: t[relayEntry(r.id)], city })}</span>
                    <span class="muted small">{fmt(t["pick.relayExit"], { city })}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <button class="link-button" type="button" onClick={() => go("install")}>{t["back"]}</button>
      </section>
    );
  }

  // Each step's section carries its own key, so a step change builds the new one instead of reusing the old one's
  // elements. The name and filter steps are both a form: without keys, the filter step's back button, reused as
  // the name step's submit button during the click, submitted that form and went straight back to the filter step.
  if (step === "name") {
    return (
      <section class="wrap narrow" key="name">
        <form class="stack" onSubmit={(e) => { e.preventDefault(); go("filter"); }}>
          {stepLabel(3)}
          <h1>{t["name.title"]}</h1>
          <label for="device-name" class="sr-only">{t["name.label"]}</label>
          <input id="device-name" class="nb-input" maxLength={40} required placeholder={t["name.placeholder"]}
            value={name} onInput={(e) => setName(e.currentTarget.value)} aria-describedby="name-hint" />
          <p id="name-hint" class="muted small">{t["name.hint"]}</p>
          <button class="nb-button nb-button--ink" type="submit">{t["name.next"]}</button>
          <button class="link-button" type="button" onClick={() => go("region")}>{t["back"]}</button>
        </form>
      </section>
    );
  }

  if (step === "filter") {
    return (
      <section class="wrap narrow" key="filter">
        <form class="stack" onSubmit={create}>
          {stepLabel(4)}
          <h1>{t["protect.title"]}</h1>
          <p>{t["protect.body"]}</p>
          <fieldset class="stack plain-fieldset">
            <legend class="sr-only">{t["protect.title"]}</legend>
            {FILTERS.map((f) => (
              <label class={`choice choice--radio choice--layer${f === filter ? " choice--on" : ""}`}>
                <input type="radio" name="filter" value={f} checked={f === filter} onChange={() => setFilter(f)} />
                <span class="choice__text">
                  <span class="choice__head">
                    <Layers filter={f} />
                    <span class="strong">{t[`protect.${f}`]}</span>
                    {f === "malware" && <span class="badge badge--active">{t["protect.recommended"]}</span>}
                  </span>
                  <span class="muted small">{t[`filter.${f}.desc`]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p class="muted small">
            {t["filter.doh"]}{" "}
            {/* a new tab, so the device being set up is not lost */}
            <a href={href("/dns/")} target="_blank" rel="noopener">{t["dns.link"]}</a>
          </p>
          {busy && <p class="muted" role="status">{t["config.waiting"]}</p>}
          {errorLine}
          <button class="nb-button nb-button--primary" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? <><Spin />{t["busy.create"]}</> : t["name.submit"]}
          </button>
          <button class="link-button" type="button" onClick={() => go("name")} disabled={busy}>{t["back"]}</button>
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
    saveFile(config.file, new Blob([config.text], { type: "application/octet-stream" }));
  };
  const steps = Array.from({ length: IMPORT_STEPS[platform] }, (_, i) => t[`import.${platform}.${i + 1}` as MessageKey]);

  return (
    <section class="wrap narrow stack">
      <p class="muted strong">{fmt(t["new.step"], { n: 5 })}</p>
      <h1>{t["config.title"]}</h1>
      {/* three things to do, numbered like the install step: save the config, import it, come back */}
      <ol class="todo">
        <li class="todo__step">
          <h2 class="todo__title">{t["config.get"]}</h2>
          <button class="nb-button" type="button" onClick={download}><Icon name="download" />{t["config.download"]}</button>
          <p class="card card--warn card--flat small">{t["config.warn"]}</p>
          {/* Onion Browser on iOS opens the file in a new tab instead of downloading it (save-file.ts) */}
          {IS_ONION && <p class="muted small">{t["config.onionSave"]}</p>}
        </li>
        <li class="todo__step">
          <h2 class="todo__title">{t["config.import"]}</h2>
          <ol class="steps">
            {steps.map((s) => <li>{s}</li>)}
          </ol>
          <div class="todo__links">
            <button class="link-button" type="button" aria-expanded={showQr} onClick={() => { if (!showQr) track("device-config", { how: "qr" }); setShowQr(!showQr); }}>
              {showQr ? t["config.qrHide"] : t["config.qrShow"]}
            </button>
            {showQr && (
              <>
                {/* generated locally from the config; nothing in it comes from outside this page */}
                <div class="qr card" role="img" aria-label={t["config.qrLabel"]} dangerouslySetInnerHTML={{ __html: qrSvg(config.text) }} />
                <p class="muted small">{t["config.onePerDevice"]}</p>
              </>
            )}
            <button class="link-button" type="button" aria-expanded={showText} onClick={() => { if (!showText) track("device-config", { how: "text" }); setShowText(!showText); }}>
              {showText ? t["config.textHide"] : t["config.textShow"]}
            </button>
            {showText && <pre class="config-text" data-testid="config-text">{config.text}</pre>}
          </div>
        </li>
        <li class="todo__step">
          <h2 class="todo__title">{t["config.back"]}</h2>
          <a class="nb-button nb-button--ink" href={href("/devices/")} onClick={() => track("device-config", { how: "done" })}>{t["config.done"]}</a>
          <p class="muted small">{t["config.expiry"]}</p>
        </li>
      </ol>
    </section>
  );
}
