import { createRoot, type Root } from 'react-dom/client';
import { Panel, type PanelProps } from './Panel';
import css from './panel.css?inline';

export const PANEL_HOST_ID = 'autofill-review-host';

export interface PanelHandle {
  update(props: PanelProps): void;
  unmount(): void;
}

/** Mount the review panel inside a shadow root so the site's CSS cannot affect it. */
export function mountPanel(doc: Document, initial: PanelProps): PanelHandle {
  doc.getElementById(PANEL_HOST_ID)?.remove();
  const host = doc.createElement('div');
  host.id = PANEL_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = css;
  const mount = doc.createElement('div');
  shadow.append(style, mount);
  doc.documentElement.appendChild(host);

  const root: Root = createRoot(mount);
  const render = (p: PanelProps) => root.render(<Panel {...p} />);
  render(initial);
  return {
    update: render,
    unmount() {
      root.unmount();
      host.remove();
    },
  };
}
