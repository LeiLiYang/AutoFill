/** The review panel's own shadow host: its log-card inputs are never form fields. */
const OWN_HOST_ID = 'autofill-review-host';

/**
 * querySelectorAll that also descends into open shadow roots (web-component career sites keep
 * their inputs there). Light-DOM matches come first, in document order.
 */
export function deepQueryAll<T extends Element>(root: ParentNode, selector: string): T[] {
  const out = Array.from(root.querySelectorAll<T>(selector));
  for (const host of Array.from(root.querySelectorAll('*'))) {
    if (host.shadowRoot && host.id !== OWN_HOST_ID) out.push(...deepQueryAll<T>(host.shadowRoot, selector));
  }
  return out;
}

/** Parent element, stepping out of a shadow root to its host. */
export function parentAcrossShadow(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode?.();
  return root && 'host' in root ? (root as ShadowRoot).host : null;
}
