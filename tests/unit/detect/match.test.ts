import { describe, expect, it } from 'vitest';
import { matchField } from '../../../src/detect/match';
import { descriptors } from '../helpers';

const matchOf = (html: string) => {
  const d = descriptors(html)[0]!;
  return matchField(d);
};

describe('matchField: attributes first', () => {
  it('uses autocomplete tokens with highest confidence', () => {
    const m = matchOf('<label for="x">Whatever</label><input id="x" autocomplete="given-name">');
    expect(m).toMatchObject({ key: 'firstName', rule: 'attrs:firstName' });
    expect(m!.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it.each([
    ['job_application[first_name]', 'firstName'],
    ['job_application[last_name]', 'lastName'],
    ['job_application[email]', 'email'],
    ['job_application[phone]', 'phone'],
    ['urls[LinkedIn]', 'linkedin'],
    ['urls[GitHub]', 'github'],
    ['urls[Portfolio]', 'portfolio'],
    ['org', 'currentCompany'],
    ['name', 'fullName'],
  ])('name=%s → %s', (name, key) => {
    expect(matchOf(`<input name="${name}">`)?.key).toBe(key);
  });
});

describe('matchField: labels', () => {
  it.each([
    ['First Name *', 'firstName'],
    ['Legal first name', 'firstName'],
    ['Surname', 'lastName'],
    ['Full name', 'fullName'],
    ['Email address', 'email'],
    ['Mobile phone number', 'phone'],
    ['LinkedIn Profile', 'linkedin'],
    ['Personal website', 'portfolio'],
    ['Postal code', 'postalCode'],
    ['Province', 'region'],
    ['Country', 'country'],
    ['Are you legally authorized to work in Canada?', 'authorizedToWork'],
    ['Will you now or in the future require visa sponsorship?', 'requiresSponsorship'],
    ['Are you willing to relocate?', 'willingToRelocate'],
    ['Earliest start date', 'startDate'],
    ['Current company', 'currentCompany'],
    ['Gender', 'gender'],
    ['Are you Hispanic/Latino?', 'hispanicLatino'],
    ['Veteran status', 'veteran'],
    ['Disability status', 'disability'],
  ])('%s → %s', (label, key) => {
    const m = matchOf(`<label for="x">${label}</label><input id="x" type="text">`);
    expect(m?.key).toBe(key);
    expect(m!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('does not treat phone country code or LinkedIn-company as a plain match', () => {
    expect(matchOf('<label for="x">Phone country code</label><input id="x">')?.key).not.toBe('phone');
    expect(matchOf('<label for="x">Company website</label><input id="x">')?.key).not.toBe('portfolio');
  });

  it('matches resume and cover letter only on file inputs', () => {
    expect(matchOf('<label for="x">Resume/CV</label><input id="x" type="file">')?.key).toBe('resume');
    expect(matchOf('<label for="x">Cover letter</label><input id="x" type="file">')?.key).toBe('coverLetter');
    expect(matchOf('<label for="x">Resume</label><input id="x" type="text">')?.key).not.toBe('resume');
  });
});

describe('matchField: fuzzy, nearby and free text', () => {
  it('fuzzy-matches a typo with reduced confidence', () => {
    const m = matchOf('<label for="x">Fisrt Name</label><input id="x">');
    expect(m?.key).toBe('firstName');
    expect(m!.rule).toMatch(/^fuzzy/);
    expect(m!.confidence).toBeLessThan(0.7);
  });

  it('never fuzzy-matches long question text', () => {
    const m = matchOf('<label for="x">Tell us something interesting about your first name and why it matters to you</label><input id="x">');
    expect(m?.rule ?? '').not.toMatch(/^fuzzy/);
  });

  it('uses nearby text when there is no label, with lower confidence', () => {
    const m = matchOf('<div><span>Email</span></div><div><input type="text"></div>');
    expect(m?.key).toBe('email');
    expect(m!.confidence).toBeLessThan(0.7);
  });

  it('treats unmatched textareas as free-text questions', () => {
    const m = matchOf('<label for="x">Why do you want to work here?</label><textarea id="x"></textarea>');
    expect(m?.key).toBe('freeText');
  });

  it('returns null for unknown inputs', () => {
    expect(matchOf('<label for="x">Favorite color</label><input id="x">')).toBeNull();
  });

  it('adapter hints win over rules', () => {
    const d = descriptors('<label for="x">Email</label><input id="x">')[0]!;
    expect(matchField({ ...d, hintedKey: 'github' })?.key).toBe('github');
  });
});
