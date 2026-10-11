/**
 * LinkedIn is log-and-save only: the extension never autofills there. These helpers decide
 * whether the page is LinkedIn and whether the application is an Easy Apply.
 */
export const isLinkedIn = (url: URL) => /(^|\.)linkedin\.com$/i.test(url.hostname);

const EASY_APPLY_MODAL = '.jobs-easy-apply-modal, [data-test-modal-id="easy-apply-modal"], .jobs-easy-apply-content, [class*="easy-apply" i]';
const APPLY_BUTTONS = '.jobs-apply-button, button[aria-label*="apply" i], a[aria-label*="apply" i], button[class*="apply" i]';

/** Roots to search: the page plus LinkedIn's shadow root, which can hold the Easy Apply modal. */
function roots(doc: Document): ParentNode[] {
  const shadow = doc.querySelector('#interop-outlet')?.shadowRoot;
  return shadow ? [doc, shadow] : [doc];
}

const buttonText = (b: Element) => `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`;

/** A visible Easy Apply modal, an Easy Apply button, or LinkedIn's in-page apply flow URL. */
export function isEasyApply(doc: Document, url?: URL): boolean {
  if (url && (/\/apply\/?$/.test(url.pathname) || url.searchParams.has('openSDUIApplyFlow'))) return true;
  return roots(doc).some(
    (r) =>
      r.querySelector(EASY_APPLY_MODAL) ||
      Array.from(r.querySelectorAll(APPLY_BUTTONS)).some((b) => /easy apply/i.test(buttonText(b))),
  );
}

/** The posting sends applicants to the employer's site ("Apply on company website") and offers no Easy Apply. */
export function appliesOnCompanySite(doc: Document): boolean {
  return roots(doc).some((r) =>
    Array.from(r.querySelectorAll(APPLY_BUTTONS)).some((b) => /company website|employer|external/i.test(buttonText(b))),
  );
}
