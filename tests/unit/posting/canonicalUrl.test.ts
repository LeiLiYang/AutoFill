import { describe, expect, it } from 'vitest';
import { canonicalPostingUrl } from '../../../src/posting/canonicalUrl';

describe('canonicalPostingUrl', () => {
  it.each([
    // tracking params stripped, job identifiers kept
    ['https://boards.greenhouse.io/acme/jobs/123?gh_src=abc&utm_source=linkedin', 'https://boards.greenhouse.io/acme/jobs/123'],
    ['https://job-boards.greenhouse.io/acme/jobs/123?utm_medium=x&utm_campaign=y', 'https://job-boards.greenhouse.io/acme/jobs/123'],
    ['https://www.acme.com/careers?gh_jid=456&gh_src=zzz&utm_source=a', 'https://www.acme.com/careers?gh_jid=456'],
    // Lever: /apply → posting, lever-source stripped
    ['https://jobs.lever.co/acme/abc-123/apply?lever-source=LinkedIn', 'https://jobs.lever.co/acme/abc-123'],
    ['https://jobs.lever.co/acme/abc-123?lever-origin=applied&lever-source[]=Twitter', 'https://jobs.lever.co/acme/abc-123'],
    // Ashby: /application → posting
    ['https://jobs.ashbyhq.com/acme/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/application?utm_source=x', 'https://jobs.ashbyhq.com/acme/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab'],
    // Greenhouse embed iframe → real posting URL
    ['https://boards.greenhouse.io/embed/job_app?for=acme&token=789&gh_src=1', 'https://boards.greenhouse.io/acme/jobs/789'],
    // Workday: strip apply flow
    ['https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Montreal/Software-Engineer_R-1234/apply/applyManually?source=LinkedIn', 'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Montreal/Software-Engineer_R-1234'],
    ['https://acme.wd5.myworkdayjobs.com/Careers/job/Toronto/Dev_R-9?source=Indeed', 'https://acme.wd5.myworkdayjobs.com/Careers/job/Toronto/Dev_R-9'],
    // LinkedIn: reduce to the job id
    ['https://www.linkedin.com/jobs/view/3912345678/?refId=abc&trackingId=xyz&trk=public_jobs', 'https://www.linkedin.com/jobs/view/3912345678'],
    ['https://www.linkedin.com/jobs/view/software-engineer-at-acme-3912345678?trk=x', 'https://www.linkedin.com/jobs/view/3912345678'],
    ['https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3912345678', 'https://www.linkedin.com/jobs/view/3912345678'],
  ])('%s', (input, expected) => {
    expect(canonicalPostingUrl(input)).toBe(expected);
  });

  it('drops fragments, trailing slashes and upper-case hosts, and upgrades to https', () => {
    expect(canonicalPostingUrl('http://JOBS.Lever.co/acme/abc/#apply')).toBe('https://jobs.lever.co/acme/abc');
  });

  it('keeps legitimate query parameters in their original order', () => {
    expect(canonicalPostingUrl('https://careers.acme.com/job?id=77&lang=en&utm_source=x&ref=y')).toBe('https://careers.acme.com/job?id=77&lang=en');
  });

  it('returns unparseable input unchanged', () => {
    expect(canonicalPostingUrl('not a url')).toBe('not a url');
  });
});
