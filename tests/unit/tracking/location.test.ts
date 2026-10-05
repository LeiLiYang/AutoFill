import { describe, expect, it } from 'vitest';
import { classifyLocation } from '../../../src/tracking/location';

const cases = (rows: [string | string[], string | null][]) => rows;

describe('Rule 1: a single listed city → that city', () => {
  it.each(
    cases([
      ['Montréal, QC', 'montreal'],
      ['Montreal, QC, Canada', 'montreal'],
      ['Montreal', 'montreal'],
      ['Montréal (Hybrid)', 'montreal'],
      ['Montreal, Quebec', 'montreal'],
      ['Toronto, ON', 'toronto'],
      ['Toronto, Ontario, Canada', 'toronto'],
      ['Greater Toronto Area', 'toronto'],
      ['Vancouver, BC', 'vancouver'],
      ['Vancouver, British Columbia', 'vancouver'],
      ['London', 'london'],
      ['London, UK', 'london'],
      ['London, United Kingdom', 'london'],
      ['London, England', 'london'],
      ['Montreal, QC; Montréal, Quebec', 'montreal'], // duplicates collapse to one place
      ['Toronto, ON; Canada', 'toronto'], // a bare country next to a city adds nothing
      ['Hybrid - Toronto, ON', 'toronto'],
    ]),
  )('%s → %s', (input, expected) => expect(classifyLocation(input)).toBe(expected));
});

describe('Rule 2: a single unlisted Canadian location, or "Remote - Canada" → canada', () => {
  it.each(
    cases([
      ['Ottawa, ON', 'canada'],
      ['Calgary, AB', 'canada'],
      ['Waterloo, ON', 'canada'],
      ['Quebec City, QC', 'canada'],
      ['Victoria, BC', 'canada'],
      ['Halifax, Nova Scotia', 'canada'],
      ['London, ON', 'canada'], // London, Ontario is not London, UK
      ['Ontario', 'canada'],
      ['Canada', 'canada'],
      ['Remote - Canada', 'canada'],
      ['Remote (Canada)', 'canada'],
      ['Canada (Remote)', 'canada'],
      ['Remote, Canada', 'canada'],
    ]),
  )('%s → %s', (input, expected) => expect(classifyLocation(input)).toBe(expected));
});

describe('Rule 3: a single US location, or "Remote - US" → USA', () => {
  it.each(
    cases([
      ['San Francisco, CA', 'USA'],
      ['New York, NY', 'USA'],
      ['New York', 'USA'],
      ['Austin, TX', 'USA'],
      ['Seattle, WA', 'USA'],
      ['Washington, DC', 'USA'],
      ['Vancouver, WA', 'USA'], // Vancouver, Washington is not Vancouver, BC
      ['London, KY', 'USA'],
      ['Remote - US', 'USA'],
      ['Remote - United States', 'USA'],
      ['Remote, USA', 'USA'],
      ['United States', 'USA'],
      ['U.S. (Remote)', 'USA'],
      ['Bay Area', 'USA'],
    ]),
  )('%s → %s', (input, expected) => expect(classifyLocation(input)).toBe(expected));
});

describe('Rule 4: multiple cities all in one country → that country (canada or USA)', () => {
  it.each(
    cases([
      ['Toronto, ON; Vancouver, BC', 'canada'],
      ['Montreal, QC | Ottawa, ON', 'canada'],
      ['Toronto, ON, Montreal, QC', 'canada'], // comma-separated list of "city, province" pairs
      ['Toronto / Montreal / Vancouver', 'canada'],
      ['Ottawa, ON; Calgary, AB', 'canada'],
      ['San Francisco, CA; New York, NY', 'USA'],
      ['Austin, TX or Seattle, WA', 'USA'],
      ['San Francisco, CA, New York, NY, Seattle, WA', 'USA'],
      [['Boston, MA', 'Chicago, IL'], 'USA'],
    ]),
  )('%s → %s', (input, expected) => expect(classifyLocation(input)).toBe(expected));
});

describe('Rule 5: multiple countries → canada', () => {
  it.each(
    cases([
      ['Toronto, ON; San Francisco, CA', 'canada'],
      ['New York, NY; London, UK', 'canada'],
      ['Canada; United States', 'canada'],
      ['Remote - US or Canada', 'canada'],
      ['London, UK; Berlin, Germany', 'canada'],
      ['Montreal, QC; Austin, TX; London, UK', 'canada'],
    ]),
  )('%s → %s', (input, expected) => expect(classifyLocation(input)).toBe(expected));
});

describe('no rule applies → null (the user must pick)', () => {
  it.each(
    cases([
      ['', null],
      ['Remote', null],
      ['Anywhere', null],
      ['Hybrid', null],
      ['Berlin, Germany', null],
      ['Sydney, Australia', null],
      ['United Kingdom', null],
      ['Manchester, UK', null],
      ['Manchester, UK; Edinburgh, UK', null], // all one country, but only canada/USA exist
      ['Remote, Europe', null],
      ['Atlantis', null],
      ['Toronto, ON; Atlantis', null], // cannot tell whether the countries differ
      ['Remote, CA', null], // ambiguous: California or Canada
    ]),
  )('%j → %s', (input, expected) => expect(classifyLocation(input)).toBe(expected));

  it('handles null and undefined', () => {
    expect(classifyLocation(null)).toBeNull();
    expect(classifyLocation(undefined)).toBeNull();
  });
});

describe('outputs are always one of the allowed strings, case-sensitive', () => {
  it('returns "USA" in upper case and everything else in lower case', () => {
    expect(classifyLocation('Austin, TX')).toBe('USA');
    expect(classifyLocation('Austin, TX')).not.toBe('usa');
    expect(classifyLocation('Toronto, ON')).not.toBe('Toronto');
  });
});
