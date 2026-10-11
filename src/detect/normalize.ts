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

/** Attribute names written as one lowercase word, which no separator rule can split. */
const GLUED: Record<string, string> = {
  firstname: 'first name', lastname: 'last name', middlename: 'middle name', givenname: 'given name', familyname: 'family name',
  preferredname: 'preferred name', phonenumber: 'phone number', mobilenumber: 'mobile number', cellphone: 'cell phone',
  mobilephone: 'mobile phone', emailaddress: 'email address', zipcode: 'zip code', postalcode: 'postal code',
  streetaddress: 'street address', jobtitle: 'job title', startdate: 'start date', linkedinurl: 'linkedin url',
  linkedinprofile: 'linkedin profile', githuburl: 'github url', coverletter: 'cover letter',
};
const GLUED_RE = new RegExp(`\\b(${Object.keys(GLUED).join('|')})\\b`, 'g');

/** Split camelCase / snake / bracket attribute names into lowercase words. */
export function attrWords(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.[\]:]+/g, ' ')
    .toLowerCase()
    .replace(GLUED_RE, (w) => GLUED[w]!)
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
