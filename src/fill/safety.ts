/**
 * The only module allowed to dispatch click/keyboard events on the host page.
 * Hard rules enforced here: never submit, never touch CAPTCHAs, never type passwords.
 * (ESLint bans .click()/.submit()/.requestSubmit() everywhere else in page-facing code.)
 */

const CAPTCHA_SELECTOR = [
  '.g-recaptcha',
  '.grecaptcha-badge',
  '.h-captcha',
  '.cf-turnstile',
  '[class*="captcha" i]',
  '[id*="captcha" i]',
  '[name*="captcha" i]',
  '[name="g-recaptcha-response"]',
  '[name="h-captcha-response"]',
  '[name="cf-turnstile-response"]',
  '[data-sitekey]',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="turnstile"]',
  'iframe[src*="arkoselabs"]',
  'iframe[src*="funcaptcha"]',
].join(',');

/** Text of buttons/links that advance or submit a form. */
const SUBMIT_LIKE_TEXT =
  /^\s*(submit|apply|apply now|submit application|send application|next|continue|save and continue|save & continue|review|review and submit|finish|done|complete)\b/i;

const SUBMIT_AUTOMATION_ID = /(bottom-navigation-next|submit|apply|pageFooterNextButton|continue)/i;

export function isCaptchaElement(el: Element): boolean {
  return !!el.closest(CAPTCHA_SELECTOR) || el.matches(CAPTCHA_SELECTOR);
}

export function isPasswordField(el: Element): boolean {
  return el instanceof HTMLInputElement && el.type === 'password';
}

/** True for anything that would submit or advance the form if clicked. */
export function isSubmitLike(el: Element): boolean {
  if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'image')) return true;
  // A <button> without a type attribute reports type "submit"; only type=button/reset are exempt.
  if (el instanceof HTMLButtonElement && el.type === 'submit') return true;
  if (el.getAttribute('role') === 'option' || el.getAttribute('role') === 'radio') return false;
  const isButtonish =
    el instanceof HTMLButtonElement ||
    el instanceof HTMLAnchorElement ||
    (el instanceof HTMLInputElement && el.type === 'button') ||
    el.getAttribute('role') === 'button';
  if (!isButtonish) return false;
  const text = (el.textContent || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '').trim();
  if (SUBMIT_LIKE_TEXT.test(text)) return true;
  const auto = el.getAttribute('data-automation-id') ?? '';
  return SUBMIT_AUTOMATION_ID.test(auto);
}

export function isClickAllowed(el: Element): boolean {
  return !isCaptchaElement(el) && !isSubmitLike(el);
}

/** Inputs we may write to. Passwords, CAPTCHA fields and hidden inputs are excluded. */
export function isFillable(el: Element): boolean {
  if (isCaptchaElement(el) || isPasswordField(el)) return false;
  if (el instanceof HTMLInputElement && (el.type === 'hidden' || el.disabled)) return false;
  return true;
}

function mouseEvent(win: Window, type: string, el: Element): MouseEvent {
  const rect = el.getBoundingClientRect();
  return new (win as any).MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  });
}

/**
 * Dispatch a full pointer/mouse click sequence. Returns false (and does nothing) when the
 * target is a submit/advance control or part of a CAPTCHA.
 */
export function safeClick(el: Element): boolean {
  if (!isClickAllowed(el)) return false;
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const ev =
      type.startsWith('pointer') && 'PointerEvent' in win
        ? new (win as any).PointerEvent(type, { bubbles: true, cancelable: true })
        : mouseEvent(win, type, el);
    el.dispatchEvent(ev);
  }
  return true;
}

/**
 * Click the element a real click on `el` would actually hit: the innermost element holding its
 * text. Events bubble, so handlers on the option itself still fire, and handlers attached to an
 * inner span (some widgets do this) now fire too. The same submit/CAPTCHA refusals apply.
 */
export function safeClickDeep(el: Element): boolean {
  if (!isClickAllowed(el)) return false;
  let target: Element = el;
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() && node.parentElement) {
      target = node.parentElement;
      break;
    }
  }
  return safeClick(isClickAllowed(target) ? target : el);
}

/** Dispatch only mousedown (react-select opens its menu on mousedown). */
export function safeMouseDown(el: Element): boolean {
  if (!isClickAllowed(el)) return false;
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  el.dispatchEvent(mouseEvent(win, 'mousedown', el));
  return true;
}

const ALLOWED_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Escape', 'Tab', 'Enter']);

/**
 * Synthetic key events for driving comboboxes. Enter is only allowed on a combobox/listbox
 * control, never on a plain input (it could be treated as a submit gesture by the page).
 */
export function safeKey(el: Element, key: string): boolean {
  if (!ALLOWED_KEYS.has(key) || isCaptchaElement(el) || isPasswordField(el)) return false;
  if (key === 'Enter') {
    const comboLike =
      el.getAttribute('role') === 'combobox' ||
      el.hasAttribute('aria-haspopup') ||
      !!el.closest('[role="listbox"],[role="combobox"]');
    if (!comboLike) return false;
  }
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  for (const type of ['keydown', 'keyup']) {
    el.dispatchEvent(new (win as any).KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }));
  }
  return true;
}
