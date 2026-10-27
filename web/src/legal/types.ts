/**
 * Terms and privacy policy, one file per document and language, loaded only on their page.
 * Text may hold [label](url) links; paths starting with "/" get the page's locale prefix.
 */
export type Block = { h: string } | { p: string } | { ul: string[] } | { table: { head: string[]; rows: string[][] } };

export interface LegalDoc {
  updated: string;
  blocks: Block[];
}
