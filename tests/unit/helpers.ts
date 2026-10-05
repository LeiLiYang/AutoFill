import { buildDescriptors } from '../../src/detect/descriptor';

export function mount(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

export const descriptors = (html: string) => buildDescriptors(mount(html), document);

export function listen(el: Element, type: string): { count: number } {
  const state = { count: 0 };
  el.addEventListener(type, () => state.count++);
  return state;
}
