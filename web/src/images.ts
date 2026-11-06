import { IS_ONION } from "./site.ts";

// Images are not kept in the repo. They live on assets.anoni.net under vessel/, named with a content hash so a
// new version gets a new URL past Cloudflare's cache; upload a changed image under its new name, then change it here.
// The onion site serves the same files at /vessel-assets/, so the onion build loads nothing from clearnet.
const BASE = IS_ONION ? "/vessel-assets/" : "https://assets.anoni.net/vessel/";
export const LOGO = `${BASE}logo-wordmark-tonal-5ed3576a.svg`;
// the same with the words in a light colour, for the dark scheme
export const LOGO_DARK = `${BASE}logo-wordmark-tonal-dark-318fa3cd.svg`;
export const FAVICON = `${BASE}favicon-48b9d7fc.svg`;

// Country flags from flag-icons 7.2.3 (MIT, Copyright (c) 2013 Panayiotis Lipiridis), 4:3. Images rather than
// emoji flags, which some systems swap or leave out (the flag of Taiwan among them).
export const FLAGS = {
  sg: `${BASE}flag-sg-25de9044.svg`,
  jp: `${BASE}flag-jp-bfea80ba.svg`,
  tw: `${BASE}flag-tw-931757f0.svg`,
} as const;
