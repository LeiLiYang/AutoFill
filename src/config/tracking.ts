/**
 * Single source of truth for the tracking sheet. Used for validation (zod) and for the
 * dropdowns in the "Log application" card.
 */

/** Column B. Exactly one of these. */
export const CATEGORIES = ['SWE', 'PM', 'FDE'] as const;
export type Category = (typeof CATEGORIES)[number];
export const DEFAULT_CATEGORY: Category = 'SWE';

/** Column D. Exactly one of these strings, case-sensitive. */
export const LOCATIONS = ['montreal', 'vancouver', 'toronto', 'canada', 'USA', 'london'] as const;
export type Location = (typeof LOCATIONS)[number];

/** Column F. */
export const CHANNELS = ['website', 'linkedin'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Sheet columns A–H, in order. C (Status) and G (Comments) are always left empty. */
export const SHEET_COLUMNS = ['Company', 'Category', 'Status', 'Location', 'Date', 'Channel', 'Comments', 'URL'] as const;

/**
 * Category keyword rules, checked in order against the job title (first match wins; default SWE).
 * FDE and PM are checked before SWE so "Forward Deployed Software Engineer" is FDE and
 * "Product Manager, Infrastructure" is PM.
 */
export const CATEGORY_RULES: { category: Category; patterns: RegExp[] }[] = [
  { category: 'FDE', patterns: [/forward[\s-]*deployed/i, /\bfde\b/i] },
  { category: 'PM', patterns: [/product\s+manage(r|ment)/i, /\bapm\b/i, /\bproduct\s+owner\b/i] },
  {
    category: 'SWE',
    patterns: [
      /back[\s-]?end/i, /front[\s-]?end/i, /full[\s-]?stack/i, /\bmobile\b/i, /\bios\b/i, /\bandroid\b/i,
      /\binfra(structure)?\b/i, /\bplatform\b/i, /\bdevops\b/i, /\bsre\b/i, /site reliability/i,
      /data engineer/i, /machine learning/i, /\bml\b/i, /software (engineer|developer)/i, /\bswe\b/i,
    ],
  },
];
