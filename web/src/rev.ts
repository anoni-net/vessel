// The revision in the footer's title block and in feedback: the commit the pages are built from, and the day
// (the tests read these modules outside the build, where nothing is defined)
const full = typeof __REV__ === "string" ? __REV__ : "";

export const REV = full.slice(0, 7);
export const BUILT = typeof __BUILT__ === "string" ? __BUILT__ : "";
export const REV_URL = full ? `https://github.com/anoni-net/vessel/commit/${full}` : "";
