import type { FieldDescriptor, FillValue, ProfileKey, Section } from '../adapters/types';
import { CANADIAN_PROVINCES, US_STATES } from '../config/geo';
import { COUNTRY_ALIASES, DECLINE } from '../config/optionSynonyms';
import type { Profile } from '../profile/schema';
import { normalize } from './normalize';

const text = (t: string | undefined): FillValue | null => (t && t.trim() ? { type: 'text', text: t.trim() } : null);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function countryTargets(country: string): string[] {
  const n = normalize(country);
  for (const [canon, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (n === canon || aliases.includes(n)) return [...new Set([country, canon, ...aliases])];
  }
  return [country];
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** "QC" → ["QC", "Quebec"]: dropdowns list provinces/states by full name, profiles often use the code. */
function regionTargets(region: string): string[] {
  const code = region.trim().toLowerCase();
  const full = CANADIAN_PROVINCES[code] ?? US_STATES[code];
  return full ? [region, titleCase(full)] : [region];
}

const DEGREE_LEVELS: { re: RegExp; targets: string[] }[] = [
  {
    re: /^(bachelor|b ?sc|b ?a\b|b ?s\b|b ?eng|b ?asc|b ?comm|b ?tech|undergraduate|undergrad|honou?rs)/,
    targets: ["Bachelor's degree", 'Bachelors degree', 'Bachelor degree', "Bachelor's", 'Bachelor', 'Undergraduate', 'Bachelor of Science', 'Bachelor of Arts', 'Bachelor of Engineering'],
  },
  {
    re: /^(master|m ?sc|m ?a\b|m ?s\b|m ?eng|mba|m ?asc|m ?comm)/,
    targets: ["Master's degree", 'Masters degree', 'Master degree', "Master's", 'Master', 'Graduate', 'Master of Science', 'Master of Arts', 'MBA'],
  },
  { re: /^(ph ?d|doctor|dphil)/, targets: ['Doctorate', 'Doctoral degree', 'PhD', 'Doctor of Philosophy', 'Doctor'] },
  { re: /^(associate|a ?a\b|a ?s\b)/, targets: ["Associate's degree", 'Associate degree', 'Associate', 'Associates'] },
  { re: /^(diploma|certificate|college)/, targets: ['Diploma', 'Certificate', 'College diploma'] },
  { re: /^(high school|secondary|ged|highschool)/, targets: ['High school', 'High School Diploma', 'Secondary school', 'GED'] },
];

/** The text as written plus the phrasings forms commonly use for the same level ("Bachelor" → "Bachelor's degree"). */
function degreeTargets(degree: string): string[] {
  const n = normalize(degree);
  const level = DEGREE_LEVELS.find((l) => l.re.test(n));
  return [...new Set([degree, ...(level?.targets ?? [])])];
}

/** "2025-03" → a value usable in a text box ("03") or a month dropdown ("March" / "Mar" / "03" / "3"). */
function monthValue(date: string | undefined): FillValue | null {
  const mm = datePart(date, 'month');
  if (!mm) return null;
  const name = MONTHS[Number(mm) - 1];
  if (!name) return null;
  return { type: 'choice', text: mm, targets: [name, name.slice(0, 3), mm, String(Number(mm))] };
}

/** Work authorization is country-specific: look at which country the question names. */
function authorizedFor(d: FieldDescriptor, p: Profile): boolean | null {
  const countries = p.work.authorizedCountries;
  if (!countries.length) return null;
  const label = ` ${normalize(`${d.label} ${d.ariaLabel ?? ''}`)} `;
  const mentions = (names: string[]) => names.some((n) => label.includes(` ${n} `));
  // Two-letter codes ("in", "us", "ca") are too ambiguous to look for inside a sentence.
  const mine = countries.flatMap((c) => countryTargets(c).map(normalize)).filter((n) => n.length > 2);
  if (mentions(mine)) return true;
  const anyKnown = Object.values(COUNTRY_ALIASES).flat().filter((a) => a.length > 2);
  if (mentions(anyKnown)) return false;
  return true; // no country named: assume the user's home jurisdiction
}

function eeoValue(value: string): FillValue | null {
  const v = normalize(value);
  if (!v) return null;
  const isDecline = DECLINE.includes(v) || v.startsWith('decline') || v.startsWith('prefer not');
  return { type: 'choice', text: value, targets: isDecline ? [value, ...DECLINE] : [value] };
}

function currentExperience(p: Profile) {
  return p.experience.find((e) => e.current) ?? p.experience[0];
}

/**
 * The experience entry a field belongs to: its section index when the form repeats the section
 * (the engine numbers repeated fields in page order), else the current job.
 */
const exp = (p: Profile, d: FieldDescriptor) => (d.entryIndex != null ? p.experience[d.entryIndex] : currentExperience(p));
const edu = (p: Profile, d: FieldDescriptor) => p.education[d.entryIndex ?? 0];

/** "2025-03" / "2025-03-14" / "2025" → the month ("03") or year ("2025") part, or ''. */
export function datePart(date: string | undefined, part: 'month' | 'year'): string {
  const m = /^(\d{4})(?:[-/](\d{1,2}))?/.exec((date ?? '').trim());
  if (!m) return '';
  return part === 'year' ? m[1]! : m[2] ? m[2].padStart(2, '0') : '';
}

/** Start/end date part for whichever repeating section the field sits in. */
function datePartFor(which: 'start' | 'end', part: 'month' | 'year', section: Section, p: Profile, d: FieldDescriptor): FillValue | null {
  const entry = section === 'education' ? edu(p, d) : exp(p, d);
  if (!entry) return null;
  // A job that is still current has no end date to enter.
  if (which === 'end' && section === 'experience' && (entry as { current?: boolean }).current) return null;
  const date = which === 'start' ? entry.startDate : entry.endDate;
  return part === 'month' ? monthValue(date) : text(datePart(date, 'year'));
}

/** Resolve a profile key to the value to enter, or null when the profile has no data. */
export function resolveValue(key: ProfileKey, p: Profile, d: FieldDescriptor): FillValue | null {
  const { contact, links, address, work } = p;
  const section: Section = d.section ?? 'experience';
  switch (key) {
    case 'firstName': return text(contact.firstName);
    case 'lastName': return text(contact.lastName);
    case 'fullName': return text(`${contact.firstName} ${contact.lastName}`);
    case 'preferredName': return text(contact.preferredName || contact.firstName);
    case 'pronouns': return text(contact.pronouns);
    case 'email': return text(contact.email);
    case 'phone': return text(contact.phone);
    case 'phoneType': {
      const t = (contact.phoneType || 'Mobile').trim();
      const mobile = /^(mobile|cell|cellular)/i.test(t);
      return { type: 'choice', text: t, targets: mobile ? [t, 'Mobile', 'Cell', 'Cellular', 'Mobile phone', 'Cell phone'] : [t] };
    }
    case 'linkedin': return text(links.linkedin);
    case 'github': return text(links.github);
    case 'portfolio': return text(links.portfolio || links.other[0]);
    case 'addressLine1': return text(address.line1);
    case 'addressLine2': return text(address.line2);
    case 'city': return text(address.city);
    case 'region': {
      if (!address.region.trim()) return null;
      return { type: 'choice', text: address.region, targets: regionTargets(address.region) };
    }
    case 'postalCode': return text(address.postalCode);
    case 'country': {
      if (!address.country.trim()) return null;
      return { type: 'choice', text: address.country, targets: countryTargets(address.country) };
    }
    case 'location': return text([address.city, address.region, address.country].filter(Boolean).join(', '));
    case 'authorizedToWork': {
      if (work.assumeAuthorized) return { type: 'bool', value: true };
      const v = authorizedFor(d, p);
      return v === null ? null : { type: 'bool', value: v };
    }
    case 'requiresSponsorship': return { type: 'bool', value: work.assumeAuthorized ? false : work.requiresSponsorship };
    case 'willingToRelocate': return { type: 'bool', value: work.willingToRelocate };
    case 'startDate': return text(work.startDate);
    case 'noticePeriod': return text(work.noticePeriod);
    case 'salary': return text(work.salaryExpectation.amount);

    case 'currentCompany': return text(exp(p, d)?.company);
    case 'currentTitle': return text(exp(p, d)?.title);
    case 'expLocation': return text(exp(p, d)?.location);
    case 'expDescription': return text(exp(p, d)?.description);
    case 'expCurrent': return exp(p, d) ? { type: 'bool', value: exp(p, d)!.current } : null;

    case 'startMonth': return datePartFor('start', 'month', section, p, d);
    case 'startYear': return datePartFor('start', 'year', section, p, d);
    case 'endMonth': return datePartFor('end', 'month', section, p, d);
    case 'endYear': return datePartFor('end', 'year', section, p, d);
    case 'expStartMonth': return datePartFor('start', 'month', 'experience', p, d);
    case 'expStartYear': return datePartFor('start', 'year', 'experience', p, d);
    case 'expEndMonth': return datePartFor('end', 'month', 'experience', p, d);
    case 'expEndYear': return datePartFor('end', 'year', 'experience', p, d);
    case 'eduStartYear': return datePartFor('start', 'year', 'education', p, d);
    case 'eduEndYear': return datePartFor('end', 'year', 'education', p, d);

    case 'school': return text(edu(p, d)?.school);
    case 'degree': {
      const deg = edu(p, d)?.degree?.trim();
      return deg ? { type: 'choice', text: deg, targets: degreeTargets(deg) } : null;
    }
    case 'field': return text(edu(p, d)?.field);
    case 'gpa': return text(edu(p, d)?.gpa);

    case 'gender': return eeoValue(p.eeo.gender);
    case 'race': return eeoValue(p.eeo.race);
    case 'hispanicLatino': return eeoValue(p.eeo.hispanicLatino);
    case 'veteran': return eeoValue(p.eeo.veteran);
    case 'disability': return eeoValue(p.eeo.disability);
    case 'resume': return { type: 'file', fileKind: 'resume' };
    case 'coverLetter': return { type: 'file', fileKind: 'coverLetter' };
  }
}
