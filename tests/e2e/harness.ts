import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultProfile, type Profile } from '../../src/profile/schema';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const EXTENSION = join(ROOT, '.output', 'chrome-mv3');
const FIXTURES = join(ROOT, 'tests', 'fixtures');

export interface Servers {
  /** Serves tests/fixtures plus /embed-parent.html that iframes the other origin. */
  main: { origin: string };
  /** A second origin, so iframes are genuinely cross-origin. */
  other: { origin: string };
  close(): Promise<void>;
}

function serve(embedTarget: () => string): Promise<{ server: Server; origin: string }> {
  return new Promise((res) => {
    const server = createServer((req, reply) => {
      const path = (req.url ?? '/').split('?')[0]!;
      if (path === '/embed-parent.html') {
        reply.setHeader('content-type', 'text/html');
        reply.end(`<!doctype html><title>Careers</title><h1>Careers at Acme</h1>
          <iframe id="grnhse_iframe" src="${embedTarget()}/greenhouse/classic.html" width="900" height="1400"></iframe>`);
        return;
      }
      // Pretty URLs that look like real ATS paths (the Lever apply form lives at …/apply).
      const aliases: Record<string, string> = { '/acme/abc/apply': '/lever/apply.html' };
      const file = join(FIXTURES, aliases[path] ?? path);
      if (!file.startsWith(FIXTURES) || !existsSync(file)) {
        reply.statusCode = 404;
        reply.end('not found');
        return;
      }
      reply.setHeader('content-type', 'text/html');
      reply.end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => res({ server, origin: `http://localhost:${(server.address() as AddressInfo).port}` }));
  });
}

export async function startServers(): Promise<Servers> {
  let otherOrigin = '';
  const main = await serve(() => otherOrigin);
  const other = await serve(() => main.origin);
  otherOrigin = other.origin;
  return {
    main: { origin: main.origin },
    other: { origin: other.origin },
    close: () => new Promise((r) => main.server.close(() => other.server.close(() => r()))),
  };
}

export interface Ext {
  context: BrowserContext;
  worker: Worker;
  id: string;
  close(): Promise<void>;
}

export async function launchExtension(): Promise<Ext> {
  if (!existsSync(join(EXTENSION, 'manifest.json'))) throw new Error('Build the test extension first: npm run build:test');
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'autofill-e2e-')), {
    // 'chromium' = Playwright's build; 'msedge' = installed Edge (use it where Playwright's Chromium will not start).
    // Branded Chrome 137+ cannot load unpacked extensions from the command line.
    channel: (process.env.E2E_CHANNEL as 'chromium' | 'chrome' | 'msedge' | undefined) ?? (process.platform === 'win32' ? 'msedge' : 'chromium'),
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      // Branded Chrome 137+ ignores --load-extension unless this feature is switched off.
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
    ],
  });
  // Record any submit gesture on every page and frame: the extension must never cause one.
  await context.addInitScript(() => {
    (window as any).__events = { submit: 0, submitClick: 0 };
    document.addEventListener('submit', () => (window as any).__events.submit++, true);
    document.addEventListener(
      'click',
      (e) => {
        if ((e.target as Element | null)?.closest?.('[type=submit], button:not([type=button])')) (window as any).__events.submitClick++;
      },
      true,
    );
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return { context, worker, id: new URL(worker.url()).host, close: () => context.close() };
}

export function e2eProfile(): Profile {
  const p = defaultProfile();
  p.contact = { ...p.contact, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '555-0100' };
  p.links.linkedin = 'https://linkedin.com/in/ada';
  p.links.github = 'https://github.com/ada';
  p.links.portfolio = 'https://ada.dev';
  p.address = { ...p.address, city: 'Montreal', region: 'QC', country: 'Canada' };
  p.work.authorizedCountries = ['Canada'];
  p.experience = [{ company: 'Analytical Engines', title: 'Engineer', location: '', startDate: '', endDate: '', current: true, description: '' }];
  return p;
}

/** Write profile + resume into the extension's storage via an extension page. */
export async function seed(ext: Ext, profile: Profile = e2eProfile()): Promise<void> {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.id}/options.html`);
  await page.evaluate(async (profileJson) => {
    await chrome.storage.local.set({ profile: profileJson, settings: { sheetId: '', tabName: 'Sheet1', anthropicApiKey: '', model: 'claude-opus-5-5', overwrite: false } });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('autofill-files', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('files', { keyPath: 'kind' });
      open.onsuccess = () => {
        const tx = open.result.transaction('files', 'readwrite');
        tx.objectStore('files').put({ kind: 'resume', name: 'ada-cv.pdf', mime: 'application/pdf', data: new TextEncoder().encode('%PDF-1.4 fake').buffer });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, profile as unknown as Record<string, unknown>);
  await page.close();
}

/** Run the same code path as the toolbar button/shortcut, for the tab showing `url`. */
export async function triggerFill(ext: Ext, page: Page): Promise<void> {
  const url = page.url();
  await ext.worker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    if (!tab?.id) throw new Error(`no tab for ${u}`);
    await (globalThis as any).__autofill.triggerFill(tab.id);
  }, url);
}

export async function savePosting(ext: Ext, page: Page): Promise<any> {
  const url = page.url();
  return ext.worker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    if (!tab?.id) throw new Error(`no tab for ${u}`);
    return (globalThis as any).__autofill.savePosting(tab.id);
  }, url);
}

export async function submitEvents(page: Page): Promise<{ submit: number; submitClick: number }> {
  let total = { submit: 0, submitClick: 0 };
  for (const frame of page.frames()) {
    const e = await frame.evaluate(() => (window as any).__events ?? { submit: 0, submitClick: 0 });
    total = { submit: total.submit + e.submit, submitClick: total.submitClick + e.submitClick };
  }
  return total;
}
