import type { ProfileKey } from '../adapters/types';

/**
 * Ordered field-matching rules. Easy to extend: add a row. Earlier rows win within a stage.
 *  - attrs:    tested against each of autocomplete / name / id / data-automation-id
 *              (camelCase and separators are split into words, lowercased)
 *  - label:    tested against the normalized label / aria-label / placeholder
 *  - not:      if it matches the label or attrs, the rule is skipped
 *  - synonyms: used by the fuzzy stage for short labels
 */
export interface MatchRule {
  key: ProfileKey;
  attrs?: RegExp;
  label?: RegExp;
  not?: RegExp;
  synonyms?: string[];
  /** Restrict to a field kind (e.g. file inputs for resume). */
  only?: 'file';
}

export const MATCH_RULES: MatchRule[] = [
  // Files first so they never fall through to text rules.
  { key: 'coverLetter', only: 'file', attrs: /cover letter|coverletter/, label: /cover letter/ },
  { key: 'resume', only: 'file', attrs: /resume|cv\b|curriculum/, label: /resume|\bcv\b|curriculum vitae/ },

  { key: 'preferredName', attrs: /preferred (first )?name|nick ?name/, label: /preferred (first )?name|nick ?name|what should we call you/, synonyms: ['preferred name', 'nickname'] },
  { key: 'firstName', attrs: /^(first name|fname|given name|first)$|\b(first name|given name)\b/, label: /^(legal )?(first|given) name\b/, synonyms: ['first name', 'given name', 'legal first name'] },
  { key: 'lastName', attrs: /^(last name|lname|family name|surname|last)$|\b(last name|family name|surname)\b/, label: /^(legal )?(last|family) name\b|^surname\b/, synonyms: ['last name', 'family name', 'surname', 'legal last name'] },
  { key: 'fullName', attrs: /^(name|full name|fullname|candidate name|your name)$/, label: /^(your |full |legal |candidate )?name$/, synonyms: ['full name', 'name', 'your name', 'legal name'] },
  { key: 'email', attrs: /\be ?mail\b/, label: /e ?mail/, synonyms: ['email', 'email address', 'e mail'] },
  { key: 'phoneType', attrs: /phone (device )?type|device type/, label: /phone (device )?type|type of phone|phone type|device type/, synonyms: ['phone device type', 'phone type'] },
  { key: 'phone', attrs: /\b(tel|phone|mobile|telephone|cell)\b/, label: /phone|mobile|telephone|cell number/, not: /country code|extension|\btype\b|device/, synonyms: ['phone', 'phone number', 'mobile number', 'telephone'] },
  { key: 'linkedin', attrs: /linked ?in/, label: /linked ?in/, synonyms: ['linkedin', 'linkedin profile', 'linkedin url'] },
  { key: 'github', attrs: /git ?hub/, label: /git ?hub/, synonyms: ['github', 'github profile', 'github url'] },
  { key: 'portfolio', attrs: /portfolio|^website$|^url$|homepage/, label: /portfolio|personal (web ?)?site|^website$|^web site$|personal url|homepage|personal website/, not: /linked ?in|git ?hub|company/, synonyms: ['portfolio', 'personal website', 'website'] },
  { key: 'pronouns', attrs: /pronoun/, label: /pronoun/, synonyms: ['pronouns'] },

  { key: 'addressLine2', attrs: /address line ?2|address2|\bapt\b|\bunit\b|\bsuite\b/, label: /address line 2|address 2|\bapt\b|\bsuite\b|\bunit\b/, synonyms: ['address line 2'] },
  { key: 'addressLine1', attrs: /address line ?1|address1|street address|^address$|street/, label: /^(street )?address( line)?( 1)?$|street address|mailing address/, synonyms: ['address', 'street address', 'address line 1'] },
  { key: 'city', attrs: /\bcity\b|address level ?2/, label: /^(current |home )?city\b|\bcity$/, synonyms: ['city', 'town', 'current city'] },
  { key: 'postalCode', attrs: /zip|postal|post code|postcode/, label: /zip|postal|post ?code/, synonyms: ['postal code', 'zip code', 'zip'] },
  { key: 'region', attrs: /\bstate\b|province|\bregion\b|address level ?1/, label: /^(state|province|state province|region|state or province)\b/, not: /united states/, synonyms: ['state', 'province', 'state province', 'region'] },
  { key: 'country', attrs: /\bcountry\b/, label: /^country( of residence)?$|^country region$|^country\b|country of residence/, not: /code|phone/, synonyms: ['country', 'country of residence'] },
  { key: 'location', attrs: /^location$|current location/, label: /^(current )?location( city)?$|where are you (currently )?(located|based)|current location|city and state|city state/, synonyms: ['location', 'current location'] },

  { key: 'authorizedToWork', label: /(legally |currently )?(authori[sz]ed|eligible|permitted|legal right|legally entitled|work authori[sz]ation) .*work|right to work|work authori[sz]ation/, synonyms: [] },
  { key: 'requiresSponsorship', label: /sponsor|require .*visa|need .*visa|immigration/, synonyms: [] },
  { key: 'willingToRelocate', label: /relocat/, synonyms: [] },
  // Start/end month and year fields of education and work-experience entries. The field's `section`
  // (education vs experience) decides whose dates they are. These must precede `startDate` below.
  { key: 'startMonth', attrs: /\b(start|from)\b.*\bmonth\b|\bmonth\b.*\b(start|from)\b/, label: /\b(start|from)\b.*\bmonth\b|\bmonth\b.*\b(start|from)\b/, synonyms: ['start date month', 'start month', 'from month'] },
  { key: 'startYear', attrs: /\b(start|from)\b.*\byear\b|\byear\b.*\b(start|from)\b|first year attended/, label: /\b(start|from)\b.*\byear\b|\byear\b.*\b(start|from)\b/, synonyms: ['start date year', 'start year', 'from year'] },
  { key: 'endMonth', attrs: /\b(end|to)\b.*\bmonth\b|\bmonth\b.*\b(end|to)\b/, label: /\b(end|to)\b.*\bmonth\b|\bmonth\b.*\b(end|to)\b/, synonyms: ['end date month', 'end month', 'to month'] },
  { key: 'endYear', attrs: /\b(end|to)\b.*\byear\b|\byear\b.*\b(end|to)\b|last year attended|graduation year/, label: /\b(end|to)\b.*\byear\b|\byear\b.*\b(end|to)\b|graduation year|year of graduation/, synonyms: ['end date year', 'end year', 'to year'] },
  { key: 'expCurrent', attrs: /currently work here|current(ly)? (role|position|job)/, label: /currently work here|current(ly)? (work|working|employed) (here|there)|this is (my )?current (role|position|job)|i (currently )?work here|^current (role|position|job)\b/, synonyms: [] },
  { key: 'startDate', attrs: /start date|available date/, not: /month|year|day/, label: /(earliest |desired |expected )?start date|available to start|when can you start|availability date|date available/, synonyms: ['start date', 'available start date', 'earliest start date'] },
  { key: 'salary', attrs: /salary|compensation/, label: /salary|compensation|pay expectation|expected pay/, synonyms: ['salary expectations', 'desired salary', 'expected salary'] },
  { key: 'noticePeriod', attrs: /notice period/, label: /notice period/, synonyms: ['notice period'] },

  { key: 'currentCompany', attrs: /^(org|organization|employer|current company|company)$/, label: /current (company|employer|organi[sz]ation)|most recent (company|employer)|^(company|employer)( name)?$/, synonyms: ['current company', 'current employer', 'company'] },
  { key: 'currentTitle', attrs: /^(job title|current title|title)$/, label: /current (job )?title|most recent (job )?title|^(job )?title$|current (role|position)/, synonyms: ['current title', 'job title', 'current role'] },
  { key: 'school', attrs: /^(school|university|college|institution)$/, label: /^(school|university|college|institution)( name)?$|school or university/, synonyms: ['school', 'university', 'college'] },
  { key: 'degree', attrs: /^degree$/, label: /^degree( type)?$|highest (level of )?(degree|education)/, synonyms: ['degree'] },
  { key: 'field', attrs: /field of study|major|discipline/, label: /field of study|^major$|discipline/, synonyms: ['field of study', 'major', 'discipline'] },
  { key: 'gpa', attrs: /\bgpa\b/, label: /\bgpa\b|grade point/, synonyms: ['gpa'] },

  { key: 'hispanicLatino', attrs: /hispanic|latino/, label: /hispanic|latino|latinx/, synonyms: [] },
  { key: 'race', attrs: /\brace\b|ethnicity/, label: /\brace\b|ethnicity|racial/, synonyms: [] },
  { key: 'gender', attrs: /^gender$/, label: /^gender( identity)?\b|^what is your gender|\bgender\b/, not: /pronoun/, synonyms: [] },
  { key: 'veteran', attrs: /veteran/, label: /veteran|protected veteran/, synonyms: [] },
  { key: 'disability', attrs: /disabilit/, label: /disabilit/, synonyms: [] },
];
