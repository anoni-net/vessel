import { FLAGS } from "./images.ts";

/** The country of each city (region id), for its flag. */
export const COUNTRY: Record<string, keyof typeof FLAGS> = { sg: "sg", jp: "jp", tw: "tw" };

/**
 * Cities with no node yet that the service is talking to a host about. They are listed, greyed out, after the
 * real regions so people can see where Vessel is heading; once a node exists the region comes from the API.
 */
export const PLANNED = ["tw"];

export const flagOf = (region: string): string | undefined => {
  const country = COUNTRY[region];
  return country ? FLAGS[country] : undefined;
};
