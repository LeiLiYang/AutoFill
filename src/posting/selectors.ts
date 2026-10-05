/** Per-ATS selectors for the job posting. Each list is tried in order; the first usable match wins. */
export interface PostingSelectors {
  title: string[];
  location: string[];
  salary: string[];
  description: string[];
}

export type Platform = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'linkedin' | 'generic';

export const SELECTORS: Record<Platform, PostingSelectors> = {
  greenhouse: {
    title: ['.app-title', 'h1.section-header', '.job__title h1', 'h1'],
    location: ['.location', '.job__location', '[class*="location" i]'],
    salary: ['.pay-range', '[class*="pay-range" i]', '[class*="salary" i]'],
    description: ['#content .body', '#job_description', '.job__description', '.job-post', '[class*="job-post" i]', '#content'],
  },
  lever: {
    title: ['.posting-headline h2', 'h2'],
    location: ['.posting-categories .location', '.location', '.sort-by-location'],
    salary: ['[data-qa="salary-range"]', '.salary-range', '[class*="salary" i]'],
    description: ['[data-qa="job-description"]', '.posting-page .content', '.section-wrapper.page-full-width', '.content'],
  },
  ashby: {
    title: ['h1'],
    location: ['[class*="locationName" i]', '[class*="location" i]'],
    salary: ['[class*="compensation" i]', '[class*="salary" i]'],
    description: ['[class*="_descriptionText" i]', '[class*="description" i]', 'main'],
  },
  workday: {
    title: ['[data-automation-id="jobPostingHeader"]', 'h2[data-automation-id="jobPostingHeader"]', 'h1'],
    location: ['[data-automation-id="locations"]', '[data-automation-id="location"]'],
    salary: ['[data-automation-id="compensation"]', '[class*="salary" i]'],
    description: ['[data-automation-id="jobPostingDescription"]', '[data-automation-id="job-posting-details"]'],
  },
  linkedin: {
    title: ['.job-details-jobs-unified-top-card__job-title', '.top-card-layout__title', 'h1'],
    location: ['.job-details-jobs-unified-top-card__bullet', '.topcard__flavor--bullet'],
    salary: ['[class*="salary" i]', '.job-details-preferences-and-skills'],
    description: ['.jobs-description__content', '.show-more-less-html__markup', '.description__text', '#job-details'],
  },
  generic: { title: ['h1'], location: [], salary: [], description: [] },
};

export function platformFor(url: URL, doc?: Document): Platform {
  const host = url.hostname.toLowerCase();
  if (/(^|\.)greenhouse\.io$/.test(host)) return 'greenhouse';
  if (host === 'jobs.lever.co') return 'lever';
  if (host === 'jobs.ashbyhq.com') return 'ashby';
  if (/\.myworkdayjobs\.com$/.test(host)) return 'workday';
  if (/(^|\.)linkedin\.com$/.test(host)) return 'linkedin';
  if (doc?.querySelector('#application_form, #grnhse_app')) return 'greenhouse';
  if (doc?.querySelector('form#application-form')) return 'lever';
  return 'generic';
}

/** Pages that are the application form only; the description lives on a separate page. */
export function isFormOnlyUrl(url: URL, platform: Platform): boolean {
  const path = url.pathname;
  switch (platform) {
    case 'lever': return /\/apply\/?$/i.test(path);
    case 'ashby': return /\/application\/?$/i.test(path);
    case 'workday': return /\/apply(\/|$)/i.test(path);
    case 'greenhouse': return /^\/embed\/job_app/i.test(path);
    default: return false;
  }
}
