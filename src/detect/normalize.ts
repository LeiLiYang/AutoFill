/** Lowercase, strip diacritics, drop punctuation, collapse whitespace. */
export function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split camelCase / snake / bracket attribute names into lowercase words. */
export function attrWords(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.[\]:]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip trailing "required"/asterisk markers that sites append to labels. */
export function cleanLabel(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\(?\s*required\s*\)?\s*$/i, '')
    .replace(/[*✱]+/g, '')
    .trim();
}
