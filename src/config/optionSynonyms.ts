/** Normalized (lowercase, punctuation-free) synonym lists used when picking options. */

export const YES = ['yes', 'y', 'true', 'i am', 'i do', 'i will', 'i have', 'yes i am', 'yes i do', 'authorized'];
export const NO = ['no', 'n', 'false', 'i am not', 'i do not', 'i will not', 'i have not', 'no i am not', 'no i do not', 'not authorized'];

export const DECLINE = [
  'decline to self identify',
  'decline to answer',
  'decline to state',
  'decline',
  'i do not wish to answer',
  'i dont wish to answer',
  'i do not want to answer',
  'i prefer not to answer',
  'i choose not to disclose',
  'prefer not to say',
  'prefer not to disclose',
  'prefer not to answer',
  'choose not to disclose',
  'not specified',
  'not disclosed',
];

/** Country aliases, keyed by the normalized canonical name. */
export const COUNTRY_ALIASES: Record<string, string[]> = {
  canada: ['canada', 'ca'],
  'united states': ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america'],
  'united kingdom': ['united kingdom', 'uk', 'u k', 'great britain', 'gb', 'england'],
  india: ['india', 'in'],
  germany: ['germany', 'de', 'deutschland'],
  france: ['france', 'fr'],
  australia: ['australia', 'au'],
};

/** Placeholder option texts (tested against normalized text) that must never be chosen. */
export const PLACEHOLDER_OPTION = /^$|^(select|please select|choose|please choose|pick one|none)\b/;
