/**
 * Whether an option element is currently selected. Native radios/checkboxes use `checked`; custom
 * widgets (button groups, listbox options) expose state through ARIA attributes or a state class.
 */
export function isOptionSelected(el: Element | undefined): boolean {
  if (!el) return false;
  if ((el as HTMLInputElement).checked === true) return true;
  if (['aria-pressed', 'aria-checked', 'aria-selected'].some((a) => el.getAttribute(a) === 'true')) return true;
  if (el.getAttribute('data-state') === 'checked' || el.getAttribute('data-state') === 'on') return true;
  return /(^|[\s_-])(selected|active|checked|is-selected|is-active)([\s_-]|$)/i.test(el.getAttribute('class') ?? '');
}
