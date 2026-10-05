/**
 * LinkedIn is log-and-save only: the extension never autofills there. These helpers decide
 * whether the page is LinkedIn and whether the application is an Easy Apply.
 */
export const isLinkedIn = (url: URL) => /(^|\.)linkedin\.com$/i.test(url.hostname);

const EASY_APPLY_MODAL = '.jobs-easy-apply-modal, [data-test-modal-id="easy-apply-modal"], .jobs-easy-apply-content';
const APPLY_BUTTONS = '.jobs-apply-button, button[aria-label*="Easy Apply" i], a[aria-label*="Easy Apply" i], button[class*="apply" i]';

export function isEasyApply(doc: Document): boolean {
  if (doc.querySelector(EASY_APPLY_MODAL)) return true;
  return Array.from(doc.querySelectorAll(APPLY_BUTTONS)).some((b) =>
    /easy apply/i.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`),
  );
}
