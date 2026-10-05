import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlatformAdapter } from '../../src/adapters/types';
import { runFill, type FillRun } from '../../src/fill/engine';
import { captureAnswers } from '../../src/review/capture';
import { collectFormAnswers } from '../../src/review/formAnswers';
import { defaultProfile, type Profile } from '../../src/profile/schema';

/**
 * Load tests/fixtures/<path> into the jsdom document. Inline scripts are not executed unless
 * `runScripts` is set (used for fixtures whose widgets need their behaviour, e.g. dropdowns).
 */
export function loadFixture(path: string, opts: { runScripts?: boolean } = {}): void {
  const html = readFileSync(resolve(__dirname, '../fixtures', path), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const scripts = Array.from(parsed.querySelectorAll('script')).map((s) => s.textContent ?? '');
  parsed.querySelectorAll('script').forEach((s) => s.remove());
  document.body.innerHTML = parsed.body.innerHTML;
  if (opts.runScripts) for (const code of scripts) (0, eval)(code);
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
  p.experience = [
    { company: 'Analytical Engines', title: 'Engineer', location: 'Montreal, QC', startDate: '2025-05', endDate: '', current: true, description: 'Built the engine.' },
  ];
  p.education = [{ school: 'Example University', degree: 'BSc', field: 'Computer Science', startDate: '2022-09', endDate: '2026-05', gpa: '3.9', current: false }];
  return p;
}

/** Four past internships (none current), as in a student profile; education says just "Bachelor". */
export function fourInternshipsProfile(): Profile {
  const p = testProfile();
  const job = (company: string, title: string, y: number) => ({
    company, title, location: 'Montreal, QC', startDate: `${y}-05`, endDate: `${y}-08`, current: false, description: `${company} work in ${y}.`,
  });
  p.experience = [job('Alpha Labs', 'SWE Intern', 2025), job('Beta Systems', 'Backend Intern', 2024), job('Gamma Cloud', 'Platform Intern', 2023), job('Delta Data', 'Data Intern', 2022)];
  p.education = [{ school: 'Example University', degree: 'Bachelor', field: 'Computer Science', startDate: '2022-09', endDate: '2026-05', gpa: '', current: true }];
  return p;
}

const scanCtx = () => ({ doc: document, url: new URL('https://example.com/apply'), isTopFrame: true });

/** What "Save my answers" would capture right now: re-scans the page against the last fill. */
export const capturedNow = (adapter: PlatformAdapter, run: FillRun) => captureAnswers(adapter.getFields(scanCtx()), run);

/** What answers.json would hold right now. */
export const formAnswersNow = (adapter: PlatformAdapter, run: FillRun) => collectFormAnswers(adapter.getFields(scanCtx()), run);

export const fakeFile = () =>new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' });

export function fillWith(adapter: PlatformAdapter, url: string, profile = testProfile(), overwrite = false) {
  return runFill({
    adapter,
    ctx: { doc: document, url: new URL(url), isTopFrame: true },
    profile,
    options: { overwrite, getFile: async () => null },
  });
}
