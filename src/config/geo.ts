/** Geography data for classifying a job location into the sheet's Location values. All lowercase, accent-free. */

export type Country = 'canada' | 'usa' | 'uk' | 'other';

export const CANADIAN_PROVINCES: Record<string, string> = {
  ab: 'alberta', bc: 'british columbia', mb: 'manitoba', nb: 'new brunswick', nl: 'newfoundland and labrador',
  ns: 'nova scotia', nt: 'northwest territories', nu: 'nunavut', on: 'ontario', pe: 'prince edward island',
  qc: 'quebec', sk: 'saskatchewan', yt: 'yukon',
};

export const US_STATES: Record<string, string> = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
  de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois',
  in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
  ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york',
  nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
  ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah',
  vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
};

export const COUNTRY_WORDS: Record<string, Country> = {
  canada: 'canada',
  'united states': 'usa', 'united states of america': 'usa', usa: 'usa', us: 'usa', 'u s': 'usa', 'u s a': 'usa', america: 'usa',
  'united kingdom': 'uk', uk: 'uk', 'u k': 'uk', england: 'uk', scotland: 'uk', wales: 'uk', 'northern ireland': 'uk',
  'great britain': 'uk', gb: 'uk',
  germany: 'other', france: 'other', india: 'other', ireland: 'other', australia: 'other', 'new zealand': 'other',
  netherlands: 'other', spain: 'other', italy: 'other', portugal: 'other', poland: 'other', sweden: 'other',
  norway: 'other', denmark: 'other', finland: 'other', switzerland: 'other', austria: 'other', belgium: 'other',
  singapore: 'other', japan: 'other', china: 'other', 'hong kong': 'other', israel: 'other', brazil: 'other',
  mexico: 'other', argentina: 'other', colombia: 'other', 'south africa': 'other', nigeria: 'other', kenya: 'other',
  'united arab emirates': 'other', uae: 'other', 'south korea': 'other', philippines: 'other', vietnam: 'other',
  romania: 'other', ukraine: 'other', turkey: 'other', egypt: 'other', pakistan: 'other',
};

/** Cities that are unambiguous enough to place without a region. */
export const CANADIAN_CITIES = new Set([
  'montreal', 'toronto', 'vancouver', 'ottawa', 'calgary', 'edmonton', 'waterloo', 'kitchener', 'mississauga',
  'brampton', 'winnipeg', 'halifax', 'quebec city', 'saskatoon', 'regina',
  'burnaby', 'surrey', 'markham', 'oakville', 'laval', 'gatineau', 'sherbrooke', 'kelowna', 'fredericton',
  'moncton', 'st johns', 'guelph', 'richmond hill', 'vaughan', 'north york', 'scarborough',
]);

export const US_CITIES = new Set([
  'new york', 'new york city', 'nyc', 'san francisco', 'los angeles', 'seattle', 'austin', 'boston', 'chicago',
  'denver', 'atlanta', 'dallas', 'houston', 'miami', 'portland', 'san jose', 'san diego', 'palo alto',
  'mountain view', 'menlo park', 'sunnyvale', 'redwood city', 'cupertino', 'brooklyn', 'washington dc',
  'philadelphia', 'phoenix', 'salt lake city', 'raleigh', 'pittsburgh', 'detroit', 'minneapolis', 'nashville',
  'las vegas', 'san mateo', 'santa clara', 'oakland', 'boulder', 'sf bay', 'silicon valley',
]);

export const OTHER_CITIES: Record<string, Country> = {
  london: 'uk', manchester: 'uk', edinburgh: 'uk', bristol: 'uk', dublin: 'other', berlin: 'other',
  paris: 'other', amsterdam: 'other', munich: 'other', zurich: 'other', stockholm: 'other', madrid: 'other',
  barcelona: 'other', lisbon: 'other', warsaw: 'other', singapore: 'other', tokyo: 'other', sydney: 'other',
  melbourne: 'other', bangalore: 'other', bengaluru: 'other', hyderabad: 'other', mumbai: 'other', delhi: 'other',
  'tel aviv': 'other', 'sao paulo': 'other', 'mexico city': 'other', dubai: 'other', seoul: 'other', beijing: 'other',
  shanghai: 'other', 'hong kong': 'other', 'cape town': 'other', lagos: 'other', nairobi: 'other',
};
