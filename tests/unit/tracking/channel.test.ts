import { describe, expect, it } from 'vitest';
import { detectChannel } from '../../../src/tracking/prefill';
import { mount } from '../helpers';

const u = (s: string) => new URL(s);
const li = 'https://www.linkedin.com/jobs/view/123';

describe('detectChannel', () => {
  it('is website off LinkedIn', () => {
    mount('<button class="jobs-apply-button">Easy Apply</button>');
    expect(detectChannel(u('https://boards.greenhouse.io/acme/jobs/1'), document)).toBe('website');
  });

  it('is linkedin for an Easy Apply button, even when only the aria-label says so', () => {
    mount('<button class="jobs-apply-button"><span>Apply</span></button>');
    expect(detectChannel(u(li), document)).toBe('linkedin');
    mount('<button aria-label="Easy Apply to this job"><span>Apply</span></button>');
    expect(detectChannel(u(li), document)).toBe('linkedin');
  });

  it('is linkedin inside LinkedIn\'s apply flow URL, where the page has no Easy Apply button', () => {
    mount('<div>Application sent</div>');
    expect(detectChannel(u('https://www.linkedin.com/jobs/view/123/apply/?openSDUIApplyFlow=true'), document)).toBe('linkedin');
  });

  it('is website only when LinkedIn sends the applicant to the company site', () => {
    mount('<button class="jobs-apply-button" aria-label="Apply on company website">Apply</button>');
    expect(detectChannel(u(li), document)).toBe('website');
  });
});
