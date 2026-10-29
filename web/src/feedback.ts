// Feedback: people tell us where they could not connect, where creating a device got stuck, or what they would
// like, and it goes to the community's own form server (Formbricks, form.anoni.net) through its public API for
// web pages, which needs no key. Vessel draws the form itself, so nobody has to meet another service.
//
// Formbricks has one survey for zh-TW and one for en; the simplified Chinese page sends to the zh-TW one with
// locale zh-CN. Question ids (kind, message, network, platform, city, contact) and the hidden fields (from,
// locale) follow formbricks/vessel_survey.py in the community workspace. Choice questions store the option's
// text, so SENT below must match that file word for word; change both together. Nothing here is linked to the
// Vessel account: no account number, device or key is sent.
import type { Locale } from "./i18n/index.ts";

const SURVEYS = { "zh-TW": "cmvrpvj5f001001o1wzcld0xe", en: "cmvrpvjmc001101o17lirnihu" } as const;

// the production environment of the Formbricks project; vite.config.ts and the nginx CSP allow only this path
export const FEEDBACK_ENDPOINT = "https://form.anoni.net/api/v1/client/cmc9borto0008lj014bq33jqq/responses";

export const KINDS = ["connect", "setup", "speed", "idea", "other"] as const;
export const NETWORKS = ["home", "mobile", "work", "public", "other"] as const;
export const PLATFORMS = ["android", "apple", "windows", "linux", "other"] as const;
export const CITIES = ["sg", "jp", "none"] as const;
export type Kind = (typeof KINDS)[number];
export type Network = (typeof NETWORKS)[number];
export type FeedbackPlatform = (typeof PLATFORMS)[number];
export type City = (typeof CITIES)[number];

// the option texts each survey stores, from formbricks/vessel_survey.py
export const SENT = {
  "zh-TW": {
    kind: { connect: "連不上或常斷線", setup: "建立裝置或匯入時卡住", speed: "速度太慢", idea: "建議或想要的功能", other: "其他" },
    network: { home: "家裡的網路", mobile: "行動網路", work: "學校或公司的網路", public: "咖啡店、旅館等公共 Wi-Fi", other: "其他" },
    platform: { android: "Android", apple: "iPhone 或 Mac", windows: "Windows", linux: "Linux", other: "其他" },
    city: { sg: "新加坡", jp: "東京", none: "還沒有裝置" },
  },
  en: {
    kind: {
      connect: "Cannot connect, or it keeps dropping",
      setup: "Stuck creating or importing a device",
      speed: "Too slow",
      idea: "A suggestion or a feature I want",
      other: "Other",
    },
    network: { home: "Home network", mobile: "Mobile data", work: "School or work network", public: "Public Wi-Fi, such as a café or hotel", other: "Other" },
    platform: { android: "Android", apple: "iPhone or Mac", windows: "Windows", linux: "Linux", other: "Other" },
    city: { sg: "Singapore", jp: "Tokyo", none: "No device yet" },
  },
} as const;

// the survey's limits
export const LIMITS = { messageMin: 10, message: 3000, contact: 200 };

export interface Feedback {
  kind?: Kind;
  message: string;
  network?: Network;
  platform?: FeedbackPlatform;
  city?: City;
  contact: string;
}

export const feedbackReady = (f: Feedback) => !!f.kind && f.message.trim().length >= LIMITS.messageMin;

/** `from`: the page the link came from, if it is one of ours. Empty answers are left out. */
export function feedbackPayload(f: Feedback, locale: Locale, from: string) {
  const survey = locale === "en" ? "en" : "zh-TW";
  const sent = SENT[survey];
  const data: Record<string, string> = { kind: sent.kind[f.kind!], message: f.message.trim(), locale };
  if (f.network) data.network = sent.network[f.network];
  if (f.platform) data.platform = sent.platform[f.platform];
  if (f.city) data.city = sent.city[f.city];
  if (f.contact.trim()) data.contact = f.contact.trim();
  if (FROM.includes(from)) data.from = from;
  return { surveyId: SURVEYS[survey], finished: true as const, data };
}

export const FROM = ["devices", "faq", "footer", "new-device", "home", "check"];

export type FeedbackResult = "sent" | "closed" | "network" | "other";

// no cookies or Referer, so the form server does not learn the page's address; 403 means the survey is closed
export async function sendFeedback(payload: ReturnType<typeof feedbackPayload>): Promise<FeedbackResult> {
  let res: Response;
  try {
    res = await fetch(FEEDBACK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
  } catch {
    return "network";
  }
  if (res.ok) return "sent";
  return res.status === 403 ? "closed" : "other";
}
