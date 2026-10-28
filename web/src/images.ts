// Images are not kept in the repo. They live on assets.anoni.net under vessel/, named with a content hash so a
// new version gets a new URL past Cloudflare's cache; upload a changed image under its new name, then change it here.
export const LOGO = "https://assets.anoni.net/vessel/logo-wordmark-tonal-5ed3576a.svg";
export const FAVICON = "https://assets.anoni.net/vessel/favicon-48b9d7fc.svg";

// Country flags from flag-icons 7.2.3 (MIT, Copyright (c) 2013 Panayiotis Lipiridis), 4:3. Images rather than
// emoji flags, which some systems swap or leave out (the flag of Taiwan among them).
export const FLAGS = {
  sg: "https://assets.anoni.net/vessel/flag-sg-25de9044.svg",
  jp: "https://assets.anoni.net/vessel/flag-jp-bfea80ba.svg",
  tw: "https://assets.anoni.net/vessel/flag-tw-931757f0.svg",
} as const;
