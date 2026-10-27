import { useEffect, useState } from "preact/hooks";
import { ApiError, type DnsFilter, type Region, api } from "../api.ts";
import { resultOf, track } from "../analytics.ts";
import { useCtx } from "../context.ts";
import { type MessageKey, errorText, fmt } from "../i18n/index.ts";
import { generateKeyPair, generatePresharedKey } from "../keys.ts";
import { navigate } from "../router.ts";
import { type Platform, buildConfig, configFileName, detectPlatform, qrSvg } from "../wgconfig.ts";

const PLATFORMS: Platform[] = ["android", "apple", "windows"];
const FILTERS: DnsFilter[] = ["none", "malware", "ads"];
const IMPORT_STEPS: Record<Platform, number> = { android: 4, apple: 4, windows: 3 };
const POLL_MS = 2000;
const POLL_TRIES = 60;

type Step = "install" | "region" | "name" | "config";

export function NewDevice() {
  const { t, href } = useCtx();
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
    if (x instanceof ApiError && x.code === "signed_out") return navigate(href("/login/"), true);
    setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
  };

  useEffect(() => {
    api.regions().then(setRegions).catch(fail);
    track("device-step", { step: "install", platform });
  }, []);

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

  if (step === "install") {
    return (
      <section class="wrap narrow stack">
        {stepLabel(1)}
        <h1>{t["install.title"]}</h1>
        <p>{t["install.body"]}</p>
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
        {regions?.map((r) => (
          <button type="button" class="choice" disabled={!r.open}
            onClick={() => { setRegion(r.id); go("name"); }}>
            <span class="strong big">{t[`region.${r.id}` as MessageKey] ?? r.id}</span>
            <span class="muted small">{r.open ? t["pick.open"] : t["pick.closed"]}</span>
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
          <label for="device-name">{t["name.label"]}</label>
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
          <p class="muted small">{t["filter.doh"]}</p>
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
