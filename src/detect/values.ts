import type { FieldDescriptor, FillValue, ProfileKey } from '../adapters/types';
import { COUNTRY_ALIASES, DECLINE } from '../config/optionSynonyms';
import type { Profile } from '../profile/schema';
import { normalize } from './normalize';

const text = (t: string | undefined): FillValue | null => (t && t.trim() ? { type: 'text', text: t.trim() } : null);

function countryTargets(country: string): string[] {
  const n = normalize(country);
  for (const [canon, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (n === canon || aliases.includes(n)) return [...new Set([country, canon, ...aliases])];
  }
  return [country];
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

/** Resolve a profile key to the value to enter, or null when the profile has no data. */
export function resolveValue(key: ProfileKey, p: Profile, d: FieldDescriptor): FillValue | null {
  const { contact, links, address, work } = p;
  switch (key) {
    case 'firstName': return text(contact.firstName);
    case 'lastName': return text(contact.lastName);
    case 'fullName': return text(`${contact.firstName} ${contact.lastName}`);
    case 'preferredName': return text(contact.preferredName || contact.firstName);
    case 'pronouns': return text(contact.pronouns);
    case 'email': return text(contact.email);
    case 'phone': return text(contact.phone);
    case 'linkedin': return text(links.linkedin);
    case 'github': return text(links.github);
    case 'portfolio': return text(links.portfolio || links.other[0]);
    case 'addressLine1': return text(address.line1);
    case 'addressLine2': return text(address.line2);
    case 'city': return text(address.city);
    case 'region': return text(address.region);
    case 'postalCode': return text(address.postalCode);
    case 'country': {
      if (!address.country.trim()) return null;
      return { type: 'choice', text: address.country, targets: countryTargets(address.country) };
    }
    case 'location': return text([address.city, address.region, address.country].filter(Boolean).join(', '));
    case 'authorizedToWork': {
      const v = authorizedFor(d, p);
      return v === null ? null : { type: 'bool', value: v };
    }
    case 'requiresSponsorship': return { type: 'bool', value: work.requiresSponsorship };
    case 'willingToRelocate': return { type: 'bool', value: work.willingToRelocate };
    case 'startDate': return text(work.startDate);
    case 'noticePeriod': return text(work.noticePeriod);
    case 'salary': return text(work.salaryExpectation.amount);
    case 'currentCompany': return text(currentExperience(p)?.company);
    case 'currentTitle': return text(currentExperience(p)?.title);
    case 'school': return text(p.education[0]?.school);
    case 'degree': return text(p.education[0]?.degree);
    case 'field': return text(p.education[0]?.field);
    case 'gpa': return text(p.education[0]?.gpa);
    case 'gender': return eeoValue(p.eeo.gender);
    case 'race': return eeoValue(p.eeo.race);
    case 'hispanicLatino': return eeoValue(p.eeo.hispanicLatino);
    case 'veteran': return eeoValue(p.eeo.veteran);
    case 'disability': return eeoValue(p.eeo.disability);
    case 'resume': return { type: 'file', fileKind: 'resume' };
    case 'coverLetter': return { type: 'file', fileKind: 'coverLetter' };
  }
}
