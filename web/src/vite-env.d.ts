/// <reference types="vite/client" />

/** The commit the pages are built from (empty when unknown) and the day of the build, from vite.config.ts. */
declare const __REV__: string;
declare const __BUILT__: string;
/** True in the onion build (VESSEL_TARGET=onion), see src/site.ts. */
declare const __VESSEL_ONION__: boolean;
