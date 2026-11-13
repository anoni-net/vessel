// Asking for group accounts (toomore/anoni-net-ws#488): a group tells us its kind, size and how long it needs
// Vessel, and leaves a way to be reached, since the leaders' invite codes are handed over in person. It goes to
// the community's own form server through the same public API as the feedback page (feedback.ts), to two surveys
// of its own, zh-TW and en; the simplified Chinese page sends to the zh-TW one with locale zh-CN. Question ids
// (kind, size, period, inspect, group, message, contact) and the hidden fields (locale, rev) follow
// formbricks/vessel_group_survey.py in the community workspace. Choice questions store the option's text, so SENT
// below must match that file word for word; change both together. Nothing here is linked to a Vessel account, and
// none of it reaches the portal's database.
import type { FormPayload } from "./feedback.ts";
import type { Locale } from "./i18n/index.ts";
import { REV } from "./rev.ts";

const SURVEYS = { "zh-TW": "cmwf4myps000o01o3jpqwbuvj", en: "cmwf4mz79000p01o3dxvvofxh" } as const;

export const KINDS = ["civil", "media", "movement", "school", "event", "other"] as const;
export const SIZES = ["s", "m", "l", "xl"] as const;
export const PERIODS = ["event", "months", "long"] as const;
export const INSPECTS = ["yes", "no", "unsure"] as const;
export type GroupKind = (typeof KINDS)[number];
export type GroupSize = (typeof SIZES)[number];
export type GroupPeriod = (typeof PERIODS)[number];
export type GroupInspect = (typeof INSPECTS)[number];

// the option texts each survey stores, from formbricks/vessel_group_survey.py
export const SENT = {
  "zh-TW": {
    kind: { civil: "公民團體", media: "媒體", movement: "社運團隊", school: "學校或社團", event: "單次活動的團隊", other: "其他" },
    size: { s: "10 人以下", m: "10 到 30 人", l: "30 到 100 人", xl: "100 人以上" },
    period: { event: "單次活動，幾天到幾週", months: "幾個月", long: "長期" },
    inspect: { yes: "需要", no: "不需要", unsure: "還不確定" },
  },
  en: {
    kind: {
      civil: "Civil society group", media: "Newsroom or media", movement: "Campaign team", school: "School or student group",
      event: "Team for a single event", other: "Other",
    },
    size: { s: "Fewer than 10", m: "10 to 30", l: "30 to 100", xl: "More than 100" },
    period: { event: "A single event, days to weeks", months: "A few months", long: "Long term" },
    inspect: { yes: "Yes", no: "No", unsure: "Not sure yet" },
  },
} as const;

// the survey's limits
export const LIMITS = { group: 100, message: 2000, contact: 200 };

export interface GroupRequest {
  kind?: GroupKind;
  size?: GroupSize;
  period?: GroupPeriod;
  inspect?: GroupInspect;
  group: string;
  message: string;
  contact: string;
}

export const requestReady = (r: GroupRequest) => !!r.kind && !!r.size && !!r.period && r.contact.trim().length > 0;

/** Empty answers are left out. */
export function requestPayload(r: GroupRequest, locale: Locale): FormPayload {
  const survey = locale === "en" ? "en" : "zh-TW";
  const sent = SENT[survey];
  const data: Record<string, string> = {
    kind: sent.kind[r.kind!], size: sent.size[r.size!], period: sent.period[r.period!], contact: r.contact.trim(), locale,
  };
  if (r.inspect) data.inspect = sent.inspect[r.inspect];
  if (r.group.trim()) data.group = r.group.trim();
  if (r.message.trim()) data.message = r.message.trim();
  if (REV) data.rev = REV;
  return { surveyId: SURVEYS[survey], finished: true, data };
}
