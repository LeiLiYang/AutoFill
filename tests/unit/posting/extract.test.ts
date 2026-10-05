import { describe, expect, it } from 'vitest';
import { extractPosting, findSalary } from '../../../src/posting/extract';
import { buildAnswersJson, buildPostingMarkdown, postingFolder, sanitizeSegment } from '../../../src/posting/save';
import { loadFixture } from '../fixtures';
import { mount } from '../helpers';

const LONG = 'We are looking for an engineer to build reliable services. '.repeat(8);
const u = (s: string) => new URL(s);

describe('extractPosting: per-ATS selectors', () => {
  it('reads a Greenhouse posting', () => {
    loadFixture('greenhouse/classic.html');
    document.querySelector('#job_description')!.innerHTML = `<h2>About the role</h2><p>${LONG}</p><ul><li>Go</li><li>Postgres</li></ul>`;
    const p = extractPosting(document, u('https://boards.greenhouse.io/acme/jobs/123?gh_src=x'));
    expect(p).toMatchObject({
      title: 'Backend Engineer',
      company: 'Acme Corp',
      location: 'Montreal, QC',
      platform: 'greenhouse',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/123',
      source: 'selectors',
      formOnly: false,
    });
    expect(p.descriptionMd).toContain('## About the role');
    expect(p.descriptionMd).toContain('- Go');
    // the application form must not leak into the description
    expect(p.descriptionMd).not.toContain('First Name');
  });

  it('reads a Lever posting and maps the /apply form URL to the posting URL', () => {
    mount(`<div class="posting-headline"><h2>Software Engineer</h2><div class="posting-categories"><div class="location">Toronto, ON</div></div></div>
      <div data-qa="job-description"><p>${LONG}</p></div>`);
    const p = extractPosting(document, u('https://jobs.lever.co/acme/abc-1?lever-source=LinkedIn'));
    expect(p).toMatchObject({ title: 'Software Engineer', location: 'Toronto, ON', company: 'Acme', platform: 'lever' });
    expect(p.formOnly).toBe(false);
  });

  it('reads a Workday posting', () => {
    mount(`<h2 data-automation-id="jobPostingHeader">Data Engineer</h2><div data-automation-id="locations">Vancouver, BC</div>
      <div data-automation-id="jobPostingDescription"><p>${LONG}</p></div>`);
    const p = extractPosting(document, u('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Vancouver/Data-Engineer_R-1'));
    expect(p).toMatchObject({ title: 'Data Engineer', location: 'Vancouver, BC', company: 'Acme', platform: 'workday', formOnly: false });
  });
});

describe('extractPosting: fallbacks', () => {
  it('uses schema.org JobPosting JSON-LD when selectors find nothing', () => {
    mount(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Platform Engineer',
      hiringOrganization: { name: 'Globex' },
      jobLocation: { address: { addressLocality: 'London', addressCountry: 'GB' } },
      baseSalary: { currency: 'GBP', value: { minValue: 70000, maxValue: 90000, unitText: 'YEAR' } },
      description: `<p>${LONG}</p><ul><li>Kubernetes</li></ul>`,
    })}</script><div>Loading…</div>`);
    const p = extractPosting(document, u('https://careers.globex.com/jobs/1'));
    expect(p).toMatchObject({ title: 'Platform Engineer', company: 'Globex', location: 'London, United Kingdom', source: 'jsonld' });
    expect(p.salary).toBe('GBP 70000–90000 per year');
    expect(p.descriptionMd).toContain('- Kubernetes');
  });

  it('falls back to Mozilla Readability on unknown pages', () => {
    mount(`<header><nav>Home Jobs About</nav></header>
      <article><h1>Site Reliability Engineer</h1><p>${LONG}</p><p>${LONG}</p><p>${LONG}</p></article>
      <footer>© Initech</footer>`);
    const p = extractPosting(document, u('https://careers.initech.com/jobs/9'));
    expect(p.source).toBe('readability');
    expect(p.title).toBe('Site Reliability Engineer');
    expect(p.descriptionMd).toContain('reliable services');
    expect(p.descriptionMd).not.toContain('Home Jobs About');
  });
});

describe('extractPosting: application-form-only pages', () => {
  it.each([
    'https://jobs.lever.co/acme/abc/apply',
    'https://jobs.ashbyhq.com/acme/abc/application',
    'https://acme.wd5.myworkdayjobs.com/Careers/job/Montreal/Dev_R-1/apply/applyManually',
    'https://boards.greenhouse.io/embed/job_app?for=acme&token=1',
  ])('%s is flagged formOnly', (url) => {
    loadFixture('lever/apply.html');
    expect(extractPosting(document, u(url)).formOnly).toBe(true);
  });

  it('flags an unknown page that is just a form with no description', () => {
    loadFixture('generic/basic.html');
    expect(extractPosting(document, u('https://example.com/apply')).formOnly).toBe(true);
  });
});

describe('findSalary', () => {
  it.each([
    ['The salary range for this role is $120,000 - $150,000 per year.', '$120,000 - $150,000 per year'],
    ['Compensation: CAD 90k to 110k annually', 'CAD 90k to 110k'],
    ['We have 100 - 200 employees', ''],
    ['', ''],
  ])('%s', (text, expected) => expect(findSalary(text)).toBe(expected));
});

describe('save helpers', () => {
  const posting = {
    title: 'Backend Engineer', company: 'Acme Corp', location: 'Montreal, QC', salary: '$100k–$120k',
    descriptionMd: 'Build things.', url: 'https://x', canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/1',
    platform: 'greenhouse' as const, formOnly: false, source: 'selectors' as const,
  };
  const date = new Date(2026, 9, 4, 15, 30);

  it('lays folders out as AutoFill/Company/date Title', () => {
    expect(postingFolder(posting, date)).toBe('AutoFill/Acme Corp/2026-10-04 Backend Engineer');
  });

  it('sanitizes Windows-hostile characters, reserved names and trailing dots', () => {
    expect(sanitizeSegment('Dev: C/C++ <Senior> "Lead"?')).toBe('Dev C C++ Senior Lead');
    expect(sanitizeSegment('CON')).toBe('_CON');
    expect(sanitizeSegment('Acme Inc.')).toBe('Acme Inc');
    expect(sanitizeSegment('   ')).toBe('untitled');
    expect(sanitizeSegment('x'.repeat(200)).length).toBeLessThanOrEqual(60);
    expect(postingFolder({ company: 'A/B', title: 'Role: X' }, date)).toBe('AutoFill/A B/2026-10-04 Role X');
  });

  it('builds posting.md with metadata and the description', () => {
    const md = buildPostingMarkdown(posting, date);
    expect(md).toContain('# Backend Engineer');
    expect(md).toContain('- **Company:** Acme Corp');
    expect(md).toContain('- **Salary:** $100k–$120k');
    expect(md).toContain('- **URL:** https://boards.greenhouse.io/acme/jobs/1');
    expect(md).toContain('Build things.');
  });

  it('omits empty metadata lines and explains a missing description', () => {
    const md = buildPostingMarkdown({ ...posting, location: '', salary: '', descriptionMd: '' }, date);
    expect(md).not.toContain('Location');
    expect(md).not.toContain('Salary');
    expect(md).toContain('No job description could be extracted');
  });

  it('builds answers.json with source per answer', () => {
    const json = JSON.parse(buildAnswersJson(posting, [{ question: 'Email', answer: 'a@b.c', source: 'autofill' }], date));
    expect(json).toMatchObject({ company: 'Acme Corp', title: 'Backend Engineer', url: 'https://boards.greenhouse.io/acme/jobs/1' });
    expect(json.answers).toEqual([{ question: 'Email', answer: 'a@b.c', source: 'autofill' }]);
  });
});
