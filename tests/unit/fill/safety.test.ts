import { describe, expect, it } from 'vitest';
import { isFillable, safeClick, safeKey } from '../../../src/fill/safety';
import { listen, mount } from '../helpers';

const clicked = (html: string, selector: string) => {
  mount(html);
  const el = document.querySelector(selector)!;
  const seen = listen(el, 'click');
  const result = safeClick(el);
  return { result, fired: seen.count };
};

describe('safeClick refuses submit-like and CAPTCHA targets', () => {
  it.each([
    ['input[type=submit]', '<form><input type="submit" value="Go"></form>', 'input'],
    ['button with default type', '<form><button>Send</button></form>', 'button'],
    ['button type=submit', '<form><button type="submit">Whatever</button></form>', 'button'],
    ['Apply link-button', '<a role="button" href="#">Apply now</a>', 'a'],
    ['Next button', '<button type="button">Next</button>', 'button'],
    ['Save and continue', '<button type="button">Save and Continue</button>', 'button'],
    ['Workday next automation id', '<button type="button" data-automation-id="bottom-navigation-next-button">x</button>', 'button'],
    ['inside g-recaptcha', '<div class="g-recaptcha"><div id="t" role="checkbox"></div></div>', '#t'],
    ['inside hcaptcha', '<div class="h-captcha"><input id="t" type="checkbox"></div>', '#t'],
    ['captcha iframe', '<iframe id="t" src="https://www.google.com/recaptcha/api2/anchor"></iframe>', '#t'],
  ])('%s', (_name, html, selector) => {
    const r = clicked(html, selector);
    expect(r.result).toBe(false);
    expect(r.fired).toBe(0);
  });

  it('allows radios, checkboxes, options and plain icon buttons', () => {
    expect(clicked('<input id="t" type="radio">', '#t')).toEqual({ result: true, fired: 1 });
    expect(clicked('<input id="t" type="checkbox">', '#t')).toEqual({ result: true, fired: 1 });
    expect(clicked('<ul><li id="t" role="option">Apply</li></ul>', '#t')).toEqual({ result: true, fired: 1 });
    expect(clicked('<button id="t" type="button" aria-label="Toggle menu"></button>', '#t')).toEqual({ result: true, fired: 1 });
  });
});

describe('isFillable', () => {
  it('rejects passwords, hidden inputs and CAPTCHA response fields', () => {
    mount('<input id="a" type="password"><input id="b" type="hidden"><textarea id="c" name="g-recaptcha-response"></textarea><input id="d" type="text">');
    const get = (id: string) => document.getElementById(id)!;
    expect(isFillable(get('a'))).toBe(false);
    expect(isFillable(get('b'))).toBe(false);
    expect(isFillable(get('c'))).toBe(false);
    expect(isFillable(get('d'))).toBe(true);
  });
});

describe('safeKey', () => {
  it('blocks Enter on plain inputs but allows it on comboboxes', () => {
    mount('<input id="plain"><input id="combo" role="combobox">');
    expect(safeKey(document.getElementById('plain')!, 'Enter')).toBe(false);
    expect(safeKey(document.getElementById('combo')!, 'Enter')).toBe(true);
  });

  it('blocks arbitrary keys', () => {
    mount('<input id="combo" role="combobox">');
    expect(safeKey(document.getElementById('combo')!, 'a')).toBe(false);
  });
});
