import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlatformAdapter } from '../../src/adapters/types';
import { runFill } from '../../src/fill/engine';
import { defaultProfile, type Profile } from '../../src/profile/schema';

/** Load tests/fixtures/<path> into the jsdom document (scripts are not executed). */
export function loadFixture(path: string): void {
  const html = readFileSync(resolve(__dirname, '../fixtures', path), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script').forEach((s) => s.remove());
  document.body.innerHTML = parsed.body.innerHTML;
}

export function testProfile(): Profile {
  const p = defaultProfile();
  p.contact = { ...p.contact, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '555-0100' };
  p.links.linkedin = 'https://linkedin.com/in/ada';
  p.links.github = 'https://github.com/ada';
  p.links.portfolio = 'https://ada.dev';
  p.address = { ...p.address, city: 'Montreal', region: 'QC', country: 'Canada' };
  p.work.authorizedCountries = ['Canada'];
  p.work.requiresSponsorship = false;
  p.experience = [{ company: 'Analytical Engines', title: 'Engineer', location: '', startDate: '', endDate: '', current: true, description: '' }];
  return p;
}

export const fakeFile = () => new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' });

export function fillWith(adapter: PlatformAdapter, url: string, profile = testProfile(), overwrite = false) {
  return runFill({
    adapter,
    ctx: { doc: document, url: new URL(url), isTopFrame: true },
    profile,
    options: { overwrite, getFile: async () => null },
  });
}
