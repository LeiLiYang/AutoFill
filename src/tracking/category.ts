import { CATEGORY_RULES, DEFAULT_CATEGORY, type Category } from '../config/tracking';

/** Classify a job title into the sheet's Category. Keyword rules live in config/tracking.ts. */
export function classifyCategory(title: string | null | undefined): Category {
  const t = title ?? '';
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((p) => p.test(t))) return rule.category;
  }
  return DEFAULT_CATEGORY;
}
