import { describe, expect, it } from 'vitest';
import { CATEGORIES, LOCATIONS } from '../../../src/config/tracking';
import { classifyCategory } from '../../../src/tracking/category';
import { formatSheetDate, isValidSheetDate } from '../../../src/tracking/date';
import { buildRow, escapeForSheets, validateEntry, type LogEntry } from '../../../src/tracking/row';

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  company: 'Acme Corp', category: 'SWE', location: 'montreal', date: '2026/10/04', channel: 'website',
  url: 'https://boards.greenhouse.io/acme/jobs/1', ...over,
});

describe('classifyCategory', () => {
  it.each([
    ['Backend Engineer', 'SWE'],
    ['Frontend Developer', 'SWE'],
    ['Full Stack Engineer', 'SWE'],
    ['Mobile Engineer (iOS)', 'SWE'],
    ['Infrastructure Engineer', 'SWE'],
    ['Data Engineer', 'SWE'],
    ['Software Engineer, New Grad', 'SWE'],
    ['Product Manager', 'PM'],
    ['Associate Product Manager', 'PM'],
    ['Senior Product Manager, Infrastructure', 'PM'],
    ['Technical Product Manager', 'PM'],
    ['APM Intern', 'PM'],
    ['Forward Deployed Engineer', 'FDE'],
    ['Forward-Deployed Software Engineer', 'FDE'],
    ['FDE, Public Sector', 'FDE'],
    ['Forward Deployed Product Manager', 'FDE'],
    ['Data Scientist', 'SWE'], // default
    ['', 'SWE'],
  ])('%s → %s', (title, expected) => expect(classifyCategory(title)).toBe(expected));

  it('only ever returns an allowed category', () => {
    for (const t of ['x', 'Product Manager', 'Forward Deployed Engineer', 'Janitor']) expect(CATEGORIES).toContain(classifyCategory(t));
  });
});

describe('dates', () => {
  it('formats local time as YYYY/MM/DD with zero padding', () => {
    expect(formatSheetDate(new Date(2026, 0, 5, 23, 59))).toBe('2026/01/05');
    expect(formatSheetDate(new Date(2026, 11, 31, 0, 1))).toBe('2026/12/31');
  });

  it('validates real calendar dates only', () => {
    expect(isValidSheetDate('2026/10/04')).toBe(true);
    expect(isValidSheetDate('2024/02/29')).toBe(true);
    expect(isValidSheetDate('2026/02/29')).toBe(false);
    expect(isValidSheetDate('2026-10-04')).toBe(false);
    expect(isValidSheetDate('2026/13/01')).toBe(false);
    expect(isValidSheetDate('')).toBe(false);
  });
});

describe('escapeForSheets', () => {
  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+1 Company', "'+1 Company"],
    ['-Dash Corp', "'-Dash Corp"],
    ['@mention Inc', "'@mention Inc"],
    ['=HYPERLINK("http://evil","x")', `'=HYPERLINK("http://evil","x")`],
    ['Acme', 'Acme'],
    ['Acme = Co', 'Acme = Co'], // only a leading character matters
    ['', ''],
  ])('%s', (input, expected) => expect(escapeForSheets(input)).toBe(expected));
});

describe('buildRow', () => {
  it('lays out columns A–H in the exact order, with C and G always empty', () => {
    expect(buildRow(entry())).toEqual([
      'Acme Corp', 'SWE', '', 'montreal', '2026/10/04', 'website', '', 'https://boards.greenhouse.io/acme/jobs/1',
    ]);
  });

  it('writes the date as plain YYYY/MM/DD text for USER_ENTERED parsing (no apostrophe)', () => {
    expect(buildRow(entry())[4]).toBe('2026/10/04');
  });

  it('prefixes formula-like company names so Sheets stores text', () => {
    const row = buildRow(entry({ company: '=cmd|calc' }));
    expect(row[0]).toBe("'=cmd|calc");
  });
});

describe('validateEntry', () => {
  it('accepts every allowed category and location, case-sensitively', () => {
    for (const category of CATEGORIES) expect(validateEntry(entry({ category })).ok).toBe(true);
    for (const location of LOCATIONS) expect(validateEntry(entry({ location })).ok).toBe(true);
  });

  it.each([
    ['usa', 'location'], ['Montreal', 'location'], ['TORONTO', 'location'], ['', 'location'], ['paris', 'location'],
  ])('rejects location %j', (location) => {
    expect(validateEntry({ ...entry(), location }).ok).toBe(false);
  });

  it.each(['swe', 'Engineer', ''])('rejects category %j', (category) => {
    expect(validateEntry({ ...entry(), category }).ok).toBe(false);
  });

  it('rejects empty company, bad dates, bad channels and non-http URLs', () => {
    expect(validateEntry(entry({ company: '  ' })).ok).toBe(false);
    expect(validateEntry(entry({ date: '2026-10-04' })).ok).toBe(false);
    expect(validateEntry({ ...entry(), channel: 'email' }).ok).toBe(false);
    expect(validateEntry(entry({ url: 'javascript:alert(1)' })).ok).toBe(false);
    expect(validateEntry(entry({ url: 'not a url' })).ok).toBe(false);
  });

  it('reports a message the card can show', () => {
    const r = validateEntry({ ...entry(), location: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('Pick a location');
  });
});
