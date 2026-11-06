// Two builds of the same pages: the clearnet portal at vessel.anoni.net, and the onion one at vessel.<onion>
// (`VESSEL_TARGET=onion`, anoni-net/vessel#147). vite.config.ts tells the code which with __VESSEL_ONION__. The tests
// import some modules in Node, where __VESSEL_ONION__ is not defined, hence the typeof.
//
// The onion build loads nothing from clearnet: no statistics, images from the onion site itself, feedback to the
// form server's onion address. Passkeys are bound to vessel.anoni.net and the connection check needs the visitor's
// own address, so the onion build explains both instead (passkey.ts, pages/check.tsx, pages/dns.tsx).

export const ONION_HOST = "anoninetru5tflukgfaehun7q6khowgmymcff3gtk5oyesqazhmfxtyd.onion";

export const IS_ONION = typeof __VESSEL_ONION__ !== "undefined" && __VESSEL_ONION__;

export const CLEARNET = "https://vessel.anoni.net";
export const ONION_SITE = `http://vessel.${ONION_HOST}`;

/** The community's home page and docs site; the onion build links to their onion sites, so readers stay on Tor. */
export const COMMUNITY_SITE = IS_ONION ? `http://${ONION_HOST}` : "https://anoni.net";
export const DOCS_SITE = IS_ONION ? `http://docs.${ONION_HOST}` : "https://anoni.net/docs";
