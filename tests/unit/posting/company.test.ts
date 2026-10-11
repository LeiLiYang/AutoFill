import { describe, expect, it } from 'vitest';
import { cleanCompany, companySlugFromUrl, deriveCompany, prettifySlug } from '../../../src/tracking/company';
import { mount } from '../helpers';

const u = (s: string) => new URL(s);

describe('companySlugFromUrl', () => {
  it.each([
    ['https://boards.greenhouse.io/acmecorp/jobs/1', 'acmecorp'],
    ['https://job-boards.greenhouse.io/acme-corp/jobs/1', 'acme-corp'],
    ['https://boards.greenhouse.io/embed/job_app?for=acme&token=1', 'acme'],
    ['https://jobs.lever.co/acme/abc/apply', 'acme'],
    ['https://jobs.ashbyhq.com/acme/xyz', 'acme'],
    ['https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x', 'nvidia'],
    ['https://careers.example.com/jobs/1', null],
  ])('%s → %s', (url, slug) => expect(companySlugFromUrl(u(url))).toBe(slug));
});

describe('deriveCompany', () => {
  it('prettifies hyphenated slugs', () => {
    expect(prettifySlug('acme-corp')).toBe('Acme Corp');
    expect(prettifySlug('stripe')).toBe('Stripe');
    expect(prettifySlug('McKinsey-and-Co')).toBe('McKinsey and Co');
  });

  it('uses the ATS slug for Greenhouse/Lever/Ashby and the tenant for Workday', () => {
    expect(deriveCompany(u('https://jobs.lever.co/shopify/abc'))).toBe('Shopify');
    expect(deriveCompany(u('https://jobs.ashbyhq.com/ramp/xyz'))).toBe('Ramp');
    expect(deriveCompany(u('https://boards.greenhouse.io/embed/job_app?for=datadog&token=1'))).toBe('Datadog');
    expect(deriveCompany(u('https://rbc.wd3.myworkdayjobs.com/en-US/RBCGLOBAL1/job/x'))).toBe('Rbc');
  });

  it('prefers page metadata when it is the same name with better casing', () => {
    mount('<script type="application/ld+json">{"@type":"JobPosting","hiringOrganization":{"name":"Acme Corp"}}</script>');
    expect(deriveCompany(u('https://boards.greenhouse.io/acmecorp/jobs/1'), document)).toBe('Acme Corp');
  });

  it('keeps the slug when metadata names a different company', () => {
    mount('<meta property="og:site_name" content="Some Job Board">');
    expect(deriveCompany(u('https://boards.greenhouse.io/acme/jobs/1'), document)).toBe('Acme');
  });

  it('finds the company from an embedded Greenhouse iframe on a career site', () => {
    mount('<iframe src="https://boards.greenhouse.io/embed/job_app?for=figma&token=5"></iframe>');
    expect(deriveCompany(u('https://www.figma-careers.example/jobs'), document)).toBe('Figma');
  });

  it('falls back to metadata, then the site name, for unknown sites', () => {
    mount('<script type="application/ld+json">{"@type":"JobPosting","hiringOrganization":{"name":"Globex"}}</script>');
    expect(deriveCompany(u('https://careers.globex.com/jobs/1'), document)).toBe('Globex');
    mount('');
    expect(deriveCompany(u('https://careers.initech.com/jobs/1'), document)).toBe('Initech');
  });

  it('drops legal suffixes and extra words after the company name', () => {
    mount('<script type="application/ld+json">{"@type":"JobPosting","hiringOrganization":{"name":"Chewy, Inc."}}</script>');
    expect(deriveCompany(u('https://boards.greenhouse.io/chewy/jobs/1'), document)).toBe('Chewy');
    mount('<script type="application/ld+json">{"@type":"JobPosting","hiringOrganization":{"name":"TikTok Live"}}</script>');
    expect(deriveCompany(u('https://jobs.lever.co/tiktok/abc'), document)).toBe('TikTok');
    mount('<script type="application/ld+json">{"@type":"JobPosting","hiringOrganization":{"name":"Chewy Inc"}}</script>');
    expect(deriveCompany(u('https://careers.chewy.example/jobs/1'), document)).toBe('Chewy');
  });

  it('takes the company, not the job title, from a LinkedIn page title', () => {
    mount('');
    document.title = 'Software Engineer, TikTok Live | TikTok | LinkedIn';
    expect(deriveCompany(u('https://www.linkedin.com/jobs/view/123'), document)).toBe('TikTok');
    document.title = 'Chewy Inc hiring Software Engineer in Boston, MA | LinkedIn';
    expect(deriveCompany(u('https://www.linkedin.com/jobs/view/123'), document)).toBe('Chewy');
  });
});

describe('cleanCompany', () => {
  it.each([
    ['Chewy Inc', 'Chewy'],
    ['Chewy, Inc.', 'Chewy'],
    ['Acme Holdings Ltd', 'Acme Holdings'],
    ['Acme Corp', 'Acme Corp'],
    ['McKinsey & Co', 'McKinsey & Co'],
    ['Stripe  (Payments)', 'Stripe'],
  ])('%s → %s', (a, b) => expect(cleanCompany(a)).toBe(b));
});
