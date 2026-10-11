import { describe, expect, it } from 'vitest';
import { extractPosting } from '../../../src/posting/extract';
import { locationFromLd } from '../../../src/posting/location';
import { classifyLocation } from '../../../src/tracking/location';
import { mount } from '../helpers';

const LONG = 'We are looking for an engineer to build reliable services. '.repeat(8);
const page = (body: string, url = 'https://careers.example.com/jobs/123') => {
  mount(`<h1>Backend Engineer</h1>${body}<article><p>${LONG}</p></article>`);
  return extractPosting(document, new URL(url)).location;
};
const ld = (job: object) => `<script type="application/ld+json">${JSON.stringify(job)}</script>`;

describe('location on sites with no ATS-specific markup', () => {
  it.each([
    ['a definition list', '<dl><dt>Location</dt><dd>Montreal, QC</dd><dt>Team</dt><dd>Platform</dd></dl>', 'Montreal, QC'],
    ['a table row', '<table><tr><th>Job location</th><td>Toronto, Ontario</td></tr></table>', 'Toronto, Ontario'],
    ['a caption and a sibling', '<div><span class="k">Location:</span><span class="v">Vancouver, BC</span></div>', 'Vancouver, BC'],
    ['caption and value in one element', '<p><strong>Location</strong> Remote - Canada</p>', 'Remote - Canada'],
    ['written inline', '<ul><li>Team: Platform</li><li>Location: Montreal, QC</li></ul>', 'Montreal, QC'],
    ['in French', '<p>Lieu de travail : Montréal, QC</p>', 'Montréal, QC'],
    ['a class that says location', '<div class="job-meta__location">Ottawa, ON</div>', 'Ottawa, ON'],
    ['a data-testid that says location', '<span data-testid="job-location">Calgary, AB</span>', 'Calgary, AB'],
    ['microdata', '<span itemprop="jobLocation"><span itemprop="addressLocality">Toronto</span>, <span itemprop="addressRegion">ON</span></span>', 'Toronto , ON'],
  ])('reads it from %s', (_name, html, expected) => {
    expect(page(html)).toBe(expected);
    expect(classifyLocation(expected)).not.toBeNull();
  });

  it('reads the line under the title when it is a real place', () => {
    expect(page('<p>Toronto, ON</p>')).toBe('Toronto, ON');
    // …and ignores a line under the title that is not one.
    expect(page('<p>Full-time · Engineering</p>')).toBe('');
  });

  it('reads it from the page title', () => {
    mount(`<h1>Backend Engineer</h1><article><p>${LONG}</p></article>`);
    document.title = 'Backend Engineer - Montreal, QC - Acme';
    expect(extractPosting(document, new URL('https://careers.example.com/jobs/1')).location).toBe('Montreal, QC');
    document.title = '';
  });

  it('never reads it from the application form or the navigation', () => {
    expect(page('<nav><a class="location">Toronto, ON</a></nav><form><label>Location</label><input name="location"><div class="location">Vancouver, BC</div></form>')).toBe('');
  });

  it('shows what the page said even when it cannot be placed', () => {
    const text = page('<dl><dt>Location</dt><dd>Our lunar base</dd></dl>');
    expect(text).toBe('Our lunar base');
    expect(classifyLocation(text)).toBeNull();
  });
});

describe('a wrong first match no longer hides the right answer', () => {
  it('skips a junk selector hit in favour of the structured data', () => {
    mount(`<div class="location-heading">Where you will work</div>
      ${ld({ '@type': 'JobPosting', title: 'X', jobLocation: { address: { addressLocality: 'Toronto', addressRegion: 'ON', addressCountry: 'CA' } } })}
      <div id="content"><div class="body"><p>${LONG}</p></div></div>`);
    expect(extractPosting(document, new URL('https://boards.greenhouse.io/acme/jobs/1')).location).toBe('Toronto, ON, Canada');
  });

  it('reads Workday when the caption is glued to the value, and falls back to the address', () => {
    mount(`<h2 data-automation-id="jobPostingHeader">Data Engineer</h2>
      <div data-automation-id="locations"><dl><dt>locations</dt><dd>Vancouver, BC</dd></dl></div>
      <div data-automation-id="jobPostingDescription"><p>${LONG}</p></div>`);
    expect(extractPosting(document, new URL('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Vancouver-BC/Data-Engineer_R-1')).location).toBe('Vancouver, BC');

    mount(`<h2 data-automation-id="jobPostingHeader">Data Engineer</h2><div data-automation-id="jobPostingDescription"><p>${LONG}</p></div>`);
    const fromUrl = extractPosting(document, new URL('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Vancouver-BC/Data-Engineer_R-1')).location;
    expect(classifyLocation(fromUrl)).toBe('vancouver');
  });
});

describe('schema.org JobPosting locations', () => {
  it.each([
    [{ jobLocation: 'Montreal, QC' }, 'Montreal, QC'],
    [{ jobLocation: { address: 'Toronto, Ontario, Canada' } }, 'Toronto, Ontario, Canada'],
    [{ jobLocation: { address: { addressLocality: 'Ottawa', addressRegion: 'ON', addressCountry: { name: 'CA' } } } }, 'Ottawa, ON, Canada'],
    [{ jobLocation: [{ address: { addressLocality: 'Toronto' } }, { address: { addressLocality: 'Vancouver' } }] }, 'Toronto | Vancouver'],
    [{ jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: 'Canada' } }, 'Remote - Canada'],
    [{ jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: [{ name: 'CA' }, { name: 'US' }] }, 'Remote - Canada | United States'],
    [{ jobLocationType: 'TELECOMMUTE' }, 'Remote'],
    [{}, ''],
  ])('%j → %s', (job, expected) => {
    expect(locationFromLd(job)).toBe(expected);
  });

  it('finds the posting inside @graph, after other items, and survives null entries and broken blocks', () => {
    mount(`<script type="application/ld+json">{ broken</script>
      ${ld([null, { '@type': 'Organization', name: 'Acme' }, { '@graph': [{ '@type': 'WebPage' }, { '@type': ['Thing', 'JobPosting'], title: 'Backend Engineer', jobLocation: 'Montreal, QC' }] }])}
      <article><p>${LONG}</p></article>`);
    const p = extractPosting(document, new URL('https://careers.example.com/jobs/1'));
    expect(p).toMatchObject({ title: 'Backend Engineer', location: 'Montreal, QC' });
  });

  it('reads a remote Canadian posting as canada', () => {
    expect(classifyLocation(page(ld({ '@type': 'JobPosting', jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { name: 'CA' } })))).toBe('canada');
  });
});

describe('classifying locations written loosely', () => {
  it.each([
    ['Montreal QC', 'montreal'],
    ['Montréal Québec Canada', 'montreal'],
    ['Toronto ON Canada', 'toronto'],
    ['Toronto Ontario', 'toronto'],
    ['Vancouver BC', 'vancouver'],
    ['Ottawa ON', 'canada'],
    ['Seattle WA', 'USA'],
    ['New York NY', 'USA'],
    ['Austin Texas', 'USA'],
    ['London United Kingdom', 'london'],
    ['London UK', 'london'],
    ['Seattle US', 'USA'],
    ['Toronto and Montreal', 'canada'],
    ['Toronto & Vancouver', 'canada'],
    ['Montreal + Remote', 'montreal'],
    ['Toronto, ON and New York, NY', 'canada'],
    ['Based in Montreal', 'montreal'],
    ['Located in Toronto, ON', 'toronto'],
    ['locationsVancouver, BC', 'vancouver'],
    ['St. John\'s, Newfoundland and Labrador', 'canada'],
    ['Remote in Canada', 'canada'],
  ])('%s → %s', (input, expected) => {
    expect(classifyLocation(input)).toBe(expected);
  });

  it.each(['Work in progress', 'Tell me more', 'Engineering or Design', 'Remote', 'Full-time', 'Join us', 'About us', 'Contact UK team', 'Apply - Unknown ATS'])('does not invent a place for "%s"', (input) => {
    expect(classifyLocation(input)).toBeNull();
  });
});
