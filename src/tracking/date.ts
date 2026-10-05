/** Today in local time as the text YYYY/MM/DD (what Sheets parses as a date with USER_ENTERED). */
export function formatSheetDate(d: Date = new Date()): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** True for a real calendar date written YYYY/MM/DD. */
export function isValidSheetDate(s: string): boolean {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}
